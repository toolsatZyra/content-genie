-- Bound authenticated FAL polling and provide a truthful terminal path for a
-- request that remains missing, rejected, or unreachable. The poll count is
-- operational recovery state; provider and World authority remain fenced.

alter table private.provider_requests
  add column if not exists fal_authenticated_poll_count integer
  not null default 0
  check (fal_authenticated_poll_count between 0 and 100);

create or replace function public.get_next_fal_authenticated_poll_candidate(
  p_environment text,
  p_minimum_age_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  poll_attempt_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_environment not in ('development','preview','production','test')
    or p_minimum_age_seconds not between 15 and 3600
  then
    raise exception 'fal poll recovery scope is invalid' using errcode = '22023';
  end if;

  select request.id as provider_request_id,
    request.external_job_id
  into candidate
  from private.provider_requests request
  join private.provider_accounts account
    on account.id = request.provider_account_id
  where account.provider = 'fal'
    and account.environment = p_environment
    and account.state = 'active'
    and request.operation in ('gen_image','edit_image')
    and request.state in ('accepted','polling')
    and request.external_job_id is not null
    and request.fal_authenticated_poll_count < 100
    and request.updated_at <= statement_timestamp()
      - make_interval(secs => p_minimum_age_seconds)
    and not exists (
      select 1 from private.provider_output_candidates output
      where output.provider_request_id = request.id
    )
  order by request.updated_at, request.id
  for update of request skip locked
  limit 1;

  if candidate.provider_request_id is null then
    return jsonb_build_object('empty', true, 'ok', true);
  end if;

  update private.provider_requests
  set fal_authenticated_poll_count = fal_authenticated_poll_count + 1,
      updated_at = statement_timestamp()
  where id = candidate.provider_request_id
  returning fal_authenticated_poll_count into poll_attempt_count;

  return jsonb_build_object(
    'empty', false,
    'externalJobId', candidate.external_job_id,
    'ok', true,
    'pollAttemptCount', poll_attempt_count,
    'providerRequestId', candidate.provider_request_id
  );
end;
$$;

create or replace function public.command_fail_fal_authenticated_poll_candidate(
  p_provider_request_id uuid,
  p_safe_error_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.world_anchor_jobs%rowtype;
  request private.provider_requests%rowtype;
  account private.provider_accounts%rowtype;
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'fal poll failure class is invalid' using errcode = '22023';
  end if;

  -- Global order for World provider settlement: job -> provider request ->
  -- run -> attempt -> stage -> regeneration request.
  select * into job
  from private.world_anchor_jobs
  where provider_request_id = p_provider_request_id
  for update;
  select * into request
  from private.provider_requests
  where id = p_provider_request_id
  for update;
  if job.id is null or request.id is null then
    raise exception 'fal poll failure binding is unavailable'
      using errcode = 'P0002';
  end if;
  select * into account
  from private.provider_accounts
  where id = request.provider_account_id;
  select * into run
  from public.preflight_runs
  where id = job.preflight_run_id
  for update;
  select * into attempt
  from public.preflight_stage_attempts
  where id = job.stage_attempt_id
  for update;
  select * into stage
  from public.preflight_stage_runs
  where id = attempt.preflight_stage_run_id
  for update;

  if account.provider <> 'fal'
    or request.operation not in ('gen_image','edit_image')
    or request.state not in ('accepted','polling')
    or job.state <> 'waiting_output'
    or run.id is null
    or attempt.id is null
    or stage.id is null
    or job.workspace_id <> run.workspace_id
    or request.workspace_id <> run.workspace_id
    or request.preflight_run_id <> run.id
    or request.stage_attempt_id <> attempt.id
    or attempt.preflight_run_id <> run.id
    or stage.preflight_run_id <> run.id
    or attempt.preflight_stage_run_id <> stage.id
    or run.state <> 'waiting_external'
    or attempt.state <> 'waiting_external'
    or stage.state <> 'waiting_external'
    or run.authority_epoch <> attempt.authority_epoch
    or stage.highest_fencing_token <> attempt.fencing_token
  then
    return jsonb_build_object(
      'ok', true,
      'providerRequestId', request.id,
      'terminalized', false
    );
  end if;

  if job.regeneration_request_id is not null then
    perform public.command_fail_world_regeneration(
      job.regeneration_request_id,
      p_safe_error_class
    );
  end if;

  update private.provider_requests
  set state = 'failed_terminal',
      aggregate_version = aggregate_version + 1,
      completed_at = statement_timestamp()
  where id = request.id
    and state in ('accepted','polling');

  update private.world_anchor_jobs
  set state = 'failed',
      safe_failure_class = p_safe_error_class
  where id = job.id
    and state = 'waiting_output';

  update public.preflight_stage_attempts
  set state = 'failed_terminal',
      safe_error_class = p_safe_error_class,
      completed_at = statement_timestamp()
  where id = attempt.id
    and state = 'waiting_external';

  update public.preflight_stage_leases
  set state = 'revoked',
      closed_at = statement_timestamp()
  where stage_attempt_id = attempt.id
    and state = 'active';

  update public.preflight_stage_runs
  set state = 'failed_terminal',
      aggregate_version = aggregate_version + 1,
      completed_at = statement_timestamp()
  where id = stage.id
    and state = 'waiting_external';

  insert into private.preflight_dead_letters(
    workspace_id, preflight_run_id, stage_attempt_id, authority_epoch,
    fencing_token, reason_class, safe_summary
  ) values (
    attempt.workspace_id, attempt.preflight_run_id, attempt.id,
    attempt.authority_epoch, attempt.fencing_token, p_safe_error_class,
    jsonb_build_object(
      'stageKey', stage.stage_key,
      'attemptNo', attempt.attempt_no,
      'maximumAttempts', stage.maximum_attempts,
      'providerRequestId', request.id,
      'pollAttemptCount', request.fal_authenticated_poll_count
    )
  ) on conflict(stage_attempt_id, fencing_token) do nothing;

  update public.preflight_runs
  set state = 'failed',
      aggregate_version = aggregate_version + 1,
      completed_at = statement_timestamp(),
      reconciliation_due_at = null
  where id = run.id
    and state = 'waiting_external';

  update public.world_build_progress_items
  set state = 'failed',
      safe_detail = p_safe_error_class,
      updated_at = statement_timestamp()
  where preflight_run_id = run.id
    and state not in ('review_ready','failed');

  insert into private.diagnostic_events(
    event_type, occurred_at, environment, workspace_id, aggregate_type,
    aggregate_id, correlation_id, stage, provider, status, error_class,
    retry_count, safe_summary, retention_class, source, dedupe_hash
  ) values (
    'provider_output.poll_terminal', statement_timestamp(), account.environment,
    request.workspace_id, 'provider_request', request.id, request.id::text,
    'authenticated_poll', 'fal', 'rejected', p_safe_error_class,
    request.fal_authenticated_poll_count,
    'FAL authenticated polling exhausted safely.', 'operational',
    'reconciler',
    encode(extensions.digest(convert_to(
      request.id::text || ':' || p_safe_error_class,
      'UTF8'
    ), 'sha256'), 'hex')
  ) on conflict (dedupe_hash) where dedupe_hash is not null do nothing;

  return jsonb_build_object(
    'ok', true,
    'providerRequestId', request.id,
    'terminalized', true
  );
end;
$$;

revoke all on function public.get_next_fal_authenticated_poll_candidate(text, integer)
from public, anon, authenticated;
revoke all on function public.command_fail_fal_authenticated_poll_candidate(uuid, text)
from public, anon, authenticated;
grant execute on function public.get_next_fal_authenticated_poll_candidate(text, integer)
to service_role;
grant execute on function public.command_fail_fal_authenticated_poll_candidate(uuid, text)
to service_role;

-- A provider output that exhausts secure-ingest retries must terminalize its
-- World attempt. Previously the candidate became `rejected` while the World
-- job and preflight run remained `waiting_output` / `waiting_external`,
-- leaving the Episode without a truthful retry path.

create or replace function private.fail_world_anchor_run_for_candidate(
  p_candidate_id uuid,
  p_safe_error_class text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.world_anchor_jobs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
begin
  if p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'world anchor failure class is invalid' using errcode = '22023';
  end if;

  select anchor.* into job
  from private.provider_output_candidates candidate
  join private.world_anchor_jobs anchor
    on anchor.provider_request_id = candidate.provider_request_id
  where candidate.id = p_candidate_id
    and candidate.state = 'rejected'
    and anchor.state = 'waiting_output'
  for update of anchor;
  if job.id is null then
    return false;
  end if;

  select * into attempt
  from public.preflight_stage_attempts
  where id = job.stage_attempt_id
  for update;
  select * into stage
  from public.preflight_stage_runs
  where id = attempt.preflight_stage_run_id
  for update;
  select * into run
  from public.preflight_runs
  where id = job.preflight_run_id
  for update;
  if attempt.id is null or stage.id is null or run.id is null then
    raise exception 'world anchor failure authority is incomplete'
      using errcode = '55000';
  end if;

  update private.world_anchor_jobs
  set state = 'failed',
      safe_failure_class = p_safe_error_class
  where preflight_run_id = run.id
    and state in ('reserved','dispatching','waiting_output');

  update public.preflight_stage_attempts
  set state = 'failed_terminal',
      safe_error_class = p_safe_error_class,
      completed_at = statement_timestamp()
  where id = attempt.id
    and state in ('claimed','running','waiting_external','waiting_decision');

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
    and state not in ('succeeded','failed_terminal','canceled','superseded');

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
      'providerOutputCandidateId', p_candidate_id
    )
  ) on conflict(stage_attempt_id, fencing_token) do nothing;

  update public.preflight_runs
  set state = 'failed',
      aggregate_version = aggregate_version + 1,
      completed_at = statement_timestamp(),
      reconciliation_due_at = null
  where id = run.id
    and state not in ('succeeded','failed','canceled','superseded');

  return true;
end;
$$;

create or replace function public.command_reconcile_terminal_world_anchor_ingest(
  p_limit integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate private.provider_output_candidates%rowtype;
  failure_class text;
  reconciled integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'terminal ingest reconciliation limit is invalid'
      using errcode = '22023';
  end if;

  for candidate in
    select output.*
    from private.provider_output_candidates output
    join private.world_anchor_jobs anchor
      on anchor.provider_request_id = output.provider_request_id
    where output.state = 'rejected'
      and anchor.state = 'waiting_output'
    order by output.completed_at, output.id
    for update of output skip locked
    limit p_limit
  loop
    select event.error_class into failure_class
    from private.diagnostic_events event
    where event.event_type = 'provider_output.ingest_failed'
      and event.aggregate_type = 'provider_output_candidate'
      and event.aggregate_id = candidate.id
    order by event.occurred_at desc, event.id desc
    limit 1;
    failure_class := coalesce(
      failure_class,
      'provider_output.ingest_rejected'
    );
    if private.fail_world_anchor_run_for_candidate(
      candidate.id,
      failure_class
    ) then
      reconciled := reconciled + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'reconciled', reconciled
  );
end;
$$;

create or replace function public.command_fail_provider_output_candidate(
  p_candidate_id uuid,
  p_lease_token uuid,
  p_retryable boolean,
  p_safe_error_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate private.provider_output_candidates%rowtype;
  retry boolean;
  event_environment text;
  quarantine_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'provider output failure class is invalid' using errcode = '22023';
  end if;
  select * into candidate from private.provider_output_candidates
  where id = p_candidate_id for update;
  if candidate.id is null or not (
    (candidate.state = 'claimed' and candidate.lease_token = p_lease_token
      and candidate.lease_expires_at > statement_timestamp())
    or
    (candidate.state = 'quarantined' and candidate.lease_token is null
      and candidate.quarantine_asset_version_id is not null)
  ) then
    raise exception 'provider output failure lease is stale' using errcode = '40001';
  end if;
  quarantine_id := candidate.quarantine_asset_version_id;
  retry := p_retryable and candidate.attempt_count < 5;
  if quarantine_id is not null then
    update private.quarantine_assets
    set state = 'rejected', completed_at = statement_timestamp()
    where id = quarantine_id and state in ('quarantined', 'scanning');
  end if;
  update private.provider_output_candidates
  set state = case when retry then 'pending'::private.provider_output_candidate_state
      else 'rejected'::private.provider_output_candidate_state end,
    available_at = case when retry then statement_timestamp() +
      make_interval(secs => least(60, (2 ^ attempt_count)::integer)) else available_at end,
    lease_token = null,
    lease_expires_at = null,
    quarantine_asset_version_id = null,
    completed_at = case when retry then null else statement_timestamp() end
  where id = candidate.id returning * into candidate;
  select account.environment into event_environment
  from private.provider_requests request
  join private.provider_accounts account on account.id = request.provider_account_id
  where request.id = candidate.provider_request_id;
  insert into private.diagnostic_events(
    event_type, occurred_at, environment, workspace_id, aggregate_type,
    aggregate_id, correlation_id, stage, provider, status, error_class,
    retry_count, safe_summary, retention_class, source, dedupe_hash
  ) values (
    'provider_output.ingest_failed', statement_timestamp(), event_environment,
    candidate.workspace_id, 'provider_output_candidate', candidate.id,
    candidate.id::text, 'secure_ingest', 'fal',
    case when retry then 'retrying' else 'rejected' end,
    p_safe_error_class, candidate.attempt_count,
    'Provider output secure ingest failed safely.', 'operational', 'reconciler',
    encode(extensions.digest(convert_to(candidate.id::text || ':' ||
      candidate.attempt_count::text || ':' || p_safe_error_class, 'UTF8'), 'sha256'), 'hex')
  ) on conflict (dedupe_hash) where dedupe_hash is not null do nothing;
  if not retry then
    perform private.fail_world_anchor_run_for_candidate(
      candidate.id,
      p_safe_error_class
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'candidateId', candidate.id,
    'state', candidate.state,
    'retryable', retry
  );
end;
$$;

revoke all on function private.fail_world_anchor_run_for_candidate(uuid, text)
from public, anon, authenticated;
revoke all on function public.command_reconcile_terminal_world_anchor_ingest(integer)
from public, anon, authenticated;
revoke all on function public.command_fail_provider_output_candidate(uuid, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.command_reconcile_terminal_world_anchor_ingest(integer)
to service_role;
grant execute on function public.command_fail_provider_output_candidate(uuid, uuid, boolean, text)
to service_role;

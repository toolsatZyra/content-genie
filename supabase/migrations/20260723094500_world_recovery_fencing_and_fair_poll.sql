-- Harden terminal World ingest reconciliation and make authenticated FAL
-- recovery polling fair. A rejected output may only terminate the exact
-- attempt that still owns the run's current fencing and authority epoch.

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
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
begin
  if p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'world anchor failure class is invalid' using errcode = '22023';
  end if;

  -- Match the completion lock order: job -> run -> attempt -> stage. The
  -- candidate is already locked by command_fail_provider_output_candidate or
  -- the bounded reconciler.
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

  -- A late candidate from an older attempt is evidence, never authority to
  -- terminate a newer attempt or completed run.
  if run.id is null or attempt.id is null or stage.id is null
    or job.workspace_id <> run.workspace_id
    or attempt.workspace_id <> run.workspace_id
    or attempt.preflight_run_id <> run.id
    or stage.preflight_run_id <> run.id
    or attempt.preflight_stage_run_id <> stage.id
    or run.state <> 'waiting_external'
    or attempt.state <> 'waiting_external'
    or stage.state <> 'waiting_external'
    or run.authority_epoch <> attempt.authority_epoch
    or stage.highest_fencing_token <> attempt.fencing_token
  then
    return false;
  end if;

  if job.regeneration_request_id is not null then
    perform public.command_fail_world_regeneration(
      job.regeneration_request_id,
      p_safe_error_class
    );
  end if;

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
      'providerOutputCandidateId', p_candidate_id
    )
  ) on conflict(stage_attempt_id, fencing_token) do nothing;

  update public.preflight_runs
  set state = 'failed',
      aggregate_version = aggregate_version + 1,
      completed_at = statement_timestamp(),
      reconciliation_due_at = null
  where id = run.id
    and state = 'waiting_external';

  -- Preserve already promoted anchors while making every unfinished card
  -- truthful and immediately retryable. Do not lock unrelated provider jobs.
  update public.world_build_progress_items
  set state = 'failed',
      safe_detail = p_safe_error_class,
      updated_at = statement_timestamp()
  where preflight_run_id = run.id
    and state not in ('review_ready', 'failed');

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
    join public.preflight_runs run
      on run.id = anchor.preflight_run_id
    join public.preflight_stage_attempts attempt
      on attempt.id = anchor.stage_attempt_id
    join public.preflight_stage_runs stage
      on stage.id = attempt.preflight_stage_run_id
    where output.state = 'rejected'
      and anchor.state = 'waiting_output'
      and run.state = 'waiting_external'
      and attempt.state = 'waiting_external'
      and stage.state = 'waiting_external'
      and attempt.preflight_run_id = run.id
      and stage.preflight_run_id = run.id
      and run.authority_epoch = attempt.authority_epoch
      and stage.highest_fencing_token = attempt.fencing_token
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

-- Rotate a selected request to the back of the eligible queue before returning
-- it. The row lock plus updated_at touch provides a bounded, concurrent-safe
-- polling lease without changing provider authority state.
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
  set updated_at = statement_timestamp()
  where id = candidate.provider_request_id;

  return jsonb_build_object(
    'empty', false,
    'externalJobId', candidate.external_job_id,
    'ok', true,
    'providerRequestId', candidate.provider_request_id
  );
end;
$$;

revoke all on function private.fail_world_anchor_run_for_candidate(uuid, text)
from public, anon, authenticated;
revoke all on function public.command_reconcile_terminal_world_anchor_ingest(integer)
from public, anon, authenticated;
revoke all on function public.get_next_fal_authenticated_poll_candidate(text, integer)
from public, anon, authenticated;
grant execute on function public.command_reconcile_terminal_world_anchor_ingest(integer)
to service_role;
grant execute on function public.get_next_fal_authenticated_poll_candidate(text, integer)
to service_role;

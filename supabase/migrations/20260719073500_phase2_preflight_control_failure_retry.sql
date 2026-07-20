-- Close the Trigger/control failure loop with database-owned bounded retries.
-- A Trigger retry can never reuse a terminal attempt: the failed attempt is
-- immutable evidence, the root stage is re-queued, and the dispatcher creates
-- a fresh attempt with a higher fence. Exhaustion is dead-lettered and fails
-- the run closed.

create or replace function public.command_fail_preflight_control(
  p_stage_attempt_id uuid,
  p_fencing_token bigint,
  p_authority_epoch bigint,
  p_input_manifest_hash text,
  p_trigger_task_id text,
  p_trigger_run_id text,
  p_retryable boolean,
  p_safe_error_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  retry_scheduled boolean;
  terminal_reason text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_fencing_token < 1 or p_authority_epoch < 1
    or p_input_manifest_hash !~ '^[a-f0-9]{64}$'
    or p_trigger_task_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
    or p_trigger_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
    or p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$'
  then
    raise exception 'preflight control failure envelope is invalid'
      using errcode = '22023';
  end if;

  select * into attempt from public.preflight_stage_attempts
  where id = p_stage_attempt_id for update;
  if attempt.id is null then
    raise exception 'preflight control attempt not found' using errcode = 'P0002';
  end if;
  select * into stage from public.preflight_stage_runs
  where id = attempt.preflight_stage_run_id for update;
  select * into run from public.preflight_runs
  where id = attempt.preflight_run_id for update;

  if attempt.state in ('failed_retryable','failed_terminal') then
    if attempt.fencing_token <> p_fencing_token
      or attempt.authority_epoch <> p_authority_epoch
      or attempt.input_manifest_hash <> p_input_manifest_hash
      or attempt.safe_error_class <> p_safe_error_class
    then
      raise exception 'preflight control failure replay conflicts'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'retryScheduled', attempt.state = 'failed_retryable',
      'preflightRunId', run.id,
      'runState', run.state,
      'stageRunId', stage.id,
      'stageState', stage.state,
      'stageAttemptId', attempt.id,
      'attemptState', attempt.state
    );
  end if;

  if stage.id is null or run.id is null
    or attempt.state not in ('claimed','running')
    or attempt.fencing_token <> p_fencing_token
    or attempt.authority_epoch <> p_authority_epoch
    or attempt.input_manifest_hash <> p_input_manifest_hash
    or stage.highest_fencing_token <> p_fencing_token
    or stage.state not in ('claimed','running')
    or run.authority_epoch <> p_authority_epoch
    or run.state <> 'running'
    or not exists (
      select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id = attempt.id
        and lease.fencing_token = p_fencing_token
        and lease.state = 'active'
        and lease.expires_at > statement_timestamp()
    )
  then
    raise exception 'preflight control failure lost authority'
      using errcode = '40001';
  end if;

  retry_scheduled := p_retryable and stage.next_attempt_no <= stage.maximum_attempts;
  terminal_reason := case
    when retry_scheduled then p_safe_error_class
    when p_retryable then 'attempts_exhausted'
    else p_safe_error_class
  end;

  update public.preflight_stage_attempts
  set state = case when retry_scheduled
        then 'failed_retryable'::public.preflight_stage_state
        else 'failed_terminal'::public.preflight_stage_state end,
      trigger_task_id = p_trigger_task_id,
      trigger_run_id = p_trigger_run_id,
      safe_error_class = terminal_reason,
      started_at = coalesce(started_at, statement_timestamp()),
      completed_at = statement_timestamp()
  where id = attempt.id
  returning * into attempt;

  update public.preflight_stage_leases
  set state = 'consumed', closed_at = statement_timestamp()
  where stage_attempt_id = attempt.id and state = 'active';

  if retry_scheduled then
    update public.preflight_stage_runs
    set state = 'created',
        input_manifest_id = null,
        input_manifest_hash = null,
        output_manifest_id = null,
        output_manifest_hash = null,
        available_at = statement_timestamp() + make_interval(
          secs => least(30, (2 ^ greatest(0, attempt.attempt_no - 1))::integer * 5)
        ),
        aggregate_version = aggregate_version + 1,
        completed_at = null
    where id = stage.id
    returning * into stage;
    update public.preflight_runs
    set state = 'queued',
        trigger_run_id = null,
        aggregate_version = aggregate_version + 1,
        reconciliation_due_at = null
    where id = run.id
    returning * into run;
  else
    update public.preflight_stage_runs
    set state = 'failed_terminal',
        aggregate_version = aggregate_version + 1,
        completed_at = statement_timestamp()
    where id = stage.id
    returning * into stage;
    insert into private.preflight_dead_letters(
      workspace_id, preflight_run_id, stage_attempt_id, authority_epoch,
      fencing_token, reason_class, safe_summary
    ) values (
      attempt.workspace_id, attempt.preflight_run_id, attempt.id,
      attempt.authority_epoch, attempt.fencing_token, terminal_reason,
      jsonb_build_object(
        'stageKey', stage.stage_key,
        'attemptNo', attempt.attempt_no,
        'maximumAttempts', stage.maximum_attempts
      )
    ) on conflict(stage_attempt_id, fencing_token) do nothing;
    update public.preflight_runs
    set state = 'failed',
        aggregate_version = aggregate_version + 1,
        completed_at = statement_timestamp(),
        reconciliation_due_at = null
    where id = run.id
    returning * into run;
  end if;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'retryScheduled', retry_scheduled,
    'preflightRunId', run.id,
    'runState', run.state,
    'stageRunId', stage.id,
    'stageState', stage.state,
    'stageAttemptId', attempt.id,
    'attemptState', attempt.state
  );
end;
$$;

do $$
declare
  definition text;
begin
  select pg_get_functiondef(
    'public.command_dispatch_preflight_control(uuid,text,text,integer)'::regprocedure
  ) into definition;
  if definition not like '%if stage.id is null or stage.state<>''created'' then%' then
    raise exception 'preflight dispatcher predecessor is unexpected';
  end if;
  definition := replace(
    definition,
    'if stage.id is null or stage.state<>''created'' then',
    'if stage.id is null or stage.state<>''created'' or stage.available_at>statement_timestamp() then'
  );
  execute definition;
end;
$$;

revoke all on function public.command_fail_preflight_control(
  uuid,bigint,bigint,text,text,text,boolean,text
) from public, anon, authenticated;
grant execute on function public.command_fail_preflight_control(
  uuid,bigint,bigint,text,text,text,boolean,text
) to service_role;

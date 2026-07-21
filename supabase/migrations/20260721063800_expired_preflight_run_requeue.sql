-- An expired attempt must return its root run to the dispatch queue. The
-- original reconciler closed only the lease and attempt, which left the run
-- in `running` and therefore invisible to the credentialed cron selector.

create or replace function private.reconcile_expired_preflight_leases(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease public.preflight_stage_leases%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  affected integer := 0;
  retry_scheduled boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    raise exception 'invalid preflight reconciliation limit' using errcode = '22023';
  end if;

  for lease in
    select * from public.preflight_stage_leases
    where state = 'active'
      and expires_at < statement_timestamp() - interval '15 seconds'
    order by expires_at
    for update skip locked
    limit p_limit
  loop
    update public.preflight_stage_leases
    set state = 'expired', closed_at = statement_timestamp()
    where id = lease.id;

    update public.preflight_stage_attempts
    set state = 'failed_retryable', safe_error_class = 'lease_expired',
        completed_at = statement_timestamp()
    where id = lease.stage_attempt_id
      and state in ('claimed','running','waiting_external','waiting_decision')
      and fencing_token = lease.fencing_token
    returning * into attempt;
    if not found then
      continue;
    end if;

    select * into stage from public.preflight_stage_runs
    where id = attempt.preflight_stage_run_id for update;
    select * into run from public.preflight_runs
    where id = attempt.preflight_run_id for update;
    retry_scheduled := stage.next_attempt_no <= stage.maximum_attempts;

    if retry_scheduled then
      update public.preflight_stage_runs
      set state = 'created',
          input_manifest_id = null,
          input_manifest_hash = null,
          output_manifest_id = null,
          output_manifest_hash = null,
          available_at = statement_timestamp() + interval '5 seconds',
          completed_at = null,
          aggregate_version = aggregate_version + 1
      where id = stage.id;
      update public.preflight_runs
      set state = 'queued',
          trigger_run_id = null,
          reconciliation_due_at = null,
          aggregate_version = aggregate_version + 1
      where id = run.id;
    else
      update public.preflight_stage_runs
      set state = 'failed_terminal',
          completed_at = statement_timestamp(),
          aggregate_version = aggregate_version + 1
      where id = stage.id;
      update public.preflight_runs
      set state = 'failed',
          completed_at = statement_timestamp(),
          reconciliation_due_at = null,
          aggregate_version = aggregate_version + 1
      where id = run.id;
    end if;
    affected := affected + 1;
  end loop;

  -- Repair rows produced by the predecessor implementation before this
  -- migration: their lease is already expired but their run was not requeued.
  for stage in
    select candidate.*
    from public.preflight_stage_runs candidate
    join public.preflight_runs candidate_run on candidate_run.id = candidate.preflight_run_id
    where candidate.state = 'failed_retryable'
      and candidate_run.state = 'running'
      and exists (
        select 1 from public.preflight_stage_attempts prior_attempt
        where prior_attempt.preflight_stage_run_id = candidate.id
          and prior_attempt.state = 'failed_retryable'
          and prior_attempt.safe_error_class = 'lease_expired'
      )
      and not exists (
        select 1 from public.preflight_stage_leases active_lease
        join public.preflight_stage_attempts active_attempt
          on active_attempt.id = active_lease.stage_attempt_id
        where active_attempt.preflight_stage_run_id = candidate.id
          and active_lease.state = 'active'
      )
    order by candidate.available_at, candidate.id
    for update of candidate skip locked
    limit greatest(0, p_limit - affected)
  loop
    select * into run from public.preflight_runs
    where id = stage.preflight_run_id for update;
    retry_scheduled := stage.next_attempt_no <= stage.maximum_attempts;
    if retry_scheduled then
      update public.preflight_stage_runs
      set state = 'created',
          input_manifest_id = null,
          input_manifest_hash = null,
          output_manifest_id = null,
          output_manifest_hash = null,
          available_at = statement_timestamp() + interval '5 seconds',
          completed_at = null,
          aggregate_version = aggregate_version + 1
      where id = stage.id;
      update public.preflight_runs
      set state = 'queued', trigger_run_id = null,
          reconciliation_due_at = null,
          aggregate_version = aggregate_version + 1
      where id = run.id;
    else
      update public.preflight_stage_runs
      set state = 'failed_terminal', completed_at = statement_timestamp(),
          aggregate_version = aggregate_version + 1
      where id = stage.id;
      update public.preflight_runs
      set state = 'failed', completed_at = statement_timestamp(),
          reconciliation_due_at = null,
          aggregate_version = aggregate_version + 1
      where id = run.id;
    end if;
    affected := affected + 1;
  end loop;

  return affected;
end;
$$;

revoke all on function private.reconcile_expired_preflight_leases(integer)
from public, anon, authenticated;
grant execute on function private.reconcile_expired_preflight_leases(integer)
to service_role;


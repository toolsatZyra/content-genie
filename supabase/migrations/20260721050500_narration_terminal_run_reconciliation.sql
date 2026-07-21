-- A terminal narration ingest/QC failure must close its waiting preflight run.
-- Otherwise the autonomous reconciler sees a permanently active run and can
-- never append the corrected successor.

create or replace function private.reconcile_failed_narration_run(
  p_job_id uuid
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
begin
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.id is null or job.state<>'failed' then return false; end if;
  select * into run from public.preflight_runs where id=job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  if run.kind<>'narration_clock' or run.state not in ('running','waiting_external')
    or attempt.state not in ('claimed','running','waiting_external')
    or stage.state not in ('claimed','running','waiting_external')
    or attempt.preflight_run_id<>run.id or stage.preflight_run_id<>run.id
    or attempt.authority_epoch<>run.authority_epoch
    or attempt.fencing_token<>stage.highest_fencing_token
  then return false; end if;
  update public.preflight_stage_attempts set
    state='failed_retryable',safe_error_class=job.safe_failure_class,
    started_at=coalesce(started_at,statement_timestamp()),
    completed_at=statement_timestamp() where id=attempt.id;
  update public.preflight_stage_leases set state='consumed',closed_at=statement_timestamp()
    where stage_attempt_id=attempt.id and state='active';
  update public.preflight_stage_runs set state='failed_terminal',completed_at=statement_timestamp(),
    aggregate_version=aggregate_version+1 where id=stage.id;
  update public.preflight_runs set state='failed',completed_at=statement_timestamp(),
    reconciliation_due_at=null,aggregate_version=aggregate_version+1 where id=run.id;
  return true;
end;
$$;

create or replace function public.command_fail_narration_ingest(
  p_job_id uuid,p_lease_token uuid,p_safe_failure_class text,p_retryable boolean
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype; run_closed boolean:=false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or p_safe_failure_class !~ '^[a-z][a-z0-9_.-]{2,100}$'
  then raise exception 'narration failure authority is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs set
    state=case when p_retryable then 'quarantined'::private.narration_job_state
      else 'failed'::private.narration_job_state end,
    safe_failure_class=p_safe_failure_class,
    completed_at=case when p_retryable then null else statement_timestamp() end,
    ingest_lease_token=null,ingest_lease_expires_at=null where id=job.id;
  if not p_retryable then
    run_closed:=private.reconcile_failed_narration_run(job.id);
  end if;
  return jsonb_build_object('ok',true,'jobId',job.id,
    'state',case when p_retryable then 'quarantined' else 'failed' end,
    'retryable',p_retryable,'runClosed',run_closed);
end;
$$;

create or replace function public.command_reconcile_failed_narration_run(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare closed boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  closed:=private.reconcile_failed_narration_run(p_job_id);
  return jsonb_build_object('ok',true,'jobId',p_job_id,'runClosed',closed);
end;
$$;

revoke all on function private.reconcile_failed_narration_run(uuid) from public,anon,authenticated;
revoke all on function public.command_fail_narration_ingest(uuid,uuid,text,boolean),
  public.command_reconcile_failed_narration_run(uuid) from public,anon,authenticated;
grant execute on function public.command_fail_narration_ingest(uuid,uuid,text,boolean),
  public.command_reconcile_failed_narration_run(uuid) to service_role;

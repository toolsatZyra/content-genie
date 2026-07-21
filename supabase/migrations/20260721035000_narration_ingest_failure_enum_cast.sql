-- Keep narration ingest recovery fail-closed while assigning its private enum
-- explicitly. PostgreSQL otherwise resolves the CASE expression as text.

create or replace function public.command_fail_narration_ingest(
  p_job_id uuid,p_lease_token uuid,p_safe_failure_class text,p_retryable boolean
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or p_safe_failure_class !~ '^[a-z][a-z0-9_.-]{2,100}$'
  then raise exception 'narration failure authority is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs set
    state=case when p_retryable
      then 'quarantined'::private.narration_job_state
      else 'failed'::private.narration_job_state
    end,
    safe_failure_class=p_safe_failure_class,
    completed_at=case when p_retryable then null else statement_timestamp() end,
    ingest_lease_token=null,ingest_lease_expires_at=null where id=job.id;
  return jsonb_build_object('ok',true,'jobId',job.id,
    'state',case when p_retryable then 'quarantined' else 'failed' end,
    'retryable',p_retryable);
end;
$$;

revoke all on function
  public.command_fail_narration_ingest(uuid,uuid,text,boolean)
from public,anon,authenticated;
grant execute on function
  public.command_fail_narration_ingest(uuid,uuid,text,boolean)
to service_role;

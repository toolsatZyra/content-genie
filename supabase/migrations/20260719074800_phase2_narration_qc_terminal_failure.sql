-- A provider that returned a definite HTTP response must not remain in an
-- ambiguous submitted state merely because its response was rejected. Record
-- the terminal request and QC failure without ever retrying the billable call.

create or replace function public.command_fail_narration_qc_step(
  p_job_id uuid,p_lease_token uuid,p_step text,p_provider_request_id uuid,
  p_expected_version bigint,p_safe_failure_class text,
  p_safe_response_hash text,p_billable_state text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  qc private.narration_qc_runs%rowtype;
  request private.provider_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_step not in ('asr','audio_judge')
    or p_safe_failure_class!~'^[a-z][a-z0-9_.-]{2,100}$'
    or p_safe_response_hash!~'^[a-f0-9]{64}$'
    or p_billable_state not in ('not_billable','estimated')
  then raise exception 'narration QC failure envelope is invalid' using errcode='22023'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  select * into qc from private.narration_qc_runs where narration_job_id=job.id for update;
  select * into request from private.provider_requests where id=p_provider_request_id for update;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp()
    or request.state<>'submitted' or request.aggregate_version<>p_expected_version
    or (p_step='asr' and (
      qc.state<>'asr_submitted' or qc.asr_provider_request_id<>request.id
      or request.operation<>'asr'))
    or (p_step='audio_judge' and (
      qc.state<>'judge_submitted' or qc.audio_judge_provider_request_id<>request.id
      or request.operation<>'audio_judge'))
  then raise exception 'narration QC failure authority is stale' using errcode='40001'; end if;
  update private.provider_requests set state='failed_terminal',
    safe_response_hash=p_safe_response_hash,billable_state=p_billable_state,
    completed_at=statement_timestamp(),aggregate_version=aggregate_version+1
    where id=request.id returning * into request;
  update private.narration_qc_runs set state='failed',
    safe_failure_class=p_safe_failure_class,completed_at=statement_timestamp()
    where id=qc.id returning * into qc;
  return jsonb_build_object('ok',true,'qcRunId',qc.id,'state',qc.state,
    'providerRequestId',request.id,'providerRequestState',request.state::text,
    'providerRequestVersion',request.aggregate_version);
end;
$$;

revoke all on function public.command_fail_narration_qc_step(
  uuid,uuid,text,uuid,bigint,text,text,text
) from public,anon,authenticated;
grant execute on function public.command_fail_narration_qc_step(
  uuid,uuid,text,uuid,bigint,text,text,text
) to service_role;

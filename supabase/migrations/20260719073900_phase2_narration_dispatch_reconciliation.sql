-- A crash between request/grant binding and the broker call must be
-- reconcilable without creating a duplicate speech request or silently
-- skipping an unsubmitted reserved request.

create or replace function public.get_narration_provider_dispatch_context(p_job_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  request private.provider_requests%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id;
  if job.id is null then raise exception 'narration job not found' using errcode='P0002'; end if;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id;
  if job.provider_request_id is not null then
    select * into request from private.provider_requests where id=job.provider_request_id;
  end if;
  return jsonb_build_object(
    'jobId',job.id,'jobState',job.state,'workspaceId',job.workspace_id,
    'preflightRunId',job.preflight_run_id,'stageAttemptId',job.stage_attempt_id,
    'stageRunId',attempt.preflight_stage_run_id,'authorityEpoch',attempt.authority_epoch,
    'fencingToken',attempt.fencing_token,'inputManifestId',job.input_manifest_id,
    'inputManifestHash',job.input_manifest_hash,'quoteLineId',job.micro_quote_line_id,
    'targetAssetId',job.target_asset_id,'capabilityJti',job.capability_jti,
    'providerRequestId',job.provider_request_id,
    'providerRequestState',case when request.id is null then null else request.state::text end,
    'capabilityGrantId',job.capability_grant_id
  );
end;
$$;

revoke all on function public.get_narration_provider_dispatch_context(uuid)
  from public,anon,authenticated;
grant execute on function public.get_narration_provider_dispatch_context(uuid)
  to service_role;

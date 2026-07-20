-- Persist the deterministic scan/time-remap evidence with promotion. A worker
-- that loses its lease after object promotion can reconstruct the same master
-- clock without inventing duration or audio-QC facts.

alter table private.narration_generation_jobs
  add column scan_evidence jsonb check (
    scan_evidence is null or (jsonb_typeof(scan_evidence)='object' and pg_column_size(scan_evidence)<=32768)
  ),
  add column scan_evidence_hash text check (
    scan_evidence_hash is null or scan_evidence_hash~'^[a-f0-9]{64}$'
  ),
  add constraint narration_job_scan_evidence_shape_check
    check ((scan_evidence is null)=(scan_evidence_hash is null)),
  add constraint narration_job_promotion_scan_evidence_check
    check ((promoted_asset_version_id is null)=(scan_evidence is null));

create or replace function public.command_record_narration_asset_promotion(
  p_job_id uuid,p_lease_token uuid,p_promoted_asset_version_id uuid,p_scan_evidence jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype; evidence_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_scan_evidence is null or jsonb_typeof(p_scan_evidence)<>'object'
    or (p_scan_evidence-array['audibleSeamsDetected','clippingDetected','corruptFramesDetected',
      'durationMs','sourceDurationMs','timeScale','unintendedSilenceDetected']::text[])<>'{}'::jsonb
    or not(p_scan_evidence?&array['audibleSeamsDetected','clippingDetected','corruptFramesDetected',
      'durationMs','sourceDurationMs','timeScale','unintendedSilenceDetected'])
    or (p_scan_evidence->>'audibleSeamsDetected')::boolean
    or (p_scan_evidence->>'clippingDetected')::boolean
    or (p_scan_evidence->>'corruptFramesDetected')::boolean
    or (p_scan_evidence->>'unintendedSilenceDetected')::boolean
    or (p_scan_evidence->>'durationMs')::integer not between 60000 and 120000
    or (p_scan_evidence->>'sourceDurationMs')::integer not between 1000 and 1800000
    or (p_scan_evidence->>'timeScale')::numeric not between 0.8 and 1.25
  then raise exception 'narration scan evidence is invalid' using errcode='22023'; end if;
  evidence_hash:=encode(extensions.digest(convert_to(p_scan_evidence::text,'UTF8'),'sha256'),'hex');
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.promoted_asset_version_id is not null then
    if job.promoted_asset_version_id<>p_promoted_asset_version_id
      or job.scan_evidence_hash<>evidence_hash
    then raise exception 'narration promotion replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,
      'assetVersionId',job.promoted_asset_version_id,'scanEvidenceHash',job.scan_evidence_hash);
  end if;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp()
    or not exists(select 1 from public.asset_versions version
      join public.assets asset on asset.id=version.asset_id
      join public.media_probes probe on probe.asset_version_id=version.id
      where version.id=p_promoted_asset_version_id and version.workspace_id=job.workspace_id
        and version.source_quarantine_version_id=job.quarantine_asset_version_id
        and version.asset_id=job.target_asset_id and version.media_mime='audio/mpeg'
        and asset.asset_kind='narration'
        and probe.duration_ms=(p_scan_evidence->>'durationMs')::integer)
  then raise exception 'narration promotion evidence is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs set
    promoted_asset_version_id=p_promoted_asset_version_id,
    scan_evidence=p_scan_evidence,scan_evidence_hash=evidence_hash where id=job.id;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,
    'assetVersionId',p_promoted_asset_version_id,'scanEvidenceHash',evidence_hash);
end;
$$;

create or replace function public.command_claim_narration_ingest(p_job_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  quarantine private.quarantine_assets%rowtype; lease_token uuid:=gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs
    where (p_job_id is null or id=p_job_id)
      and (state='quarantined' or (state='scanning' and ingest_lease_expires_at<=statement_timestamp()))
    order by created_at for update skip locked limit 1;
  if job.id is null then return null; end if;
  select * into quarantine from private.quarantine_assets
    where id=job.quarantine_asset_version_id;
  if quarantine.id is null or quarantine.state not in ('quarantined','scanning','promoted')
  then raise exception 'narration quarantine is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs set state='scanning',ingest_lease_token=lease_token,
    ingest_lease_expires_at=statement_timestamp()+interval '10 minutes' where id=job.id;
  return jsonb_build_object('jobId',job.id,'workspaceId',job.workspace_id,
    'preflightRunId',job.preflight_run_id,'stageAttemptId',job.stage_attempt_id,
    'audioIdentitySelectionId',job.audio_identity_selection_id,
    'targetAssetId',job.target_asset_id,'providerRequestId',job.provider_request_id,
    'quarantineAssetVersionId',job.quarantine_asset_version_id,
    'promotedAssetVersionId',job.promoted_asset_version_id,'scanEvidence',job.scan_evidence,
    'objectName',quarantine.object_name,'sourceAudioSha256',job.source_audio_sha256,
    'alignment',job.alignment,'alignmentHash',job.alignment_hash,
    'leaseToken',lease_token,'leaseExpiresAt',statement_timestamp()+interval '10 minutes');
end;
$$;

drop function public.command_fail_narration_ingest(uuid,uuid,text);

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
  update private.narration_generation_jobs set state=case when p_retryable then 'quarantined' else 'failed' end,
    safe_failure_class=p_safe_failure_class,
    completed_at=case when p_retryable then null else statement_timestamp() end,
    ingest_lease_token=null,ingest_lease_expires_at=null where id=job.id;
  return jsonb_build_object('ok',true,'jobId',job.id,
    'state',case when p_retryable then 'quarantined' else 'failed' end,
    'retryable',p_retryable);
end;
$$;

revoke all on function
  public.command_record_narration_asset_promotion(uuid,uuid,uuid,jsonb),
  public.command_fail_narration_ingest(uuid,uuid,text,boolean)
from public,anon,authenticated;
grant execute on function
  public.command_record_narration_asset_promotion(uuid,uuid,uuid,jsonb),
  public.command_fail_narration_ingest(uuid,uuid,text,boolean)
to service_role;

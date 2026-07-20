-- Storage promotion and clock publication cross an external object-store
-- boundary. Persist the promoted derivative before clock assembly so a lease
-- loss can resume without re-uploading or duplicating immutable versions.

create or replace function public.command_record_narration_asset_promotion(
  p_job_id uuid,p_lease_token uuid,p_promoted_asset_version_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.promoted_asset_version_id is not null then
    if job.promoted_asset_version_id<>p_promoted_asset_version_id
    then raise exception 'narration promotion replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,
      'assetVersionId',job.promoted_asset_version_id);
  end if;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp()
    or not exists(select 1 from public.asset_versions version
      join public.assets asset on asset.id=version.asset_id
      where version.id=p_promoted_asset_version_id and version.workspace_id=job.workspace_id
        and version.source_quarantine_version_id=job.quarantine_asset_version_id
        and version.asset_id=job.target_asset_id and version.media_mime='audio/mpeg'
        and asset.asset_kind='narration')
  then raise exception 'narration promotion evidence is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs
    set promoted_asset_version_id=p_promoted_asset_version_id where id=job.id;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,
    'assetVersionId',p_promoted_asset_version_id);
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
    'promotedAssetVersionId',job.promoted_asset_version_id,
    'objectName',quarantine.object_name,'sourceAudioSha256',job.source_audio_sha256,
    'alignment',job.alignment,'alignmentHash',job.alignment_hash,
    'leaseToken',lease_token,'leaseExpiresAt',statement_timestamp()+interval '10 minutes');
end;
$$;

revoke all on function public.command_record_narration_asset_promotion(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.command_record_narration_asset_promotion(uuid,uuid,uuid)
  to service_role;

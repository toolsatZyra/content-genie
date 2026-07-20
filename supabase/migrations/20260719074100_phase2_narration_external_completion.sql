-- Externalization and terminal completion are kind-aware. A narration run
-- cannot enter an external wait until its exact speech request/grant exists,
-- and media promotion plus master-clock publication close the fenced run.

create or replace function public.command_mark_world_anchor_waiting_external(
  p_preflight_run_id uuid,p_stage_attempt_id uuid,p_trigger_task_id text,p_trigger_run_id text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=p_stage_attempt_id and preflight_run_id=run.id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  if run.state='waiting_external' and attempt.state='waiting_external' then
    return jsonb_build_object('ok',true,'replayed',true,'state','waiting_external');
  end if;
  if run.state<>'running' or attempt.state<>'claimed' or stage.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch or attempt.fencing_token<>stage.highest_fencing_token
    or (run.kind='world_anchor' and exists(select 1 from private.world_anchor_jobs job
      where job.preflight_run_id=run.id and (job.provider_request_id is null or job.state<>'dispatching')))
    or (run.kind='narration_clock' and not exists(select 1 from private.narration_generation_jobs job
      where job.preflight_run_id=run.id and job.stage_attempt_id=attempt.id
        and job.provider_request_id is not null and job.capability_grant_id is not null
        and job.state='dispatching'))
    or run.kind not in ('world_anchor','narration_clock')
  then raise exception 'provider external wait is stale' using errcode='40001'; end if;
  update public.preflight_stage_attempts set state='waiting_external',trigger_task_id=p_trigger_task_id,
    trigger_run_id=p_trigger_run_id,started_at=coalesce(started_at,statement_timestamp()) where id=attempt.id;
  update public.preflight_stage_leases set state='consumed',closed_at=statement_timestamp()
    where stage_attempt_id=attempt.id and state='active';
  update public.preflight_stage_runs set state='waiting_external',aggregate_version=aggregate_version+1 where id=stage.id;
  update public.preflight_runs set state='waiting_external',reconciliation_due_at=statement_timestamp()+interval '5 minutes',
    aggregate_version=aggregate_version+1 where id=run.id;
  if run.kind='world_anchor' then
    update private.world_anchor_jobs set state='waiting_output'
      where preflight_run_id=run.id and state='dispatching';
  end if;
  return jsonb_build_object('ok',true,'replayed',false,'state','waiting_external');
end;
$$;

create or replace function public.command_complete_narration_ingest(
  p_job_id uuid,p_lease_token uuid,p_promoted_asset_version_id uuid,
  p_master_clock_version_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype; output_id uuid:=gen_random_uuid();
  output_manifest jsonb; output_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.state='promoted' then
    if job.promoted_asset_version_id<>p_promoted_asset_version_id
      or job.master_clock_version_id<>p_master_clock_version_id
    then raise exception 'narration completion replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'state','promoted',
      'assetVersionId',job.promoted_asset_version_id,'masterClockVersionId',job.master_clock_version_id);
  end if;
  select * into run from public.preflight_runs where id=job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp()
    or run.state<>'waiting_external' or run.kind<>'narration_clock'
    or attempt.state<>'waiting_external' or stage.state<>'waiting_external'
    or not exists(select 1 from public.narration_master_clock_versions clock
      where clock.id=p_master_clock_version_id and clock.workspace_id=job.workspace_id
        and clock.preflight_run_id=job.preflight_run_id
        and clock.audio_identity_selection_id=job.audio_identity_selection_id
        and clock.narration_asset_version_id=p_promoted_asset_version_id
        and clock.state='verified')
  then raise exception 'narration completion evidence is stale' using errcode='40001'; end if;
  output_manifest:=jsonb_build_object(
    'schemaVersion','genie.narration-clock-output.v1','preflightRunId',run.id,
    'jobId',job.id,'narrationAssetVersionId',p_promoted_asset_version_id,
    'masterClockVersionId',p_master_clock_version_id,'alignmentHash',job.alignment_hash
  );
  output_hash:=encode(extensions.digest(convert_to(output_manifest::text,'UTF8'),'sha256'),'hex');
  insert into private.preflight_output_manifests(
    id,workspace_id,preflight_run_id,stage_attempt_id,schema_version,manifest_json,manifest_hash
  ) values(output_id,run.workspace_id,run.id,attempt.id,'genie.preflight-output.v1',
    output_manifest,output_hash);
  update private.narration_generation_jobs set state='promoted',
    promoted_asset_version_id=p_promoted_asset_version_id,
    master_clock_version_id=p_master_clock_version_id,completed_at=statement_timestamp(),
    ingest_lease_token=null,ingest_lease_expires_at=null where id=job.id;
  update public.preflight_stage_attempts set state='succeeded',output_manifest_id=output_id,
    output_manifest_hash=output_hash,completed_at=statement_timestamp() where id=attempt.id;
  update public.preflight_stage_runs set state='succeeded',output_manifest_id=output_id,
    output_manifest_hash=output_hash,completed_at=statement_timestamp(),
    aggregate_version=aggregate_version+1 where id=stage.id;
  update public.preflight_runs set state='succeeded',completed_at=statement_timestamp(),
    reconciliation_due_at=null,aggregate_version=aggregate_version+1 where id=run.id;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,'state','promoted',
    'assetVersionId',p_promoted_asset_version_id,'masterClockVersionId',p_master_clock_version_id);
end;
$$;

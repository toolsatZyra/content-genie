-- A World prompt regeneration is an exact, user-authorized provider job. The
-- original Phase 2 decision ledger durably queued that intent but did not bind
-- it to executable preflight/provider authority. This migration closes that
-- gap while preserving the normal provider broker, spend, quarantine and
-- atomic-promotion path.

alter table private.world_regeneration_requests
  add column if not exists preflight_run_id uuid
    references public.preflight_runs(id) on delete restrict,
  add column if not exists world_anchor_job_id uuid
    references private.world_anchor_jobs(id) on delete restrict,
  add column if not exists safe_failure_class text;

create unique index if not exists world_regeneration_requests_run_unique
  on private.world_regeneration_requests(preflight_run_id)
  where preflight_run_id is not null;

create unique index if not exists world_regeneration_requests_job_unique
  on private.world_regeneration_requests(world_anchor_job_id)
  where world_anchor_job_id is not null;

alter table private.world_anchor_jobs
  add column if not exists regeneration_request_id uuid
    references private.world_regeneration_requests(id) on delete restrict;

create unique index if not exists world_anchor_jobs_regeneration_unique
  on private.world_anchor_jobs(regeneration_request_id)
  where regeneration_request_id is not null;

create or replace function public.get_next_world_regeneration_queue_item()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare request private.world_regeneration_requests%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into request
  from private.world_regeneration_requests candidate
  where candidate.state='queued'
  order by candidate.created_at
  limit 1;
  if request.id is null then return null; end if;
  return jsonb_build_object(
    'regenerationRequestId',request.id,
    'preflightRunId',request.preflight_run_id
  );
end;
$$;

create or replace function public.get_world_regeneration_request_for_run(
  p_preflight_run_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare request_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select id into request_id from private.world_regeneration_requests
  where preflight_run_id=p_preflight_run_id and state='queued';
  return request_id;
end;
$$;

create or replace function public.command_ensure_world_regeneration_authority(
  p_regeneration_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  request private.world_regeneration_requests%rowtype;
  configuration public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  decision private.world_asset_decisions%rowtype;
  member public.memberships%rowtype;
  intent private.world_build_spend_intents%rowtype;
  intent_key text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into request from private.world_regeneration_requests
  where id=p_regeneration_request_id for update;
  if request.id is null or request.state<>'queued' then
    raise exception 'world regeneration is not queued' using errcode='40001';
  end if;
  select * into configuration from public.episode_configuration_candidates
  where id=request.configuration_candidate_id and workspace_id=request.workspace_id;
  select * into episode from public.episodes
  where id=configuration.episode_id and workspace_id=request.workspace_id;
  select * into decision from private.world_asset_decisions
  where command_id=request.command_id and decision='regenerate'
    and actor_user_id=request.requested_by
    and configuration_candidate_id=request.configuration_candidate_id;
  select * into member from public.memberships
  where workspace_id=request.workspace_id and user_id=request.requested_by
    and status='active';
  if configuration.id is null or configuration.state<>'world_design'
    or configuration.voice_confirmed_at is null
    or configuration.look_confirmed_at is null
    or episode.id is null or decision.command_id is null or member.user_id is null
  then
    raise exception 'world regeneration authority is stale' using errcode='40001';
  end if;
  if request.preflight_run_id is not null then
    return jsonb_build_object(
      'configurationCandidateId',configuration.id,
      'episodeId',episode.id,
      'preflightRunId',request.preflight_run_id,
      'regenerationRequestId',request.id,
      'scriptRevisionId',configuration.script_revision_id,
      'workspaceId',request.workspace_id
    );
  end if;
  intent_key:='world-regeneration:'||request.id::text;
  select * into intent from private.world_build_spend_intents
  where workspace_id=request.workspace_id and authorized_by=request.requested_by
    and idempotency_key=intent_key;
  if intent.id is null then
    update private.world_build_spend_intents set state='expired'
    where configuration_candidate_id=configuration.id and state='active';
    insert into private.world_build_spend_intents(
      workspace_id,episode_id,configuration_candidate_id,script_revision_id,
      look_version_id,authorized_by,actor_authority_epoch,aal,hard_ceiling_minor,
      world_ceiling_minor,narration_ceiling_minor,state,command_id,idempotency_key,
      request_hash,expires_at
    ) values(
      request.workspace_id,episode.id,configuration.id,configuration.script_revision_id,
      configuration.look_version_id,request.requested_by,member.authority_epoch,
      decision.actor_aal,500,384,116,'active',request.command_id,intent_key,
      request.request_hash,statement_timestamp()+interval '24 hours'
    ) returning * into intent;
  end if;
  return jsonb_build_object(
    'configurationCandidateId',configuration.id,
    'episodeId',episode.id,
    'preflightRunId',null,
    'regenerationRequestId',request.id,
    'scriptRevisionId',configuration.script_revision_id,
    'workspaceId',request.workspace_id
  );
end;
$$;

create or replace function public.command_bind_world_regeneration_run(
  p_regeneration_request_id uuid,
  p_preflight_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  request private.world_regeneration_requests%rowtype;
  run public.preflight_runs%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into request from private.world_regeneration_requests
  where id=p_regeneration_request_id for update;
  select * into run from public.preflight_runs where id=p_preflight_run_id;
  if request.id is null or request.state<>'queued'
    or run.id is null or run.kind<>'world_anchor'
    or run.configuration_candidate_id<>request.configuration_candidate_id
    or run.workspace_id<>request.workspace_id
    or run.state not in ('created','queued','running','waiting_external','succeeded')
  then
    raise exception 'world regeneration run binding is stale' using errcode='40001';
  end if;
  if request.preflight_run_id is not null
    and request.preflight_run_id<>run.id
  then
    raise exception 'world regeneration run replay conflicts' using errcode='40001';
  end if;
  update private.world_regeneration_requests
  set preflight_run_id=run.id
  where id=request.id;
  return jsonb_build_object(
    'ok',true,'preflightRunId',run.id,
    'regenerationRequestId',request.id
  );
end;
$$;

create or replace function public.command_prepare_world_regeneration_context(
  p_regeneration_request_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  request private.world_regeneration_requests%rowtype;
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  source_extraction private.world_extraction_results%rowtype;
  copied_extraction private.world_extraction_results%rowtype;
  source_job private.world_anchor_jobs%rowtype;
  source_payload jsonb;
  character_version public.character_versions%rowtype;
  character_record public.characters%rowtype;
  form_record public.character_forms%rowtype;
  location_version public.location_versions%rowtype;
  location_record public.locations%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into request from private.world_regeneration_requests
  where id=p_regeneration_request_id and preflight_run_id=p_preflight_run_id
  for update;
  select * into run from public.preflight_runs where id=p_preflight_run_id;
  select * into attempt from public.preflight_stage_attempts
  where id=p_stage_attempt_id and preflight_run_id=run.id;
  if request.id is null or request.state<>'queued'
    or run.id is null or run.state<>'running' or run.kind<>'world_anchor'
    or attempt.id is null or attempt.state<>'claimed'
    or run.configuration_candidate_id<>request.configuration_candidate_id
  then
    raise exception 'world regeneration execution authority is stale' using errcode='40001';
  end if;
  select * into copied_extraction from private.world_extraction_results
  where preflight_run_id=run.id;
  if copied_extraction.id is null then
    select extraction.* into source_extraction
    from private.world_extraction_results extraction
    where extraction.configuration_candidate_id=request.configuration_candidate_id
      and extraction.script_revision_id=run.script_revision_id
      and extraction.preflight_run_id<>run.id
    order by extraction.created_at desc
    limit 1;
    if source_extraction.id is null then
      raise exception 'world regeneration extraction evidence is unavailable'
        using errcode='P0002';
    end if;
    insert into private.world_extraction_results(
      id,workspace_id,preflight_run_id,stage_attempt_id,
      configuration_candidate_id,script_revision_id,script_sha256,
      look_version_id,schema_version,extraction_json,extraction_hash,
      model_key,model_request_hash,provider_response_id_hash,
      provider_request_id_hash
    ) values(
      gen_random_uuid(),run.workspace_id,run.id,attempt.id,
      run.configuration_candidate_id,run.script_revision_id,
      source_extraction.script_sha256,source_extraction.look_version_id,
      source_extraction.schema_version,source_extraction.extraction_json,
      source_extraction.extraction_hash,source_extraction.model_key,
      source_extraction.model_request_hash,
      source_extraction.provider_response_id_hash,
      source_extraction.provider_request_id_hash
    ) returning * into copied_extraction;
  end if;
  select * into source_job from private.world_anchor_jobs
  where world_version_id=request.prior_version_id and state='promoted'
  order by completed_at desc limit 1;
  if source_job.id is not null then
    select payload_json into source_payload from private.provider_input_manifests
    where id=source_job.input_manifest_id;
  end if;
  if request.entity_kind='character' then
    select * into character_version from public.character_versions
    where id=request.prior_version_id and workspace_id=request.workspace_id
      and configuration_candidate_id=request.configuration_candidate_id;
    select * into form_record from public.character_forms
    where id=request.entity_id and workspace_id=request.workspace_id;
    select * into character_record from public.characters
    where id=form_record.character_id and workspace_id=request.workspace_id;
    if character_version.id is null or form_record.id is null
      or character_record.id is null
    then raise exception 'prior character regeneration source is unavailable'
      using errcode='P0002'; end if;
    return jsonb_build_object(
      'characterFormId',form_record.id,'characterId',character_record.id,
      'characterKey',character_record.canonical_key,
      'characterName',character_record.display_name,
      'entityKind','character','extractionResultId',copied_extraction.id,
      'formKey',form_record.form_key,'formName',form_record.display_name,
      'locationId',null,'locationKey',null,'locationName',null,
      'namedTemple',false,'negativePromptText',character_version.negative_prompt_text,
      'operation','gen_image',
      'promptText',request.revised_prompt_text,
      'providerCapabilityId',source_job.provider_capability_id,
      'providerPayload',source_payload,'realPlaceName',null,
      'regenerationRequestId',request.id,'templeEvidenceSetHash',null,
      'worldManifest',character_version.identity_manifest,
      'worldManifestHash',character_version.identity_manifest_hash
    );
  end if;
  select * into location_version from public.location_versions
  where id=request.prior_version_id and workspace_id=request.workspace_id
    and configuration_candidate_id=request.configuration_candidate_id;
  select * into location_record from public.locations
  where id=request.entity_id and workspace_id=request.workspace_id;
  if location_version.id is null or location_record.id is null then
    raise exception 'prior location regeneration source is unavailable'
      using errcode='P0002';
  end if;
  return jsonb_build_object(
    'characterFormId',null,'characterId',null,'characterKey',null,
    'characterName',null,'entityKind','location',
    'extractionResultId',copied_extraction.id,'formKey',null,'formName',null,
    'locationId',location_record.id,'locationKey',location_record.canonical_key,
    'locationName',location_record.display_name,
    'namedTemple',location_record.named_temple,
    'negativePromptText',location_version.negative_prompt_text,
    'operation','gen_image',
    'promptText',request.revised_prompt_text,
    'providerCapabilityId',source_job.provider_capability_id,
    'providerPayload',source_payload,
    'realPlaceName',location_record.real_place_name,
    'regenerationRequestId',request.id,
    'templeEvidenceSetHash',location_version.temple_evidence_set_hash,
    'worldManifest',location_version.location_manifest,
    'worldManifestHash',location_version.location_manifest_hash
  );
end;
$$;

create or replace function public.command_bind_world_regeneration_job(
  p_regeneration_request_id uuid,
  p_world_anchor_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare request private.world_regeneration_requests%rowtype;
  job private.world_anchor_jobs%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into request from private.world_regeneration_requests
  where id=p_regeneration_request_id for update;
  select * into job from private.world_anchor_jobs
  where id=p_world_anchor_job_id for update;
  if request.id is null or request.state<>'queued'
    or job.id is null or job.preflight_run_id<>request.preflight_run_id
    or job.workspace_id<>request.workspace_id
    or job.entity_kind<>request.entity_kind
    or coalesce(job.character_form_id,job.location_id)<>request.entity_id
  then raise exception 'world regeneration job binding is stale'
    using errcode='40001'; end if;
  if request.world_anchor_job_id is not null
    and request.world_anchor_job_id<>job.id
  then raise exception 'world regeneration job replay conflicts'
    using errcode='40001'; end if;
  update private.world_regeneration_requests
  set world_anchor_job_id=job.id where id=request.id;
  update private.world_anchor_jobs
  set regeneration_request_id=request.id where id=job.id;
  return jsonb_build_object('jobId',job.id,'ok',true,
    'regenerationRequestId',request.id);
end;
$$;

create or replace function public.command_fail_world_regeneration(
  p_regeneration_request_id uuid,
  p_safe_failure_class text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare request private.world_regeneration_requests%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  if p_safe_failure_class !~ '^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'safe failure class is invalid' using errcode='22023';
  end if;
  select * into request from private.world_regeneration_requests
  where id=p_regeneration_request_id for update;
  if request.id is null or request.state in ('completed','failed','superseded') then
    return;
  end if;
  update private.world_regeneration_requests
  set state='failed',safe_failure_class=p_safe_failure_class,
    completed_at=statement_timestamp()
  where id=request.id;
  if request.entity_kind='character' then
    update public.character_selections selection
    set state=case when selected_version_id is null then 'review_required' else 'accepted' end,
      aggregate_version=aggregate_version+1,updated_at=statement_timestamp()
    where configuration_candidate_id=request.configuration_candidate_id
      and character_form_id=request.entity_id and state='generating';
  else
    update public.location_selections selection
    set state=case when selected_version_id is null then 'review_required' else 'accepted' end,
      aggregate_version=aggregate_version+1,updated_at=statement_timestamp()
    where configuration_candidate_id=request.configuration_candidate_id
      and location_id=request.entity_id and state='generating';
  end if;
end;
$$;

create or replace function public.command_complete_world_anchor_job(
  p_provider_request_id uuid,p_promoted_asset_version_id uuid,p_world_version_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.world_anchor_jobs%rowtype; run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype; stage public.preflight_stage_runs%rowtype;
  candidate_result jsonb; output_id uuid; output_manifest jsonb; output_hash text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.world_anchor_jobs where provider_request_id=p_provider_request_id for update;
  if job.state='promoted' then
    if job.promoted_asset_version_id<>p_promoted_asset_version_id then
      raise exception 'world anchor completion replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'worldVersionId',job.world_version_id);
  end if;
  select * into run from public.preflight_runs where id=job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  if job.id is null or job.state<>'waiting_output' or run.state<>'waiting_external'
    or attempt.state<>'waiting_external' or stage.state<>'waiting_external'
    or not exists(select 1 from public.asset_versions v where v.id=p_promoted_asset_version_id
      and v.workspace_id=job.workspace_id and v.asset_id=job.target_asset_id)
  then raise exception 'world anchor promoted asset authority is stale' using errcode='40001'; end if;
  if job.entity_kind='character' then
    candidate_result:=public.command_record_character_candidate(job.workspace_id,
      run.configuration_candidate_id,job.character_id,job.character_form_id,
      job.character_key,job.character_name,job.form_key,job.form_name,
      p_world_version_id,'generated',job.prompt_text,job.prompt_sha256,
      job.negative_prompt_text,p_promoted_asset_version_id,job.world_manifest,
      job.world_manifest_hash,job.regeneration_request_id);
  else
    candidate_result:=public.command_record_location_candidate(job.workspace_id,
      run.configuration_candidate_id,job.location_id,job.location_key,
      job.location_name,job.named_temple,job.real_place_name,p_world_version_id,
      'generated',job.prompt_text,job.prompt_sha256,job.negative_prompt_text,
      p_promoted_asset_version_id,job.world_manifest,job.world_manifest_hash,
      job.temple_evidence_set_hash,job.regeneration_request_id);
  end if;
  update private.world_anchor_jobs set state='promoted',promoted_asset_version_id=p_promoted_asset_version_id,
    world_version_id=p_world_version_id,completed_at=statement_timestamp() where id=job.id;
  if not exists(select 1 from private.world_anchor_jobs j where j.preflight_run_id=run.id and j.state<>'promoted') then
    output_id:=gen_random_uuid();
    output_manifest:=jsonb_build_object('schemaVersion','genie.world-anchor-output.v1',
      'preflightRunId',run.id,'jobCount',(select count(*) from private.world_anchor_jobs j where j.preflight_run_id=run.id),
      'worldVersionIds',(select jsonb_agg(j.world_version_id order by j.slot_key) from private.world_anchor_jobs j where j.preflight_run_id=run.id));
    output_hash:=encode(extensions.digest(convert_to(output_manifest::text,'UTF8'),'sha256'),'hex');
    insert into private.preflight_output_manifests(id,workspace_id,preflight_run_id,stage_attempt_id,
      schema_version,manifest_json,manifest_hash)
    values(output_id,run.workspace_id,run.id,attempt.id,'genie.preflight-output.v1',output_manifest,output_hash);
    update public.preflight_stage_attempts set state='succeeded',output_manifest_id=output_id,
      output_manifest_hash=output_hash,completed_at=statement_timestamp() where id=attempt.id;
    update public.preflight_stage_runs set state='succeeded',output_manifest_id=output_id,
      output_manifest_hash=output_hash,completed_at=statement_timestamp(),aggregate_version=aggregate_version+1 where id=stage.id;
    update public.preflight_runs set state='succeeded',completed_at=statement_timestamp(),
      reconciliation_due_at=null,aggregate_version=aggregate_version+1 where id=run.id;
  end if;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,
    'worldVersionId',p_world_version_id,'candidate',candidate_result);
end;
$$;

revoke all on function public.get_next_world_regeneration_queue_item(),
  public.get_world_regeneration_request_for_run(uuid),
  public.command_ensure_world_regeneration_authority(uuid),
  public.command_bind_world_regeneration_run(uuid,uuid),
  public.command_prepare_world_regeneration_context(uuid,uuid,uuid),
  public.command_bind_world_regeneration_job(uuid,uuid),
  public.command_fail_world_regeneration(uuid,text)
from public,anon,authenticated;

grant execute on function public.get_next_world_regeneration_queue_item(),
  public.get_world_regeneration_request_for_run(uuid),
  public.command_ensure_world_regeneration_authority(uuid),
  public.command_bind_world_regeneration_run(uuid,uuid),
  public.command_prepare_world_regeneration_context(uuid,uuid,uuid),
  public.command_bind_world_regeneration_job(uuid,uuid),
  public.command_fail_world_regeneration(uuid,text)
to service_role;

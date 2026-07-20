-- Authorize World Extraction and Pronunciation Director calls through the
-- same append-only, live-lease model ledger used by cinematic planning. Scope
-- is derived from the exact preflight run; models can never propose authority.

alter type private.agent_tool_name add value if not exists 'audio.pronunciation';

create or replace function public.get_preflight_control_execution_input(
  p_stage_attempt_id uuid,
  p_authority_epoch bigint,
  p_fencing_token bigint,
  p_input_manifest_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  script public.script_revisions%rowtype;
  config public.episode_configuration_candidates%rowtype;
  look public.look_versions%rowtype;
  policy public.cultural_policy_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id;
  select * into stage from public.preflight_stage_runs
    where id=attempt.preflight_stage_run_id;
  select * into run from public.preflight_runs where id=attempt.preflight_run_id;
  if attempt.id is null or stage.id is null or run.id is null
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch<>p_authority_epoch
    or attempt.fencing_token<>p_fencing_token
    or attempt.input_manifest_hash<>p_input_manifest_hash
    or stage.highest_fencing_token<>p_fencing_token
    or run.authority_epoch<>p_authority_epoch
    or run.state<>'running'
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=p_fencing_token
        and lease.expires_at>statement_timestamp())
  then raise exception 'preflight execution authority is stale' using errcode='40001'; end if;
  select * into script from public.script_revisions where id=run.script_revision_id;
  select * into config from public.episode_configuration_candidates
    where id=run.configuration_candidate_id;
  select * into look from public.look_versions where id=config.look_version_id;
  select * into policy from public.cultural_policy_versions
    where policy_key='genie-launch-hindu-devotional' and state='active';
  if script.id is null or config.id is null or look.id is null or policy.id is null
    or config.script_revision_id<>script.id
    or config.look_confirmed_at is null or config.voice_confirmed_at is null
    or not exists(select 1 from public.script_lock_events lock
      where lock.script_revision_id=script.id and lock.raw_utf8_sha256=script.raw_utf8_sha256)
  then raise exception 'preflight execution source is stale' using errcode='40001'; end if;
  return jsonb_build_object(
    'configurationCandidateId',config.id,
    'episodeId',run.episode_id,
    'kind',run.kind,
    'lookKey',look.look_key,
    'lookVersionId',look.id,
    'lockedLookBlockSha256',look.locked_look_block_sha256,
    'narratorGender',config.narrator_gender,
    'policyVersionId',policy.id,
    'preflightRunId',run.id,
    'processingScalarCount',script.processing_scalar_count,
    'processingText',script.processing_text,
    'processingTextSha256',script.processing_utf8_sha256,
    'rawScript',script.raw_text,
    'rawScriptSha256',script.raw_utf8_sha256,
    'scriptRevisionId',script.id,
    'voiceVersionId',config.voice_version_id,
    'workspaceId',run.workspace_id
  );
end;
$$;

create or replace function public.get_audio_identity_preflight_input(
  p_workspace_id uuid,
  p_configuration_candidate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  config public.episode_configuration_candidates%rowtype;
  episode_row public.episodes%rowtype;
  series_row public.series%rowtype;
  script public.script_revisions%rowtype;
  binding public.source_review_packet_world_bindings%rowtype;
  packet public.source_review_packets%rowtype;
  extraction private.world_extraction_results%rowtype;
  selection public.preflight_audio_identity_selections%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into config from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into episode_row from public.episodes
    where id=config.episode_id and workspace_id=p_workspace_id;
  select * into series_row from public.series
    where id=episode_row.series_id and workspace_id=p_workspace_id;
  select * into script from public.script_revisions
    where id=config.script_revision_id and workspace_id=p_workspace_id;
  select binding_row.* into binding
    from public.source_review_packet_world_bindings binding_row
    join public.source_review_packets packet_row
      on packet_row.id=binding_row.source_review_packet_id
    join public.source_review_statuses status
      on status.source_review_packet_id=packet_row.id
    join public.world_reference_pack_versions pack
      on pack.id=binding_row.world_reference_pack_version_id
    where binding_row.workspace_id=p_workspace_id
      and binding_row.configuration_candidate_id=config.id
      and packet_row.script_revision_id=script.id
      and status.status='approved'
      and pack.state='verified'
    order by packet_row.packet_version desc
    limit 1;
  select * into packet from public.source_review_packets
    where id=binding.source_review_packet_id and workspace_id=p_workspace_id;
  select * into extraction from private.world_extraction_results
    where id=binding.world_extraction_result_id and workspace_id=p_workspace_id;
  select * into selection from public.preflight_audio_identity_selections
    where configuration_candidate_id=config.id and workspace_id=p_workspace_id
      and state='verified'
    order by created_at desc limit 1;
  if config.id is null or episode_row.id is null or series_row.id is null
    or script.id is null or binding.source_review_packet_id is null
    or packet.id is null or extraction.id is null
    or binding.script_sha256<>script.raw_utf8_sha256
    or binding.extraction_hash<>extraction.extraction_hash
  then return null; end if;
  return jsonb_build_object(
    'workspaceId',p_workspace_id,
    'configurationCandidateId',config.id,
    'episodeId',episode_row.id,
    'seriesId',series_row.id,
    'seriesTitle',series_row.title,
    'scriptRevisionId',script.id,
    'scriptSha256',script.raw_utf8_sha256,
    'processingText',script.processing_text,
    'voiceVersionId',config.voice_version_id,
    'narratorGender',config.narrator_gender,
    'policyVersionId',packet.policy_version_id,
    'sourceReviewPacketId',packet.id,
    'sourceReviewSubjectHash',packet.subject_hash,
    'sourceSetHash',packet.source_set_hash,
    'worldReferencePackVersionId',binding.world_reference_pack_version_id,
    'worldReferencePackHash',binding.world_reference_pack_hash,
    'storyContext',extraction.extraction_json->'storyContext',
    'characters',extraction.extraction_json->'characters',
    'locations',extraction.extraction_json->'locations',
    'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'sourceRecordVersionId',source.id,
      'claimClass',link.claim_class,
      'sourceClass',source.source_class,
      'title',source.title,
      'language',source.language,
      'editionCitation',source.edition_citation,
      'boundedProposition',source.bounded_proposition
    ) order by link.claim_class,source.title,source.id)
      from public.source_review_packet_sources link
      join public.source_record_versions source
        on source.id=link.source_record_version_id
      where link.source_review_packet_id=packet.id
        and link.workspace_id=p_workspace_id), '[]'::jsonb),
    'existingSelectionId',selection.id
  );
end;
$$;

create or replace function public.command_record_agent_model_call(
  p_workspace_id uuid,p_episode_id uuid,p_configuration_candidate_id uuid,
  p_script_revision_id uuid,p_policy_version_id uuid,p_preflight_run_id uuid,
  p_stage_attempt_id uuid,p_tool_name text,p_trusted_scope_hash text,
  p_arguments_hash text,p_source_set_hash text,p_maximum_fan_out integer,
  p_maximum_depth integer,p_maximum_tokens integer,p_maximum_duration_ms integer,
  p_maximum_result_bytes integer,p_model_version text,p_prompt_hash text
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare call_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_tool_name not in (
      'source.extract','audio.pronunciation','story.plan','shot.plan','edd.plan','plan.evaluate'
    )
    or p_trusted_scope_hash !~ '^[a-f0-9]{64}$'
    or p_arguments_hash !~ '^[a-f0-9]{64}$'
    or p_source_set_hash !~ '^[a-f0-9]{64}$'
    or p_prompt_hash !~ '^[a-f0-9]{64}$'
    or p_maximum_fan_out not between 1 and 3
    or p_maximum_depth<>1
    or p_maximum_tokens not between 256 and 16000
    or p_maximum_duration_ms<>180000
    or p_maximum_result_bytes<>131072
    or p_model_version not in ('gpt-5.6-sol','gpt-5.6-terra')
  then raise exception 'agent model-call envelope is invalid' using errcode='22023'; end if;
  if not exists(
    select 1 from public.preflight_stage_attempts attempt
    join public.preflight_runs run on run.id=attempt.preflight_run_id
      and run.workspace_id=attempt.workspace_id
    join public.preflight_stage_runs stage on stage.id=attempt.preflight_stage_run_id
      and stage.preflight_run_id=run.id
    join public.preflight_stage_leases lease on lease.stage_attempt_id=attempt.id
      and lease.workspace_id=attempt.workspace_id
      and lease.preflight_run_id=attempt.preflight_run_id
    join public.script_revisions script on script.id=run.script_revision_id
      and script.workspace_id=run.workspace_id
    where attempt.id=p_stage_attempt_id and attempt.workspace_id=p_workspace_id
      and attempt.preflight_run_id=p_preflight_run_id
      and attempt.state in ('claimed','running') and run.state='running'
      and run.episode_id=p_episode_id
      and run.configuration_candidate_id=p_configuration_candidate_id
      and run.script_revision_id=p_script_revision_id
      and run.authority_epoch=attempt.authority_epoch
      and stage.highest_fencing_token=attempt.fencing_token
      and lease.fencing_token=attempt.fencing_token and lease.state='active'
      and lease.expires_at>statement_timestamp()
      and (
        (p_tool_name='source.extract' and run.kind='world_anchor'
          and p_source_set_hash=script.raw_utf8_sha256
          and exists(select 1 from public.cultural_policy_versions policy
            where policy.id=p_policy_version_id
              and policy.policy_key='genie-launch-hindu-devotional'
              and policy.state='active'))
        or
        (p_tool_name='audio.pronunciation' and run.kind='narration_clock'
          and exists(select 1 from public.source_review_packets packet
            join public.source_review_statuses status
              on status.source_review_packet_id=packet.id
            where packet.policy_version_id=p_policy_version_id
              and packet.source_set_hash=p_source_set_hash
              and packet.configuration_candidate_id=p_configuration_candidate_id
              and packet.script_revision_id=p_script_revision_id
              and packet.workspace_id=p_workspace_id and status.status='approved'))
        or
        (p_tool_name in ('story.plan','shot.plan','edd.plan','plan.evaluate')
          and run.kind='plan_evaluation'
          and exists(select 1 from public.source_review_packets packet
            join public.source_review_statuses status
              on status.source_review_packet_id=packet.id
            where packet.policy_version_id=p_policy_version_id
              and packet.source_set_hash=p_source_set_hash
              and packet.configuration_candidate_id=p_configuration_candidate_id
              and packet.script_revision_id=p_script_revision_id
              and packet.workspace_id=p_workspace_id and status.status='approved'))
      )
  ) then raise exception 'agent model-call authority is stale' using errcode='40001'; end if;
  insert into private.agent_tool_calls(
    workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    policy_version_id,preflight_run_id,stage_attempt_id,tool_name,
    classification,trusted_scope_hash,arguments_hash,source_set_hash,
    schema_version,maximum_fan_out,maximum_depth,maximum_tokens,
    maximum_duration_ms,maximum_result_bytes,maximum_cost_minor,
    model_family,model_version,prompt_hash,status
  ) values(
    p_workspace_id,p_episode_id,p_configuration_candidate_id,p_script_revision_id,
    p_policy_version_id,p_preflight_run_id,p_stage_attempt_id,
    p_tool_name::private.agent_tool_name,'read_only',p_trusted_scope_hash,
    p_arguments_hash,p_source_set_hash,'genie.restricted-tools.v1',
    p_maximum_fan_out,p_maximum_depth,p_maximum_tokens,p_maximum_duration_ms,
    p_maximum_result_bytes,0,'openai',p_model_version,p_prompt_hash,'authorized'
  ) returning id into call_id;
  return call_id;
end;
$$;

revoke all on function public.get_preflight_control_execution_input(uuid,bigint,bigint,text),
  public.get_audio_identity_preflight_input(uuid,uuid),
  public.command_record_agent_model_call(
    uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,
    integer,integer,text,text
  ) from public,anon,authenticated;
grant execute on function public.get_preflight_control_execution_input(uuid,bigint,bigint,text),
  public.get_audio_identity_preflight_input(uuid,uuid),
  public.command_record_agent_model_call(
    uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,
    integer,integer,text,text
  ) to service_role;

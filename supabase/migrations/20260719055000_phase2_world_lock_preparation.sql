-- Read-only hash preparation for the authenticated World Lock API. The
-- subsequent mutating command recomputes and revalidates every value under its
-- aggregate locks, so a race can only fail closed.

create or replace function public.prepare_first_episode_world_lock(
  p_workspace_id uuid,p_configuration_candidate_id uuid,p_production_quote_id uuid,
  p_quote_confirmation_id uuid,p_continuity_state_version_id uuid,
  p_expected_series_version bigint,p_expected_episode_version bigint,
  p_expected_configuration_version bigint
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor_id uuid:=auth.uid(); config public.episode_configuration_candidates%rowtype;
  episode_row public.episodes%rowtype; series_row public.series%rowtype;
  script public.script_revisions%rowtype; audio public.preflight_audio_identity_selections%rowtype;
  clock public.narration_master_clock_versions%rowtype; plan public.preflight_plan_bundles%rowtype;
  consensus private.preflight_plan_qc_consensus%rowtype; source_packet public.source_review_packets%rowtype;
  quote public.production_quotes%rowtype; confirmation public.production_quote_confirmations%rowtype;
  character_set_hash text; location_set_hash text; component_hash_value text;
  manifest_hash_value text; request_hash_value text; aggregate_vector jsonb;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null
    or private.current_aal()<>'aal2' or not private.is_active_member(p_workspace_id,actor_id)
  then raise exception 'AAL2 active membership required' using errcode='42501'; end if;
  select * into config from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into episode_row from public.episodes where id=config.episode_id and workspace_id=p_workspace_id;
  select * into series_row from public.series where id=episode_row.series_id and workspace_id=p_workspace_id;
  select * into script from public.script_revisions where id=config.script_revision_id;
  select * into clock from public.narration_master_clock_versions
    where configuration_candidate_id=config.id and state='verified' order by version_number desc limit 1;
  select * into audio from public.preflight_audio_identity_selections
    where id=clock.audio_identity_selection_id and state='verified';
  select * into plan from public.preflight_plan_bundles
    where configuration_candidate_id=config.id and master_clock_version_id=clock.id order by created_at desc limit 1;
  select * into consensus from private.preflight_plan_qc_consensus
    where plan_bundle_id=plan.id and verdict='pass' order by created_at desc limit 1;
  select * into source_packet from public.source_review_packets where id=plan.source_review_packet_id;
  select * into quote from public.production_quotes where id=p_production_quote_id
    and workspace_id=p_workspace_id and configuration_candidate_id=config.id
    and plan_bundle_id=plan.id and plan_qc_consensus_id=consensus.id;
  select * into confirmation from public.production_quote_confirmations where id=p_quote_confirmation_id
    and workspace_id=p_workspace_id and production_quote_id=quote.id;
  if config.id is null or series_row.aggregate_version<>p_expected_series_version
    or episode_row.aggregate_version<>p_expected_episode_version
    or config.aggregate_version<>p_expected_configuration_version
    or script.id is null or audio.id is null or clock.id is null or plan.id is null
    or consensus.id is null or source_packet.id is null or quote.id is null or confirmation.id is null
  then raise exception 'World Lock preparation is stale' using errcode='40001'; end if;
  select encode(extensions.digest(convert_to(string_agg(selection.selected_version_id::text,'|' order by selection.selected_version_id),'UTF8'),'sha256'),'hex')
    into character_set_hash from public.character_selections selection
    where selection.configuration_candidate_id=config.id and selection.state='accepted';
  select encode(extensions.digest(convert_to(string_agg(selection.selected_version_id::text,'|' order by selection.selected_version_id),'UTF8'),'sha256'),'hex')
    into location_set_hash from public.location_selections selection
    where selection.configuration_candidate_id=config.id and selection.state='accepted';
  aggregate_vector:=jsonb_build_object('series',p_expected_series_version,
    'episode',p_expected_episode_version,'configuration',p_expected_configuration_version);
  component_hash_value:=encode(extensions.digest(convert_to(jsonb_build_object(
    'configurationCandidateId',config.id,'scriptRevisionId',script.id,
    'culturalPolicyVersionId',source_packet.policy_version_id,'audioIdentitySelectionId',audio.id,
    'pronunciationLexiconVersionId',audio.pronunciation_lexicon_version_id,
    'scoreIdentityVersionId',audio.score_identity_version_id,'soundIdentityVersionId',audio.sound_identity_version_id,
    'worldReferencePackVersionId',plan.world_reference_pack_version_id,'sourceReviewPacketId',source_packet.id,
    'masterClockVersionId',clock.id,'planBundleId',plan.id,'planQcConsensusId',consensus.id,
    'productionQuoteId',quote.id,'quoteConfirmationId',confirmation.id,
    'characterSelectionSetHash',character_set_hash,'locationSelectionSetHash',location_set_hash)::text,
    'UTF8'),'sha256'),'hex');
  manifest_hash_value:=encode(extensions.digest(convert_to(jsonb_build_object(
    'seriesId',series_row.id,'releaseNumber',1,'continuityStateVersionId',p_continuity_state_version_id,
    'lookVersionId',config.look_version_id,'narratorGender',config.narrator_gender,
    'voiceVersionId',config.voice_version_id,'componentHash',component_hash_value,
    'aggregateVersions',aggregate_vector)::text,'UTF8'),'sha256'),'hex');
  request_hash_value:=encode(extensions.digest(convert_to(
    manifest_hash_value||':'||quote.quote_hash||':'||aggregate_vector::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object('manifestHash',manifest_hash_value,'requestHash',request_hash_value);
end;
$$;

revoke all on function public.prepare_first_episode_world_lock(
  uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint
) from public,anon,authenticated;
grant execute on function public.prepare_first_episode_world_lock(
  uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint
) to authenticated;

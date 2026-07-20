-- One fail-closed service read model for the Pronunciation Director and the
-- narration reconciler. It exposes only an approved review packet bound to the
-- exact verified World and locked script; model-proposed IDs are never trusted.

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
    'sourceReviewPacketId',packet.id,
    'sourceReviewSubjectHash',packet.subject_hash,
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

revoke all on function public.get_audio_identity_preflight_input(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_audio_identity_preflight_input(uuid,uuid)
  to service_role;

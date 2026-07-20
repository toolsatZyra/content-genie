-- Bind every qualified source-review packet to the exact immutable World,
-- extraction, script, and active policy it reviewed. The original source
-- packet tables intentionally remain append-only; this forward-only binding
-- prevents an approved packet from being replayed across a changed World.

create table public.source_review_packet_world_bindings (
  source_review_packet_id uuid primary key,
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  world_reference_pack_version_id uuid not null,
  world_extraction_result_id uuid not null,
  script_sha256 text not null check(script_sha256~'^[a-f0-9]{64}$'),
  extraction_hash text not null check(extraction_hash~'^[a-f0-9]{64}$'),
  world_reference_pack_hash text not null check(world_reference_pack_hash~'^[a-f0-9]{64}$'),
  cultural_policy_hash text not null check(cultural_policy_hash~'^[a-f0-9]{64}$'),
  subject_hash text not null check(subject_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,source_review_packet_id),
  unique(configuration_candidate_id,subject_hash),
  foreign key(workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict,
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,world_reference_pack_version_id)
    references public.world_reference_pack_versions(workspace_id,id) on delete restrict,
  foreign key(world_extraction_result_id)
    references private.world_extraction_results(id) on delete restrict
);

create trigger source_packet_world_bindings_immutable
before update or delete on public.source_review_packet_world_bindings
for each row execute function private.reject_mutation();

create or replace function public.get_source_cultural_preflight_input(
  p_workspace_id uuid,
  p_configuration_candidate_id uuid,
  p_world_reference_pack_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  config public.episode_configuration_candidates%rowtype;
  episode_row public.episodes%rowtype;
  series_row public.series%rowtype;
  script public.script_revisions%rowtype;
  pack public.world_reference_pack_versions%rowtype;
  extraction private.world_extraction_results%rowtype;
  policy public.cultural_policy_versions%rowtype;
  existing_binding public.source_review_packet_world_bindings%rowtype;
  expected_subject_hash text;
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
  select * into pack from public.world_reference_pack_versions
    where id=p_world_reference_pack_version_id and workspace_id=p_workspace_id
      and configuration_candidate_id=config.id and state='verified';
  select * into extraction from private.world_extraction_results
    where configuration_candidate_id=config.id
      and script_revision_id=script.id
      and script_sha256=script.raw_utf8_sha256
      and look_version_id=config.look_version_id
    order by created_at desc limit 1;
  select * into policy from public.cultural_policy_versions
    where policy_key='genie-launch-hindu-devotional' and state='active';
  if config.id is null or episode_row.id is null or series_row.id is null
    or script.id is null or pack.id is null or extraction.id is null or policy.id is null
    or config.state not in ('world_design','preflight','ready_to_lock')
    or exists(select 1 from public.character_selections selection
      where selection.configuration_candidate_id=config.id
        and (selection.state<>'accepted' or selection.selected_version_id is null))
    or exists(select 1 from public.location_selections selection
      where selection.configuration_candidate_id=config.id
        and (selection.state<>'accepted' or selection.selected_version_id is null))
  then raise exception 'source cultural input is stale or incomplete' using errcode='40001'; end if;

  expected_subject_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'scriptSha256',script.raw_utf8_sha256,
    'extractionHash',extraction.extraction_hash,
    'worldReferencePackHash',pack.manifest_hash,
    'culturalPolicyHash',policy.manifest_hash
  )::text,'UTF8'),'sha256'),'hex');
  select * into existing_binding from public.source_review_packet_world_bindings binding
    where binding.configuration_candidate_id=config.id
      and binding.subject_hash=expected_subject_hash;

  return jsonb_build_object(
    'configurationCandidateId',config.id,
    'episodeId',episode_row.id,
    'seriesId',series_row.id,
    'seriesTitle',series_row.title,
    'scriptRevisionId',script.id,
    'processingText',script.processing_text,
    'processingTextSha256',script.processing_utf8_sha256,
    'rawScriptSha256',script.raw_utf8_sha256,
    'worldReferencePackVersionId',pack.id,
    'worldReferencePackHash',pack.manifest_hash,
    'worldReferenceManifest',pack.manifest,
    'worldExtractionResultId',extraction.id,
    'worldExtractionHash',extraction.extraction_hash,
    'worldExtraction',extraction.extraction_json,
    'policyVersionId',policy.id,
    'policyHash',policy.manifest_hash,
    'policyRules',(select jsonb_agg(jsonb_build_object(
      'id',rule.id,'code',rule.rule_code,'contentClass',rule.content_class,
      'defaultVerdict',rule.default_verdict,'nonOverridable',rule.non_overridable,
      'ruleText',rule.rule_text) order by rule.rule_code)
      from public.cultural_policy_rules rule where rule.policy_version_id=policy.id),
    'subjectHash',expected_subject_hash,
    'existingPacketId',existing_binding.source_review_packet_id,
    'characters',coalesce((select jsonb_agg(jsonb_build_object(
      'characterVersionId',version.id,'canonicalKey',character.canonical_key,
      'displayName',character.display_name,'formKey',form.form_key,
      'identityManifest',version.identity_manifest,
      'anchorAssetVersionId',version.anchor_asset_version_id,
      'anchorContentHash',asset.content_sha256
    ) order by character.canonical_key,form.form_key)
      from public.character_selections selection
      join public.character_forms form on form.id=selection.character_form_id
      join public.characters character on character.id=form.character_id
      join public.character_versions version on version.id=selection.selected_version_id
      join public.asset_versions asset on asset.id=version.anchor_asset_version_id
      where selection.configuration_candidate_id=config.id and selection.state='accepted'),'[]'::jsonb),
    'locations',coalesce((select jsonb_agg(jsonb_build_object(
      'locationVersionId',version.id,'canonicalKey',location.canonical_key,
      'displayName',location.display_name,'namedTemple',location.named_temple,
      'realPlaceName',location.real_place_name,'locationManifest',version.location_manifest,
      'anchorAssetVersionId',version.empty_anchor_asset_version_id,
      'anchorContentHash',asset.content_sha256,
      'templeEvidenceSetHash',version.temple_evidence_set_hash,
      'templeReferences',coalesce((select jsonb_agg(jsonb_build_object(
        'canonicalTitle',reference.canonical_title,
        'sourcePageUrl',reference.source_page_url,
        'sourceFileUrl',reference.source_file_url,
        'authorCredit',reference.author_credit,
        'licenseShortName',reference.license_short_name,
        'licenseUrl',reference.license_url,
        'sourceMetadataHash',reference.source_metadata_hash,
        'assetVersionId',reference.asset_version_id
      ) order by reference.ordinal)
        from public.temple_research_packets research
        join public.temple_research_references reference
          on reference.temple_research_packet_id=research.id
        where research.world_extraction_result_id=extraction.id
          and research.location_key=location.canonical_key
          and research.state='verified'),'[]'::jsonb)
    ) order by location.canonical_key)
      from public.location_selections selection
      join public.locations location on location.id=selection.location_id
      join public.location_versions version on version.id=selection.selected_version_id
      join public.asset_versions asset on asset.id=version.empty_anchor_asset_version_id
      where selection.configuration_candidate_id=config.id and selection.state='accepted'),'[]'::jsonb)
  );
end;
$$;

create or replace function public.command_record_bound_source_review_packet(
  p_packet_id uuid,p_workspace_id uuid,p_series_id uuid,
  p_configuration_candidate_id uuid,p_policy_version_id uuid,
  p_world_reference_pack_version_id uuid,p_world_extraction_result_id uuid,
  p_subject_hash text,p_source_set_hash text,p_evidence_set_hash text,
  p_tradition text,p_region text,p_language text,p_content_classes text[],
  p_interpretation_labels text[],p_machine_verdict text,
  p_machine_evidence_hash text,p_source_links jsonb,p_findings jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  config public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  pack public.world_reference_pack_versions%rowtype;
  extraction private.world_extraction_results%rowtype;
  policy public.cultural_policy_versions%rowtype;
  expected_subject_hash text;
  expected_machine_hash text;
  existing public.source_review_packet_world_bindings%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_configuration_candidate_id::text,0));
  select * into config from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into script from public.script_revisions
    where id=config.script_revision_id and workspace_id=p_workspace_id;
  select * into pack from public.world_reference_pack_versions
    where id=p_world_reference_pack_version_id and workspace_id=p_workspace_id
      and configuration_candidate_id=config.id and state='verified';
  select * into extraction from private.world_extraction_results
    where id=p_world_extraction_result_id and configuration_candidate_id=config.id
      and script_revision_id=script.id and script_sha256=script.raw_utf8_sha256
      and look_version_id=config.look_version_id;
  select * into policy from public.cultural_policy_versions
    where id=p_policy_version_id and state='active';
  expected_subject_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'scriptSha256',script.raw_utf8_sha256,
    'extractionHash',extraction.extraction_hash,
    'worldReferencePackHash',pack.manifest_hash,
    'culturalPolicyHash',policy.manifest_hash
  )::text,'UTF8'),'sha256'),'hex');
  expected_machine_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'schemaVersion','genie.source-cultural-machine-evidence.v1',
    'subjectHash',expected_subject_hash,'sourceSetHash',p_source_set_hash,
    'evidenceSetHash',p_evidence_set_hash,'policyHash',policy.manifest_hash
  )::text,'UTF8'),'sha256'),'hex');
  select * into existing from public.source_review_packet_world_bindings binding
    where binding.configuration_candidate_id=config.id
      and binding.subject_hash=expected_subject_hash;
  if existing.source_review_packet_id is not null then
    return existing.source_review_packet_id;
  end if;
  if config.id is null or script.id is null or pack.id is null or extraction.id is null
    or policy.id is null or p_series_id<>(select episode.series_id from public.episodes episode where episode.id=config.episode_id)
    or p_subject_hash is distinct from expected_subject_hash
    or p_source_set_hash is distinct from encode(extensions.digest(convert_to(p_source_links::text,'UTF8'),'sha256'),'hex')
    or p_evidence_set_hash is distinct from encode(extensions.digest(convert_to(p_findings::text,'UTF8'),'sha256'),'hex')
    or p_machine_evidence_hash is distinct from expected_machine_hash
  then raise exception 'bound source review packet evidence is stale or invalid' using errcode='40001'; end if;
  perform public.command_record_source_review_packet(
    p_packet_id,p_workspace_id,p_series_id,config.id,policy.id,
    p_subject_hash,p_source_set_hash,p_evidence_set_hash,p_tradition,p_region,
    p_language,p_content_classes,p_interpretation_labels,p_machine_verdict,
    p_machine_evidence_hash,p_source_links,p_findings
  );
  insert into public.source_review_packet_world_bindings(
    source_review_packet_id,workspace_id,configuration_candidate_id,
    world_reference_pack_version_id,world_extraction_result_id,script_sha256,
    extraction_hash,world_reference_pack_hash,cultural_policy_hash,subject_hash
  ) values(
    p_packet_id,p_workspace_id,config.id,pack.id,extraction.id,script.raw_utf8_sha256,
    extraction.extraction_hash,pack.manifest_hash,policy.manifest_hash,expected_subject_hash
  );
  return p_packet_id;
end;
$$;

create or replace view public.source_review_readiness_projections
with (security_invoker=true)
as
select
  packet.workspace_id,
  packet.configuration_candidate_id,
  jsonb_build_object(
    'packetId',packet.id,
    'packetVersion',packet.packet_version,
    'subjectHash',packet.subject_hash,
    'machineVerdict',packet.machine_verdict,
    'status',status.status,
    'statusVersion',status.version,
    'tradition',packet.tradition,
    'region',packet.region,
    'language',packet.language,
    'contentClasses',to_jsonb(packet.content_classes),
    'interpretationLabels',to_jsonb(packet.interpretation_labels),
    'worldReferencePackVersionId',binding.world_reference_pack_version_id,
    'sources',coalesce((select jsonb_agg(jsonb_build_object(
      'sourceVersionId',source.id,'title',source.title,
      'sourceClass',source.source_class,'stableUrl',source.stable_url,
      'boundedProposition',source.bounded_proposition,
      'rightsStatus',source.rights_status,
      'verificationState',source.verification_state,
      'contradictionState',source.contradiction_state,
      'claimClass',link.claim_class
    ) order by link.claim_class,source.title)
      from public.source_review_packet_sources link
      join public.source_record_versions source on source.id=link.source_record_version_id
      where link.source_review_packet_id=packet.id),'[]'::jsonb),
    'findings',coalesce((select jsonb_agg(jsonb_build_object(
      'ruleCode',rule.rule_code,'verdict',finding.verdict,
      'safeSummary',finding.safe_summary,'confidence',finding.confidence,
      'nonOverridable',rule.non_overridable
    ) order by rule.rule_code)
      from public.cultural_readiness_findings finding
      join public.cultural_policy_rules rule on rule.id=finding.policy_rule_id
      where finding.source_review_packet_id=packet.id),'[]'::jsonb),
    'competencies',coalesce((select jsonb_agg(jsonb_build_object(
      'competencyVersionId',competency.id,'status',competency_status.status,
      'expiresAt',competency.expires_at,
      'scopeHash',encode(extensions.digest(convert_to(
        array_to_string(competency.traditions,',')||':'||
        array_to_string(competency.regions,',')||':'||
        array_to_string(competency.languages,',')||':'||
        array_to_string(competency.content_classes,',')||':'||
        competency.appointment_evidence_hash,'UTF8'),'sha256'),'hex')
    ) order by competency.version_number desc)
      from public.reviewer_competency_versions competency
      join public.reviewer_competency_statuses competency_status
        on competency_status.competency_version_id=competency.id
      where competency.workspace_id=packet.workspace_id
        and competency.reviewer_user_id=(select auth.uid())
        and competency_status.status='active'
        and competency.effective_at<=statement_timestamp()
        and competency.expires_at>statement_timestamp()),'[]'::jsonb)
  ) as source_review
from public.source_review_packets packet
join public.source_review_statuses status on status.source_review_packet_id=packet.id
join public.source_review_packet_world_bindings binding
  on binding.source_review_packet_id=packet.id
where packet.packet_version=(select max(latest.packet_version)
  from public.source_review_packets latest
  where latest.configuration_candidate_id=packet.configuration_candidate_id);

alter table public.source_review_packet_world_bindings enable row level security;
alter table public.source_review_packet_world_bindings force row level security;
create policy source_review_packet_world_bindings_member_select
on public.source_review_packet_world_bindings for select to authenticated
using(private.is_active_member(workspace_id,(select auth.uid())));

revoke all on table public.source_review_packet_world_bindings,
  public.source_review_readiness_projections from public,anon,authenticated;
grant select on table public.source_review_packet_world_bindings,
  public.source_review_readiness_projections to authenticated;

revoke all on function public.get_source_cultural_preflight_input(uuid,uuid,uuid),
  public.command_record_bound_source_review_packet(
    uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text[],text[],text,text,jsonb,jsonb
  ) from public,anon,authenticated;
grant execute on function public.get_source_cultural_preflight_input(uuid,uuid,uuid),
  public.command_record_bound_source_review_packet(
    uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text[],text[],text,text,jsonb,jsonb
  ) to service_role;

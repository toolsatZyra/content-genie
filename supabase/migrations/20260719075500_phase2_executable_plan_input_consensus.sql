-- Read-model and lifecycle completion for executable plan generation and
-- two blind evaluator consensus.

create or replace function public.get_plan_preflight_input(
  p_workspace_id uuid,p_preflight_run_id uuid,p_stage_attempt_id uuid,
  p_capability_version_ids uuid[]
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  config public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  clock public.narration_master_clock_versions%rowtype;
  packet public.source_review_packets%rowtype;
  pack public.world_reference_pack_versions%rowtype;
  binding public.source_review_packet_world_bindings%rowtype;
  audio public.preflight_audio_identity_selections%rowtype;
  score public.score_identity_versions%rowtype;
  sound public.sound_identity_versions%rowtype;
  policy public.cultural_policy_versions%rowtype;
  rubric private.plan_qc_rubric_versions%rowtype;
  existing_plan public.preflight_plan_bundles%rowtype;
  alignment_value jsonb;
  character_value jsonb;
  location_value jsonb;
  source_value jsonb;
  capability_value jsonb;
  parameter_value jsonb;
  existing_value jsonb;
  rubric_hash_value text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_capability_version_ids is null or cardinality(p_capability_version_ids)<>3
    or cardinality(p_capability_version_ids)<>cardinality(array(
      select distinct unnest(p_capability_version_ids)
    ))
  then raise exception 'plan capability set is invalid' using errcode='22023'; end if;
  select * into run from public.preflight_runs
    where id=p_preflight_run_id and workspace_id=p_workspace_id;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and workspace_id=p_workspace_id
      and preflight_run_id=p_preflight_run_id;
  select * into config from public.episode_configuration_candidates
    where id=run.configuration_candidate_id and workspace_id=p_workspace_id;
  select * into script from public.script_revisions
    where id=run.script_revision_id and workspace_id=p_workspace_id;
  select * into clock from public.narration_master_clock_versions
    where configuration_candidate_id=config.id and workspace_id=p_workspace_id
      and state='verified' order by version_number desc limit 1;
  select packet_row.* into packet from public.source_review_packets packet_row
    join public.source_review_statuses status on status.source_review_packet_id=packet_row.id
    where packet_row.configuration_candidate_id=config.id
      and packet_row.workspace_id=p_workspace_id and status.status='approved'
    order by packet_row.packet_version desc limit 1;
  select * into pack from public.world_reference_pack_versions
    where configuration_candidate_id=config.id and workspace_id=p_workspace_id
      and state='verified' order by version_number desc limit 1;
  select * into binding from public.source_review_packet_world_bindings
    where source_review_packet_id=packet.id and workspace_id=p_workspace_id
      and configuration_candidate_id=config.id
      and world_reference_pack_version_id=pack.id;
  select * into audio from public.preflight_audio_identity_selections
    where id=clock.audio_identity_selection_id and workspace_id=p_workspace_id
      and state='verified';
  select * into score from public.score_identity_versions
    where id=audio.score_identity_version_id and workspace_id=p_workspace_id
      and state='verified';
  select * into sound from public.sound_identity_versions
    where id=audio.sound_identity_version_id and workspace_id=p_workspace_id
      and state='verified';
  select * into policy from public.cultural_policy_versions
    where id=packet.policy_version_id and state='active';
  select * into rubric from private.plan_qc_rubric_versions
    where rubric_key='mythological-devotional-plan' and rubric_version='1.0.0'
      and state='active';
  if run.id is null or run.kind<>'plan_evaluation' or run.state<>'running'
    or attempt.id is null or attempt.state not in ('claimed','running')
    or attempt.authority_epoch<>run.authority_epoch
    or not exists(select 1 from public.preflight_stage_runs stage
      where stage.id=attempt.preflight_stage_run_id and stage.preflight_run_id=run.id
        and stage.highest_fencing_token=attempt.fencing_token
        and stage.input_manifest_hash=attempt.input_manifest_hash)
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=attempt.fencing_token
        and lease.expires_at>statement_timestamp())
    or config.id is null or config.state not in ('preflight','ready_to_lock')
    or script.id is null or clock.id is null or clock.script_revision_id<>script.id
    or clock.processing_text_sha256<>script.processing_utf8_sha256
    or packet.id is null or packet.script_revision_id<>script.id
    or pack.id is null or binding.source_review_packet_id is null
    or binding.script_sha256<>script.raw_utf8_sha256
    or binding.world_reference_pack_hash<>pack.manifest_hash
    or audio.id is null or score.id is null or sound.id is null
    or policy.id is null or binding.cultural_policy_hash<>policy.manifest_hash
    or rubric.rubric_key is null
    or (select count(*) from private.production_provider_capability_versions capability
        join private.provider_accounts account on account.id=capability.provider_account_id
        where capability.id=any(p_capability_version_ids)
          and capability.state='verified' and capability.expires_at>statement_timestamp()
          and account.workspace_id=p_workspace_id and account.state='active')<>3
    or (select count(distinct capability.motion_class)
        from private.production_provider_capability_versions capability
        where capability.id=any(p_capability_version_ids))<>3
  then raise exception 'plan preflight authority or evidence is stale' using errcode='40001'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'segmentNumber',segment.segment_number,'kind',segment.segment_kind,
    'startScalar',segment.processing_start_scalar,'endScalar',segment.processing_end_scalar,
    'exactText',segment.exact_text,'startMs',segment.start_ms,'endMs',segment.end_ms
  ) order by segment.segment_number),'[]'::jsonb)
  into alignment_value from public.narration_alignment_segments segment
  where segment.master_clock_version_id=clock.id;
  if jsonb_array_length(alignment_value)<>clock.segment_count
  then raise exception 'narration alignment evidence is incomplete' using errcode='40001'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'characterVersionId',version.id,'characterFormId',version.character_form_id,
    'anchorAssetVersionId',version.anchor_asset_version_id,
    'anchorContentSha256',anchor_asset.content_sha256,
    'sheetAssetVersionId',sheet.sheet_asset_version_id,
    'sheetContentSha256',sheet_asset.content_sha256,
    'identityManifest',version.identity_manifest,
    'identityManifestHash',version.identity_manifest_hash
  ) order by version.character_form_id),'[]'::jsonb)
  into character_value
  from public.character_selections selection
  join public.character_versions version on version.id=selection.selected_version_id
  join public.asset_versions anchor_asset on anchor_asset.id=version.anchor_asset_version_id
    and anchor_asset.workspace_id=p_workspace_id
  join lateral (
    select sheet_row.* from public.character_sheet_versions sheet_row
    where sheet_row.character_version_id=version.id and sheet_row.workspace_id=p_workspace_id
      and sheet_row.state='verified' order by sheet_row.created_at desc limit 1
  ) sheet on true
  join public.asset_versions sheet_asset on sheet_asset.id=sheet.sheet_asset_version_id
    and sheet_asset.workspace_id=p_workspace_id
  where selection.configuration_candidate_id=config.id
    and selection.workspace_id=p_workspace_id and selection.state='accepted';

  select coalesce(jsonb_agg(jsonb_build_object(
    'locationVersionId',version.id,'locationId',version.location_id,
    'anchorAssetVersionId',version.empty_anchor_asset_version_id,
    'anchorContentSha256',anchor_asset.content_sha256,
    'locationManifest',version.location_manifest,
    'locationManifestHash',version.location_manifest_hash,
    'templeEvidenceSetHash',version.temple_evidence_set_hash
  ) order by version.location_id),'[]'::jsonb)
  into location_value
  from public.location_selections selection
  join public.location_versions version on version.id=selection.selected_version_id
  join public.asset_versions anchor_asset on anchor_asset.id=version.empty_anchor_asset_version_id
    and anchor_asset.workspace_id=p_workspace_id
  where selection.configuration_candidate_id=config.id
    and selection.workspace_id=p_workspace_id and selection.state='accepted';
  if jsonb_array_length(character_value)<1 or jsonb_array_length(location_value)<1
  then raise exception 'accepted World references are incomplete' using errcode='40001'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceRecordVersionId',source.id,'sourceClass',source.source_class,
    'title',source.title,'language',source.language,
    'editionCitation',source.edition_citation,
    'boundedProposition',source.bounded_proposition,
    'claimClass',packet_source.claim_class,'canonicalHash',source.canonical_hash
  ) order by source.id),'[]'::jsonb)
  into source_value
  from public.source_review_packet_sources packet_source
  join public.source_record_versions source on source.id=packet_source.source_record_version_id
  where packet_source.source_review_packet_id=packet.id
    and packet_source.workspace_id=p_workspace_id;

  select jsonb_agg(jsonb_build_object(
    'capabilityVersionId',capability.id,'profileKey',capability.capability_key,
    'providerFamily',capability.provider_family,'modelKey',capability.model_key,
    'modelVersion',capability.model_version,'endpointKey',capability.endpoint_key,
    'motionClass',capability.motion_class,'durationMinMs',capability.duration_min_ms,
    'durationMaxMs',capability.duration_max_ms,
    'durationQuantumMs',capability.duration_quantum_ms,
    'maximumReferenceCount',capability.maximum_reference_count,
    'maximumWidth',capability.maximum_width,'maximumHeight',capability.maximum_height,
    'schemaHash',capability.schema_hash,'expiresAt',capability.expires_at
  ) order by capability.motion_class)
  into capability_value from private.production_provider_capability_versions capability
  where capability.id=any(p_capability_version_ids);

  rubric_hash_value:=encode(extensions.digest(convert_to(
    rubric.source_visual_hash||':'||rubric.source_checks_hash||':'||rubric.contract_hash,
    'UTF8'),'sha256'),'hex');
  select jsonb_agg(jsonb_build_object(
    'parameterId',parameter.parameter_id,'baseWeight',parameter.base_weight
  ) order by parameter.parameter_id)
  into parameter_value from private.plan_qc_rubric_parameters parameter
  where parameter.rubric_key=rubric.rubric_key
    and parameter.rubric_version=rubric.rubric_version;

  select * into existing_plan from public.preflight_plan_bundles
    where preflight_run_id=run.id and workspace_id=p_workspace_id
    order by created_at desc limit 1;
  existing_value:=case when existing_plan.id is null then null else jsonb_build_object(
    'planBundleId',existing_plan.id,'planHash',existing_plan.plan_hash,
    'graphHash',existing_plan.graph_hash,'state',existing_plan.state,
    'storyVersionId',existing_plan.story_version_id,
    'beatVersionId',existing_plan.beat_version_id,
    'shotVersionId',existing_plan.shot_version_id,
    'soundVersionId',existing_plan.sound_version_id,
    'compositionVersionId',existing_plan.composition_version_id,
    'safetyVersionId',existing_plan.safety_version_id,
    'routingVersionId',existing_plan.routing_version_id,
    'eddVersionId',existing_plan.edd_version_id
  ) end;

  return jsonb_build_object(
    'workspaceId',p_workspace_id,'episodeId',run.episode_id,
    'configurationCandidateId',config.id,'scriptRevisionId',script.id,
    'processingText',script.processing_text,
    'processingTextSha256',script.processing_utf8_sha256,
    'processingScalarCount',script.processing_scalar_count,
    'preflightRunId',run.id,'stageAttemptId',attempt.id,
    'inputManifestHash',attempt.input_manifest_hash,
    'masterClock',jsonb_build_object(
      'masterClockVersionId',clock.id,'durationMs',clock.duration_ms,
      'alignmentHash',clock.alignment_hash,'audioEvidenceHash',clock.audio_evidence_hash,
      'performanceProfileHash',clock.performance_profile_hash
    ),
    'alignmentSegments',alignment_value,
    'sourceReview',jsonb_build_object(
      'sourceReviewPacketId',packet.id,'subjectHash',packet.subject_hash,
      'sourceSetHash',packet.source_set_hash,'evidenceSetHash',packet.evidence_set_hash,
      'policyVersionId',policy.id,'policyManifest',policy.manifest,
      'policyHash',policy.manifest_hash,'sources',source_value
    ),
    'world',jsonb_build_object(
      'worldReferencePackVersionId',pack.id,'manifest',pack.manifest,
      'manifestHash',pack.manifest_hash,'qcEvidenceHash',pack.qc_evidence_hash,
      'characters',character_value,'locations',location_value
    ),
    'audio',jsonb_build_object(
      'audioIdentitySelectionId',audio.id,
      'scoreIdentityVersionId',score.id,'scoreManifest',score.motif_manifest,
      'scoreManifestHash',score.motif_manifest_hash,
      'soundIdentityVersionId',sound.id,'ambienceManifest',sound.ambience_manifest,
      'sfxManifest',sound.sfx_manifest,'soundManifestHash',sound.manifest_hash
    ),
    'capabilities',capability_value,
    'rubric',jsonb_build_object(
      'rubricKey',rubric.rubric_key,'rubricVersion',rubric.rubric_version,
      'rubricHash',rubric_hash_value,'parameters',parameter_value
    ),
    'existingPlan',existing_value
  );
end;
$$;
revoke all on function public.get_plan_preflight_input(uuid,uuid,uuid,uuid[])
from public,anon,authenticated;
grant execute on function public.get_plan_preflight_input(uuid,uuid,uuid,uuid[])
to service_role;

drop trigger if exists plan_bundles_immutable on public.preflight_plan_bundles;

create or replace function private.guard_plan_bundle_lifecycle()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='DELETE' then
    raise exception 'plan bundles are immutable' using errcode='55000';
  end if;
  if auth.role() is distinct from 'service_role'
    or to_jsonb(new)-'state'-'created_at' is distinct from to_jsonb(old)-'state'-'created_at'
    or old.created_at is distinct from new.created_at
    or old.state<>'candidate' or new.state not in ('qc_passed','blocked')
  then raise exception 'plan bundle content or lifecycle mutation is forbidden' using errcode='55000'; end if;
  return new;
end;
$$;

create trigger plan_bundles_lifecycle_guard
before update or delete on public.preflight_plan_bundles
for each row execute function private.guard_plan_bundle_lifecycle();

revoke all on function private.guard_plan_bundle_lifecycle()
from public,anon,authenticated;

create or replace function public.command_create_preflight_plan_consensus(
  p_workspace_id uuid,p_blind_group_id uuid
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  challenge private.plan_evaluator_challenges%rowtype;
  consensus_id uuid;
  expected_rubric_hash text;
  ovs_value numeric;
  cvp_value numeric;
  pfs_value numeric;
  lcr_value numeric;
  confidence_value numeric;
  evidence_density_value numeric;
  maximum_spread integer;
  gate_codes text[]:='{}'::text[];
  final_verdict text;
  consensus_hash_value text;
  reveal_applicable boolean;
  existing_consensus private.preflight_plan_qc_consensus%rowtype;
  score_first integer; score_clarity integer; score_vertical integer;
  score_emotion integer; score_reveal integer; score_blocking integer;
  score_escalation integer; score_cliffhanger integer; score_rhythm integer;
  score_economy integer; score_performance integer; score_sound integer;
  score_subtitle integer; score_feasibility integer; score_localization integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into existing_consensus from private.preflight_plan_qc_consensus
    where workspace_id=p_workspace_id and blind_group_id=p_blind_group_id;
  if existing_consensus.id is not null then return existing_consensus.id; end if;
  select * into challenge from private.plan_evaluator_challenges
    where blind_group_id=p_blind_group_id and workspace_id=p_workspace_id limit 1;
  if challenge.id is null
    or (select count(*) from private.plan_evaluator_challenges where blind_group_id=p_blind_group_id)<>2
    or (select count(distinct evaluator_deployment_family) from private.plan_evaluator_challenges where blind_group_id=p_blind_group_id)<>2
    or (select count(*) from private.plan_evaluator_score_sets score_set
        join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
        where c.blind_group_id=p_blind_group_id)<>2
  then raise exception 'two independent evaluator results are required' using errcode='40001'; end if;
  select encode(extensions.digest(convert_to(
    rubric.source_visual_hash||':'||rubric.source_checks_hash||':'||rubric.contract_hash,'UTF8'),'sha256'),'hex')
    into expected_rubric_hash from private.plan_qc_rubric_versions rubric
    where rubric.rubric_key=challenge.rubric_key and rubric.rubric_version=challenge.rubric_version and rubric.state='active';

  with scores as (
    select parameter.parameter_id,min(parameter.score) score,
      max(parameter.score)-min(parameter.score) spread,
      bool_and(parameter.applicable) applicable
    from private.plan_evaluator_parameter_scores parameter
    join private.plan_evaluator_score_sets score_set on score_set.id=parameter.score_set_id
    join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
    where c.blind_group_id=p_blind_group_id group by parameter.parameter_id
  )
  select max(spread),
    min(score) filter(where parameter_id='first_frame_hook'),
    min(score) filter(where parameter_id='visual_story_clarity'),
    min(score) filter(where parameter_id='vertical_composition'),
    min(score) filter(where parameter_id='emotional_readability'),
    min(score) filter(where parameter_id='reveal_execution'),
    min(score) filter(where parameter_id='blocking_power_geometry'),
    min(score) filter(where parameter_id='visual_escalation'),
    min(score) filter(where parameter_id='cliffhanger_image'),
    min(score) filter(where parameter_id='edit_rhythm'),
    min(score) filter(where parameter_id='shot_economy'),
    min(score) filter(where parameter_id='performance_capture'),
    min(score) filter(where parameter_id='sound_music'),
    min(score) filter(where parameter_id='subtitle_ui_safety'),
    min(score) filter(where parameter_id='production_feasibility'),
    min(score) filter(where parameter_id='localization_compliance')
  into maximum_spread,score_first,score_clarity,score_vertical,score_emotion,
    score_reveal,score_blocking,score_escalation,score_cliffhanger,score_rhythm,
    score_economy,score_performance,score_sound,score_subtitle,score_feasibility,
    score_localization from scores;

  evidence_density_value:=case when exists(
    select 1 from private.plan_evaluator_parameter_scores parameter
    join private.plan_evaluator_score_sets score_set on score_set.id=parameter.score_set_id
    join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
    where c.blind_group_id=p_blind_group_id and (not parameter.applicable or parameter.evidence_version_id is null)
  ) then 0 else 100 end;
  confidence_value:=0.45*100+0.25*evidence_density_value+0.20*70+
    0.10*greatest(0,100-12*case when maximum_spread>=3 then 1 else 0 end);

  ovs_value:=10*(10*score_first+9*score_clarity+9.6*score_vertical+8*score_emotion+
    9.6*score_reveal+8.4*score_blocking+7*score_escalation+7*score_cliffhanger+
    7*score_rhythm+7.2*score_economy+6*score_performance+4.8*score_sound+
    4*score_subtitle+4.8*score_feasibility+4.8*score_localization)/
    (10+9+9.6+8+9.6+8.4+7+7+7+7.2+6+4.8+4+4.8+4.8);
  cvp_value:=10*(0.22*score_first+0.14*score_emotion+0.14*score_escalation+
    0.18*score_reveal+0.20*score_cliffhanger+0.12*score_rhythm);
  pfs_value:=10*(0.35*score_feasibility+0.20*score_economy+0.20*score_blocking+
    0.15*score_rhythm+0.10*score_subtitle);
  lcr_value:=greatest(0,least(100,100-10*(0.45*score_localization+
    0.25*score_subtitle+0.15*score_clarity+0.15*score_sound)));
  select exists(select 1 from public.preflight_beats beat
    where beat.plan_bundle_id=challenge.plan_bundle_id and beat.reveal_level<>'none') into reveal_applicable;

  if score_first<=3 then gate_codes:=array_append(gate_codes,'FIRST_FRAME_HOOK'); end if;
  if reveal_applicable and score_reveal<=3 then gate_codes:=array_append(gate_codes,'REVEAL_EXECUTION'); end if;
  if score_subtitle<=3 then gate_codes:=array_append(gate_codes,'SUBTITLE_UI_SAFETY'); end if;
  if score_sound<=3 then gate_codes:=array_append(gate_codes,'SOUND_MUSIC'); end if;
  if score_feasibility<=3 then gate_codes:=array_append(gate_codes,'GENERATION_FEASIBILITY'); end if;
  if score_localization<=2 then gate_codes:=array_append(gate_codes,'LOCALIZATION_COMPLIANCE'); end if;
  if score_cliffhanger<=3 then gate_codes:=array_append(gate_codes,'CLIFFHANGER_IMAGE'); end if;
  if ovs_value<74 then gate_codes:=array_append(gate_codes,'OVS_BELOW_74'); end if;
  if cvp_value<70 then gate_codes:=array_append(gate_codes,'CVP_BELOW_70'); end if;
  if pfs_value<70 then gate_codes:=array_append(gate_codes,'PFS_BELOW_70'); end if;
  if confidence_value<75 or evidence_density_value<>100 then gate_codes:=array_append(gate_codes,'EVIDENCE_CONFIDENCE'); end if;
  if exists(select 1 from private.evaluator_records evaluation
      join private.plan_evaluator_score_sets score_set on score_set.evaluator_record_id=evaluation.id
      join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
      where c.blind_group_id=p_blind_group_id and evaluation.verdict<>'pass')
  then gate_codes:=array_append(gate_codes,'EVALUATOR_BLOCK'); end if;
  final_verdict:=case when maximum_spread>=3 then 'indeterminate'
    when cardinality(gate_codes)>0 then 'block' else 'pass' end;
  consensus_hash_value:=encode(extensions.digest(convert_to(jsonb_build_object(
    'blindGroupId',p_blind_group_id,'rubricHash',expected_rubric_hash,
    'ovs',round(ovs_value,3),'cvp',round(cvp_value,3),'pfs',round(pfs_value,3),
    'lcr',round(lcr_value,3),'confidence',round(confidence_value,3),
    'evidenceDensity',round(evidence_density_value,3),'maximumSpread',maximum_spread,
    'verdict',final_verdict,'gateCodes',to_jsonb(gate_codes))::text,'UTF8'),'sha256'),'hex');
  insert into private.preflight_plan_qc_consensus(
    workspace_id,preflight_run_id,stage_attempt_id,plan_bundle_id,blind_group_id,
    rubric_key,rubric_version,rubric_hash,ovs,cvp,pfs,lcr,confidence,evidence_density,
    maximum_parameter_spread,verdict,gate_codes,consensus_hash
  ) values(p_workspace_id,challenge.preflight_run_id,challenge.stage_attempt_id,
    challenge.plan_bundle_id,p_blind_group_id,challenge.rubric_key,challenge.rubric_version,
    expected_rubric_hash,round(ovs_value,3),round(cvp_value,3),round(pfs_value,3),
    round(lcr_value,3),round(confidence_value,3),round(evidence_density_value,3),
    maximum_spread,final_verdict,gate_codes,consensus_hash_value)
  returning id into consensus_id;
  update public.preflight_plan_bundles
    set state=case when final_verdict='pass' then 'qc_passed' else 'blocked' end
    where id=challenge.plan_bundle_id and workspace_id=p_workspace_id and state='candidate';
  if not found then raise exception 'plan bundle lifecycle is stale' using errcode='40001'; end if;
  return consensus_id;
end;
$$;

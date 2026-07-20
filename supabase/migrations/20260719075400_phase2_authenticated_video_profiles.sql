-- Model upstream design references separately from direct provider inputs.
-- Kling receives one composed start frame; Seedance may receive the exact
-- multi-reference set. Provider durations must also obey discrete API quanta.

alter table public.preflight_provider_request_slots
  add column input_strategy text;

update public.preflight_provider_request_slots
set input_strategy='direct_multi_reference'
where input_strategy is null;

alter table public.preflight_provider_request_slots
  alter column input_strategy set not null,
  add constraint preflight_slot_input_strategy_valid
    check(input_strategy in ('composited_start_frame','direct_multi_reference'));

create or replace function public.command_record_preflight_plan(
  p_plan_bundle_id uuid,p_workspace_id uuid,p_configuration_candidate_id uuid,
  p_preflight_run_id uuid,p_master_clock_version_id uuid,
  p_source_review_packet_id uuid,p_world_reference_pack_version_id uuid,
  p_plan_hash text,p_graph_hash text,p_projected_ovs numeric,p_projected_cvp numeric,
  p_projected_pfs numeric,p_projected_confidence numeric,p_evidence_density numeric,
  p_component_ids jsonb,p_plan jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  config public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  clock public.narration_master_clock_versions%rowtype;
  current_component_kind text;
  component_payload jsonb;
  component_version integer;
  component_id uuid;
  beat jsonb;
  shot jsonb;
  slot jsonb;
  edge jsonb;
  beat_number integer:=0;
  shot_number integer:=0;
  previous_beat_scalar integer:=0;
  previous_beat_time integer:=0;
  previous_shot_time integer:=0;
  start_scalar integer;
  end_scalar integer;
  start_time integer;
  end_time integer;
  character_ids uuid[];
  source_shot integer;
  capability private.production_provider_capability_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into config from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into script from public.script_revisions where id=config.script_revision_id;
  select * into clock from public.narration_master_clock_versions
    where id=p_master_clock_version_id and workspace_id=p_workspace_id;
  if config.id is null or config.state not in ('preflight','ready_to_lock')
    or clock.id is null or clock.configuration_candidate_id<>config.id or clock.state<>'verified'
    or not exists(select 1 from public.preflight_runs run
      where run.id=p_preflight_run_id and run.workspace_id=p_workspace_id
        and run.configuration_candidate_id=config.id and run.script_revision_id=script.id
        and run.kind='plan_evaluation'
        and run.state in ('running','waiting_external','waiting_decision','succeeded'))
    or not exists(select 1 from public.source_review_packets packet
      join public.source_review_statuses status on status.source_review_packet_id=packet.id
      where packet.id=p_source_review_packet_id and packet.workspace_id=p_workspace_id
        and packet.configuration_candidate_id=config.id and packet.script_revision_id=script.id
        and status.status='approved')
    or not exists(select 1 from public.world_reference_pack_versions pack
      where pack.id=p_world_reference_pack_version_id and pack.workspace_id=p_workspace_id
        and pack.configuration_candidate_id=config.id and pack.state='verified')
    or p_plan is null or jsonb_typeof(p_plan)<>'object'
    or (p_plan-array['story','beats','shots','sound','composition','safety','routing','edd','requestSlots','references']::text[])<>'{}'::jsonb
    or not(p_plan?&array['story','beats','shots','sound','composition','safety','routing','edd','requestSlots','references'])
    or jsonb_typeof(p_plan->'story')<>'object'
    or jsonb_typeof(p_plan->'beats')<>'array' or jsonb_array_length(p_plan->'beats') not between 1 and 100
    or jsonb_typeof(p_plan->'shots')<>'array' or jsonb_array_length(p_plan->'shots') not between 1 and 240
    or jsonb_typeof(p_plan->'sound')<>'object' or jsonb_typeof(p_plan->'composition')<>'object'
    or jsonb_typeof(p_plan->'safety')<>'object' or jsonb_typeof(p_plan->'routing')<>'object'
    or jsonb_typeof(p_plan->'edd')<>'object'
    or jsonb_typeof(p_plan->'requestSlots')<>'array' or jsonb_array_length(p_plan->'requestSlots') not between 1 and 2160
    or jsonb_typeof(p_plan->'references')<>'array' or jsonb_array_length(p_plan->'references') not between 1 and 4800
    or p_component_ids is null or jsonb_typeof(p_component_ids)<>'object'
    or (p_component_ids-array['story','beat','shot','sound','composition','safety','routing','edd']::text[])<>'{}'::jsonb
    or not(p_component_ids?&array['story','beat','shot','sound','composition','safety','routing','edd'])
    or p_plan_hash is distinct from encode(extensions.digest(convert_to(p_plan::text,'UTF8'),'sha256'),'hex')
    or p_graph_hash is distinct from encode(extensions.digest(convert_to(
      jsonb_build_object('shots',p_plan->'shots','requestSlots',p_plan->'requestSlots','references',p_plan->'references')::text,
      'UTF8'),'sha256'),'hex')
  then raise exception 'preflight plan envelope is invalid' using errcode='40001'; end if;

  foreach current_component_kind in array array['story','beat','shot','sound','composition','safety','routing','edd'] loop
    component_payload:=case current_component_kind
      when 'beat' then p_plan->'beats' when 'shot' then p_plan->'shots'
      else p_plan->current_component_kind end;
    component_id:=(p_component_ids->>current_component_kind)::uuid;
    select coalesce(max(version_number),0)+1 into component_version
      from public.preflight_plan_component_versions
      where configuration_candidate_id=config.id
        and preflight_plan_component_versions.component_kind=current_component_kind;
    insert into public.preflight_plan_component_versions(
      id,workspace_id,configuration_candidate_id,master_clock_version_id,component_kind,
      version_number,schema_version,payload,content_hash
    ) values(component_id,p_workspace_id,config.id,clock.id,current_component_kind,component_version,
      'genie.preflight-plan.v1',component_payload,
      encode(extensions.digest(convert_to(component_payload::text,'UTF8'),'sha256'),'hex'));
  end loop;

  insert into public.preflight_plan_bundles(
    id,workspace_id,configuration_candidate_id,preflight_run_id,master_clock_version_id,
    source_review_packet_id,world_reference_pack_version_id,story_version_id,beat_version_id,
    shot_version_id,sound_version_id,composition_version_id,safety_version_id,
    routing_version_id,edd_version_id,plan_hash,graph_hash,projected_ovs,projected_cvp,
    projected_pfs,projected_confidence,evidence_density,state
  ) values(
    p_plan_bundle_id,p_workspace_id,config.id,p_preflight_run_id,clock.id,
    p_source_review_packet_id,p_world_reference_pack_version_id,
    (p_component_ids->>'story')::uuid,(p_component_ids->>'beat')::uuid,
    (p_component_ids->>'shot')::uuid,(p_component_ids->>'sound')::uuid,
    (p_component_ids->>'composition')::uuid,(p_component_ids->>'safety')::uuid,
    (p_component_ids->>'routing')::uuid,(p_component_ids->>'edd')::uuid,
    p_plan_hash,p_graph_hash,p_projected_ovs,p_projected_cvp,p_projected_pfs,
    p_projected_confidence,p_evidence_density,'candidate'
  );

  for beat in select value from jsonb_array_elements(p_plan->'beats') loop
    beat_number:=beat_number+1;
    if jsonb_typeof(beat)<>'object'
      or (beat-array['beatNumber','startScalar','endScalar','exactText','startMs','endMs','beatType','revealLevel','requiresProof','requiresReaction','requiresConsequence']::text[])<>'{}'::jsonb
      or not(beat?&array['beatNumber','startScalar','endScalar','exactText','startMs','endMs','beatType','revealLevel','requiresProof','requiresReaction','requiresConsequence'])
      or (beat->>'beatNumber')::integer<>beat_number
    then raise exception 'beat plan is not exact' using errcode='22023'; end if;
    start_scalar:=(beat->>'startScalar')::integer; end_scalar:=(beat->>'endScalar')::integer;
    start_time:=(beat->>'startMs')::integer; end_time:=(beat->>'endMs')::integer;
    if start_scalar<>previous_beat_scalar or start_time<>previous_beat_time
      or substring(script.processing_text from start_scalar+1 for end_scalar-start_scalar) is distinct from beat->>'exactText'
      or end_scalar>script.processing_scalar_count or end_time>clock.duration_ms
      or end_time<=start_time or end_scalar<=start_scalar
    then raise exception 'beats do not cover the locked script/master clock' using errcode='40001'; end if;
    insert into public.preflight_beats(
      workspace_id,plan_bundle_id,beat_number,processing_start_scalar,processing_end_scalar,
      exact_text,start_ms,end_ms,beat_type,reveal_level,requires_proof,requires_reaction,requires_consequence
    ) values(p_workspace_id,p_plan_bundle_id,beat_number,start_scalar,end_scalar,beat->>'exactText',
      start_time,end_time,beat->>'beatType',beat->>'revealLevel',
      (beat->>'requiresProof')::boolean,(beat->>'requiresReaction')::boolean,
      (beat->>'requiresConsequence')::boolean);
    previous_beat_scalar:=end_scalar; previous_beat_time:=end_time;
  end loop;
  if previous_beat_scalar<>script.processing_scalar_count or previous_beat_time<>clock.duration_ms then
    raise exception 'beat coverage is incomplete' using errcode='40001'; end if;

  for shot in select value from jsonb_array_elements(p_plan->'shots') loop
    shot_number:=shot_number+1;
    if jsonb_typeof(shot)<>'object'
      or (shot-array['shotNumber','beatNumber','startMs','endMs','motionClass','locationVersionId','characterVersionIds','safeAreaPass','suppliesProof','suppliesReaction','suppliesConsequence','shotContentHash']::text[])<>'{}'::jsonb
      or not(shot?&array['shotNumber','beatNumber','startMs','endMs','motionClass','locationVersionId','characterVersionIds','safeAreaPass','suppliesProof','suppliesReaction','suppliesConsequence','shotContentHash'])
      or (shot->>'shotNumber')::integer<>shot_number
      or jsonb_typeof(shot->'characterVersionIds')<>'array'
    then raise exception 'shot plan is not exact' using errcode='22023'; end if;
    start_time:=(shot->>'startMs')::integer; end_time:=(shot->>'endMs')::integer;
    select array_agg(value::uuid order by ordinal) into character_ids
      from jsonb_array_elements_text(shot->'characterVersionIds') with ordinality as ids(value,ordinal);
    if start_time<>previous_shot_time or end_time<=start_time or end_time>clock.duration_ms
      or character_ids is null or cardinality(character_ids)<>cardinality(array(select distinct unnest(character_ids)))
      or not exists(select 1 from public.preflight_beats planned_beat
        where planned_beat.plan_bundle_id=p_plan_bundle_id
          and planned_beat.beat_number=(shot->>'beatNumber')::integer
          and start_time>=planned_beat.start_ms and end_time<=planned_beat.end_ms)
      or not exists(select 1 from public.location_selections selection
        where selection.configuration_candidate_id=config.id and selection.workspace_id=p_workspace_id
          and selection.selected_version_id=(shot->>'locationVersionId')::uuid and selection.state='accepted')
      or (select count(*) from public.character_selections selection
          where selection.configuration_candidate_id=config.id and selection.workspace_id=p_workspace_id
            and selection.selected_version_id=any(character_ids) and selection.state='accepted')<>cardinality(character_ids)
    then raise exception 'shot coverage or World binding is invalid' using errcode='40001'; end if;
    insert into public.preflight_shots(
      workspace_id,plan_bundle_id,shot_number,beat_number,start_ms,end_ms,motion_class,
      location_version_id,character_version_ids,safe_area_pass,supplies_proof,
      supplies_reaction,supplies_consequence,shot_content_hash,topological_order
    ) values(p_workspace_id,p_plan_bundle_id,shot_number,(shot->>'beatNumber')::integer,
      start_time,end_time,shot->>'motionClass',(shot->>'locationVersionId')::uuid,
      character_ids,(shot->>'safeAreaPass')::boolean,(shot->>'suppliesProof')::boolean,
      (shot->>'suppliesReaction')::boolean,(shot->>'suppliesConsequence')::boolean,
      shot->>'shotContentHash',shot_number);
    previous_shot_time:=end_time;
  end loop;
  if previous_shot_time<>clock.duration_ms then
    raise exception 'shot plan does not cover the narration master clock' using errcode='40001'; end if;

  for slot in select value from jsonb_array_elements(p_plan->'requestSlots') loop
    if jsonb_typeof(slot)<>'object'
      or (slot-array['slotKey','shotNumber','slotKind','capabilityVersionId','durationMs','retainedDurationMs','inputStrategy','referenceCount','outputWidth','outputHeight','billingQuantumCount','expectedOutputKind']::text[])<>'{}'::jsonb
      or not(slot?&array['slotKey','shotNumber','slotKind','capabilityVersionId','durationMs','retainedDurationMs','inputStrategy','referenceCount','outputWidth','outputHeight','billingQuantumCount','expectedOutputKind'])
    then raise exception 'provider request slot is not exact' using errcode='22023'; end if;
    select * into capability from private.production_provider_capability_versions
      where id=(slot->>'capabilityVersionId')::uuid;
    if capability.id is null or capability.state<>'verified' or capability.expires_at<=statement_timestamp()
      or not exists(select 1 from public.preflight_shots planned_shot
        where planned_shot.plan_bundle_id=p_plan_bundle_id
          and planned_shot.shot_number=(slot->>'shotNumber')::integer
          and planned_shot.motion_class=capability.motion_class
          and planned_shot.end_ms-planned_shot.start_ms=(slot->>'retainedDurationMs')::integer)
      or (slot->>'durationMs')::integer not between capability.duration_min_ms and capability.duration_max_ms
      or (slot->>'retainedDurationMs')::integer not between 1000 and (slot->>'durationMs')::integer
      or mod((slot->>'durationMs')::integer,capability.duration_quantum_ms)<>0
      or slot->>'inputStrategy' not in ('composited_start_frame','direct_multi_reference')
      or (slot->>'referenceCount')::integer>capability.maximum_reference_count
      or (slot->>'outputWidth')::integer>capability.maximum_width
      or (slot->>'outputHeight')::integer>capability.maximum_height
      or (slot->>'outputWidth')::integer*16<>(slot->>'outputHeight')::integer*9
      or (slot->>'billingQuantumCount')::integer<>ceil((slot->>'durationMs')::numeric/capability.duration_quantum_ms)
    then raise exception 'provider request slot breaches its authenticated capability' using errcode='40001'; end if;
    insert into public.preflight_provider_request_slots(
      workspace_id,plan_bundle_id,shot_number,slot_key,slot_kind,capability_version_id,
      duration_ms,retained_duration_ms,input_strategy,reference_count,output_width,output_height,billing_quantum_count,expected_output_kind
    ) values(p_workspace_id,p_plan_bundle_id,(slot->>'shotNumber')::integer,slot->>'slotKey',
      slot->>'slotKind',capability.id,(slot->>'durationMs')::integer,
      (slot->>'retainedDurationMs')::integer,slot->>'inputStrategy',
      (slot->>'referenceCount')::integer,(slot->>'outputWidth')::integer,
      (slot->>'outputHeight')::integer,(slot->>'billingQuantumCount')::integer,
      slot->>'expectedOutputKind');
  end loop;

  for edge in select value from jsonb_array_elements(p_plan->'references') loop
    if jsonb_typeof(edge)<>'object'
      or (edge-array['shotNumber','sourceShotNumber','referenceKind','referenceOrdinal','assetVersionId','contentHash','requiresUpstreamSuccess']::text[])<>'{}'::jsonb
      or not(edge?&array['shotNumber','sourceShotNumber','referenceKind','referenceOrdinal','assetVersionId','contentHash','requiresUpstreamSuccess'])
    then raise exception 'reference edge is not exact' using errcode='22023'; end if;
    source_shot:=nullif(edge->>'sourceShotNumber','')::integer;
    if not exists(select 1 from public.preflight_shots planned_shot
        where planned_shot.plan_bundle_id=p_plan_bundle_id and planned_shot.shot_number=(edge->>'shotNumber')::integer)
      or (source_shot is not null and source_shot>=(edge->>'shotNumber')::integer)
      or (source_shot is not null and edge->>'referenceKind'<>'continuity')
      or (source_shot is null and edge->>'referenceKind'='continuity')
      or (source_shot is not null and not (edge->>'requiresUpstreamSuccess')::boolean)
      or (source_shot is not null and not exists(select 1 from public.preflight_shots source, public.preflight_shots target
        where source.plan_bundle_id=p_plan_bundle_id and target.plan_bundle_id=p_plan_bundle_id
          and source.shot_number=source_shot and target.shot_number=(edge->>'shotNumber')::integer
          and source.location_version_id=target.location_version_id
          and source.shot_content_hash=edge->>'contentHash'))
      or (source_shot is null and not exists(select 1 from public.asset_versions version
        where version.id=nullif(edge->>'assetVersionId','')::uuid and version.workspace_id=p_workspace_id
          and version.content_sha256=edge->>'contentHash'))
    then raise exception 'reference graph is cyclic, stale, later-bound, or unsafe' using errcode='40001'; end if;
    insert into public.preflight_reference_edges(
      workspace_id,plan_bundle_id,shot_number,source_shot_number,reference_kind,
      reference_ordinal,asset_version_id,asset_content_hash,requires_upstream_success
    ) values(p_workspace_id,p_plan_bundle_id,(edge->>'shotNumber')::integer,source_shot,
      edge->>'referenceKind',(edge->>'referenceOrdinal')::integer,
      nullif(edge->>'assetVersionId','')::uuid,edge->>'contentHash',
      (edge->>'requiresUpstreamSuccess')::boolean);
  end loop;

  if exists(select 1 from public.preflight_shots planned_shot
    where planned_shot.plan_bundle_id=p_plan_bundle_id and (
      (select count(*) from public.preflight_provider_request_slots slot
        where slot.plan_bundle_id=p_plan_bundle_id and slot.shot_number=planned_shot.shot_number and slot.slot_kind='primary')<>1
      or (select count(*) from public.preflight_provider_request_slots slot
        where slot.plan_bundle_id=p_plan_bundle_id and slot.shot_number=planned_shot.shot_number and slot.slot_kind='candidate')>3
      or (select count(*) from public.preflight_provider_request_slots slot
        where slot.plan_bundle_id=p_plan_bundle_id and slot.shot_number=planned_shot.shot_number and slot.slot_kind='retry')>3
      or (select count(*) from public.preflight_provider_request_slots slot
        where slot.plan_bundle_id=p_plan_bundle_id and slot.shot_number=planned_shot.shot_number and slot.slot_kind='alternate')>2
      or exists(select 1 from public.preflight_provider_request_slots slot
        where slot.plan_bundle_id=p_plan_bundle_id and slot.shot_number=planned_shot.shot_number
          and ((slot.input_strategy='composited_start_frame' and (
              slot.reference_count<>1 or not exists(select 1 from public.preflight_reference_edges edge
                where edge.plan_bundle_id=p_plan_bundle_id and edge.shot_number=planned_shot.shot_number)))
            or (slot.input_strategy='direct_multi_reference' and slot.reference_count<>(
              select count(*) from public.preflight_reference_edges edge
              where edge.plan_bundle_id=p_plan_bundle_id and edge.shot_number=planned_shot.shot_number))))
    )) then raise exception 'shot request expansion is incomplete or unbounded' using errcode='40001'; end if;

  if exists(select 1 from (
      select edge.*,row_number() over(partition by edge.shot_number order by edge.reference_ordinal) expected_ordinal,
        case edge.reference_kind when 'character' then 1 when 'continuity' then 2 else 3 end priority,
        lag(case edge.reference_kind when 'character' then 1 when 'continuity' then 2 else 3 end)
          over(partition by edge.shot_number order by edge.reference_ordinal) previous_priority
      from public.preflight_reference_edges edge where edge.plan_bundle_id=p_plan_bundle_id
    ) ordered where reference_ordinal<>expected_ordinal or priority<coalesce(previous_priority,priority))
  then raise exception 'reference ordering is not canonical' using errcode='40001'; end if;

  if exists(select 1 from public.preflight_reference_edges edge
    where edge.plan_bundle_id=p_plan_bundle_id and edge.source_shot_number is null and (
      (edge.reference_kind='character' and not exists(
        select 1 from public.character_selections selection
        join public.character_versions version on version.id=selection.selected_version_id
        left join public.character_sheet_versions sheet on sheet.character_version_id=version.id
        where selection.configuration_candidate_id=config.id and selection.state='accepted'
          and (version.anchor_asset_version_id=edge.asset_version_id or sheet.sheet_asset_version_id=edge.asset_version_id)))
      or (edge.reference_kind='location_master' and not exists(
        select 1 from public.location_selections selection
        join public.location_versions version on version.id=selection.selected_version_id
        where selection.configuration_candidate_id=config.id and selection.state='accepted'
          and version.empty_anchor_asset_version_id=edge.asset_version_id))
    )) then raise exception 'reference edge is outside the accepted World' using errcode='40001'; end if;

  if exists(select 1 from public.preflight_beats beat
    where beat.plan_bundle_id=p_plan_bundle_id and (
      (beat.requires_proof and not exists(select 1 from public.preflight_shots shot
        where shot.plan_bundle_id=p_plan_bundle_id and shot.beat_number=beat.beat_number and shot.supplies_proof))
      or (beat.requires_reaction and not exists(select 1 from public.preflight_shots shot
        where shot.plan_bundle_id=p_plan_bundle_id and shot.beat_number=beat.beat_number and shot.supplies_reaction))
      or (beat.requires_consequence and not exists(select 1 from public.preflight_shots shot
        where shot.plan_bundle_id=p_plan_bundle_id and shot.beat_number=beat.beat_number and shot.supplies_consequence))
    )) then raise exception 'reveal proof/reaction/consequence coverage is incomplete' using errcode='40001'; end if;
  return p_plan_bundle_id;
end;
$$;

create or replace function public.command_ensure_video_production_profile(
  p_workspace_id uuid,p_environment text,p_profile_key text,
  p_schema_raw_sha256 text,p_schema_canonical_hash text,
  p_canary_raw_sha256 text,p_canary_canonical_hash text,
  p_pricing_raw_sha256 text,p_pricing_canonical_hash text,
  p_retrieved_at timestamptz,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  account private.provider_accounts%rowtype;
  schema_evidence private.provider_evidence_snapshots%rowtype;
  canary_evidence private.provider_evidence_snapshots%rowtype;
  pricing_evidence private.provider_evidence_snapshots%rowtype;
  capability private.production_provider_capability_versions%rowtype;
  rate private.production_rate_card_versions%rowtype;
  provider_family_value text; account_key_value text; model_key_value text;
  model_version_value text:='2026-07-19-authenticated-vertical-canary';
  endpoint_key_value text; motion_class_value text; source_url_value text;
  duration_min_value integer; duration_max_value integer; duration_quantum_value integer;
  maximum_reference_value integer; maximum_width_value integer; maximum_height_value integer;
  unit_price_value bigint; rate_key_value text; expected_schema_raw text;
  expected_schema_canonical text; expected_canary_raw text; expected_canary_canonical text;
  capability_hash text; rate_hash_value text; verified_value timestamptz;
  expiry_value timestamptz; next_rate_version integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_schema_raw_sha256 !~ '^[a-f0-9]{64}$'
    or p_schema_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_canary_raw_sha256 !~ '^[a-f0-9]{64}$'
    or p_canary_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_pricing_raw_sha256<>'0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084'
    or p_pricing_canonical_hash<>'20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d'
    or p_retrieved_at<>'2026-07-19T13:06:06.255Z'::timestamptz
    or p_expires_at<>'2026-10-17T13:06:06.255Z'::timestamptz
    or p_expires_at<=statement_timestamp()
  then raise exception 'video production evidence envelope is invalid' using errcode='22023'; end if;
  case p_profile_key
    when 'kling-2.5-simple-camera-subject' then
      provider_family_value:='fal'; account_key_value:='fal-video';
      model_key_value:='fal-ai/kling-video/v2.5-turbo/pro/image-to-video';
      endpoint_key_value:='kling-video-v2.5-turbo-pro-image-to-video';
      motion_class_value:='simple_camera_subject';
      source_url_value:='https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fkling-video%2Fv2.5-turbo%2Fpro%2Fimage-to-video';
      duration_min_value:=5000; duration_max_value:=10000; duration_quantum_value:=5000;
      maximum_reference_value:=1; maximum_width_value:=1080; maximum_height_value:=1920;
      unit_price_value:=350000; rate_key_value:='video.kling25.simple';
      expected_schema_raw:='89719e9bbf2864ef733e61182f87c3884ad4fcce269cd3fb304aa37ea9207ae2';
      expected_schema_canonical:='979783417dfb1e319ffbf84bdafb878ec32f305aa70b7d926fcb728d0dd00f52';
      expected_canary_raw:='28e7f619a30bd4c4f16e4ba48e9208896beb80caa7db23d4a62a09dd99b436f4';
      expected_canary_canonical:='d23838b52b03f64e40f3b67850a4df5dc53664003dc6e25c8d8c8f23db9a38db';
    when 'kling-3-camera-led' then
      provider_family_value:='fal'; account_key_value:='fal-video';
      model_key_value:='fal-ai/kling-video/v3/pro/image-to-video';
      endpoint_key_value:='kling-video-v3-pro-image-to-video';
      motion_class_value:='camera_led';
      source_url_value:='https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fkling-video%2Fv3%2Fpro%2Fimage-to-video';
      duration_min_value:=3000; duration_max_value:=15000; duration_quantum_value:=1000;
      maximum_reference_value:=1; maximum_width_value:=1080; maximum_height_value:=1920;
      unit_price_value:=112000; rate_key_value:='video.kling3.camera';
      expected_schema_raw:='e48bb88661f8eebe3d40904f4be71659e823006fcbf9a0789a8cd9d39a9de7e8';
      expected_schema_canonical:='19bada0f4b6bed681b54f490d73cc69618e646ee1c6a96ca95d2a0b26a59489a';
      expected_canary_raw:='9e667248a8dd4a0dc98939fbf6c5b700cbd24e9b3a1dce9c2e085e3bf42743fb';
      expected_canary_canonical:='09c0c10d2573dc3fca20644cd2d4700edbe97da111f339fb574bb10e79db636e';
    when 'seedance-2-complex-general' then
      provider_family_value:='seedance'; account_key_value:='seedance-video-via-fal';
      model_key_value:='bytedance/seedance-2.0/reference-to-video';
      endpoint_key_value:='seedance-2.0-reference-to-video';
      motion_class_value:='complex_general';
      source_url_value:='https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=bytedance%2Fseedance-2.0%2Freference-to-video';
      duration_min_value:=4000; duration_max_value:=15000; duration_quantum_value:=1000;
      maximum_reference_value:=9; maximum_width_value:=720; maximum_height_value:=1280;
      unit_price_value:=303400; rate_key_value:='video.seedance2.complex';
      expected_schema_raw:='3700d3b348f00102d600d252d3980cdb835a2e8b39a0240976e4e841246fcac1';
      expected_schema_canonical:='f49614fd15f016e958008ef2b6878f56295366983d1362b3747ce379d1abaabb';
      expected_canary_raw:='a2418f1901a1562ffe15e9b99f9390c7e5df802cf3031d7294ad8190e963fcfc';
      expected_canary_canonical:='ae939ee262141ef8d3862203297518bbf75c305216bb1c50baf99dc962d4521e';
    else raise exception 'video production profile is not allowlisted' using errcode='22023';
  end case;
  if p_schema_raw_sha256<>expected_schema_raw
    or p_schema_canonical_hash<>expected_schema_canonical
    or p_canary_raw_sha256<>expected_canary_raw
    or p_canary_canonical_hash<>expected_canary_canonical
  then raise exception 'video production evidence differs from the qualified profile' using errcode='40001'; end if;
  insert into private.provider_accounts(
    workspace_id,environment,provider,account_key,credential_secret_ref,region,state
  ) values(
    p_workspace_id,p_environment,provider_family_value,account_key_value,'FAL_KEY','global','active'
  ) on conflict(workspace_id,environment,account_key) do update
    set state='active',aggregate_version=private.provider_accounts.aggregate_version+1
  returning * into account;
  if account.provider<>provider_family_value or account.credential_secret_ref<>'FAL_KEY'
  then raise exception 'video provider account binding conflicts' using errcode='40001'; end if;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,canonical_hash,
    storage_object_name,verification_state,retrieved_at,expires_at
  ) values(
    account.id,'official_schema',
    encode(extensions.digest(convert_to(source_url_value,'UTF8'),'sha256'),'hex'),
    p_schema_raw_sha256,p_schema_canonical_hash,
    'provider-evidence/video/'||p_profile_key||'/schema-'||p_schema_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at
  ) on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into schema_evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='official_schema'
      and canonical_hash=p_schema_canonical_hash;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,canonical_hash,
    storage_object_name,verification_state,retrieved_at,expires_at
  ) values(
    account.id,'canary',
    encode(extensions.digest(convert_to('authenticated-fal-queue-canary:'||p_profile_key,'UTF8'),'sha256'),'hex'),
    p_canary_raw_sha256,p_canary_canonical_hash,
    'provider-evidence/video/'||p_profile_key||'/canary-'||p_canary_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at
  ) on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into canary_evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='canary'
      and canonical_hash=p_canary_canonical_hash;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,canonical_hash,
    storage_object_name,verification_state,retrieved_at,expires_at
  ) values(
    account.id,'pricing',
    encode(extensions.digest(convert_to('repo:docs/evidence/provider-snapshots/fal-2026-07-17.json','UTF8'),'sha256'),'hex'),
    p_pricing_raw_sha256,p_pricing_canonical_hash,
    'provider-evidence/video/pricing-'||p_pricing_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at
  ) on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into pricing_evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='pricing'
      and canonical_hash=p_pricing_canonical_hash;
  verified_value:=greatest(
    p_retrieved_at,schema_evidence.retrieved_at,canary_evidence.retrieved_at,
    pricing_evidence.retrieved_at
  );
  expiry_value:=least(
    p_expires_at,schema_evidence.expires_at,canary_evidence.expires_at,
    pricing_evidence.expires_at
  );
  capability_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'providerAccountId',account.id,'capabilityKey',p_profile_key,
    'providerFamily',provider_family_value,'modelKey',model_key_value,
    'modelVersion',model_version_value,'endpointKey',endpoint_key_value,
    'motionClass',motion_class_value,'durationMinMs',duration_min_value,
    'durationMaxMs',duration_max_value,'durationQuantumMs',duration_quantum_value,
    'maximumReferenceCount',maximum_reference_value,'maximumWidth',maximum_width_value,
    'maximumHeight',maximum_height_value,'schemaEvidenceHash',schema_evidence.canonical_hash,
    'canaryEvidenceHash',canary_evidence.canonical_hash)::text,'UTF8'),'sha256'),'hex');
  select * into capability from private.production_provider_capability_versions
    where provider_account_id=account.id and capability_key=p_profile_key
      and model_version=model_version_value and schema_hash=capability_hash;
  if capability.id is null then
    insert into private.production_provider_capability_versions(
      id,provider_account_id,capability_key,provider_family,model_key,model_version,
      endpoint_key,motion_class,duration_min_ms,duration_max_ms,duration_quantum_ms,
      maximum_reference_count,maximum_width,maximum_height,evidence_snapshot_id,
      canary_evidence_snapshot_id,schema_hash,verified_at,expires_at,state
    ) values(
      gen_random_uuid(),account.id,p_profile_key,provider_family_value,model_key_value,
      model_version_value,endpoint_key_value,motion_class_value,duration_min_value,
      duration_max_value,duration_quantum_value,maximum_reference_value,
      maximum_width_value,maximum_height_value,schema_evidence.id,canary_evidence.id,
      capability_hash,verified_value,expiry_value,'verified'
    ) returning * into capability;
  end if;
  if capability.state<>'verified' or capability.expires_at<=statement_timestamp()
  then raise exception 'video production capability is unavailable' using errcode='40001'; end if;
  select * into rate from private.production_rate_card_versions
    where rate_key=rate_key_value and capability_version_id=capability.id
      and state='verified' and expires_at>statement_timestamp()
    order by version_number desc limit 1;
  if rate.id is null then
    select coalesce(max(version_number),0)+1 into next_rate_version
      from private.production_rate_card_versions where rate_key=rate_key_value;
    rate_hash_value:=encode(extensions.digest(convert_to(jsonb_build_object(
      'rateKey',rate_key_value,'lineKind','provider_clip',
      'capabilityVersionId',capability.id,'unitName','billing_quantum',
      'unitPriceMicrousd',unit_price_value,'minimumQuantity',1,
      'maximumLineMicrousd',50000000,'pricingEvidenceSnapshotId',pricing_evidence.id,
      'verifiedAt',verified_value,'expiresAt',expiry_value)::text,'UTF8'),'sha256'),'hex');
    insert into private.production_rate_card_versions(
      id,rate_key,version_number,line_kind,capability_version_id,currency,unit_name,
      unit_price_microusd,minimum_quantity,maximum_line_microusd,mandatory_addon,
      pricing_evidence_snapshot_id,rate_hash,verified_at,expires_at,state
    ) values(
      gen_random_uuid(),rate_key_value,next_rate_version,'provider_clip',capability.id,
      'USD','billing_quantum',unit_price_value,1,50000000,false,
      pricing_evidence.id,rate_hash_value,verified_value,expiry_value,'verified'
    ) returning * into rate;
  end if;
  return jsonb_build_object(
    'ok',true,'profileKey',p_profile_key,'providerAccountId',account.id,
    'schemaEvidenceId',schema_evidence.id,'canaryEvidenceId',canary_evidence.id,
    'pricingEvidenceId',pricing_evidence.id,'capabilityVersionId',capability.id,
    'rateCardVersionId',rate.id,'expiresAt',least(capability.expires_at,rate.expires_at)
  );
end;
$$;

revoke all on function public.command_ensure_video_production_profile(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz
) from public,anon,authenticated;
grant execute on function public.command_ensure_video_production_profile(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz
) to service_role;

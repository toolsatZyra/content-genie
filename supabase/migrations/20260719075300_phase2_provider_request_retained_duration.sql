-- Separate the exact retained edit duration from the provider's discrete,
-- billable request duration. A 4.37-second narration window may correctly ask
-- Kling for 5 seconds and then trim deterministically; the old equality made
-- truthful planning impossible for non-integer master-clock boundaries.

alter table public.preflight_provider_request_slots
  add column retained_duration_ms integer;

update public.preflight_provider_request_slots
set retained_duration_ms=duration_ms
where retained_duration_ms is null;

alter table public.preflight_provider_request_slots
  alter column retained_duration_ms set not null,
  add constraint preflight_slot_retained_duration_valid
    check(retained_duration_ms between 1000 and duration_ms);

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
      or (slot-array['slotKey','shotNumber','slotKind','capabilityVersionId','durationMs','retainedDurationMs','referenceCount','outputWidth','outputHeight','billingQuantumCount','expectedOutputKind']::text[])<>'{}'::jsonb
      or not(slot?&array['slotKey','shotNumber','slotKind','capabilityVersionId','durationMs','retainedDurationMs','referenceCount','outputWidth','outputHeight','billingQuantumCount','expectedOutputKind'])
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
      or (slot->>'referenceCount')::integer>capability.maximum_reference_count
      or (slot->>'outputWidth')::integer>capability.maximum_width
      or (slot->>'outputHeight')::integer>capability.maximum_height
      or (slot->>'outputWidth')::integer*16<>(slot->>'outputHeight')::integer*9
      or (slot->>'billingQuantumCount')::integer<>ceil((slot->>'durationMs')::numeric/capability.duration_quantum_ms)
    then raise exception 'provider request slot breaches its authenticated capability' using errcode='40001'; end if;
    insert into public.preflight_provider_request_slots(
      workspace_id,plan_bundle_id,shot_number,slot_key,slot_kind,capability_version_id,
      duration_ms,retained_duration_ms,reference_count,output_width,output_height,billing_quantum_count,expected_output_kind
    ) values(p_workspace_id,p_plan_bundle_id,(slot->>'shotNumber')::integer,slot->>'slotKey',
      slot->>'slotKind',capability.id,(slot->>'durationMs')::integer,
      (slot->>'retainedDurationMs')::integer,(slot->>'referenceCount')::integer,(slot->>'outputWidth')::integer,
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
          and slot.reference_count<>(select count(*) from public.preflight_reference_edges edge
            where edge.plan_bundle_id=p_plan_bundle_id and edge.shot_number=planned_shot.shot_number))
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

comment on column public.preflight_provider_request_slots.duration_ms is
  'Discrete duration requested from and billed by the pinned provider capability.';
comment on column public.preflight_provider_request_slots.retained_duration_ms is
  'Exact master-clock duration retained after deterministic conform trim.';

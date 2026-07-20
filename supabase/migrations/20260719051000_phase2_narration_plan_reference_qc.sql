-- Immutable narration master clock, executable preflight plan, reference graph,
-- and deterministic two-evaluator PLAN_PREFLIGHT consensus.

create table private.production_provider_capability_versions (
  id uuid primary key,
  provider_account_id uuid not null references private.provider_accounts(id) on delete restrict,
  capability_key text not null check (capability_key ~ '^[a-z][a-z0-9_.:-]{2,140}$'),
  provider_family text not null check (provider_family in ('fal','seedance')),
  model_key text not null check (model_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,160}$'),
  model_version text not null check (char_length(model_version) between 1 and 160),
  endpoint_key text not null check (endpoint_key ~ '^[a-z][a-z0-9_.:/-]{2,180}$'),
  motion_class text not null check (motion_class in ('simple_camera_subject','camera_led','complex_general')),
  duration_min_ms integer not null check (duration_min_ms between 1000 and 30000),
  duration_max_ms integer not null check (duration_max_ms between duration_min_ms and 30000),
  duration_quantum_ms integer not null check (duration_quantum_ms between 1 and 30000),
  maximum_reference_count integer not null check (maximum_reference_count between 1 and 20),
  maximum_width integer not null check (maximum_width between 720 and 4096),
  maximum_height integer not null check (maximum_height between 1280 and 4096),
  evidence_snapshot_id uuid not null references private.provider_evidence_snapshots(id) on delete restrict,
  schema_hash text not null check (schema_hash ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null check (state in ('verified','disabled','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  unique(provider_account_id,capability_key,model_version,schema_hash),
  check (expires_at>verified_at),
  check (
    (motion_class='simple_camera_subject' and provider_family='fal' and lower(model_key) like '%kling%2.5%')
    or (motion_class='camera_led' and provider_family='fal' and lower(model_key) like '%kling%3%')
    or (motion_class='complex_general' and provider_family='seedance' and lower(model_key) like '%seedance%')
  )
);

create table public.narration_master_clock_versions (
  id uuid primary key,
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  preflight_run_id uuid not null,
  script_revision_id uuid not null,
  audio_identity_selection_id uuid not null,
  narration_asset_version_id uuid not null,
  version_number integer not null check(version_number>0),
  duration_ms integer not null check(duration_ms between 60000 and 120000),
  processing_text_sha256 text not null check(processing_text_sha256~'^[a-f0-9]{64}$'),
  alignment_hash text not null check(alignment_hash~'^[a-f0-9]{64}$'),
  audio_evidence_hash text not null check(audio_evidence_hash~'^[a-f0-9]{64}$'),
  performance_profile_hash text not null check(performance_profile_hash~'^[a-f0-9]{64}$'),
  segment_count integer not null check(segment_count between 1 and 2000),
  state text not null check(state in ('verified','rejected','stale')),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(configuration_candidate_id,version_number),
  unique(configuration_candidate_id,alignment_hash,audio_evidence_hash),
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,preflight_run_id)
    references public.preflight_runs(workspace_id,id) on delete restrict,
  foreign key(workspace_id,audio_identity_selection_id)
    references public.preflight_audio_identity_selections(workspace_id,id) on delete restrict,
  foreign key(workspace_id,narration_asset_version_id)
    references public.asset_versions(workspace_id,id) on delete restrict
);

create table public.narration_alignment_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  master_clock_version_id uuid not null,
  segment_number integer not null check(segment_number>0),
  segment_kind text not null check(segment_kind in ('spoken','authored_pause')),
  processing_start_scalar integer not null check(processing_start_scalar>=0),
  processing_end_scalar integer not null check(processing_end_scalar>processing_start_scalar),
  exact_text text not null check(char_length(exact_text)>0),
  start_ms integer not null check(start_ms>=0),
  end_ms integer not null check(end_ms>=start_ms),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(master_clock_version_id,segment_number),
  unique(master_clock_version_id,processing_start_scalar,processing_end_scalar),
  foreign key(workspace_id,master_clock_version_id)
    references public.narration_master_clock_versions(workspace_id,id) on delete restrict,
  check(segment_kind='authored_pause' or end_ms>start_ms)
);

create table public.narration_segment_pronunciations (
  workspace_id uuid not null,
  narration_segment_id uuid not null,
  pronunciation_entry_id uuid not null,
  primary key(narration_segment_id,pronunciation_entry_id),
  foreign key(workspace_id,narration_segment_id)
    references public.narration_alignment_segments(workspace_id,id) on delete restrict,
  foreign key(workspace_id,pronunciation_entry_id)
    references public.pronunciation_entries(workspace_id,id) on delete restrict
);

create table public.preflight_plan_component_versions (
  id uuid primary key,
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  master_clock_version_id uuid not null,
  component_kind text not null check(component_kind in ('story','beat','shot','sound','composition','safety','routing','edd')),
  version_number integer not null check(version_number>0),
  schema_version text not null check(schema_version='genie.preflight-plan.v1'),
  payload jsonb not null check(jsonb_typeof(payload) in ('object','array') and pg_column_size(payload)<=524288),
  content_hash text not null check(content_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(configuration_candidate_id,component_kind,version_number),
  unique(configuration_candidate_id,component_kind,content_hash),
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,master_clock_version_id)
    references public.narration_master_clock_versions(workspace_id,id) on delete restrict
);

create table public.preflight_plan_bundles (
  id uuid primary key,
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  preflight_run_id uuid not null,
  master_clock_version_id uuid not null,
  source_review_packet_id uuid not null,
  world_reference_pack_version_id uuid not null,
  story_version_id uuid not null,
  beat_version_id uuid not null,
  shot_version_id uuid not null,
  sound_version_id uuid not null,
  composition_version_id uuid not null,
  safety_version_id uuid not null,
  routing_version_id uuid not null,
  edd_version_id uuid not null,
  plan_hash text not null check(plan_hash~'^[a-f0-9]{64}$'),
  graph_hash text not null check(graph_hash~'^[a-f0-9]{64}$'),
  projected_ovs numeric(6,3) not null check(projected_ovs between 0 and 100),
  projected_cvp numeric(6,3) not null check(projected_cvp between 0 and 100),
  projected_pfs numeric(6,3) not null check(projected_pfs between 0 and 100),
  projected_confidence numeric(6,3) not null check(projected_confidence between 0 and 100),
  evidence_density numeric(6,3) not null check(evidence_density between 0 and 100),
  state text not null check(state in ('candidate','qc_passed','blocked','stale')),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(configuration_candidate_id,plan_hash),
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,preflight_run_id)
    references public.preflight_runs(workspace_id,id) on delete restrict,
  foreign key(workspace_id,master_clock_version_id)
    references public.narration_master_clock_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict,
  foreign key(workspace_id,world_reference_pack_version_id)
    references public.world_reference_pack_versions(workspace_id,id) on delete restrict
);

create table public.preflight_beats (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_bundle_id uuid not null,
  beat_number integer not null check(beat_number>0),
  processing_start_scalar integer not null check(processing_start_scalar>=0),
  processing_end_scalar integer not null check(processing_end_scalar>processing_start_scalar),
  exact_text text not null check(char_length(exact_text)>0),
  start_ms integer not null check(start_ms>=0),
  end_ms integer not null check(end_ms>start_ms),
  beat_type text not null check(char_length(beat_type) between 2 and 100),
  reveal_level text not null check(reveal_level in ('none','minor','major')),
  requires_proof boolean not null,
  requires_reaction boolean not null,
  requires_consequence boolean not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(plan_bundle_id,beat_number),
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  check(reveal_level='none' or (requires_proof and requires_reaction)),
  check(reveal_level<>'major' or requires_consequence)
);

create table public.preflight_shots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_bundle_id uuid not null,
  shot_number integer not null check(shot_number>0),
  beat_number integer not null check(beat_number>0),
  start_ms integer not null check(start_ms>=0),
  end_ms integer not null check(end_ms>start_ms),
  motion_class text not null check(motion_class in ('simple_camera_subject','camera_led','complex_general')),
  location_version_id uuid not null,
  character_version_ids uuid[] not null check(cardinality(character_version_ids) between 1 and 20),
  safe_area_pass boolean not null,
  supplies_proof boolean not null,
  supplies_reaction boolean not null,
  supplies_consequence boolean not null,
  shot_content_hash text not null check(shot_content_hash~'^[a-f0-9]{64}$'),
  topological_order integer not null check(topological_order>0),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(plan_bundle_id,shot_number),
  unique(plan_bundle_id,topological_order),
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  foreign key(workspace_id,location_version_id)
    references public.location_versions(workspace_id,id) on delete restrict
);

create table public.preflight_provider_request_slots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_bundle_id uuid not null,
  shot_number integer not null check(shot_number>0),
  slot_key text not null check(slot_key~'^[a-z][a-z0-9_.:-]{2,140}$'),
  slot_kind text not null check(slot_kind in ('primary','candidate','retry','alternate')),
  capability_version_id uuid not null references private.production_provider_capability_versions(id) on delete restrict,
  duration_ms integer not null check(duration_ms between 1000 and 30000),
  reference_count integer not null check(reference_count between 1 and 20),
  output_width integer not null check(output_width between 720 and 4096),
  output_height integer not null check(output_height between 1280 and 4096),
  billing_quantum_count integer not null check(billing_quantum_count>0),
  expected_output_kind text not null check(expected_output_kind='video/mp4'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(plan_bundle_id,slot_key),
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict
);

create table public.preflight_reference_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  plan_bundle_id uuid not null,
  shot_number integer not null check(shot_number>0),
  source_shot_number integer,
  reference_kind text not null check(reference_kind in ('character','continuity','location_master')),
  reference_ordinal integer not null check(reference_ordinal>0),
  asset_version_id uuid,
  asset_content_hash text not null check(asset_content_hash~'^[a-f0-9]{64}$'),
  requires_upstream_success boolean not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(plan_bundle_id,shot_number,reference_ordinal),
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  foreign key(workspace_id,asset_version_id)
    references public.asset_versions(workspace_id,id) on delete restrict,
  check(source_shot_number is null or source_shot_number>0),
  check(source_shot_number is null or requires_upstream_success),
  check((source_shot_number is null and asset_version_id is not null)
    or (source_shot_number is not null and asset_version_id is null))
);

alter table public.preflight_plan_bundles
  add foreign key(workspace_id,story_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict,
  add foreign key(workspace_id,beat_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict,
  add foreign key(workspace_id,shot_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict,
  add foreign key(workspace_id,sound_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict,
  add foreign key(workspace_id,composition_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict,
  add foreign key(workspace_id,safety_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict,
  add foreign key(workspace_id,routing_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict,
  add foreign key(workspace_id,edd_version_id) references public.preflight_plan_component_versions(workspace_id,id) on delete restrict;

create table private.plan_qc_rubric_versions (
  rubric_key text not null,
  rubric_version text not null,
  source_visual_hash text not null check(source_visual_hash~'^[a-f0-9]{64}$'),
  source_checks_hash text not null check(source_checks_hash~'^[a-f0-9]{64}$'),
  contract_hash text not null check(contract_hash~'^[a-f0-9]{64}$'),
  schema_version text not null check(schema_version='genie.plan-qc.v1'),
  state text not null check(state in ('active','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  primary key(rubric_key,rubric_version)
);

create table private.plan_qc_rubric_parameters (
  rubric_key text not null,
  rubric_version text not null,
  parameter_id text not null,
  base_weight numeric(8,4) not null check(base_weight>0),
  primary key(rubric_key,rubric_version,parameter_id),
  foreign key(rubric_key,rubric_version)
    references private.plan_qc_rubric_versions(rubric_key,rubric_version) on delete restrict
);

insert into private.plan_qc_rubric_versions(
  rubric_key,rubric_version,source_visual_hash,source_checks_hash,contract_hash,schema_version,state
) values(
  'mythological-devotional-plan','1.0.0',
  'd7f33631ebead6fd4af26c811295904e5622c72098b54382c5cc95106688c4a5',
  'ca3143b61f6207034a7893abcd5b09e5558e22a3218e7478e13b7d029016decb',
  'd870d0dedf7b4cba4cbb3ed5d7939afed91ef8eef5b905017c1816b4371b6d68',
  'genie.plan-qc.v1','active'
);

insert into private.plan_qc_rubric_parameters(rubric_key,rubric_version,parameter_id,base_weight)
values
('mythological-devotional-plan','1.0.0','first_frame_hook',10),
('mythological-devotional-plan','1.0.0','visual_story_clarity',9),
('mythological-devotional-plan','1.0.0','vertical_composition',8),
('mythological-devotional-plan','1.0.0','emotional_readability',8),
('mythological-devotional-plan','1.0.0','reveal_execution',8),
('mythological-devotional-plan','1.0.0','blocking_power_geometry',7),
('mythological-devotional-plan','1.0.0','visual_escalation',7),
('mythological-devotional-plan','1.0.0','cliffhanger_image',7),
('mythological-devotional-plan','1.0.0','edit_rhythm',7),
('mythological-devotional-plan','1.0.0','shot_economy',6),
('mythological-devotional-plan','1.0.0','performance_capture',6),
('mythological-devotional-plan','1.0.0','sound_music',5),
('mythological-devotional-plan','1.0.0','subtitle_ui_safety',4),
('mythological-devotional-plan','1.0.0','production_feasibility',4),
('mythological-devotional-plan','1.0.0','localization_compliance',4);

create table private.plan_evaluator_challenges (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  plan_bundle_id uuid not null,
  blind_group_id uuid not null,
  evaluator_key text not null check(evaluator_key~'^[a-z][a-z0-9_.-]{2,100}$'),
  evaluator_deployment_family text not null check(char_length(evaluator_deployment_family) between 3 and 100),
  input_manifest_hash text not null check(input_manifest_hash~'^[a-f0-9]{64}$'),
  plan_hash text not null check(plan_hash~'^[a-f0-9]{64}$'),
  rubric_key text not null,
  rubric_version text not null,
  issued_at timestamptz not null default statement_timestamp(),
  unique(stage_attempt_id,evaluator_key),
  unique(blind_group_id,evaluator_deployment_family),
  foreign key(workspace_id,preflight_run_id,stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id,preflight_run_id,id) on delete restrict,
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  foreign key(rubric_key,rubric_version)
    references private.plan_qc_rubric_versions(rubric_key,rubric_version) on delete restrict
);

create table private.plan_evaluator_score_sets (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references private.plan_evaluator_challenges(id) on delete restrict,
  evaluator_record_id uuid not null unique references private.evaluator_records(id) on delete restrict,
  score_set_hash text not null check(score_set_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp()
);

create table private.plan_evaluator_parameter_scores (
  score_set_id uuid not null references private.plan_evaluator_score_sets(id) on delete restrict,
  parameter_id text not null,
  score integer not null check(score between 1 and 10),
  applicable boolean not null,
  applicability_reason text not null check(char_length(applicability_reason) between 2 and 500),
  evidence_version_id uuid not null,
  primary key(score_set_id,parameter_id)
);

create table private.preflight_plan_qc_consensus (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  plan_bundle_id uuid not null,
  blind_group_id uuid not null unique,
  rubric_key text not null,
  rubric_version text not null,
  rubric_hash text not null check(rubric_hash~'^[a-f0-9]{64}$'),
  ovs numeric(6,3) not null check(ovs between 0 and 100),
  cvp numeric(6,3) not null check(cvp between 0 and 100),
  pfs numeric(6,3) not null check(pfs between 0 and 100),
  lcr numeric(6,3) not null check(lcr between 0 and 100),
  confidence numeric(6,3) not null check(confidence between 0 and 100),
  evidence_density numeric(6,3) not null check(evidence_density between 0 and 100),
  maximum_parameter_spread integer not null check(maximum_parameter_spread between 0 and 9),
  verdict text not null check(verdict in ('pass','block','indeterminate')),
  gate_codes text[] not null,
  consensus_hash text not null check(consensus_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(plan_bundle_id,consensus_hash),
  foreign key(workspace_id,preflight_run_id,stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id,preflight_run_id,id) on delete restrict,
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  foreign key(rubric_key,rubric_version)
    references private.plan_qc_rubric_versions(rubric_key,rubric_version) on delete restrict
);

create trigger narration_clock_immutable before update or delete on public.narration_master_clock_versions
for each row execute function private.reject_mutation();
create trigger narration_segments_immutable before update or delete on public.narration_alignment_segments
for each row execute function private.reject_mutation();
create trigger narration_pronunciations_immutable before update or delete on public.narration_segment_pronunciations
for each row execute function private.reject_mutation();
create trigger plan_components_immutable before update or delete on public.preflight_plan_component_versions
for each row execute function private.reject_mutation();
create trigger plan_bundles_immutable before update or delete on public.preflight_plan_bundles
for each row execute function private.reject_mutation();
create trigger plan_beats_immutable before update or delete on public.preflight_beats
for each row execute function private.reject_mutation();
create trigger plan_shots_immutable before update or delete on public.preflight_shots
for each row execute function private.reject_mutation();
create trigger plan_slots_immutable before update or delete on public.preflight_provider_request_slots
for each row execute function private.reject_mutation();
create trigger plan_edges_immutable before update or delete on public.preflight_reference_edges
for each row execute function private.reject_mutation();
create trigger plan_challenges_immutable before update or delete on private.plan_evaluator_challenges
for each row execute function private.reject_mutation();
create trigger plan_score_sets_immutable before update or delete on private.plan_evaluator_score_sets
for each row execute function private.reject_mutation();
create trigger plan_parameter_scores_immutable before update or delete on private.plan_evaluator_parameter_scores
for each row execute function private.reject_mutation();
create trigger plan_consensus_immutable before update or delete on private.preflight_plan_qc_consensus
for each row execute function private.reject_mutation();

create or replace function public.command_record_narration_master_clock(
  p_master_clock_id uuid,p_workspace_id uuid,p_configuration_candidate_id uuid,
  p_preflight_run_id uuid,p_audio_identity_selection_id uuid,
  p_narration_asset_version_id uuid,p_processing_text_sha256 text,
  p_alignment_hash text,p_audio_evidence_hash text,p_performance_profile_hash text,
  p_audio_evidence jsonb,p_segments jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  config public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  clock_run public.preflight_runs%rowtype;
  duration integer;
  next_version integer;
  segment jsonb;
  segment_id uuid;
  segment_number integer:=0;
  previous_scalar integer:=0;
  previous_end_ms integer:=0;
  start_scalar integer;
  end_scalar integer;
  start_time integer;
  end_time integer;
  pronunciation_id_text text;
  spoken_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into config from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into script from public.script_revisions where id=config.script_revision_id;
  select * into clock_run from public.preflight_runs
    where id=p_preflight_run_id and workspace_id=p_workspace_id;
  select probe.duration_ms::integer into duration
    from public.media_probes probe
    join public.asset_versions version on version.id=probe.asset_version_id
    join public.assets asset on asset.id=version.asset_id
    where version.id=p_narration_asset_version_id and version.workspace_id=p_workspace_id
      and version.media_mime like 'audio/%' and asset.workspace_id=p_workspace_id
      and asset.asset_kind='narration'
    order by probe.created_at desc limit 1;
  if config.id is null or script.id is null or duration not between 60000 and 120000
    or config.state not in ('preflight','ready_to_lock')
    or clock_run.id is null or clock_run.configuration_candidate_id<>config.id
    or clock_run.script_revision_id<>script.id or clock_run.kind<>'narration_clock'
    or clock_run.state not in ('running','waiting_external','waiting_decision','succeeded')
    or not exists(select 1 from public.preflight_audio_identity_selections selection
      where selection.id=p_audio_identity_selection_id and selection.workspace_id=p_workspace_id
        and selection.configuration_candidate_id=config.id and selection.state='verified')
    or p_processing_text_sha256 is distinct from script.processing_utf8_sha256
    or p_segments is null or jsonb_typeof(p_segments)<>'array'
    or jsonb_array_length(p_segments) not between 1 and 2000
    or p_alignment_hash is distinct from encode(extensions.digest(convert_to(p_segments::text,'UTF8'),'sha256'),'hex')
    or p_audio_evidence is null or jsonb_typeof(p_audio_evidence)<>'object'
    or (p_audio_evidence-array['clippingDetected','truncationDetected','corruptFramesDetected',
      'unintendedSilenceDetected','audibleSeamsDetected','voiceIdentityPass',
      'pronunciationPass','expressiveHindiPass','requestedGenderPass','probeVersionId']::text[])<>'{}'::jsonb
    or not(p_audio_evidence?&array['clippingDetected','truncationDetected','corruptFramesDetected',
      'unintendedSilenceDetected','audibleSeamsDetected','voiceIdentityPass',
      'pronunciationPass','expressiveHindiPass','requestedGenderPass','probeVersionId'])
    or p_audio_evidence_hash is distinct from encode(extensions.digest(convert_to(p_audio_evidence::text,'UTF8'),'sha256'),'hex')
    or (p_audio_evidence->>'clippingDetected')::boolean
    or (p_audio_evidence->>'truncationDetected')::boolean
    or (p_audio_evidence->>'corruptFramesDetected')::boolean
    or (p_audio_evidence->>'unintendedSilenceDetected')::boolean
    or (p_audio_evidence->>'audibleSeamsDetected')::boolean
    or not (p_audio_evidence->>'voiceIdentityPass')::boolean
    or not (p_audio_evidence->>'pronunciationPass')::boolean
    or not (p_audio_evidence->>'expressiveHindiPass')::boolean
    or not (p_audio_evidence->>'requestedGenderPass')::boolean
    or not exists(select 1 from public.media_probes probe
      where probe.id=(p_audio_evidence->>'probeVersionId')::uuid
        and probe.asset_version_id=p_narration_asset_version_id and probe.duration_ms=duration)
  then raise exception 'narration master clock envelope is invalid' using errcode='40001'; end if;

  select coalesce(max(version_number),0)+1 into next_version
    from public.narration_master_clock_versions where configuration_candidate_id=config.id;
  insert into public.narration_master_clock_versions(
    id,workspace_id,configuration_candidate_id,preflight_run_id,script_revision_id,
    audio_identity_selection_id,narration_asset_version_id,version_number,duration_ms,
    processing_text_sha256,alignment_hash,audio_evidence_hash,performance_profile_hash,
    segment_count,state
  ) values(
    p_master_clock_id,p_workspace_id,config.id,clock_run.id,script.id,
    p_audio_identity_selection_id,p_narration_asset_version_id,next_version,duration,
    p_processing_text_sha256,p_alignment_hash,p_audio_evidence_hash,p_performance_profile_hash,
    jsonb_array_length(p_segments),'verified'
  );

  for segment in select value from jsonb_array_elements(p_segments) loop
    segment_number:=segment_number+1;
    if jsonb_typeof(segment)<>'object'
      or (segment-array['kind','startScalar','endScalar','exactText','startMs','endMs','pronunciationEntryIds']::text[])<>'{}'::jsonb
      or not(segment?&array['kind','startScalar','endScalar','exactText','startMs','endMs','pronunciationEntryIds'])
      or jsonb_typeof(segment->'pronunciationEntryIds')<>'array'
    then raise exception 'narration alignment segment is not exact' using errcode='22023'; end if;
    start_scalar:=(segment->>'startScalar')::integer;
    end_scalar:=(segment->>'endScalar')::integer;
    start_time:=(segment->>'startMs')::integer;
    end_time:=(segment->>'endMs')::integer;
    if start_scalar<>previous_scalar or start_time<previous_end_ms
      or substring(script.processing_text from start_scalar+1 for end_scalar-start_scalar) is distinct from segment->>'exactText'
      or end_scalar>script.processing_scalar_count or end_time>duration
      or segment->>'kind' not in ('spoken','authored_pause')
      or (segment->>'kind'='spoken' and end_time<=start_time)
    then raise exception 'narration alignment is non-monotonic or mutates locked text' using errcode='40001'; end if;
    insert into public.narration_alignment_segments(
      workspace_id,master_clock_version_id,segment_number,segment_kind,
      processing_start_scalar,processing_end_scalar,exact_text,start_ms,end_ms
    ) values(p_workspace_id,p_master_clock_id,segment_number,segment->>'kind',
      start_scalar,end_scalar,segment->>'exactText',start_time,end_time)
    returning id into segment_id;
    if segment->>'kind'='spoken' then spoken_count:=spoken_count+1; end if;
    for pronunciation_id_text in select jsonb_array_elements_text(segment->'pronunciationEntryIds') loop
      if not exists(select 1 from public.pronunciation_entries entry
        join public.preflight_audio_identity_selections selection
          on selection.pronunciation_lexicon_version_id=entry.lexicon_version_id
        where entry.id=pronunciation_id_text::uuid and entry.workspace_id=p_workspace_id
          and selection.id=p_audio_identity_selection_id
          and entry.processing_start_scalar>=start_scalar
          and entry.processing_end_scalar<=end_scalar
          and entry.verification_status='verified')
      then raise exception 'narration pronunciation evidence is stale or out of span' using errcode='40001'; end if;
      insert into public.narration_segment_pronunciations(workspace_id,narration_segment_id,pronunciation_entry_id)
      values(p_workspace_id,segment_id,pronunciation_id_text::uuid);
    end loop;
    previous_scalar:=end_scalar;
    previous_end_ms:=end_time;
  end loop;
  if previous_scalar<>script.processing_scalar_count or previous_end_ms<>duration or spoken_count<1 then
    raise exception 'narration alignment does not cover the locked script and master clock' using errcode='40001';
  end if;
  return p_master_clock_id;
end;
$$;

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
      or (slot-array['slotKey','shotNumber','slotKind','capabilityVersionId','durationMs','referenceCount','outputWidth','outputHeight','billingQuantumCount','expectedOutputKind']::text[])<>'{}'::jsonb
      or not(slot?&array['slotKey','shotNumber','slotKind','capabilityVersionId','durationMs','referenceCount','outputWidth','outputHeight','billingQuantumCount','expectedOutputKind'])
    then raise exception 'provider request slot is not exact' using errcode='22023'; end if;
    select * into capability from private.production_provider_capability_versions
      where id=(slot->>'capabilityVersionId')::uuid;
    if capability.id is null or capability.state<>'verified' or capability.expires_at<=statement_timestamp()
      or not exists(select 1 from public.preflight_shots planned_shot
        where planned_shot.plan_bundle_id=p_plan_bundle_id
          and planned_shot.shot_number=(slot->>'shotNumber')::integer
          and planned_shot.motion_class=capability.motion_class
          and planned_shot.end_ms-planned_shot.start_ms=(slot->>'durationMs')::integer)
      or (slot->>'durationMs')::integer not between capability.duration_min_ms and capability.duration_max_ms
      or (slot->>'referenceCount')::integer>capability.maximum_reference_count
      or (slot->>'outputWidth')::integer>capability.maximum_width
      or (slot->>'outputHeight')::integer>capability.maximum_height
      or (slot->>'outputWidth')::integer*16<>(slot->>'outputHeight')::integer*9
      or (slot->>'billingQuantumCount')::integer<>ceil((slot->>'durationMs')::numeric/capability.duration_quantum_ms)
    then raise exception 'provider request slot breaches its authenticated capability' using errcode='40001'; end if;
    insert into public.preflight_provider_request_slots(
      workspace_id,plan_bundle_id,shot_number,slot_key,slot_kind,capability_version_id,
      duration_ms,reference_count,output_width,output_height,billing_quantum_count,expected_output_kind
    ) values(p_workspace_id,p_plan_bundle_id,(slot->>'shotNumber')::integer,slot->>'slotKey',
      slot->>'slotKind',capability.id,(slot->>'durationMs')::integer,
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

create or replace function public.command_issue_plan_evaluator_challenges(
  p_workspace_id uuid,p_preflight_run_id uuid,p_stage_attempt_id uuid,
  p_plan_bundle_id uuid,p_blind_group_id uuid,p_challenges jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare challenge jsonb; attempt public.preflight_stage_attempts%rowtype;
  bundle public.preflight_plan_bundles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and workspace_id=p_workspace_id and preflight_run_id=p_preflight_run_id;
  select * into bundle from public.preflight_plan_bundles
    where id=p_plan_bundle_id and workspace_id=p_workspace_id and preflight_run_id=p_preflight_run_id;
  if attempt.id is null or bundle.id is null
    or attempt.input_manifest_hash<>bundle.plan_hash
    or p_challenges is null or jsonb_typeof(p_challenges)<>'array' or jsonb_array_length(p_challenges)<>2
    or exists(select 1 from private.evaluator_records record where record.stage_attempt_id=attempt.id)
    or exists(select 1 from private.plan_evaluator_challenges existing where existing.stage_attempt_id=attempt.id)
    or (select count(distinct value->>'deploymentFamily') from jsonb_array_elements(p_challenges))<>2
    or (select count(distinct value->>'evaluatorKey') from jsonb_array_elements(p_challenges))<>2
  then raise exception 'sealed evaluator challenge envelope is invalid' using errcode='40001'; end if;
  for challenge in select value from jsonb_array_elements(p_challenges) loop
    if jsonb_typeof(challenge)<>'object'
      or (challenge-array['challengeId','evaluatorKey','deploymentFamily']::text[])<>'{}'::jsonb
      or not(challenge?&array['challengeId','evaluatorKey','deploymentFamily'])
    then raise exception 'evaluator challenge is not exact' using errcode='22023'; end if;
    insert into private.plan_evaluator_challenges(
      id,workspace_id,preflight_run_id,stage_attempt_id,plan_bundle_id,blind_group_id,
      evaluator_key,evaluator_deployment_family,input_manifest_hash,plan_hash,
      rubric_key,rubric_version
    ) values((challenge->>'challengeId')::uuid,p_workspace_id,p_preflight_run_id,attempt.id,
      bundle.id,p_blind_group_id,challenge->>'evaluatorKey',challenge->>'deploymentFamily',
      attempt.input_manifest_hash,bundle.plan_hash,'mythological-devotional-plan','1.0.0');
  end loop;
  return p_blind_group_id;
end;
$$;

create or replace function public.command_record_plan_evaluator_score_set(
  p_challenge_id uuid,p_evaluator_record_id uuid,p_score_set_hash text,p_scores jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare challenge private.plan_evaluator_challenges%rowtype;
  evaluation private.evaluator_records%rowtype;
  score_set_id uuid;
  score_row jsonb;
  expected_rubric_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into challenge from private.plan_evaluator_challenges where id=p_challenge_id;
  select * into evaluation from private.evaluator_records where id=p_evaluator_record_id;
  select encode(extensions.digest(convert_to(
    rubric.source_visual_hash||':'||rubric.source_checks_hash||':'||rubric.contract_hash,'UTF8'),'sha256'),'hex')
    into expected_rubric_hash from private.plan_qc_rubric_versions rubric
    where rubric.rubric_key=challenge.rubric_key and rubric.rubric_version=challenge.rubric_version and rubric.state='active';
  if challenge.id is null or evaluation.id is null or evaluation.created_at<challenge.issued_at
    or evaluation.workspace_id<>challenge.workspace_id
    or evaluation.preflight_run_id<>challenge.preflight_run_id
    or evaluation.stage_attempt_id<>challenge.stage_attempt_id
    or evaluation.evaluator_key<>challenge.evaluator_key
    or evaluation.evaluator_deployment_family<>challenge.evaluator_deployment_family
    or evaluation.input_manifest_hash<>challenge.input_manifest_hash
    or evaluation.plan_hash<>challenge.plan_hash or evaluation.rubric_hash<>expected_rubric_hash
    or p_scores is null or jsonb_typeof(p_scores)<>'array' or jsonb_array_length(p_scores)<>15
    or p_score_set_hash is distinct from encode(extensions.digest(convert_to(p_scores::text,'UTF8'),'sha256'),'hex')
    or evaluation.output_hash<>p_score_set_hash
    or (select count(distinct value->>'parameterId') from jsonb_array_elements(p_scores))<>15
    or exists(select 1 from private.plan_qc_rubric_parameters parameter
      where parameter.rubric_key=challenge.rubric_key and parameter.rubric_version=challenge.rubric_version
        and not exists(select 1 from jsonb_array_elements(p_scores) proposed
          where proposed->>'parameterId'=parameter.parameter_id))
  then raise exception 'evaluator score set is not bound to its sealed challenge' using errcode='40001'; end if;
  insert into private.plan_evaluator_score_sets(challenge_id,evaluator_record_id,score_set_hash)
    values(challenge.id,evaluation.id,p_score_set_hash) returning id into score_set_id;
  for score_row in select value from jsonb_array_elements(p_scores) loop
    if jsonb_typeof(score_row)<>'object'
      or (score_row-array['parameterId','score','applicable','applicabilityReason','evidenceVersionId']::text[])<>'{}'::jsonb
      or not(score_row?&array['parameterId','score','applicable','applicabilityReason','evidenceVersionId'])
      or not exists(select 1 from private.plan_qc_rubric_parameters parameter
        where parameter.rubric_key=challenge.rubric_key and parameter.rubric_version=challenge.rubric_version
          and parameter.parameter_id=score_row->>'parameterId')
    then raise exception 'evaluator parameter score is not exact' using errcode='22023'; end if;
    insert into private.plan_evaluator_parameter_scores(
      score_set_id,parameter_id,score,applicable,applicability_reason,evidence_version_id
    ) values(score_set_id,score_row->>'parameterId',(score_row->>'score')::integer,
      (score_row->>'applicable')::boolean,score_row->>'applicabilityReason',
      (score_row->>'evidenceVersionId')::uuid);
  end loop;
  return score_set_id;
end;
$$;

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
  score_first integer; score_clarity integer; score_vertical integer;
  score_emotion integer; score_reveal integer; score_blocking integer;
  score_escalation integer; score_cliffhanger integer; score_rhythm integer;
  score_economy integer; score_performance integer; score_sound integer;
  score_subtitle integer; score_feasibility integer; score_localization integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
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
  return consensus_id;
end;
$$;

create index production_capability_provider_idx on private.production_provider_capability_versions(provider_account_id);
create index production_capability_evidence_idx on private.production_provider_capability_versions(evidence_snapshot_id);
create index narration_clock_config_idx on public.narration_master_clock_versions(configuration_candidate_id,version_number desc);
create index narration_clock_run_idx on public.narration_master_clock_versions(preflight_run_id);
create index narration_clock_audio_idx on public.narration_master_clock_versions(audio_identity_selection_id);
create index narration_clock_asset_idx on public.narration_master_clock_versions(narration_asset_version_id);
create index narration_segment_clock_idx on public.narration_alignment_segments(master_clock_version_id,segment_number);
create index narration_pronunciation_entry_idx on public.narration_segment_pronunciations(pronunciation_entry_id);
create index plan_component_config_idx on public.preflight_plan_component_versions(configuration_candidate_id,component_kind,version_number desc);
create index plan_component_clock_idx on public.preflight_plan_component_versions(master_clock_version_id);
create index plan_bundle_config_idx on public.preflight_plan_bundles(configuration_candidate_id,created_at desc);
create index plan_bundle_run_idx on public.preflight_plan_bundles(preflight_run_id);
create index plan_bundle_clock_idx on public.preflight_plan_bundles(master_clock_version_id);
create index plan_bundle_source_idx on public.preflight_plan_bundles(source_review_packet_id);
create index plan_bundle_world_idx on public.preflight_plan_bundles(world_reference_pack_version_id);
create index plan_bundle_story_idx on public.preflight_plan_bundles(story_version_id);
create index plan_bundle_beat_idx on public.preflight_plan_bundles(beat_version_id);
create index plan_bundle_shot_idx on public.preflight_plan_bundles(shot_version_id);
create index plan_bundle_sound_idx on public.preflight_plan_bundles(sound_version_id);
create index plan_bundle_composition_idx on public.preflight_plan_bundles(composition_version_id);
create index plan_bundle_safety_idx on public.preflight_plan_bundles(safety_version_id);
create index plan_bundle_routing_idx on public.preflight_plan_bundles(routing_version_id);
create index plan_bundle_edd_idx on public.preflight_plan_bundles(edd_version_id);
create index preflight_beats_bundle_idx on public.preflight_beats(plan_bundle_id,beat_number);
create index preflight_shots_bundle_idx on public.preflight_shots(plan_bundle_id,shot_number);
create index preflight_shots_location_idx on public.preflight_shots(location_version_id);
create index preflight_slots_bundle_idx on public.preflight_provider_request_slots(plan_bundle_id,shot_number);
create index preflight_slots_capability_idx on public.preflight_provider_request_slots(capability_version_id);
create index preflight_edges_bundle_idx on public.preflight_reference_edges(plan_bundle_id,shot_number);
create index preflight_edges_asset_idx on public.preflight_reference_edges(asset_version_id) where asset_version_id is not null;
create index plan_challenge_attempt_idx on private.plan_evaluator_challenges(stage_attempt_id);
create index plan_challenge_bundle_idx on private.plan_evaluator_challenges(plan_bundle_id);
create index plan_challenge_rubric_idx on private.plan_evaluator_challenges(rubric_key,rubric_version);
create index plan_score_set_record_idx on private.plan_evaluator_score_sets(evaluator_record_id);
create index plan_parameter_id_idx on private.plan_evaluator_parameter_scores(parameter_id);
create index plan_consensus_attempt_idx on private.preflight_plan_qc_consensus(stage_attempt_id);
create index plan_consensus_bundle_idx on private.preflight_plan_qc_consensus(plan_bundle_id);
create index plan_consensus_rubric_idx on private.preflight_plan_qc_consensus(rubric_key,rubric_version);

do $$ declare table_name text; begin
  foreach table_name in array array[
    'narration_master_clock_versions','narration_alignment_segments',
    'narration_segment_pronunciations','preflight_plan_component_versions',
    'preflight_plan_bundles','preflight_beats','preflight_shots',
    'preflight_provider_request_slots','preflight_reference_edges'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id,(select auth.uid())))',
      table_name||'_member_select',table_name);
  end loop;
end $$;

revoke all on table public.narration_master_clock_versions,public.narration_alignment_segments,
  public.narration_segment_pronunciations,public.preflight_plan_component_versions,
  public.preflight_plan_bundles,public.preflight_beats,public.preflight_shots,
  public.preflight_provider_request_slots,public.preflight_reference_edges
from public,anon,authenticated;
grant select on table public.narration_master_clock_versions,public.narration_alignment_segments,
  public.narration_segment_pronunciations,public.preflight_plan_component_versions,
  public.preflight_plan_bundles,public.preflight_beats,public.preflight_shots,
  public.preflight_provider_request_slots,public.preflight_reference_edges
to authenticated;

revoke all on function
  public.command_record_narration_master_clock(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb),
  public.command_record_preflight_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb),
  public.command_issue_plan_evaluator_challenges(uuid,uuid,uuid,uuid,uuid,jsonb),
  public.command_record_plan_evaluator_score_set(uuid,uuid,text,jsonb),
  public.command_create_preflight_plan_consensus(uuid,uuid)
from public,anon,authenticated;
grant execute on function
  public.command_record_narration_master_clock(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb),
  public.command_record_preflight_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb),
  public.command_issue_plan_evaluator_challenges(uuid,uuid,uuid,uuid,uuid,jsonb),
  public.command_record_plan_evaluator_score_set(uuid,uuid,text,jsonb),
  public.command_create_preflight_plan_consensus(uuid,uuid)
to service_role;

-- Atomic first-Episode World Lock. Advisory aggregate locks plus row locks make
-- the critical section serial for a Series/Episode/configuration, while one
-- PostgreSQL transaction guarantees all-or-nothing publication and reservation.

create table public.series_release_components (
  id uuid primary key,
  workspace_id uuid not null,
  series_release_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  cultural_policy_version_id uuid not null,
  audio_identity_selection_id uuid not null,
  pronunciation_lexicon_version_id uuid not null,
  score_identity_version_id uuid not null,
  sound_identity_version_id uuid not null,
  world_reference_pack_version_id uuid not null,
  source_review_packet_id uuid not null,
  master_clock_version_id uuid not null,
  plan_bundle_id uuid not null,
  plan_qc_consensus_id uuid not null,
  production_quote_id uuid not null,
  quote_confirmation_id uuid not null,
  character_selection_set_hash text not null check(character_selection_set_hash~'^[a-f0-9]{64}$'),
  location_selection_set_hash text not null check(location_selection_set_hash~'^[a-f0-9]{64}$'),
  component_hash text not null check(component_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(series_release_id),
  foreign key(workspace_id,series_release_id)
    references public.series_releases(workspace_id,id) on delete restrict,
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(script_revision_id) references public.script_revisions(id) on delete restrict,
  foreign key(cultural_policy_version_id) references public.cultural_policy_versions(id) on delete restrict,
  foreign key(workspace_id,audio_identity_selection_id)
    references public.preflight_audio_identity_selections(workspace_id,id) on delete restrict,
  foreign key(workspace_id,pronunciation_lexicon_version_id)
    references public.pronunciation_lexicon_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,score_identity_version_id)
    references public.score_identity_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,sound_identity_version_id)
    references public.sound_identity_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,world_reference_pack_version_id)
    references public.world_reference_pack_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict,
  foreign key(workspace_id,master_clock_version_id)
    references public.narration_master_clock_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  foreign key(workspace_id,plan_qc_consensus_id)
    references private.preflight_plan_qc_consensus(workspace_id,id) on delete restrict,
  foreign key(workspace_id,production_quote_id)
    references public.production_quotes(workspace_id,id) on delete restrict,
  foreign key(workspace_id,quote_confirmation_id)
    references public.production_quote_confirmations(workspace_id,id) on delete restrict
);

create table public.series_release_character_versions (
  workspace_id uuid not null,
  series_release_id uuid not null,
  character_version_id uuid not null,
  primary key(series_release_id,character_version_id),
  foreign key(workspace_id,series_release_id)
    references public.series_releases(workspace_id,id) on delete restrict,
  foreign key(workspace_id,character_version_id)
    references public.character_versions(workspace_id,id) on delete restrict
);

create table public.series_release_location_versions (
  workspace_id uuid not null,
  series_release_id uuid not null,
  location_version_id uuid not null,
  primary key(series_release_id,location_version_id),
  foreign key(workspace_id,series_release_id)
    references public.series_releases(workspace_id,id) on delete restrict,
  foreign key(workspace_id,location_version_id)
    references public.location_versions(workspace_id,id) on delete restrict
);

create table public.series_release_decisions (
  id uuid primary key,
  workspace_id uuid not null,
  series_release_id uuid not null,
  decision text not null check(decision='publish_and_lock'),
  decision_hash text not null check(decision_hash~'^[a-f0-9]{64}$'),
  aggregate_versions jsonb not null check(jsonb_typeof(aggregate_versions)='object' and pg_column_size(aggregate_versions)<=8192),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check(actor_aal='aal2'),
  command_id uuid not null unique,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(series_release_id),
  foreign key(workspace_id,series_release_id)
    references public.series_releases(workspace_id,id) on delete restrict
);

create table private.production_budget_authorizations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  configuration_candidate_id uuid not null,
  production_quote_id uuid not null,
  quote_confirmation_id uuid not null,
  authorized_high_microusd bigint not null check(authorized_high_microusd between 0 and 50000000),
  hard_ceiling_microusd bigint not null check(hard_ceiling_microusd between authorized_high_microusd and 50000000),
  currency char(3) not null check(currency='USD'),
  authority_epoch bigint not null check(authority_epoch>0),
  authorized_by uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check(actor_aal='aal2'),
  state text not null check(state in ('active','consumed','released','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(production_quote_id),
  foreign key(workspace_id,episode_id) references public.episodes(workspace_id,id) on delete restrict,
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,production_quote_id)
    references public.production_quotes(workspace_id,id) on delete restrict,
  foreign key(workspace_id,quote_confirmation_id)
    references public.production_quote_confirmations(workspace_id,id) on delete restrict,
  check(expires_at>created_at)
);

create table private.production_budget_reservations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  authorization_id uuid not null references private.production_budget_authorizations(id) on delete restrict,
  reserved_microusd bigint not null check(reserved_microusd between 0 and 50000000),
  settled_microusd bigint not null default 0 check(settled_microusd between 0 and reserved_microusd),
  state text not null check(state in ('active','partially_settled','settled','released','revoked')),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(authorization_id),
  check(expires_at>created_at)
);

create table public.production_runs (
  id uuid primary key,
  workspace_id uuid not null,
  episode_id uuid not null,
  series_id uuid not null,
  configuration_candidate_id uuid not null,
  series_release_id uuid not null,
  series_release_component_id uuid not null,
  production_quote_id uuid not null,
  budget_authorization_id uuid not null references private.production_budget_authorizations(id) on delete restrict,
  budget_reservation_id uuid not null references private.production_budget_reservations(id) on delete restrict,
  run_number integer not null check(run_number>0),
  authority_epoch bigint not null check(authority_epoch>0),
  pinned_manifest_hash text not null check(pinned_manifest_hash~'^[a-f0-9]{64}$'),
  authorized_high_microusd bigint not null check(authorized_high_microusd between 0 and 50000000),
  hard_ceiling_microusd bigint not null check(hard_ceiling_microusd between authorized_high_microusd and 50000000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(episode_id,run_number),
  unique(configuration_candidate_id,authority_epoch),
  foreign key(workspace_id,episode_id,series_id)
    references public.episodes(workspace_id,id,series_id) on delete restrict,
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,series_release_id,series_id)
    references public.series_releases(workspace_id,id,series_id) on delete restrict,
  foreign key(workspace_id,series_release_component_id)
    references public.series_release_components(workspace_id,id) on delete restrict,
  foreign key(workspace_id,production_quote_id)
    references public.production_quotes(workspace_id,id) on delete restrict
);

create table public.production_run_statuses (
  production_run_id uuid primary key references public.production_runs(id) on delete restrict,
  workspace_id uuid not null,
  episode_id uuid not null,
  state text not null check(state in (
    'authorized','queued','running','paused','waiting_external','waiting_decision',
    'succeeded','failed','canceled','superseded'
  )),
  version bigint not null default 1 check(version>0),
  reason text check(reason is null or char_length(reason) between 1 and 1000),
  changed_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,production_run_id),
  foreign key(workspace_id,production_run_id)
    references public.production_runs(workspace_id,id) on delete restrict,
  foreign key(workspace_id,episode_id)
    references public.episodes(workspace_id,id) on delete restrict
);

create unique index one_authoritative_production_run_uq on public.production_run_statuses(episode_id)
where state in ('authorized','queued','running','paused','waiting_external','waiting_decision');

create table private.world_lock_command_receipts (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null check(char_length(idempotency_key) between 8 and 200),
  request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
  response_json jsonb not null check(jsonb_typeof(response_json)='object' and pg_column_size(response_json)<=16384),
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,actor_user_id,idempotency_key)
);

create trigger release_components_immutable before update or delete on public.series_release_components
for each row execute function private.reject_mutation();
create trigger release_character_versions_immutable before update or delete on public.series_release_character_versions
for each row execute function private.reject_mutation();
create trigger release_location_versions_immutable before update or delete on public.series_release_location_versions
for each row execute function private.reject_mutation();
create trigger release_decisions_immutable before update or delete on public.series_release_decisions
for each row execute function private.reject_mutation();
create trigger production_authorizations_immutable before update or delete on private.production_budget_authorizations
for each row execute function private.reject_mutation();
create trigger production_reservations_immutable before update or delete on private.production_budget_reservations
for each row execute function private.reject_mutation();
create trigger production_runs_immutable before update or delete on public.production_runs
for each row execute function private.reject_mutation();
create trigger world_lock_receipts_immutable before update or delete on private.world_lock_command_receipts
for each row execute function private.reject_mutation();

create or replace function public.command_lock_first_episode_world(
  p_workspace_id uuid,p_configuration_candidate_id uuid,p_production_quote_id uuid,
  p_quote_confirmation_id uuid,p_series_release_id uuid,p_continuity_state_version_id uuid,
  p_series_release_component_id uuid,p_series_release_decision_id uuid,
  p_budget_authorization_id uuid,p_budget_reservation_id uuid,p_production_run_id uuid,
  p_expected_series_version bigint,p_expected_episode_version bigint,
  p_expected_configuration_version bigint,p_release_manifest_hash text,
  p_command_id uuid,p_idempotency_key text,p_request_hash text,p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  existing private.world_lock_command_receipts%rowtype;
  config public.episode_configuration_candidates%rowtype;
  episode_row public.episodes%rowtype;
  series_row public.series%rowtype;
  script public.script_revisions%rowtype;
  audio public.preflight_audio_identity_selections%rowtype;
  source_packet public.source_review_packets%rowtype;
  clock public.narration_master_clock_versions%rowtype;
  plan public.preflight_plan_bundles%rowtype;
  consensus private.preflight_plan_qc_consensus%rowtype;
  quote public.production_quotes%rowtype;
  confirmation public.production_quote_confirmations%rowtype;
  character_set_hash text;
  location_set_hash text;
  continuity_hash text;
  component_hash_value text;
  manifest_hash_value text;
  decision_hash_value text;
  expected_request_hash text;
  aggregate_vector jsonb;
  response jsonb;
  next_release_number integer;
  next_continuity_number integer;
  next_run_number integer;
  next_authority_epoch bigint;
  new_episode_version bigint;
  new_series_version bigint;
  work_item_id uuid;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null
    or private.current_aal()<>'aal2'
  then raise exception 'AAL2 authenticated authority required' using errcode='42501'; end if;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_request_hash !~ '^[a-f0-9]{64}$' or p_release_manifest_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'World Lock command envelope is invalid' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'world-lock:'||p_workspace_id::text||':'||p_configuration_candidate_id::text,0));
  select * into existing from private.world_lock_command_receipts
    where workspace_id=p_workspace_id and actor_user_id=actor_id
      and idempotency_key=p_idempotency_key;
  if existing.id is not null then
    if existing.command_id=p_command_id and existing.request_hash=p_request_hash
    then return existing.response_json; end if;
    raise exception 'World Lock idempotency conflict' using errcode='40001';
  end if;

  perform private.assert_active_session(p_workspace_id);
  if not private.has_workspace_role(p_workspace_id,actor_id,array['admin']::public.membership_role[]) then
    raise exception 'workspace admin authority required' using errcode='42501'; end if;
  select * into config from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id for update;
  select * into episode_row from public.episodes
    where id=config.episode_id and workspace_id=p_workspace_id for update;
  select * into series_row from public.series
    where id=episode_row.series_id and workspace_id=p_workspace_id for update;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('series-world-lock:'||series_row.id::text,0));
  if config.id is null or episode_row.id is null or series_row.id is null
    or series_row.state<>'active' or series_row.active_release_id is not null
    or episode_row.episode_number<>1 or episode_row.pinned_series_release_id is not null
    or episode_row.workflow_state<>'world_setup'
    or config.state not in ('preflight','ready_to_lock')
    or config.voice_confirmed_at is null or config.look_confirmed_at is null
    or series_row.aggregate_version<>p_expected_series_version
    or episode_row.aggregate_version<>p_expected_episode_version
    or config.aggregate_version<>p_expected_configuration_version
  then raise exception 'first-Episode World Lock aggregate is stale or ineligible' using errcode='40001'; end if;
  if not exists(select 1 from private.aggregate_versions aggregate
      where aggregate.workspace_id=p_workspace_id and aggregate.aggregate_type='series'
        and aggregate.aggregate_id=series_row.id and aggregate.current_version=p_expected_series_version for update)
    or not exists(select 1 from private.aggregate_versions aggregate
      where aggregate.workspace_id=p_workspace_id and aggregate.aggregate_type='episode'
        and aggregate.aggregate_id=episode_row.id and aggregate.current_version=p_expected_episode_version for update)
  then raise exception 'aggregate version registry is stale' using errcode='40001'; end if;

  select * into script from public.script_revisions where id=config.script_revision_id;
  select * into clock from public.narration_master_clock_versions
    where configuration_candidate_id=config.id and state='verified' order by version_number desc limit 1;
  select * into audio from public.preflight_audio_identity_selections
    where id=clock.audio_identity_selection_id and configuration_candidate_id=config.id and state='verified';
  select * into plan from public.preflight_plan_bundles
    where configuration_candidate_id=config.id and master_clock_version_id=clock.id
    order by created_at desc limit 1;
  select * into consensus from private.preflight_plan_qc_consensus
    where plan_bundle_id=plan.id and verdict='pass' order by created_at desc limit 1;
  select * into source_packet from public.source_review_packets where id=plan.source_review_packet_id;
  select * into quote from public.production_quotes
    where id=p_production_quote_id and workspace_id=p_workspace_id
      and configuration_candidate_id=config.id and plan_bundle_id=plan.id
      and plan_qc_consensus_id=consensus.id;
  select * into confirmation from public.production_quote_confirmations
    where id=p_quote_confirmation_id and workspace_id=p_workspace_id
      and production_quote_id=quote.id;

  if script.id is null or not exists(select 1 from public.script_lock_events lock_event
      where lock_event.script_revision_id=script.id and lock_event.raw_utf8_sha256=script.raw_utf8_sha256)
    or not exists(select 1 from public.look_version_availability availability
      where availability.look_version_id=config.look_version_id and availability.status='active')
    or not exists(select 1 from public.voice_version_availability availability
      where availability.voice_version_id=config.voice_version_id and availability.status='verified')
    or audio.id is null or audio.voice_version_id<>config.voice_version_id
    or not exists(select 1 from public.pronunciation_lexicon_versions version
      where version.id=audio.pronunciation_lexicon_version_id and version.state='verified'
        and version.script_revision_id=script.id and version.voice_version_id=config.voice_version_id)
    or not exists(select 1 from public.score_identity_versions version
      where version.id=audio.score_identity_version_id and version.state='verified')
    or not exists(select 1 from public.sound_identity_versions version
      where version.id=audio.sound_identity_version_id and version.state='verified')
    or clock.id is null or clock.script_revision_id<>script.id or clock.duration_ms not between 60000 and 120000
    or plan.id is null or consensus.id is null or source_packet.id is null
    or plan.master_clock_version_id<>clock.id or plan.source_review_packet_id<>source_packet.id
    or not exists(select 1 from public.source_review_statuses status
      where status.source_review_packet_id=source_packet.id and status.status='approved')
    or exists(select 1 from public.cultural_readiness_findings finding
      where finding.source_review_packet_id=source_packet.id and finding.verdict in (
        'repair_required','qualified_review_required','production_blocked','release_blocked'))
    or not exists(select 1 from public.world_reference_pack_versions pack
      where pack.id=plan.world_reference_pack_version_id and pack.state='verified'
        and pack.configuration_candidate_id=config.id)
    or quote.id is null or quote.expires_at<=statement_timestamp()
    or confirmation.id is null or confirmation.quote_hash<>quote.quote_hash
    or confirmation.hard_ceiling_microusd<>quote.hard_ceiling_microusd
    or quote.high_total_microusd>quote.hard_ceiling_microusd
    or quote.high_total_microusd<>(select coalesce(sum(line.high_amount_microusd),0)
      from public.production_quote_lines line where line.production_quote_id=quote.id)
  then raise exception 'World Lock prerequisite pins are incomplete or stale' using errcode='40001'; end if;

  if not exists(select 1 from public.character_selections selection
      where selection.configuration_candidate_id=config.id and selection.state='accepted')
    or exists(select 1 from public.character_selections selection
      where selection.configuration_candidate_id=config.id and selection.state<>'accepted')
    or exists(select 1 from public.character_selections selection
      where selection.configuration_candidate_id=config.id and selection.state='accepted'
        and not exists(select 1 from public.character_sheet_versions sheet
          where sheet.character_version_id=selection.selected_version_id and sheet.state='verified'))
    or not exists(select 1 from public.location_selections selection
      where selection.configuration_candidate_id=config.id and selection.state='accepted')
    or exists(select 1 from public.location_selections selection
      where selection.configuration_candidate_id=config.id and selection.state<>'accepted')
  then raise exception 'every World identity must be accepted and sheet-verified' using errcode='40001'; end if;

  if exists(select 1 from public.preflight_shots shot where shot.plan_bundle_id=plan.id and (
      not exists(select 1 from public.preflight_provider_request_slots slot
        join private.production_provider_capability_versions capability on capability.id=slot.capability_version_id
        where slot.plan_bundle_id=plan.id and slot.shot_number=shot.shot_number
          and slot.slot_kind='primary' and capability.state='verified'
          and capability.expires_at>statement_timestamp())
      or exists(select 1 from public.preflight_reference_edges edge
        where edge.plan_bundle_id=plan.id and edge.shot_number=shot.shot_number
          and (edge.source_shot_number>=edge.shot_number
            or (edge.source_shot_number is not null and not edge.requires_upstream_success)))
    ))
    or exists(select 1 from public.preflight_provider_request_slots slot
      join private.production_provider_capability_versions capability on capability.id=slot.capability_version_id
      where slot.plan_bundle_id=plan.id and (
        capability.state<>'verified' or capability.expires_at<=statement_timestamp()
        or slot.reference_count<>(select count(*) from public.preflight_reference_edges edge
          where edge.plan_bundle_id=plan.id and edge.shot_number=slot.shot_number)))
    or exists(select 1 from public.production_quote_lines line
      join private.production_rate_card_versions rate on rate.id=line.rate_card_version_id
      join private.provider_evidence_snapshots evidence on evidence.id=rate.pricing_evidence_snapshot_id
      where line.production_quote_id=quote.id and (
        rate.state<>'verified' or rate.expires_at<=statement_timestamp()
        or evidence.verification_state<>'verified'))
  then raise exception 'capability, reference graph, or rate evidence became stale' using errcode='40001'; end if;

  select encode(extensions.digest(convert_to(string_agg(selection.selected_version_id::text,'|' order by selection.selected_version_id),'UTF8'),'sha256'),'hex')
    into character_set_hash from public.character_selections selection
    where selection.configuration_candidate_id=config.id and selection.state='accepted';
  select encode(extensions.digest(convert_to(string_agg(selection.selected_version_id::text,'|' order by selection.selected_version_id),'UTF8'),'sha256'),'hex')
    into location_set_hash from public.location_selections selection
    where selection.configuration_candidate_id=config.id and selection.state='accepted';
  next_continuity_number:=1;
  continuity_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'seriesId',series_row.id,'version',next_continuity_number,'baseVersionId',null,
    'initialWorldLock',true)::text,'UTF8'),'sha256'),'hex');
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
  next_release_number:=1;
  manifest_hash_value:=encode(extensions.digest(convert_to(jsonb_build_object(
    'seriesId',series_row.id,'releaseNumber',next_release_number,
    'continuityStateVersionId',p_continuity_state_version_id,'lookVersionId',config.look_version_id,
    'narratorGender',config.narrator_gender,'voiceVersionId',config.voice_version_id,
    'componentHash',component_hash_value,'aggregateVersions',aggregate_vector)::text,
    'UTF8'),'sha256'),'hex');
  expected_request_hash:=encode(extensions.digest(convert_to(
    manifest_hash_value||':'||quote.quote_hash||':'||aggregate_vector::text,'UTF8'),'sha256'),'hex');
  if p_release_manifest_hash is distinct from manifest_hash_value
    or p_request_hash is distinct from expected_request_hash
  then raise exception 'World Lock manifest or request hash is not exact' using errcode='40001'; end if;

  insert into public.continuity_state_versions(
    id,workspace_id,series_id,version_no,base_version_id,content_hash,safe_summary,created_by
  ) values(p_continuity_state_version_id,p_workspace_id,series_row.id,next_continuity_number,
    null,continuity_hash,jsonb_build_object('initialWorldLock',true),actor_id);
  insert into public.series_releases(
    id,workspace_id,series_id,release_number,manifest_hash,look_version_id,
    continuity_state_version_id,created_by,narrator_gender,voice_version_id,
    creative_identity_schema_version
  ) values(p_series_release_id,p_workspace_id,series_row.id,next_release_number,
    manifest_hash_value,config.look_version_id,p_continuity_state_version_id,actor_id,
    config.narrator_gender,config.voice_version_id,1);
  insert into public.series_release_components(
    id,workspace_id,series_release_id,configuration_candidate_id,script_revision_id,
    cultural_policy_version_id,audio_identity_selection_id,pronunciation_lexicon_version_id,
    score_identity_version_id,sound_identity_version_id,world_reference_pack_version_id,
    source_review_packet_id,master_clock_version_id,plan_bundle_id,plan_qc_consensus_id,
    production_quote_id,quote_confirmation_id,character_selection_set_hash,
    location_selection_set_hash,component_hash
  ) values(p_series_release_component_id,p_workspace_id,p_series_release_id,config.id,script.id,
    source_packet.policy_version_id,audio.id,audio.pronunciation_lexicon_version_id,
    audio.score_identity_version_id,audio.sound_identity_version_id,
    plan.world_reference_pack_version_id,source_packet.id,clock.id,plan.id,consensus.id,
    quote.id,confirmation.id,character_set_hash,location_set_hash,component_hash_value);
  insert into public.series_release_character_versions(workspace_id,series_release_id,character_version_id)
    select p_workspace_id,p_series_release_id,selection.selected_version_id
    from public.character_selections selection where selection.configuration_candidate_id=config.id and selection.state='accepted';
  insert into public.series_release_location_versions(workspace_id,series_release_id,location_version_id)
    select p_workspace_id,p_series_release_id,selection.selected_version_id
    from public.location_selections selection where selection.configuration_candidate_id=config.id and selection.state='accepted';
  insert into public.series_release_statuses(release_id,workspace_id,series_id,status,changed_by)
    values(p_series_release_id,p_workspace_id,series_row.id,'active',actor_id);

  decision_hash_value:=encode(extensions.digest(convert_to(
    manifest_hash_value||':'||quote.quote_hash||':'||actor_id::text||':'||aggregate_vector::text,
    'UTF8'),'sha256'),'hex');
  insert into public.series_release_decisions(
    id,workspace_id,series_release_id,decision,decision_hash,aggregate_versions,
    actor_user_id,actor_aal,command_id,correlation_id
  ) values(p_series_release_decision_id,p_workspace_id,p_series_release_id,
    'publish_and_lock',decision_hash_value,aggregate_vector,actor_id,'aal2',p_command_id,p_correlation_id);

  next_authority_epoch:=1;
  insert into private.production_budget_authorizations(
    id,workspace_id,episode_id,configuration_candidate_id,production_quote_id,
    quote_confirmation_id,authorized_high_microusd,hard_ceiling_microusd,currency,
    authority_epoch,authorized_by,actor_aal,state,expires_at
  ) values(p_budget_authorization_id,p_workspace_id,episode_row.id,config.id,quote.id,
    confirmation.id,quote.high_total_microusd,quote.hard_ceiling_microusd,'USD',
    next_authority_epoch,actor_id,'aal2','active',statement_timestamp()+interval '24 hours');
  insert into private.production_budget_reservations(
    id,workspace_id,authorization_id,reserved_microusd,state,expires_at
  ) values(p_budget_reservation_id,p_workspace_id,p_budget_authorization_id,
    quote.high_total_microusd,'active',statement_timestamp()+interval '24 hours');

  select coalesce(max(run_number),0)+1 into next_run_number from public.production_runs
    where episode_id=episode_row.id;
  insert into public.production_runs(
    id,workspace_id,episode_id,series_id,configuration_candidate_id,series_release_id,
    series_release_component_id,production_quote_id,budget_authorization_id,
    budget_reservation_id,run_number,authority_epoch,pinned_manifest_hash,
    authorized_high_microusd,hard_ceiling_microusd,created_by
  ) values(p_production_run_id,p_workspace_id,episode_row.id,series_row.id,config.id,
    p_series_release_id,p_series_release_component_id,quote.id,p_budget_authorization_id,
    p_budget_reservation_id,next_run_number,next_authority_epoch,manifest_hash_value,
    quote.high_total_microusd,quote.hard_ceiling_microusd,actor_id);
  insert into public.production_run_statuses(production_run_id,workspace_id,episode_id,state)
    values(p_production_run_id,p_workspace_id,episode_row.id,'authorized');

  update public.episode_configuration_candidates set state='locked',locked_at=statement_timestamp(),
    aggregate_version=aggregate_version+1 where id=config.id;
  update public.series set active_release_id=p_series_release_id,
    aggregate_version=aggregate_version+1 where id=series_row.id;
  update public.episodes set workflow_state='ready_to_produce',
    pinned_series_release_id=p_series_release_id,pinned_continuity_version_id=p_continuity_state_version_id,
    cost_estimate_minor=ceil(quote.expected_total_microusd::numeric/10000),currency='USD',
    aggregate_version=aggregate_version+1,progress_percent=15 where id=episode_row.id;
  update private.aggregate_versions set current_version=current_version+1,updated_at=statement_timestamp()
    where workspace_id=p_workspace_id and aggregate_type='series' and aggregate_id=series_row.id
    returning current_version into new_series_version;
  update private.aggregate_versions set current_version=current_version+1,updated_at=statement_timestamp()
    where workspace_id=p_workspace_id and aggregate_type='episode' and aggregate_id=episode_row.id
    returning current_version into new_episode_version;

  insert into public.work_items(
    workspace_id,episode_id,series_id,kind,state,required_role,dedupe_key,priority,
    safe_summary,deep_link
  ) values(p_workspace_id,episode_row.id,series_row.id,'production.start','open','member',
    'production-start:'||p_production_run_id::text,80,'World locked; production is ready to start.',
    '/episodes/'||episode_row.id::text||'/create') returning id into work_item_id;
  insert into public.domain_events(
    workspace_id,event_type,aggregate_type,aggregate_id,aggregate_sequence,actor_kind,
    actor_principal,correlation_id,causation_id,schema_version,safe_payload
  ) values(p_workspace_id,'episode.world_locked.v1','episode',episode_row.id,new_episode_version,
    'user',actor_id::text,p_correlation_id,p_command_id,1,jsonb_build_object(
      'seriesReleaseId',p_series_release_id,'productionRunId',p_production_run_id,
      'workItemId',work_item_id,'authorizedHighMicrousd',quote.high_total_microusd));
  insert into private.outbox_events(
    workspace_id,event_type,destination,payload_json,idempotency_key
  ) values(p_workspace_id,'production.run.authorized.v1','trigger.production',jsonb_build_object(
    'productionRunId',p_production_run_id,'workspaceId',p_workspace_id,'episodeId',episode_row.id),
    'production-authorized:'||p_production_run_id::text);
  insert into audit.events(
    workspace_id,actor_kind,actor_user_id,actor_principal,membership_role,aal,
    command_id,idempotency_key,action,target_type,target_id,target_version,
    permission_decision,new_hash,correlation_id,outcome,safe_metadata
  ) values(p_workspace_id,'user',actor_id,actor_id::text,'admin','aal2',p_command_id,
    p_idempotency_key,'episode.world_lock','episode',episode_row.id,new_episode_version,
    'allow',manifest_hash_value,p_correlation_id,'accepted',jsonb_build_object(
      'seriesReleaseId',p_series_release_id,'productionRunId',p_production_run_id));

  response:=jsonb_build_object('ok',true,'seriesReleaseId',p_series_release_id,
    'productionRunId',p_production_run_id,'workItemId',work_item_id,
    'manifestHash',manifest_hash_value,'episodeState','ready_to_produce',
    'episodeAggregateVersion',new_episode_version,'seriesAggregateVersion',new_series_version);
  insert into private.world_lock_command_receipts(
    command_id,workspace_id,actor_user_id,idempotency_key,request_hash,response_json,correlation_id
  ) values(p_command_id,p_workspace_id,actor_id,p_idempotency_key,p_request_hash,response,p_correlation_id);
  return response;
end;
$$;

create index release_components_release_idx on public.series_release_components(series_release_id);
create index release_components_config_idx on public.series_release_components(configuration_candidate_id);
create index release_components_script_idx on public.series_release_components(script_revision_id);
create index release_components_policy_idx on public.series_release_components(cultural_policy_version_id);
create index release_components_audio_idx on public.series_release_components(audio_identity_selection_id);
create index release_components_lexicon_idx on public.series_release_components(pronunciation_lexicon_version_id);
create index release_components_score_idx on public.series_release_components(score_identity_version_id);
create index release_components_sound_idx on public.series_release_components(sound_identity_version_id);
create index release_components_world_idx on public.series_release_components(world_reference_pack_version_id);
create index release_components_source_idx on public.series_release_components(source_review_packet_id);
create index release_components_clock_idx on public.series_release_components(master_clock_version_id);
create index release_components_plan_idx on public.series_release_components(plan_bundle_id);
create index release_components_consensus_idx on public.series_release_components(plan_qc_consensus_id);
create index release_components_quote_idx on public.series_release_components(production_quote_id);
create index release_components_confirmation_idx on public.series_release_components(quote_confirmation_id);
create index release_character_version_idx on public.series_release_character_versions(character_version_id);
create index release_location_version_idx on public.series_release_location_versions(location_version_id);
create index release_decision_actor_idx on public.series_release_decisions(actor_user_id);
create index budget_authorization_episode_idx on private.production_budget_authorizations(episode_id);
create index budget_authorization_config_idx on private.production_budget_authorizations(configuration_candidate_id);
create index budget_authorization_confirmation_idx on private.production_budget_authorizations(quote_confirmation_id);
create index budget_reservation_workspace_idx on private.production_budget_reservations(workspace_id);
create index production_run_episode_idx on public.production_runs(episode_id,run_number desc);
create index production_run_series_idx on public.production_runs(series_id);
create index production_run_config_idx on public.production_runs(configuration_candidate_id);
create index production_run_release_idx on public.production_runs(series_release_id);
create index production_run_component_idx on public.production_runs(series_release_component_id);
create index production_run_quote_idx on public.production_runs(production_quote_id);
create index production_run_authorization_idx on public.production_runs(budget_authorization_id);
create index production_run_reservation_idx on public.production_runs(budget_reservation_id);
create index production_run_status_episode_idx on public.production_run_statuses(episode_id,state);

do $$ declare table_name text; begin
  foreach table_name in array array[
    'series_release_components','series_release_character_versions',
    'series_release_location_versions','series_release_decisions',
    'production_runs','production_run_statuses'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id,(select auth.uid())))',
      table_name||'_member_select',table_name);
  end loop;
end $$;

revoke all on table public.series_release_components,public.series_release_character_versions,
  public.series_release_location_versions,public.series_release_decisions,
  public.production_runs,public.production_run_statuses from public,anon,authenticated;
grant select on table public.series_release_components,public.series_release_character_versions,
  public.series_release_location_versions,public.series_release_decisions,
  public.production_runs,public.production_run_statuses to authenticated;
revoke all on function public.command_lock_first_episode_world(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,
  text,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.command_lock_first_episode_world(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,
  text,uuid,text,text,uuid
) to authenticated;

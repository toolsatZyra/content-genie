-- Immutable world identities and versions. Mutable selection envelopes point
-- at candidates; accepting a replacement never rewrites historical media.

create table public.characters (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  series_id uuid not null,
  canonical_key text not null check (canonical_key ~ '^[a-z0-9][a-z0-9_.-]{1,99}$'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, series_id, canonical_key),
  foreign key (workspace_id, series_id)
    references public.series(workspace_id, id) on delete restrict
);

create table public.character_forms (
  id uuid primary key,
  workspace_id uuid not null,
  character_id uuid not null,
  form_key text not null check (form_key ~ '^[a-z0-9][a-z0-9_.-]{1,99}$'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, id, character_id),
  unique (character_id, form_key),
  foreign key (workspace_id, character_id)
    references public.characters(workspace_id, id) on delete restrict
);

create table public.character_versions (
  id uuid primary key,
  workspace_id uuid not null,
  character_id uuid not null,
  character_form_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  look_version_id uuid not null references public.look_versions(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  source_kind text not null check (source_kind in ('generated','uploaded','inherited')),
  prompt_text text not null check (char_length(prompt_text) between 1 and 16000),
  prompt_sha256 text not null check (prompt_sha256 ~ '^[a-f0-9]{64}$'),
  negative_prompt_text text not null default '' check (char_length(negative_prompt_text) <= 8000),
  anchor_asset_version_id uuid not null,
  identity_manifest jsonb not null check (
    jsonb_typeof(identity_manifest) = 'object'
    and pg_column_size(identity_manifest) <= 65536
  ),
  identity_manifest_hash text not null check (identity_manifest_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, id, character_form_id),
  unique (character_form_id, version_number),
  foreign key (workspace_id, character_id)
    references public.characters(workspace_id, id) on delete restrict,
  foreign key (workspace_id, character_form_id, character_id)
    references public.character_forms(workspace_id, id, character_id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id) on delete restrict,
  foreign key (workspace_id, anchor_asset_version_id)
    references public.asset_versions(workspace_id, id) on delete restrict
);

create table public.character_selections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  character_form_id uuid not null,
  candidate_version_id uuid not null,
  selected_version_id uuid,
  state text not null check (state in (
    'review_required','generating','accepted','blocked'
  )),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (configuration_candidate_id, character_form_id),
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id) on delete restrict,
  foreign key (workspace_id, character_form_id)
    references public.character_forms(workspace_id, id) on delete restrict,
  foreign key (workspace_id, candidate_version_id, character_form_id)
    references public.character_versions(workspace_id, id, character_form_id) on delete restrict,
  foreign key (workspace_id, selected_version_id, character_form_id)
    references public.character_versions(workspace_id, id, character_form_id) on delete restrict,
  check ((accepted_by is null) = (accepted_at is null)),
  check (state <> 'accepted' or selected_version_id is not null)
);

create table public.locations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  series_id uuid not null,
  canonical_key text not null check (canonical_key ~ '^[a-z0-9][a-z0-9_.-]{1,99}$'),
  display_name text not null check (char_length(display_name) between 1 and 240),
  named_temple boolean not null default false,
  real_place_name text check (real_place_name is null or char_length(real_place_name) between 1 and 300),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, series_id, canonical_key),
  foreign key (workspace_id, series_id)
    references public.series(workspace_id, id) on delete restrict,
  check (not named_temple or real_place_name is not null)
);

create table public.location_versions (
  id uuid primary key,
  workspace_id uuid not null,
  location_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  look_version_id uuid not null references public.look_versions(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  source_kind text not null check (source_kind in ('generated','uploaded','inherited')),
  prompt_text text not null check (char_length(prompt_text) between 1 and 16000),
  prompt_sha256 text not null check (prompt_sha256 ~ '^[a-f0-9]{64}$'),
  negative_prompt_text text not null default '' check (char_length(negative_prompt_text) <= 8000),
  empty_anchor_asset_version_id uuid not null,
  location_manifest jsonb not null check (
    jsonb_typeof(location_manifest) = 'object'
    and pg_column_size(location_manifest) <= 65536
  ),
  location_manifest_hash text not null check (location_manifest_hash ~ '^[a-f0-9]{64}$'),
  temple_evidence_set_hash text check (
    temple_evidence_set_hash is null or temple_evidence_set_hash ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, id, location_id),
  unique (location_id, version_number),
  foreign key (workspace_id, location_id)
    references public.locations(workspace_id, id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id) on delete restrict,
  foreign key (workspace_id, empty_anchor_asset_version_id)
    references public.asset_versions(workspace_id, id) on delete restrict
);

create table public.location_selections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  location_id uuid not null,
  candidate_version_id uuid not null,
  selected_version_id uuid,
  state text not null check (state in (
    'review_required','generating','accepted','blocked'
  )),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  accepted_by uuid references auth.users(id) on delete restrict,
  accepted_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (configuration_candidate_id, location_id),
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id) on delete restrict,
  foreign key (workspace_id, location_id)
    references public.locations(workspace_id, id) on delete restrict,
  foreign key (workspace_id, candidate_version_id, location_id)
    references public.location_versions(workspace_id, id, location_id) on delete restrict,
  foreign key (workspace_id, selected_version_id, location_id)
    references public.location_versions(workspace_id, id, location_id) on delete restrict,
  check ((accepted_by is null) = (accepted_at is null)),
  check (state <> 'accepted' or selected_version_id is not null)
);

create table private.world_regeneration_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  configuration_candidate_id uuid not null,
  entity_kind text not null check (entity_kind in ('character','location')),
  entity_id uuid not null,
  prior_version_id uuid not null,
  revised_prompt_text text not null check (char_length(revised_prompt_text) between 1 and 16000),
  revised_prompt_sha256 text not null check (revised_prompt_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null default 'queued' check (state in ('queued','completed','failed','superseded')),
  requested_by uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null unique,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (workspace_id, requested_by, idempotency_key),
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id) on delete restrict,
  check ((state = 'completed') = (completed_at is not null))
);

create table private.world_asset_decisions (
  command_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  configuration_candidate_id uuid not null,
  entity_kind text not null check (entity_kind in ('character','location')),
  entity_id uuid not null,
  version_id uuid not null,
  decision text not null check (decision in ('accept','regenerate')),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check (actor_aal in ('aal1','aal2')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb not null check (jsonb_typeof(response_json) = 'object'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, actor_user_id, idempotency_key),
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id) on delete restrict
);

create table public.character_sheet_versions (
  id uuid primary key,
  workspace_id uuid not null,
  character_version_id uuid not null,
  sheet_asset_version_id uuid not null,
  provider_profile text not null check (char_length(provider_profile) between 3 and 160),
  crop_manifest jsonb not null check (
    jsonb_typeof(crop_manifest) = 'object' and pg_column_size(crop_manifest) <= 65536
  ),
  crop_manifest_hash text not null check (crop_manifest_hash ~ '^[a-f0-9]{64}$'),
  qc_evidence_hash text not null check (qc_evidence_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('verified','rejected')),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (character_version_id, crop_manifest_hash),
  foreign key (workspace_id, character_version_id)
    references public.character_versions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, sheet_asset_version_id)
    references public.asset_versions(workspace_id, id) on delete restrict
);

create table public.world_reference_pack_versions (
  id uuid primary key,
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  version_number integer not null check (version_number > 0),
  selection_set_hash text not null check (selection_set_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (
    jsonb_typeof(manifest) = 'object' and pg_column_size(manifest) <= 131072
  ),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  qc_evidence_hash text not null check (qc_evidence_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('verified','rejected','stale')),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (configuration_candidate_id, version_number),
  unique (configuration_candidate_id, selection_set_hash),
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id) on delete restrict
);

create trigger character_versions_immutable before update or delete on public.character_versions
for each row execute function private.reject_mutation();
create trigger location_versions_immutable before update or delete on public.location_versions
for each row execute function private.reject_mutation();
create trigger character_sheets_immutable before update or delete on public.character_sheet_versions
for each row execute function private.reject_mutation();
create trigger world_reference_packs_immutable before update or delete on public.world_reference_pack_versions
for each row execute function private.reject_mutation();
create trigger world_asset_decisions_immutable before update or delete on private.world_asset_decisions
for each row execute function private.reject_mutation();

create or replace function private.assert_world_candidate_scope(
  p_workspace_id uuid,
  p_configuration_candidate_id uuid
)
returns public.episode_configuration_candidates
language plpgsql
security definer
set search_path = ''
as $$
declare candidate public.episode_configuration_candidates%rowtype;
begin
  select * into candidate from public.episode_configuration_candidates
  where id = p_configuration_candidate_id and workspace_id = p_workspace_id;
  if not found or candidate.state <> 'world_design'
    or candidate.look_confirmed_at is null or candidate.voice_confirmed_at is null
  then raise exception 'world configuration is unavailable' using errcode = '40001'; end if;
  return candidate;
end;
$$;

create or replace function public.command_record_character_candidate(
  p_workspace_id uuid, p_configuration_candidate_id uuid,
  p_character_id uuid, p_character_form_id uuid,
  p_character_key text, p_character_name text,
  p_form_key text, p_form_name text,
  p_version_id uuid, p_source_kind text,
  p_prompt_text text, p_prompt_sha256 text, p_negative_prompt_text text,
  p_anchor_asset_version_id uuid, p_identity_manifest jsonb,
  p_identity_manifest_hash text, p_regeneration_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  next_version integer;
  selection public.character_selections%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  config := private.assert_world_candidate_scope(p_workspace_id, p_configuration_candidate_id);
  select * into episode from public.episodes where id = config.episode_id;
  if p_source_kind not in ('generated','uploaded','inherited')
    or p_prompt_sha256 !~ '^[a-f0-9]{64}$'
    or p_prompt_sha256 <> encode(extensions.digest(
      convert_to(p_prompt_text,'UTF8'),'sha256'),'hex')
    or p_identity_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_identity_manifest) <> 'object'
  then raise exception 'character candidate envelope is invalid' using errcode = '22023'; end if;
  insert into public.characters (id, workspace_id, series_id, canonical_key, display_name)
  values (p_character_id, p_workspace_id, episode.series_id, p_character_key, p_character_name)
  on conflict (id) do nothing;
  if not exists (select 1 from public.characters where id = p_character_id
    and workspace_id = p_workspace_id and series_id = episode.series_id
    and canonical_key = p_character_key and display_name = p_character_name)
  then raise exception 'character identity conflicts with existing world' using errcode = '40001'; end if;
  insert into public.character_forms (id, workspace_id, character_id, form_key, display_name)
  values (p_character_form_id, p_workspace_id, p_character_id, p_form_key, p_form_name)
  on conflict (id) do nothing;
  if not exists (select 1 from public.character_forms where id = p_character_form_id
    and workspace_id = p_workspace_id and character_id = p_character_id
    and form_key = p_form_key and display_name = p_form_name)
  then raise exception 'character form conflicts with existing world' using errcode = '40001'; end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.character_versions where character_form_id = p_character_form_id;
  select * into selection from public.character_selections
  where configuration_candidate_id = config.id and character_form_id = p_character_form_id
  for update;
  if found and (p_regeneration_request_id is null or not exists (
    select 1 from private.world_regeneration_requests request
    where request.id = p_regeneration_request_id and request.workspace_id = p_workspace_id
      and request.configuration_candidate_id = config.id and request.entity_kind = 'character'
      and request.entity_id = p_character_form_id and request.state = 'queued'
  )) then raise exception 'character generation response is stale' using errcode = '40001'; end if;
  insert into public.character_versions (
    id, workspace_id, character_id, character_form_id, configuration_candidate_id,
    script_revision_id, look_version_id, version_number, source_kind,
    prompt_text, prompt_sha256, negative_prompt_text, anchor_asset_version_id,
    identity_manifest, identity_manifest_hash
  ) values (
    p_version_id, p_workspace_id, p_character_id, p_character_form_id, config.id,
    config.script_revision_id, config.look_version_id, next_version, p_source_kind,
    p_prompt_text, p_prompt_sha256, p_negative_prompt_text, p_anchor_asset_version_id,
    p_identity_manifest, p_identity_manifest_hash
  );
  insert into public.character_selections (
    workspace_id, configuration_candidate_id, character_form_id,
    candidate_version_id, selected_version_id, state
  ) values (p_workspace_id, config.id, p_character_form_id, p_version_id, null, 'review_required')
  on conflict (configuration_candidate_id, character_form_id) do update
  set candidate_version_id = excluded.candidate_version_id,
      state = 'review_required',
      aggregate_version = public.character_selections.aggregate_version + 1,
      updated_at = statement_timestamp();
  if p_regeneration_request_id is not null then
    update private.world_regeneration_requests set state = 'completed', completed_at = statement_timestamp()
    where id = p_regeneration_request_id;
  end if;
  return jsonb_build_object('ok',true,'characterVersionId',p_version_id,
    'versionNumber',next_version,'state','review_required');
end;
$$;

create or replace function public.command_record_location_candidate(
  p_workspace_id uuid, p_configuration_candidate_id uuid,
  p_location_id uuid, p_location_key text, p_location_name text,
  p_named_temple boolean, p_real_place_name text,
  p_version_id uuid, p_source_kind text,
  p_prompt_text text, p_prompt_sha256 text, p_negative_prompt_text text,
  p_anchor_asset_version_id uuid, p_location_manifest jsonb,
  p_location_manifest_hash text, p_temple_evidence_set_hash text,
  p_regeneration_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  next_version integer;
  selection public.location_selections%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  config := private.assert_world_candidate_scope(p_workspace_id, p_configuration_candidate_id);
  select * into episode from public.episodes where id = config.episode_id;
  if p_source_kind not in ('generated','uploaded','inherited')
    or p_prompt_sha256 !~ '^[a-f0-9]{64}$'
    or p_prompt_sha256 <> encode(extensions.digest(
      convert_to(p_prompt_text,'UTF8'),'sha256'),'hex')
    or p_location_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_location_manifest) <> 'object'
    or (p_named_temple and (p_real_place_name is null
      or p_temple_evidence_set_hash !~ '^[a-f0-9]{64}$'))
  then raise exception 'location candidate envelope is invalid' using errcode = '22023'; end if;
  insert into public.locations (
    id, workspace_id, series_id, canonical_key, display_name, named_temple, real_place_name
  ) values (
    p_location_id, p_workspace_id, episode.series_id, p_location_key,
    p_location_name, p_named_temple, p_real_place_name
  ) on conflict (id) do nothing;
  if not exists (select 1 from public.locations where id = p_location_id
    and workspace_id = p_workspace_id and series_id = episode.series_id
    and canonical_key = p_location_key and display_name = p_location_name
    and named_temple = p_named_temple
    and real_place_name is not distinct from p_real_place_name)
  then raise exception 'location identity conflicts with existing world' using errcode = '40001'; end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.location_versions where location_id = p_location_id;
  select * into selection from public.location_selections
  where configuration_candidate_id = config.id and location_id = p_location_id for update;
  if found and (p_regeneration_request_id is null or not exists (
    select 1 from private.world_regeneration_requests request
    where request.id = p_regeneration_request_id and request.workspace_id = p_workspace_id
      and request.configuration_candidate_id = config.id and request.entity_kind = 'location'
      and request.entity_id = p_location_id and request.state = 'queued'
  )) then raise exception 'location generation response is stale' using errcode = '40001'; end if;
  insert into public.location_versions (
    id, workspace_id, location_id, configuration_candidate_id, script_revision_id,
    look_version_id, version_number, source_kind, prompt_text, prompt_sha256,
    negative_prompt_text, empty_anchor_asset_version_id, location_manifest,
    location_manifest_hash, temple_evidence_set_hash
  ) values (
    p_version_id, p_workspace_id, p_location_id, config.id, config.script_revision_id,
    config.look_version_id, next_version, p_source_kind, p_prompt_text, p_prompt_sha256,
    p_negative_prompt_text, p_anchor_asset_version_id, p_location_manifest,
    p_location_manifest_hash, p_temple_evidence_set_hash
  );
  insert into public.location_selections (
    workspace_id, configuration_candidate_id, location_id,
    candidate_version_id, selected_version_id, state
  ) values (p_workspace_id, config.id, p_location_id, p_version_id, null, 'review_required')
  on conflict (configuration_candidate_id, location_id) do update
  set candidate_version_id = excluded.candidate_version_id,
      state = 'review_required',
      aggregate_version = public.location_selections.aggregate_version + 1,
      updated_at = statement_timestamp();
  if p_regeneration_request_id is not null then
    update private.world_regeneration_requests set state = 'completed', completed_at = statement_timestamp()
    where id = p_regeneration_request_id;
  end if;
  return jsonb_build_object('ok',true,'locationVersionId',p_version_id,
    'versionNumber',next_version,'state','review_required');
end;
$$;

create or replace function public.command_decide_world_candidate(
  p_workspace_id uuid, p_configuration_candidate_id uuid,
  p_entity_kind text, p_entity_id uuid, p_candidate_version_id uuid,
  p_expected_selection_version bigint, p_decision text,
  p_revised_prompt_text text, p_revised_prompt_sha256 text,
  p_command_id uuid, p_idempotency_key text, p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
  existing jsonb;
  response jsonb;
  selection_version bigint;
  target_episode_id uuid;
  regeneration_id uuid;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_world_candidate_scope(p_workspace_id, p_configuration_candidate_id);
  if p_entity_kind not in ('character','location') or p_decision not in ('accept','regenerate')
    or p_request_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'world decision envelope is invalid' using errcode = '22023'; end if;
  select decision.response_json into existing from private.world_asset_decisions decision
  where decision.workspace_id = p_workspace_id and decision.actor_user_id = actor_id
    and decision.idempotency_key = p_idempotency_key;
  if found then return existing; end if;
  if p_entity_kind = 'character' then
    update public.character_selections selection
    set selected_version_id = case when p_decision = 'accept' then p_candidate_version_id else selection.selected_version_id end,
        state = case when p_decision = 'accept' then 'accepted' else 'generating' end,
        accepted_by = case when p_decision = 'accept' then actor_id else selection.accepted_by end,
        accepted_at = case when p_decision = 'accept' then statement_timestamp() else selection.accepted_at end,
        aggregate_version = selection.aggregate_version + 1,
        updated_at = statement_timestamp()
    where selection.workspace_id = p_workspace_id
      and selection.configuration_candidate_id = p_configuration_candidate_id
      and selection.character_form_id = p_entity_id
      and selection.candidate_version_id = p_candidate_version_id
      and selection.aggregate_version = p_expected_selection_version
      and selection.state = 'review_required'
    returning aggregate_version into selection_version;
  else
    update public.location_selections selection
    set selected_version_id = case when p_decision = 'accept' then p_candidate_version_id else selection.selected_version_id end,
        state = case when p_decision = 'accept' then 'accepted' else 'generating' end,
        accepted_by = case when p_decision = 'accept' then actor_id else selection.accepted_by end,
        accepted_at = case when p_decision = 'accept' then statement_timestamp() else selection.accepted_at end,
        aggregate_version = selection.aggregate_version + 1,
        updated_at = statement_timestamp()
    where selection.workspace_id = p_workspace_id
      and selection.configuration_candidate_id = p_configuration_candidate_id
      and selection.location_id = p_entity_id
      and selection.candidate_version_id = p_candidate_version_id
      and selection.aggregate_version = p_expected_selection_version
      and selection.state = 'review_required'
    returning aggregate_version into selection_version;
  end if;
  if selection_version is null then raise exception 'world selection is stale' using errcode = '40001'; end if;
  if p_decision = 'regenerate' then
    if p_revised_prompt_sha256 !~ '^[a-f0-9]{64}$'
      or p_revised_prompt_sha256 <> encode(extensions.digest(
        convert_to(p_revised_prompt_text,'UTF8'),'sha256'),'hex')
      or char_length(p_revised_prompt_text) not between 1 and 16000
    then raise exception 'revised world prompt is invalid' using errcode = '22023'; end if;
    insert into private.world_regeneration_requests (
      workspace_id, configuration_candidate_id, entity_kind, entity_id,
      prior_version_id, revised_prompt_text, revised_prompt_sha256,
      requested_by, command_id, idempotency_key, request_hash, response_json
    ) values (
      p_workspace_id, p_configuration_candidate_id, p_entity_kind, p_entity_id,
      p_candidate_version_id, p_revised_prompt_text, p_revised_prompt_sha256,
      actor_id, p_command_id, p_idempotency_key, p_request_hash, '{}'::jsonb
    ) returning id into regeneration_id;
    insert into private.outbox_events (
      workspace_id, event_type, destination, payload_json, idempotency_key
    ) values (
      p_workspace_id, 'world.asset.regeneration_requested.v1', 'trigger.preflight.world',
      jsonb_build_object('regenerationRequestId',regeneration_id,
        'configurationCandidateId',p_configuration_candidate_id),
      'world-regeneration:' || regeneration_id::text
    );
  end if;
  select configuration.episode_id into target_episode_id
  from public.episode_configuration_candidates configuration
  where configuration.id = p_configuration_candidate_id;
  update public.episode_configuration_candidates set aggregate_version = aggregate_version + 1
  where id = p_configuration_candidate_id;
  update public.episodes set aggregate_version = aggregate_version + 1
  where id = target_episode_id;
  response := jsonb_build_object('ok',true,'decision',p_decision,
    'entityKind',p_entity_kind,'entityId',p_entity_id,
    'candidateVersionId',p_candidate_version_id,'selectionVersion',selection_version,
    'regenerationRequestId',regeneration_id);
  if p_decision = 'regenerate' then
    update private.world_regeneration_requests set response_json = response
    where id = regeneration_id;
  end if;
  insert into private.world_asset_decisions (
    command_id, workspace_id, configuration_candidate_id, entity_kind,
    entity_id, version_id, decision, actor_user_id, actor_aal,
    idempotency_key, request_hash, response_json
  ) values (
    p_command_id, p_workspace_id, p_configuration_candidate_id, p_entity_kind,
    p_entity_id, p_candidate_version_id, p_decision, actor_id, private.current_aal(),
    p_idempotency_key, p_request_hash, response
  );
  perform private.insert_audit_event(
    p_workspace_id, 'world.asset.' || p_decision, p_entity_kind,
    p_entity_id, selection_version, p_command_id, p_idempotency_key,
    p_correlation_id, 'allow', 'accepted'
  );
  return response;
end;
$$;

create or replace function public.command_record_character_sheet(
  p_workspace_id uuid, p_character_version_id uuid, p_sheet_version_id uuid,
  p_sheet_asset_version_id uuid, p_provider_profile text,
  p_crop_manifest jsonb, p_crop_manifest_hash text,
  p_qc_evidence_hash text, p_state text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  insert into public.character_sheet_versions (
    id, workspace_id, character_version_id, sheet_asset_version_id,
    provider_profile, crop_manifest, crop_manifest_hash, qc_evidence_hash, state
  ) values (
    p_sheet_version_id, p_workspace_id, p_character_version_id,
    p_sheet_asset_version_id, p_provider_profile, p_crop_manifest,
    p_crop_manifest_hash, p_qc_evidence_hash, p_state
  );
  return p_sheet_version_id;
end;
$$;

create or replace function public.command_record_world_reference_pack(
  p_workspace_id uuid, p_configuration_candidate_id uuid, p_pack_version_id uuid,
  p_selection_set_hash text, p_manifest jsonb, p_manifest_hash text,
  p_qc_evidence_hash text, p_state text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare next_version integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_state = 'verified' and (
    exists (select 1 from public.character_selections where
      configuration_candidate_id = p_configuration_candidate_id and state <> 'accepted')
    or exists (select 1 from public.location_selections where
      configuration_candidate_id = p_configuration_candidate_id and state <> 'accepted')
    or exists (
      select 1 from public.character_selections selection
      where selection.configuration_candidate_id = p_configuration_candidate_id
        and not exists (select 1 from public.character_sheet_versions sheet
          where sheet.character_version_id = selection.selected_version_id
            and sheet.state = 'verified')
    )
  ) then raise exception 'world reference pack prerequisites are incomplete' using errcode = '40001'; end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.world_reference_pack_versions
  where configuration_candidate_id = p_configuration_candidate_id;
  insert into public.world_reference_pack_versions (
    id, workspace_id, configuration_candidate_id, version_number,
    selection_set_hash, manifest, manifest_hash, qc_evidence_hash, state
  ) values (
    p_pack_version_id, p_workspace_id, p_configuration_candidate_id, next_version,
    p_selection_set_hash, p_manifest, p_manifest_hash, p_qc_evidence_hash, p_state
  );
  return p_pack_version_id;
end;
$$;

alter table public.characters enable row level security;
alter table public.character_forms enable row level security;
alter table public.character_versions enable row level security;
alter table public.character_selections enable row level security;
alter table public.locations enable row level security;
alter table public.location_versions enable row level security;
alter table public.location_selections enable row level security;
alter table public.character_sheet_versions enable row level security;
alter table public.world_reference_pack_versions enable row level security;
alter table public.characters force row level security;
alter table public.character_forms force row level security;
alter table public.character_versions force row level security;
alter table public.character_selections force row level security;
alter table public.locations force row level security;
alter table public.location_versions force row level security;
alter table public.location_selections force row level security;
alter table public.character_sheet_versions force row level security;
alter table public.world_reference_pack_versions force row level security;

create policy characters_member_select on public.characters for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy character_forms_member_select on public.character_forms for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy character_versions_member_select on public.character_versions for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy character_selections_member_select on public.character_selections for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy locations_member_select on public.locations for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy location_versions_member_select on public.location_versions for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy location_selections_member_select on public.location_selections for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy character_sheets_member_select on public.character_sheet_versions for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));
create policy world_reference_packs_member_select on public.world_reference_pack_versions for select to authenticated
using (private.is_active_member(workspace_id,(select auth.uid())));

revoke all on table public.characters, public.character_forms,
  public.character_versions, public.character_selections, public.locations,
  public.location_versions, public.location_selections,
  public.character_sheet_versions, public.world_reference_pack_versions
from public, anon, authenticated;
grant select on table public.characters, public.character_forms,
  public.character_versions, public.character_selections, public.locations,
  public.location_versions, public.location_selections,
  public.character_sheet_versions, public.world_reference_pack_versions
to authenticated;
revoke all on table private.world_regeneration_requests,
  private.world_asset_decisions from public, anon, authenticated;

revoke all on function private.assert_world_candidate_scope(uuid,uuid),
  public.command_record_character_candidate(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid,jsonb,text,uuid),
  public.command_record_location_candidate(uuid,uuid,uuid,text,text,boolean,text,uuid,text,text,text,text,uuid,jsonb,text,text,uuid),
  public.command_decide_world_candidate(uuid,uuid,text,uuid,uuid,bigint,text,text,text,uuid,text,text,uuid),
  public.command_record_character_sheet(uuid,uuid,uuid,uuid,text,jsonb,text,text,text),
  public.command_record_world_reference_pack(uuid,uuid,uuid,text,jsonb,text,text,text)
from public, anon, authenticated;
grant execute on function
  public.command_record_character_candidate(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid,jsonb,text,uuid),
  public.command_record_location_candidate(uuid,uuid,uuid,text,text,boolean,text,uuid,text,text,text,text,uuid,jsonb,text,text,uuid),
  public.command_record_character_sheet(uuid,uuid,uuid,uuid,text,jsonb,text,text,text),
  public.command_record_world_reference_pack(uuid,uuid,uuid,text,jsonb,text,text,text)
to service_role;
grant execute on function public.command_decide_world_candidate(
  uuid,uuid,text,uuid,uuid,bigint,text,text,text,uuid,text,text,uuid
) to authenticated;

-- Owner-provided narration is a first-class, user-confirmed source. The
-- original Episode script remains immutable; when the confirmed transcript
-- differs, it becomes a new immutable script revision with complete Unicode
-- coordinate evidence and the earlier revision remains addressable.

create type public.narration_source_kind as enum (
  'elevenlabs_v3',
  'uploaded_audio'
);

create type public.episode_narration_upload_state as enum (
  'prepared',
  'verified',
  'confirmed',
  'rejected',
  'superseded'
);

alter table public.episode_configuration_candidates
  add column narration_source_kind public.narration_source_kind
    not null default 'elevenlabs_v3',
  add column selected_narration_upload_version_id uuid,
  add column narration_source_confirmed_by uuid
    references auth.users(id) on delete restrict,
  add column narration_source_confirmed_at timestamptz,
  add constraint episode_configuration_narration_source_pair_check check (
    (
      narration_source_kind = 'elevenlabs_v3'
      and selected_narration_upload_version_id is null
      and narration_source_confirmed_by is null
      and narration_source_confirmed_at is null
    )
    or
    (
      narration_source_kind = 'uploaded_audio'
      and selected_narration_upload_version_id is not null
      and narration_source_confirmed_by is not null
      and narration_source_confirmed_at is not null
    )
  );

create table private.narration_upload_ingest_policy_versions (
  id uuid primary key,
  version_number integer not null unique check (version_number > 0),
  policy_json jsonb not null check (
    jsonb_typeof(policy_json) = 'object'
    and pg_column_size(policy_json) <= 16384
  ),
  policy_hash text not null unique check (policy_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('active','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  withdrawn_at timestamptz,
  check ((state = 'withdrawn') = (withdrawn_at is not null))
);

create unique index narration_upload_ingest_one_active_policy_uq
  on private.narration_upload_ingest_policy_versions ((true))
  where state = 'active';

insert into private.narration_upload_ingest_policy_versions (
  id, version_number, policy_json, policy_hash, state
)
select
  'a4d82e59-bd43-5f15-90fe-07f68ec9356c'::uuid,
  1,
  policy,
  encode(extensions.digest(convert_to(policy::text, 'UTF8'), 'sha256'), 'hex'),
  'active'
from (
  values (jsonb_build_object(
    'schemaVersion', 'genie.owner-narration-ingest.v1',
    'allowedSourceMimes', jsonb_build_array('audio/mpeg','audio/wav'),
    'canonicalMime', 'audio/mpeg',
    'maximumBytes', 104857600,
    'minimumDurationMs', 60000,
    'maximumDurationMs', 120000,
    'malwareScanRequired', true,
    'metadataStripRequired', true,
    'parserSandboxRequired', true,
    'transcriptionRequired', true,
    'coordinateAttestationRequiredAtConfirmation', true
  ))
) as configured(policy);

create trigger narration_upload_ingest_policies_immutable
before update or delete on private.narration_upload_ingest_policy_versions
for each row execute function private.reject_mutation();

create table public.episode_narration_upload_versions (
  id uuid primary key,
  workspace_id uuid not null,
  episode_id uuid not null,
  configuration_candidate_id uuid not null,
  original_script_revision_id uuid not null,
  confirmed_transcript_revision_id uuid,
  stable_asset_id uuid not null,
  quarantine_asset_version_id uuid not null unique,
  promoted_asset_version_id uuid unique,
  version_number integer not null check (version_number > 0),
  state public.episode_narration_upload_state not null default 'prepared',
  state_version bigint not null default 1 check (state_version > 0),
  display_filename text not null check (
    char_length(display_filename) between 1 and 255
    and display_filename !~ '[[:cntrl:]]'
  ),
  declared_mime text not null check (declared_mime in ('audio/mpeg','audio/wav')),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  sanitized_sha256 text check (
    sanitized_sha256 is null or sanitized_sha256 ~ '^[a-f0-9]{64}$'
  ),
  byte_length bigint not null check (byte_length between 1 and 104857600),
  sanitized_byte_length bigint check (
    sanitized_byte_length is null
    or sanitized_byte_length between 1 and 104857600
  ),
  duration_ms integer check (
    duration_ms is null or duration_ms between 60000 and 120000
  ),
  transcription_text text,
  transcription_sha256 text check (
    transcription_sha256 is null or transcription_sha256 ~ '^[a-f0-9]{64}$'
  ),
  alignment_json jsonb,
  alignment_hash text check (
    alignment_hash is null or alignment_hash ~ '^[a-f0-9]{64}$'
  ),
  script_comparison_json jsonb,
  script_comparison_hash text check (
    script_comparison_hash is null or script_comparison_hash ~ '^[a-f0-9]{64}$'
  ),
  quality_evidence jsonb,
  quality_evidence_hash text check (
    quality_evidence_hash is null or quality_evidence_hash ~ '^[a-f0-9]{64}$'
  ),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  confirmed_by uuid references auth.users(id) on delete restrict,
  confirmed_at timestamptz,
  rejected_at timestamptz,
  superseded_at timestamptz,
  safe_failure_class text check (
    safe_failure_class is null
    or safe_failure_class ~ '^[a-z][a-z0-9_.-]{2,100}$'
  ),
  command_id uuid not null unique,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, episode_id, version_number),
  unique (workspace_id, uploaded_by, idempotency_key),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, episode_id, original_script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict,
  foreign key (workspace_id, episode_id, confirmed_transcript_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict,
  foreign key (workspace_id, promoted_asset_version_id)
    references public.asset_versions(workspace_id, id) on delete restrict,
  check ((confirmed_by is null) = (confirmed_at is null)),
  check ((sanitized_sha256 is null) = (sanitized_byte_length is null)),
  check ((transcription_text is null) = (transcription_sha256 is null)),
  check ((alignment_json is null) = (alignment_hash is null)),
  check ((script_comparison_json is null) = (script_comparison_hash is null)),
  check ((quality_evidence is null) = (quality_evidence_hash is null)),
  check (
    transcription_text is null
    or (
      char_length(transcription_text) between 1 and 8192
      and char_length(btrim(transcription_text)) > 0
      and transcription_sha256 = encode(
        extensions.digest(convert_to(transcription_text, 'UTF8'), 'sha256'),
        'hex'
      )
    )
  ),
  check (
    alignment_json is null
    or (
      jsonb_typeof(alignment_json) in ('object','array')
      and pg_column_size(alignment_json) <= 2097152
      and alignment_hash = encode(
        extensions.digest(convert_to(alignment_json::text, 'UTF8'), 'sha256'),
        'hex'
      )
    )
  ),
  check (
    script_comparison_json is null
    or (
      jsonb_typeof(script_comparison_json) = 'object'
      and pg_column_size(script_comparison_json) <= 262144
      and script_comparison_hash = encode(
        extensions.digest(convert_to(script_comparison_json::text, 'UTF8'), 'sha256'),
        'hex'
      )
    )
  ),
  check (
    quality_evidence is null
    or (
      jsonb_typeof(quality_evidence) = 'object'
      and pg_column_size(quality_evidence) <= 262144
      and quality_evidence_hash = encode(
        extensions.digest(convert_to(quality_evidence::text, 'UTF8'), 'sha256'),
        'hex'
      )
    )
  ),
  check (
    (
      state = 'prepared'
      and promoted_asset_version_id is null
      and sanitized_sha256 is null
      and duration_ms is null
      and transcription_text is null
      and confirmed_transcript_revision_id is null
      and confirmed_at is null
      and rejected_at is null
      and superseded_at is null
      and safe_failure_class is null
    )
    or
    (
      state = 'verified'
      and num_nonnulls(
        promoted_asset_version_id, sanitized_sha256, sanitized_byte_length,
        duration_ms, transcription_text, transcription_sha256,
        alignment_json, alignment_hash, script_comparison_json,
        script_comparison_hash, quality_evidence, quality_evidence_hash
      ) = 12
      and confirmed_transcript_revision_id is null
      and confirmed_at is null
      and rejected_at is null
      and superseded_at is null
      and safe_failure_class is null
    )
    or
    (
      state = 'confirmed'
      and num_nonnulls(
        promoted_asset_version_id, sanitized_sha256, sanitized_byte_length,
        duration_ms, transcription_text, transcription_sha256,
        alignment_json, alignment_hash, script_comparison_json,
        script_comparison_hash, quality_evidence, quality_evidence_hash,
        confirmed_transcript_revision_id, confirmed_by, confirmed_at
      ) = 15
      and rejected_at is null
      and superseded_at is null
      and safe_failure_class is null
    )
    or
    (
      state = 'rejected'
      and rejected_at is not null
      and safe_failure_class is not null
      and confirmed_at is null
      and superseded_at is null
    )
    or
    (
      state = 'superseded'
      and promoted_asset_version_id is not null
      and superseded_at is not null
      and rejected_at is null
      and safe_failure_class is null
    )
  )
);

alter table public.episode_configuration_candidates
  add constraint episode_configuration_selected_narration_upload_fk
  foreign key (
    workspace_id,
    selected_narration_upload_version_id
  ) references public.episode_narration_upload_versions(workspace_id, id)
  on delete restrict;

create index episode_narration_upload_episode_idx
  on public.episode_narration_upload_versions (
    workspace_id, episode_id, version_number desc
  );
create index episode_narration_upload_pending_idx
  on public.episode_narration_upload_versions (state, created_at)
  where state in ('prepared','verified');

create table private.episode_narration_upload_attestations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  upload_version_id uuid not null unique,
  quarantine_asset_version_id uuid not null unique
    references private.quarantine_assets(id) on delete restrict,
  policy_version_id uuid not null
    references private.narration_upload_ingest_policy_versions(id) on delete restrict,
  scan_engine text not null check (scan_engine ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$'),
  scan_version text not null check (char_length(scan_version) between 1 and 100),
  source_mime text not null check (source_mime in ('audio/mpeg','audio/wav')),
  sanitized_mime text not null check (sanitized_mime = 'audio/mpeg'),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  sanitized_sha256 text not null check (sanitized_sha256 ~ '^[a-f0-9]{64}$'),
  source_byte_length bigint not null check (source_byte_length between 1 and 104857600),
  sanitized_byte_length bigint not null check (sanitized_byte_length between 1 and 104857600),
  decompressed_bytes bigint not null check (decompressed_bytes between 1 and 268435456),
  duration_ms integer not null check (duration_ms between 60000 and 120000),
  probe_sha256 text not null check (probe_sha256 ~ '^[a-f0-9]{64}$'),
  transcription_text text not null check (
    char_length(transcription_text) between 1 and 8192
    and char_length(btrim(transcription_text)) > 0
  ),
  transcription_sha256 text not null check (transcription_sha256 ~ '^[a-f0-9]{64}$'),
  alignment_json jsonb not null check (
    jsonb_typeof(alignment_json) in ('object','array')
    and pg_column_size(alignment_json) <= 2097152
  ),
  alignment_hash text not null check (alignment_hash ~ '^[a-f0-9]{64}$'),
  script_comparison_json jsonb not null check (
    jsonb_typeof(script_comparison_json) = 'object'
    and pg_column_size(script_comparison_json) <= 262144
  ),
  script_comparison_hash text not null check (script_comparison_hash ~ '^[a-f0-9]{64}$'),
  quality_evidence jsonb not null check (
    jsonb_typeof(quality_evidence) = 'object'
    and pg_column_size(quality_evidence) <= 262144
  ),
  quality_evidence_hash text not null check (quality_evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  foreign key (workspace_id, upload_version_id)
    references public.episode_narration_upload_versions(workspace_id, id)
    on delete restrict,
  check (transcription_sha256 = encode(
    extensions.digest(convert_to(transcription_text, 'UTF8'), 'sha256'), 'hex'
  )),
  check (alignment_hash = encode(
    extensions.digest(convert_to(alignment_json::text, 'UTF8'), 'sha256'), 'hex'
  )),
  check (script_comparison_hash = encode(
    extensions.digest(convert_to(script_comparison_json::text, 'UTF8'), 'sha256'), 'hex'
  )),
  check (quality_evidence_hash = encode(
    extensions.digest(convert_to(quality_evidence::text, 'UTF8'), 'sha256'), 'hex'
  ))
);

create trigger episode_narration_upload_attestations_immutable
before update or delete on private.episode_narration_upload_attestations
for each row execute function private.reject_mutation();

revoke all on table private.narration_upload_ingest_policy_versions,
  private.episode_narration_upload_attestations
from public, anon, authenticated;
grant select on table private.narration_upload_ingest_policy_versions,
  private.episode_narration_upload_attestations
to service_role;

alter table public.episode_narration_upload_versions enable row level security;
alter table public.episode_narration_upload_versions force row level security;
create policy episode_narration_upload_versions_member_select
on public.episode_narration_upload_versions
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

revoke all on table public.episode_narration_upload_versions
from public, anon, authenticated;
grant select on table public.episode_narration_upload_versions
to authenticated, service_role;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_entry.conname
    from pg_catalog.pg_constraint constraint_entry
    where constraint_entry.conrelid = 'public.script_revisions'::regclass
      and constraint_entry.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%source_kind%browser_text%uploaded_text%'
  loop
    execute pg_catalog.format(
      'alter table public.script_revisions drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.script_revisions
  add constraint script_revisions_source_envelope_v2_check check (
    (
      source_kind = 'browser_text'
      and uploaded_asset_version_id is null
      and original_source_bytes is null
      and original_source_sha256 is null
      and source_encoding_evidence = '{"kind":"browser-utf16"}'::jsonb
    )
    or
    (
      source_kind = 'uploaded_text'
      and uploaded_asset_version_id is null
      and original_source_bytes is not null
      and octet_length(original_source_bytes) between 1 and 24576
      and original_source_sha256 ~ '^[a-f0-9]{64}$'
      and original_source_sha256 =
        encode(extensions.digest(original_source_bytes, 'sha256'), 'hex')
      and private.decode_uploaded_script_source_v1(
        original_source_bytes,
        source_encoding_evidence
      ) = raw_text
    )
    or
    (
      source_kind = 'uploaded_audio_transcript'
      and uploaded_asset_version_id is not null
      and original_source_bytes is null
      and original_source_sha256 is null
      and source_encoding_evidence =
        '{"kind":"uploaded-audio-transcript-utf16"}'::jsonb
    )
  );

alter table public.script_revisions
  add constraint script_revisions_uploaded_audio_asset_fk
  foreign key (workspace_id, uploaded_asset_version_id)
  references public.asset_versions(workspace_id, id) on delete restrict;

create or replace function private.assert_narration_upload_window(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_configuration_candidate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  configuration_row public.episode_configuration_candidates%rowtype;
  episode_row public.episodes%rowtype;
begin
  select * into configuration_row
  from public.episode_configuration_candidates configuration
  where configuration.workspace_id = p_workspace_id
    and configuration.episode_id = p_episode_id
    and configuration.id = p_configuration_candidate_id;

  select * into episode_row
  from public.episodes episode
  where episode.workspace_id = p_workspace_id
    and episode.id = p_episode_id
    and episode.archived_at is null;

  if configuration_row.id is null
    or episode_row.id is null
    or configuration_row.state <> 'world_design'
    or episode_row.workflow_state <> 'world_setup'
    or exists (
      select 1
      from public.preflight_runs run
      where run.workspace_id = p_workspace_id
        and run.episode_id = p_episode_id
        and run.configuration_candidate_id = p_configuration_candidate_id
    )
    or exists (
      select 1
      from public.character_selections selection
      where selection.workspace_id = p_workspace_id
        and selection.configuration_candidate_id = p_configuration_candidate_id
    )
    or exists (
      select 1
      from public.location_selections selection
      where selection.workspace_id = p_workspace_id
        and selection.configuration_candidate_id = p_configuration_candidate_id
    )
    or exists (
      select 1
      from public.world_reference_pack_versions pack
      where pack.workspace_id = p_workspace_id
        and pack.configuration_candidate_id = p_configuration_candidate_id
    )
    or exists (
      select 1
      from public.world_build_progress_items item
      where item.workspace_id = p_workspace_id
        and item.configuration_candidate_id = p_configuration_candidate_id
    )
  then
    raise exception 'narration upload window has closed' using errcode = '55000';
  end if;
end;
$$;

revoke all on function private.assert_narration_upload_window(uuid,uuid,uuid)
from public, anon, authenticated;

create or replace function private.create_configuration_for_script_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  default_look uuid;
  default_voice uuid;
  next_candidate integer;
begin
  if new.source_kind = 'uploaded_audio_transcript' then
    return new;
  end if;

  select l.id into default_look
  from public.look_versions l
  join public.look_version_availability a on a.look_version_id = l.id
  where l.look_key = 'glowing-divine-realism'
    and l.pack_version = 1
    and a.status = 'active';
  select v.id into default_voice
  from public.voice_versions v
  join public.voice_version_availability a on a.voice_version_id = v.id
  where v.gender = 'male'
    and v.registry_version = 1
    and a.status <> 'withdrawn';
  if default_look is null or default_voice is null then
    raise exception 'default creative configuration is unavailable'
      using errcode = '55000';
  end if;

  update public.episode_configuration_candidates
  set state = 'superseded',
      superseded_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where episode_id = new.episode_id
    and state not in ('locked', 'superseded');

  select coalesce(max(candidate_number), 0) + 1 into next_candidate
  from public.episode_configuration_candidates
  where episode_id = new.episode_id;

  insert into public.episode_configuration_candidates (
    workspace_id,
    episode_id,
    candidate_number,
    script_revision_id,
    narrator_gender,
    voice_version_id,
    look_version_id,
    selected_by
  )
  values (
    new.workspace_id,
    new.episode_id,
    next_candidate,
    new.id,
    'male',
    default_voice,
    default_look,
    new.created_by
  );
  return new;
end;
$$;

revoke all on function private.create_configuration_for_script_revision()
from public, anon, authenticated;

create or replace function public.get_active_narration_upload_ingest_policy()
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  policy private.narration_upload_ingest_policy_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into policy
  from private.narration_upload_ingest_policy_versions candidate
  where candidate.state = 'active';
  if policy.id is null then
    raise exception 'active narration upload ingest policy unavailable'
      using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'id', policy.id,
    'policy', policy.policy_json,
    'policyHash', policy.policy_hash
  );
end;
$$;

create or replace function public.command_prepare_episode_narration_upload(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_configuration_candidate_id uuid,
  p_expected_configuration_version bigint,
  p_upload_version_id uuid,
  p_stable_asset_id uuid,
  p_quarantine_asset_version_id uuid,
  p_declared_mime text,
  p_byte_length bigint,
  p_source_sha256 text,
  p_display_filename text,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  configuration_row public.episode_configuration_candidates%rowtype;
  existing_upload public.episode_narration_upload_versions%rowtype;
  next_version integer;
  response jsonb;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform private.assert_active_session(p_workspace_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || actor_id::text || p_idempotency_key,
    0
  ));

  response := private.existing_command_response(
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.narration_upload.prepare',
    p_request_hash
  );
  if response is not null then
    return response;
  end if;

  if p_declared_mime not in ('audio/mpeg','audio/wav')
    or p_byte_length not between 1 and 104857600
    or p_source_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(p_display_filename) not between 1 and 255
    or p_display_filename ~ '[[:cntrl:]]'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    or p_request_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'narration upload envelope is invalid' using errcode = '22023';
  end if;

  select * into configuration_row
  from public.episode_configuration_candidates configuration
  where configuration.workspace_id = p_workspace_id
    and configuration.episode_id = p_episode_id
    and configuration.id = p_configuration_candidate_id
  for update;
  if configuration_row.id is null then
    raise exception 'configuration candidate not found' using errcode = 'P0002';
  end if;
  if p_expected_configuration_version is null
    or configuration_row.aggregate_version is distinct from
      p_expected_configuration_version
  then
    raise exception 'stale configuration candidate' using errcode = '40001';
  end if;
  perform private.assert_narration_upload_window(
    p_workspace_id,
    p_episode_id,
    p_configuration_candidate_id
  );

  select * into existing_upload
  from public.episode_narration_upload_versions upload
  where upload.workspace_id = p_workspace_id
    and upload.uploaded_by = actor_id
    and upload.idempotency_key = p_idempotency_key;
  if existing_upload.id is not null then
    if existing_upload.request_hash is distinct from p_request_hash then
      raise exception 'narration upload idempotency key conflicts'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true,
      'uploadVersionId', existing_upload.id,
      'stableAssetId', existing_upload.stable_asset_id,
      'quarantineAssetVersionId', existing_upload.quarantine_asset_version_id,
      'versionNumber', existing_upload.version_number,
      'state', existing_upload.state,
      'stateVersion', existing_upload.state_version
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'narration-upload:' || p_configuration_candidate_id::text,
    0
  ));
  select coalesce(max(upload.version_number), 0) + 1 into next_version
  from public.episode_narration_upload_versions upload
  where upload.configuration_candidate_id = p_configuration_candidate_id;

  insert into public.episode_narration_upload_versions (
    id,
    workspace_id,
    episode_id,
    configuration_candidate_id,
    original_script_revision_id,
    stable_asset_id,
    quarantine_asset_version_id,
    version_number,
    display_filename,
    declared_mime,
    source_sha256,
    byte_length,
    uploaded_by,
    command_id,
    idempotency_key,
    request_hash
  ) values (
    p_upload_version_id,
    p_workspace_id,
    p_episode_id,
    p_configuration_candidate_id,
    configuration_row.script_revision_id,
    p_stable_asset_id,
    p_quarantine_asset_version_id,
    next_version,
    p_display_filename,
    p_declared_mime,
    p_source_sha256,
    p_byte_length,
    actor_id,
    p_command_id,
    p_idempotency_key,
    p_request_hash
  );

  response := jsonb_build_object(
    'ok', true,
    'uploadVersionId', p_upload_version_id,
    'stableAssetId', p_stable_asset_id,
    'quarantineAssetVersionId', p_quarantine_asset_version_id,
    'versionNumber', next_version,
    'state', 'prepared',
    'stateVersion', 1
  );
  perform private.record_command(
    p_command_id,
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.narration_upload.prepare',
    'episode',
    p_episode_id,
    p_expected_configuration_version,
    p_request_hash,
    response,
    p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id,
    'episode.narration_upload.prepare',
    'episode_narration_upload_version',
    p_upload_version_id,
    1,
    p_command_id,
    p_idempotency_key,
    p_correlation_id,
    'allow',
    'accepted'
  );
  return response;
end;
$$;

create or replace function public.command_ensure_episode_narration_upload_quarantine(
  p_workspace_id uuid,
  p_upload_version_id uuid,
  p_object_name text,
  p_provenance_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload public.episode_narration_upload_versions%rowtype;
  quarantine private.quarantine_assets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_upload_version_id;
  if upload.id is null
    or upload.state <> 'prepared'
    or p_object_name <> p_workspace_id::text || '/quarantine/' ||
      upload.stable_asset_id::text || '/' ||
      upload.quarantine_asset_version_id::text || '/source'
    or p_provenance_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'narration upload quarantine binding is invalid'
      using errcode = '40001';
  end if;

  select * into quarantine
  from private.quarantine_assets asset
  where asset.id = upload.quarantine_asset_version_id;
  if quarantine.id is not null then
    if quarantine.workspace_id <> p_workspace_id
      or quarantine.stable_asset_id <> upload.stable_asset_id
      or quarantine.source_kind <> 'upload'
      or quarantine.object_name <> p_object_name
      or quarantine.declared_mime <> upload.declared_mime
      or quarantine.byte_length <> upload.byte_length
      or quarantine.source_sha256 <> upload.source_sha256
      or quarantine.provenance_hash <> p_provenance_hash
    then
      raise exception 'narration upload quarantine conflicts'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true,
      'quarantineAssetVersionId', quarantine.id,
      'state', quarantine.state
    );
  end if;

  return public.command_register_quarantine_asset(
    upload.quarantine_asset_version_id,
    p_workspace_id,
    upload.stable_asset_id,
    null,
    null,
    'upload',
    p_object_name,
    upload.display_filename,
    upload.declared_mime,
    upload.byte_length,
    upload.source_sha256,
    p_provenance_hash
  );
end;
$$;

create or replace function public.command_attest_episode_narration_upload(
  p_workspace_id uuid,
  p_upload_version_id uuid,
  p_attestation_id uuid,
  p_policy_version_id uuid,
  p_scan_engine text,
  p_scan_version text,
  p_sanitized_byte_length bigint,
  p_duration_ms integer,
  p_probe_sha256 text,
  p_sanitized_sha256 text,
  p_decompressed_bytes bigint,
  p_transcription_text text,
  p_transcription_sha256 text,
  p_alignment_json jsonb,
  p_alignment_hash text,
  p_script_comparison_json jsonb,
  p_script_comparison_hash text,
  p_quality_evidence jsonb,
  p_quality_evidence_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload public.episode_narration_upload_versions%rowtype;
  quarantine private.quarantine_assets%rowtype;
  existing private.episode_narration_upload_attestations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_upload_version_id;
  select * into quarantine
  from private.quarantine_assets source
  where source.workspace_id = p_workspace_id
    and source.id = upload.quarantine_asset_version_id
  for update;
  select * into existing
  from private.episode_narration_upload_attestations attestation
  where attestation.upload_version_id = p_upload_version_id;

  if existing.id is not null then
    if existing.id is distinct from p_attestation_id
      or existing.policy_version_id is distinct from p_policy_version_id
      or existing.scan_engine is distinct from p_scan_engine
      or existing.scan_version is distinct from p_scan_version
      or existing.sanitized_byte_length is distinct from p_sanitized_byte_length
      or existing.duration_ms is distinct from p_duration_ms
      or existing.probe_sha256 is distinct from p_probe_sha256
      or existing.sanitized_sha256 is distinct from p_sanitized_sha256
      or existing.decompressed_bytes is distinct from p_decompressed_bytes
      or existing.transcription_sha256 is distinct from p_transcription_sha256
      or existing.alignment_hash is distinct from p_alignment_hash
      or existing.script_comparison_hash is distinct from p_script_comparison_hash
      or existing.quality_evidence_hash is distinct from p_quality_evidence_hash
    then
      raise exception 'narration upload attestation conflicts'
        using errcode = '40001';
    end if;
    return existing.id;
  end if;

  if upload.id is null
    or upload.state <> 'prepared'
    or quarantine.id is null
    or quarantine.state not in ('quarantined','scanning')
    or quarantine.source_kind <> 'upload'
    or quarantine.declared_mime <> upload.declared_mime
    or quarantine.byte_length <> upload.byte_length
    or quarantine.source_sha256 <> upload.source_sha256
    or not exists (
      select 1
      from private.narration_upload_ingest_policy_versions policy
      where policy.id = p_policy_version_id
        and policy.state = 'active'
    )
    or p_sanitized_byte_length not between 1 and 104857600
    or p_duration_ms not between 60000 and 120000
    or p_probe_sha256 !~ '^[a-f0-9]{64}$'
    or p_sanitized_sha256 !~ '^[a-f0-9]{64}$'
    or p_decompressed_bytes not between 1 and 268435456
    or char_length(p_transcription_text) not between 1 and 8192
    or char_length(btrim(p_transcription_text)) = 0
    or p_transcription_sha256 is distinct from encode(
      extensions.digest(convert_to(p_transcription_text, 'UTF8'), 'sha256'),
      'hex'
    )
    or p_alignment_json is null
    or jsonb_typeof(p_alignment_json) not in ('object','array')
    or pg_column_size(p_alignment_json) > 2097152
    or p_alignment_hash is distinct from encode(
      extensions.digest(convert_to(p_alignment_json::text, 'UTF8'), 'sha256'),
      'hex'
    )
    or p_script_comparison_json is null
    or jsonb_typeof(p_script_comparison_json) <> 'object'
    or not (p_script_comparison_json ? 'matchesOriginalScript')
    or jsonb_typeof(p_script_comparison_json -> 'matchesOriginalScript')
      is distinct from 'boolean'
    or p_script_comparison_hash is distinct from encode(
      extensions.digest(
        convert_to(p_script_comparison_json::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    )
    or p_quality_evidence is null
    or jsonb_typeof(p_quality_evidence) <> 'object'
    or not (p_quality_evidence ?& array[
      'clippingDetected','corruptFramesDetected','unintendedSilenceDetected'
    ])
    or jsonb_typeof(p_quality_evidence -> 'clippingDetected')
      is distinct from 'boolean'
    or jsonb_typeof(p_quality_evidence -> 'corruptFramesDetected')
      is distinct from 'boolean'
    or jsonb_typeof(p_quality_evidence -> 'unintendedSilenceDetected')
      is distinct from 'boolean'
    or (p_quality_evidence ->> 'clippingDetected')::boolean
    or (p_quality_evidence ->> 'corruptFramesDetected')::boolean
    or (p_quality_evidence ->> 'unintendedSilenceDetected')::boolean
    or p_quality_evidence_hash is distinct from encode(
      extensions.digest(convert_to(p_quality_evidence::text, 'UTF8'), 'sha256'),
      'hex'
    )
  then
    raise exception 'narration upload attestation is invalid'
      using errcode = '22023';
  end if;

  insert into private.episode_narration_upload_attestations (
    id,
    workspace_id,
    upload_version_id,
    quarantine_asset_version_id,
    policy_version_id,
    scan_engine,
    scan_version,
    source_mime,
    sanitized_mime,
    source_sha256,
    sanitized_sha256,
    source_byte_length,
    sanitized_byte_length,
    decompressed_bytes,
    duration_ms,
    probe_sha256,
    transcription_text,
    transcription_sha256,
    alignment_json,
    alignment_hash,
    script_comparison_json,
    script_comparison_hash,
    quality_evidence,
    quality_evidence_hash
  ) values (
    p_attestation_id,
    p_workspace_id,
    p_upload_version_id,
    upload.quarantine_asset_version_id,
    p_policy_version_id,
    p_scan_engine,
    p_scan_version,
    upload.declared_mime,
    'audio/mpeg',
    upload.source_sha256,
    p_sanitized_sha256,
    upload.byte_length,
    p_sanitized_byte_length,
    p_decompressed_bytes,
    p_duration_ms,
    p_probe_sha256,
    p_transcription_text,
    p_transcription_sha256,
    p_alignment_json,
    p_alignment_hash,
    p_script_comparison_json,
    p_script_comparison_hash,
    p_quality_evidence,
    p_quality_evidence_hash
  );
  update private.quarantine_assets
  set state = 'scanning', updated_at = statement_timestamp()
  where id = upload.quarantine_asset_version_id
    and state = 'quarantined';
  return p_attestation_id;
end;
$$;

create or replace function public.command_promote_episode_narration_upload(
  p_workspace_id uuid,
  p_upload_version_id uuid,
  p_attestation_id uuid,
  p_asset_version_id uuid,
  p_final_object_name text,
  p_storage_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload public.episode_narration_upload_versions%rowtype;
  attestation private.episode_narration_upload_attestations%rowtype;
  quarantine private.quarantine_assets%rowtype;
  promoted public.asset_versions%rowtype;
  next_asset_version integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'narration-upload-promote:' || p_upload_version_id::text,
    0
  ));

  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_upload_version_id
  for update;
  select * into attestation
  from private.episode_narration_upload_attestations evidence
  where evidence.workspace_id = p_workspace_id
    and evidence.id = p_attestation_id
    and evidence.upload_version_id = p_upload_version_id;
  select * into quarantine
  from private.quarantine_assets source
  where source.workspace_id = p_workspace_id
    and source.id = upload.quarantine_asset_version_id
  for update;

  if upload.promoted_asset_version_id is not null then
    select * into promoted
    from public.asset_versions asset_version
    where asset_version.workspace_id = p_workspace_id
      and asset_version.id = upload.promoted_asset_version_id;
    if upload.promoted_asset_version_id is distinct from p_asset_version_id
      or promoted.asset_id is distinct from upload.stable_asset_id
      or promoted.source_quarantine_version_id is distinct from
        upload.quarantine_asset_version_id
      or promoted.content_sha256 is distinct from attestation.sanitized_sha256
      or promoted.media_mime is distinct from 'audio/mpeg'
      or promoted.object_name is distinct from p_final_object_name
      or promoted.storage_version is distinct from p_storage_version
    then
      raise exception 'narration upload promotion conflicts'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'uploadVersionId', upload.id,
      'assetId', promoted.asset_id,
      'assetVersionId', promoted.id,
      'state', upload.state,
      'stateVersion', upload.state_version
    );
  end if;

  if upload.id is null
    or upload.state <> 'prepared'
    or attestation.id is null
    or quarantine.id is null
    or quarantine.state <> 'scanning'
    or quarantine.stable_asset_id <> upload.stable_asset_id
    or quarantine.source_sha256 <> upload.source_sha256
    or attestation.quarantine_asset_version_id <> quarantine.id
    or p_final_object_name <> p_workspace_id::text || '/narration/' ||
      upload.stable_asset_id::text || '/' || p_asset_version_id::text || '/source'
    or char_length(p_storage_version) not between 1 and 200
    or not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'workspace-media'
        and object.name = p_final_object_name
    )
  then
    raise exception 'narration upload promotion evidence is incomplete'
      using errcode = '55000';
  end if;

  insert into public.assets (id, workspace_id, asset_kind)
  values (upload.stable_asset_id, p_workspace_id, 'narration')
  on conflict (id) do nothing;
  if not exists (
    select 1
    from public.assets asset
    where asset.workspace_id = p_workspace_id
      and asset.id = upload.stable_asset_id
      and asset.asset_kind = 'narration'
  ) then
    raise exception 'narration stable asset identity conflicts'
      using errcode = '40001';
  end if;

  select coalesce(max(asset_version.version_number), 0) + 1
    into next_asset_version
  from public.asset_versions asset_version
  where asset_version.asset_id = upload.stable_asset_id;

  insert into public.asset_versions (
    id,
    workspace_id,
    asset_id,
    version_number,
    source_quarantine_version_id,
    bucket_id,
    object_name,
    storage_version,
    content_sha256,
    media_mime,
    byte_length,
    policy_version_id,
    provenance_hash
  ) values (
    p_asset_version_id,
    p_workspace_id,
    upload.stable_asset_id,
    next_asset_version,
    upload.quarantine_asset_version_id,
    'workspace-media',
    p_final_object_name,
    p_storage_version,
    attestation.sanitized_sha256,
    'audio/mpeg',
    attestation.sanitized_byte_length,
    attestation.policy_version_id,
    quarantine.provenance_hash
  );
  insert into public.media_probes (
    workspace_id,
    asset_version_id,
    probe_version,
    probe_sha256,
    width,
    height,
    duration_ms,
    frame_count,
    streams
  ) values (
    p_workspace_id,
    p_asset_version_id,
    attestation.scan_version,
    attestation.probe_sha256,
    null,
    null,
    attestation.duration_ms,
    null,
    jsonb_build_array(jsonb_build_object(
      'mime', 'audio/mpeg',
      'metadataStripped', true,
      'parserSandboxed', true,
      'sourceMime', attestation.source_mime
    ))
  );

  update private.quarantine_assets
  set state = 'promoted',
      updated_at = statement_timestamp(),
      completed_at = statement_timestamp()
  where id = quarantine.id;
  update public.episode_narration_upload_versions
  set promoted_asset_version_id = p_asset_version_id,
      sanitized_sha256 = attestation.sanitized_sha256,
      sanitized_byte_length = attestation.sanitized_byte_length,
      duration_ms = attestation.duration_ms,
      transcription_text = attestation.transcription_text,
      transcription_sha256 = attestation.transcription_sha256,
      alignment_json = attestation.alignment_json,
      alignment_hash = attestation.alignment_hash,
      script_comparison_json = attestation.script_comparison_json,
      script_comparison_hash = attestation.script_comparison_hash,
      quality_evidence = attestation.quality_evidence,
      quality_evidence_hash = attestation.quality_evidence_hash,
      state = 'verified',
      state_version = state_version + 1,
      updated_at = statement_timestamp()
  where id = upload.id
  returning * into upload;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'uploadVersionId', upload.id,
    'assetId', upload.stable_asset_id,
    'assetVersionId', upload.promoted_asset_version_id,
    'state', upload.state,
    'stateVersion', upload.state_version
  );
end;
$$;

create or replace function public.command_reject_episode_narration_upload(
  p_workspace_id uuid,
  p_upload_version_id uuid,
  p_safe_failure_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload public.episode_narration_upload_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_safe_failure_class !~ '^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'safe failure class is invalid' using errcode = '22023';
  end if;
  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_upload_version_id
  for update;
  if upload.id is null then
    raise exception 'narration upload not found' using errcode = 'P0002';
  end if;
  if upload.state = 'rejected' then
    if upload.safe_failure_class <> p_safe_failure_class then
      raise exception 'narration upload rejection conflicts'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'uploadVersionId', upload.id,
      'state', upload.state,
      'stateVersion', upload.state_version,
      'safeFailureClass', upload.safe_failure_class
    );
  end if;
  if upload.state <> 'prepared' then
    raise exception 'narration upload can no longer be rejected'
      using errcode = '40001';
  end if;
  update public.episode_narration_upload_versions
  set state = 'rejected',
      state_version = state_version + 1,
      safe_failure_class = p_safe_failure_class,
      rejected_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = upload.id
  returning * into upload;
  update private.quarantine_assets
  set state = 'rejected',
      updated_at = statement_timestamp(),
      completed_at = statement_timestamp()
  where id = upload.quarantine_asset_version_id
    and state in ('quarantined','scanning');
  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'uploadVersionId', upload.id,
    'state', upload.state,
    'stateVersion', upload.state_version,
    'safeFailureClass', upload.safe_failure_class
  );
end;
$$;

create or replace function private.restore_generated_narration_on_voice_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.narration_source_kind = 'uploaded_audio' then
    update public.episode_narration_upload_versions
    set state = 'superseded',
        state_version = state_version + 1,
        superseded_at = statement_timestamp(),
        updated_at = statement_timestamp()
    where workspace_id = old.workspace_id
      and id = old.selected_narration_upload_version_id
      and state = 'confirmed';
    new.narration_source_kind := 'elevenlabs_v3';
    new.selected_narration_upload_version_id := null;
    new.narration_source_confirmed_by := null;
    new.narration_source_confirmed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function private.restore_generated_narration_on_voice_selection()
from public, anon, authenticated;

create trigger episode_configuration_voice_restores_generated_narration
before update of narrator_gender, voice_version_id,
  voice_confirmed_by, voice_confirmed_at
on public.episode_configuration_candidates
for each row execute function private.restore_generated_narration_on_voice_selection();

create or replace function public.command_confirm_episode_narration_upload(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_configuration_candidate_id uuid,
  p_upload_version_id uuid,
  p_expected_configuration_version bigint,
  p_expected_upload_state_version bigint,
  p_coordinate_attestation_id uuid,
  p_raw_text text,
  p_raw_utf8 bytea,
  p_raw_utf8_sha256 text,
  p_processing_text text,
  p_processing_utf8_sha256 text,
  p_processing_profile text,
  p_coordinate_map jsonb,
  p_runtime_evidence jsonb,
  p_raw_utf16_code_units integer,
  p_raw_scalar_count integer,
  p_raw_grapheme_count integer,
  p_processing_utf16_code_units integer,
  p_processing_scalar_count integer,
  p_processing_grapheme_count integer,
  p_duration_acknowledged boolean,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_epoch bigint;
  actor_role public.membership_role;
  configuration_row public.episode_configuration_candidates%rowtype;
  episode_row public.episodes%rowtype;
  upload public.episode_narration_upload_versions%rowtype;
  current_script public.script_revisions%rowtype;
  transcript_revision_id uuid;
  next_revision integer;
  estimated_seconds numeric(10,3);
  is_out_of_band boolean;
  trusted_attestation_id uuid;
  episode_version bigint;
  response jsonb;
  created_revision boolean := false;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform private.assert_active_session(p_workspace_id);
  perform pg_catalog.set_config('genie.uploaded_script_source', '', true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_workspace_id::text || actor_id::text || p_idempotency_key,
    0
  ));

  response := private.existing_command_response(
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.narration_upload.confirm',
    p_request_hash
  );
  if response is not null then
    return response;
  end if;

  select * into episode_row
  from public.episodes episode
  where episode.workspace_id = p_workspace_id
    and episode.id = p_episode_id
    and episode.archived_at is null
  for update;
  select membership.authority_epoch, membership.role
    into actor_epoch, actor_role
  from public.memberships membership
  where membership.workspace_id = p_workspace_id
    and membership.user_id = actor_id
    and membership.status = 'active'
  for update;
  if episode_row.id is null
    or actor_epoch is null
    or not (
      episode_row.owner_user_id = actor_id
      or actor_role in ('member','admin')
    )
  then
    raise exception 'Episode owner or member confirmation required'
      using errcode = '42501';
  end if;

  select * into configuration_row
  from public.episode_configuration_candidates configuration
  where configuration.workspace_id = p_workspace_id
    and configuration.episode_id = p_episode_id
    and configuration.id = p_configuration_candidate_id
  for update;
  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.episode_id = p_episode_id
    and candidate.configuration_candidate_id = p_configuration_candidate_id
    and candidate.id = p_upload_version_id
  for update;
  select * into current_script
  from public.script_revisions script
  where script.workspace_id = p_workspace_id
    and script.episode_id = p_episode_id
    and script.id = configuration_row.script_revision_id;

  if configuration_row.id is null
    or upload.id is null
    or current_script.id is null
    or upload.state <> 'verified'
    or upload.state_version is distinct from p_expected_upload_state_version
    or configuration_row.aggregate_version is distinct from
      p_expected_configuration_version
    or upload.promoted_asset_version_id is null
    or upload.transcription_text is distinct from p_raw_text
    or upload.transcription_sha256 is distinct from p_raw_utf8_sha256
  then
    raise exception 'narration upload confirmation is stale'
      using errcode = '40001';
  end if;
  perform private.assert_narration_upload_window(
    p_workspace_id,
    p_episode_id,
    p_configuration_candidate_id
  );

  delete from private.script_coordinate_attestations attestation
  where attestation.id = p_coordinate_attestation_id
    and attestation.workspace_id = p_workspace_id
    and attestation.episode_id = p_episode_id
    and attestation.actor_user_id = actor_id
    and attestation.request_hash = p_request_hash
    and attestation.raw_utf8_sha256 = p_raw_utf8_sha256
    and attestation.processing_utf8_sha256 = p_processing_utf8_sha256
    and attestation.coordinate_map_sha256 = encode(
      extensions.digest(convert_to(p_coordinate_map::text, 'UTF8'), 'sha256'),
      'hex'
    )
    and attestation.runtime_evidence_sha256 = encode(
      extensions.digest(convert_to(p_runtime_evidence::text, 'UTF8'), 'sha256'),
      'hex'
    )
    and attestation.expires_at > statement_timestamp()
  returning attestation.id into trusted_attestation_id;
  if trusted_attestation_id is null then
    raise exception 'trusted coordinate-map attestation required'
      using errcode = '42501';
  end if;

  if p_raw_utf8 <> convert_to(p_raw_text, 'UTF8')
    or p_raw_utf8_sha256 <> encode(extensions.digest(p_raw_utf8, 'sha256'), 'hex')
    or p_processing_profile <> 'genie-script-processing.v1'
    or p_processing_text <> normalize(
      pg_catalog.replace(
        pg_catalog.replace(p_raw_text, E'\r\n', E'\n'),
        E'\r',
        E'\n'
      ),
      NFC
    )
    or p_processing_utf8_sha256 <> encode(
      extensions.digest(convert_to(p_processing_text, 'UTF8'), 'sha256'),
      'hex'
    )
    or p_raw_scalar_count <> char_length(p_raw_text)
    or p_processing_scalar_count <> char_length(p_processing_text)
    or p_raw_utf16_code_units < p_raw_scalar_count
    or p_processing_utf16_code_units < p_processing_scalar_count
    or p_raw_grapheme_count > p_raw_scalar_count
    or p_processing_grapheme_count > p_processing_scalar_count
    or octet_length(p_raw_utf8) not between 1 and 8192
    or pg_column_size(p_coordinate_map) > 8388608
    or not private.verify_script_coordinate_map_envelope(
      p_coordinate_map,
      p_raw_text,
      p_processing_text,
      p_raw_utf16_code_units,
      p_raw_scalar_count,
      p_raw_grapheme_count,
      p_processing_utf16_code_units,
      p_processing_scalar_count,
      p_processing_grapheme_count
    )
  then
    raise exception 'uploaded narration transcript envelope rejected'
      using errcode = '22023';
  end if;

  estimated_seconds := private.estimate_hindi_narration_duration_v1(
    p_processing_text
  );
  is_out_of_band := estimated_seconds < 60 or estimated_seconds > 120;
  if is_out_of_band and not p_duration_acknowledged then
    raise exception 'duration estimate requires acknowledgement'
      using errcode = '22023';
  end if;

  if current_script.raw_utf8_sha256 = p_raw_utf8_sha256 then
    transcript_revision_id := current_script.id;
    next_revision := current_script.revision_number;
  else
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'script-revision:' || p_episode_id::text,
      0
    ));
    select coalesce(max(script.revision_number), 0) + 1 into next_revision
    from public.script_revisions script
    where script.episode_id = p_episode_id;

    insert into public.script_revisions (
      workspace_id,
      episode_id,
      revision_number,
      source_kind,
      raw_text,
      raw_utf8,
      raw_utf8_sha256,
      processing_text,
      processing_utf8_sha256,
      processing_profile,
      coordinate_map,
      runtime_evidence,
      source_encoding_evidence,
      raw_utf16_code_units,
      raw_scalar_count,
      raw_grapheme_count,
      processing_utf16_code_units,
      processing_scalar_count,
      processing_grapheme_count,
      estimated_duration_seconds,
      duration_out_of_band,
      duration_acknowledged,
      uploaded_asset_version_id,
      created_by
    ) values (
      p_workspace_id,
      p_episode_id,
      next_revision,
      'uploaded_audio_transcript',
      p_raw_text,
      p_raw_utf8,
      p_raw_utf8_sha256,
      p_processing_text,
      p_processing_utf8_sha256,
      p_processing_profile,
      p_coordinate_map,
      p_runtime_evidence,
      '{"kind":"uploaded-audio-transcript-utf16"}'::jsonb,
      p_raw_utf16_code_units,
      p_raw_scalar_count,
      p_raw_grapheme_count,
      p_processing_utf16_code_units,
      p_processing_scalar_count,
      p_processing_grapheme_count,
      estimated_seconds,
      is_out_of_band,
      p_duration_acknowledged,
      upload.promoted_asset_version_id,
      actor_id
    ) returning id into transcript_revision_id;
    created_revision := true;

    insert into public.script_lock_events (
      workspace_id,
      episode_id,
      script_revision_id,
      raw_utf8_sha256,
      actor_user_id,
      actor_authority_epoch,
      duration_acknowledged,
      command_id,
      correlation_id
    ) values (
      p_workspace_id,
      p_episode_id,
      transcript_revision_id,
      p_raw_utf8_sha256,
      actor_id,
      actor_epoch,
      p_duration_acknowledged,
      p_command_id,
      p_correlation_id
    );
  end if;

  update public.episode_narration_upload_versions
  set state = 'superseded',
      state_version = state_version + 1,
      superseded_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where workspace_id = p_workspace_id
    and configuration_candidate_id = p_configuration_candidate_id
    and state = 'confirmed'
    and id <> upload.id;

  update public.episode_narration_upload_versions
  set confirmed_transcript_revision_id = transcript_revision_id,
      state = 'confirmed',
      state_version = state_version + 1,
      confirmed_by = actor_id,
      confirmed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  where id = upload.id
  returning * into upload;

  update public.episode_configuration_candidates
  set script_revision_id = transcript_revision_id,
      narration_source_kind = 'uploaded_audio',
      selected_narration_upload_version_id = upload.id,
      narration_source_confirmed_by = actor_id,
      narration_source_confirmed_at = upload.confirmed_at,
      selected_by = actor_id,
      aggregate_version = aggregate_version + 1
  where id = configuration_row.id
  returning * into configuration_row;

  update public.episodes
  set aggregate_version = aggregate_version + 1
  where workspace_id = p_workspace_id
    and id = p_episode_id
  returning aggregate_version into episode_version;
  update private.aggregate_versions aggregate_state
  set current_version = aggregate_state.current_version + 1,
      updated_at = statement_timestamp()
  where aggregate_state.workspace_id = p_workspace_id
    and aggregate_state.aggregate_type = 'episode'
    and aggregate_state.aggregate_id = p_episode_id;

  perform private.emit_domain_event(
    p_workspace_id,
    'episode.narration_upload_confirmed.v1',
    'episode',
    p_episode_id,
    episode_version,
    p_correlation_id,
    jsonb_build_object(
      'episodeId', p_episode_id,
      'configurationCandidateId', configuration_row.id,
      'configurationVersion', configuration_row.aggregate_version,
      'narrationSourceKind', 'uploaded_audio',
      'uploadVersionId', upload.id,
      'scriptRevisionId', transcript_revision_id,
      'scriptRevisionNumber', next_revision,
      'scriptRevisionCreated', created_revision,
      'transcriptSha256', p_raw_utf8_sha256
    )
  );

  response := jsonb_build_object(
    'ok', true,
    'episodeId', p_episode_id,
    'episodeVersion', episode_version,
    'configurationCandidateId', configuration_row.id,
    'configurationVersion', configuration_row.aggregate_version,
    'narrationSourceKind', configuration_row.narration_source_kind,
    'uploadVersionId', upload.id,
    'uploadState', upload.state,
    'uploadStateVersion', upload.state_version,
    'scriptRevisionId', transcript_revision_id,
    'scriptRevisionNumber', next_revision,
    'scriptRevisionCreated', created_revision,
    'transcriptSha256', p_raw_utf8_sha256
  );
  perform private.record_command(
    p_command_id,
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.narration_upload.confirm',
    'episode',
    p_episode_id,
    p_expected_configuration_version,
    p_request_hash,
    response,
    p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id,
    'episode.narration_upload.confirm',
    'episode_narration_upload_version',
    upload.id,
    upload.state_version,
    p_command_id,
    p_idempotency_key,
    p_correlation_id,
    'allow',
    'accepted',
    null,
    jsonb_build_object(
      'episodeId', p_episode_id,
      'scriptRevisionId', transcript_revision_id,
      'transcriptSha256', p_raw_utf8_sha256
    )
  );
  return response;
end;
$$;

alter table public.narration_master_clock_versions
  add column source_kind public.narration_source_kind
    not null default 'elevenlabs_v3',
  add column narration_upload_version_id uuid,
  add constraint narration_master_clock_source_pair_check check (
    (
      source_kind = 'elevenlabs_v3'
      and narration_upload_version_id is null
    )
    or
    (
      source_kind = 'uploaded_audio'
      and narration_upload_version_id is not null
    )
  ),
  add constraint narration_master_clock_upload_fk
  foreign key (workspace_id, narration_upload_version_id)
  references public.episode_narration_upload_versions(workspace_id, id)
  on delete restrict;

create index narration_master_clock_upload_idx
  on public.narration_master_clock_versions (narration_upload_version_id)
  where narration_upload_version_id is not null;

create or replace function public.command_record_uploaded_narration_master_clock(
  p_master_clock_id uuid,
  p_workspace_id uuid,
  p_configuration_candidate_id uuid,
  p_preflight_run_id uuid,
  p_narration_upload_version_id uuid,
  p_audio_identity_selection_id uuid,
  p_processing_text_sha256 text,
  p_alignment_hash text,
  p_audio_evidence_hash text,
  p_performance_profile_hash text,
  p_audio_evidence jsonb,
  p_segments jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  configuration_row public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  clock_run public.preflight_runs%rowtype;
  upload public.episode_narration_upload_versions%rowtype;
  duration integer;
  next_version integer;
  segment jsonb;
  segment_id uuid;
  segment_number integer := 0;
  previous_scalar integer := 0;
  previous_end_ms integer := 0;
  start_scalar integer;
  end_scalar integer;
  start_time integer;
  end_time integer;
  pronunciation_id_text text;
  spoken_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into configuration_row
  from public.episode_configuration_candidates configuration
  where configuration.workspace_id = p_workspace_id
    and configuration.id = p_configuration_candidate_id;
  select * into script
  from public.script_revisions revision
  where revision.id = configuration_row.script_revision_id;
  select * into clock_run
  from public.preflight_runs run
  where run.workspace_id = p_workspace_id
    and run.id = p_preflight_run_id;
  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_narration_upload_version_id;
  select probe.duration_ms::integer into duration
  from public.media_probes probe
  join public.asset_versions asset_version
    on asset_version.id = probe.asset_version_id
  join public.assets asset
    on asset.id = asset_version.asset_id
  where asset_version.workspace_id = p_workspace_id
    and asset_version.id = upload.promoted_asset_version_id
    and asset_version.media_mime = 'audio/mpeg'
    and asset.workspace_id = p_workspace_id
    and asset.asset_kind = 'narration'
  order by probe.created_at desc
  limit 1;

  if configuration_row.id is null
    or configuration_row.state not in ('preflight','ready_to_lock')
    or configuration_row.narration_source_kind <> 'uploaded_audio'
    or configuration_row.selected_narration_upload_version_id <> upload.id
    or upload.id is null
    or upload.state <> 'confirmed'
    or upload.confirmed_transcript_revision_id <> script.id
    or upload.transcription_text <> script.raw_text
    or upload.transcription_sha256 <> script.raw_utf8_sha256
    or upload.promoted_asset_version_id is null
    or duration is distinct from upload.duration_ms
    or duration not between 60000 and 120000
    or clock_run.id is null
    or clock_run.configuration_candidate_id <> configuration_row.id
    or clock_run.script_revision_id <> script.id
    or clock_run.kind <> 'narration_clock'
    or clock_run.state not in (
      'running','waiting_external','waiting_decision','succeeded'
    )
    or clock_run.requires_micro_authority
    or num_nonnulls(
      clock_run.micro_quote_id,
      clock_run.micro_authorization_id,
      clock_run.micro_reservation_id
    ) <> 0
    or not exists (
      select 1
      from public.preflight_audio_identity_selections selection
      where selection.workspace_id = p_workspace_id
        and selection.id = p_audio_identity_selection_id
        and selection.configuration_candidate_id = configuration_row.id
        and selection.state = 'verified'
    )
    or exists (
      select 1
      from private.narration_generation_jobs job
      where job.workspace_id = p_workspace_id
        and job.preflight_run_id = p_preflight_run_id
    )
    or exists (
      select 1
      from private.provider_requests request
      where request.workspace_id = p_workspace_id
        and request.preflight_run_id = p_preflight_run_id
        and request.operation = 'gen_speech'
    )
    or exists (
      select 1
      from private.micro_quotes quote
      where quote.workspace_id = p_workspace_id
        and quote.configuration_candidate_id = configuration_row.id
        and quote.preflight_kind = 'narration_clock'
    )
    or p_processing_text_sha256 is distinct from script.processing_utf8_sha256
    or p_segments is null
    or jsonb_typeof(p_segments) <> 'array'
    or jsonb_array_length(p_segments) not between 1 and 2000
    or p_alignment_hash is distinct from encode(
      extensions.digest(convert_to(p_segments::text, 'UTF8'), 'sha256'),
      'hex'
    )
    or p_audio_evidence is distinct from upload.quality_evidence
    or p_audio_evidence_hash is distinct from upload.quality_evidence_hash
    or p_performance_profile_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'uploaded narration master clock envelope is invalid'
      using errcode = '40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'narration-clock:' || configuration_row.id::text,
    0
  ));
  if exists (
    select 1
    from public.narration_master_clock_versions existing
    where existing.id = p_master_clock_id
  ) then
    if exists (
      select 1
      from public.narration_master_clock_versions existing
      where existing.id = p_master_clock_id
        and existing.workspace_id = p_workspace_id
        and existing.configuration_candidate_id = configuration_row.id
        and existing.preflight_run_id = clock_run.id
        and existing.script_revision_id = script.id
        and existing.audio_identity_selection_id = p_audio_identity_selection_id
        and existing.narration_asset_version_id =
          upload.promoted_asset_version_id
        and existing.source_kind = 'uploaded_audio'
        and existing.narration_upload_version_id = upload.id
        and existing.processing_text_sha256 = p_processing_text_sha256
        and existing.alignment_hash = p_alignment_hash
        and existing.audio_evidence_hash = p_audio_evidence_hash
        and existing.performance_profile_hash = p_performance_profile_hash
        and existing.segment_count = jsonb_array_length(p_segments)
        and existing.state = 'verified'
    ) then
      return p_master_clock_id;
    end if;
    raise exception 'uploaded narration master clock replay conflicts'
      using errcode = '40001';
  end if;

  select coalesce(max(clock.version_number), 0) + 1 into next_version
  from public.narration_master_clock_versions clock
  where clock.configuration_candidate_id = configuration_row.id;
  insert into public.narration_master_clock_versions (
    id,
    workspace_id,
    configuration_candidate_id,
    preflight_run_id,
    script_revision_id,
    audio_identity_selection_id,
    narration_asset_version_id,
    version_number,
    duration_ms,
    processing_text_sha256,
    alignment_hash,
    audio_evidence_hash,
    performance_profile_hash,
    segment_count,
    state,
    source_kind,
    narration_upload_version_id
  ) values (
    p_master_clock_id,
    p_workspace_id,
    configuration_row.id,
    clock_run.id,
    script.id,
    p_audio_identity_selection_id,
    upload.promoted_asset_version_id,
    next_version,
    duration,
    p_processing_text_sha256,
    p_alignment_hash,
    p_audio_evidence_hash,
    p_performance_profile_hash,
    jsonb_array_length(p_segments),
    'verified',
    'uploaded_audio',
    upload.id
  );

  for segment in select value from jsonb_array_elements(p_segments) loop
    segment_number := segment_number + 1;
    if jsonb_typeof(segment) <> 'object'
      or (
        segment - array[
          'kind','startScalar','endScalar','exactText','startMs','endMs',
          'pronunciationEntryIds'
        ]::text[]
      ) <> '{}'::jsonb
      or not (segment ?& array[
        'kind','startScalar','endScalar','exactText','startMs','endMs',
        'pronunciationEntryIds'
      ])
      or jsonb_typeof(segment -> 'pronunciationEntryIds') <> 'array'
    then
      raise exception 'uploaded narration alignment segment is not exact'
        using errcode = '22023';
    end if;
    start_scalar := (segment ->> 'startScalar')::integer;
    end_scalar := (segment ->> 'endScalar')::integer;
    start_time := (segment ->> 'startMs')::integer;
    end_time := (segment ->> 'endMs')::integer;
    if start_scalar <> previous_scalar
      or start_time < previous_end_ms
      or substring(
        script.processing_text
        from start_scalar + 1
        for end_scalar - start_scalar
      ) is distinct from segment ->> 'exactText'
      or end_scalar > script.processing_scalar_count
      or end_time > duration
      or segment ->> 'kind' not in ('spoken','authored_pause')
      or (segment ->> 'kind' = 'spoken' and end_time <= start_time)
    then
      raise exception 'uploaded narration alignment is non-monotonic or incomplete'
        using errcode = '40001';
    end if;

    insert into public.narration_alignment_segments (
      workspace_id,
      master_clock_version_id,
      segment_number,
      segment_kind,
      processing_start_scalar,
      processing_end_scalar,
      exact_text,
      start_ms,
      end_ms
    ) values (
      p_workspace_id,
      p_master_clock_id,
      segment_number,
      segment ->> 'kind',
      start_scalar,
      end_scalar,
      segment ->> 'exactText',
      start_time,
      end_time
    ) returning id into segment_id;

    if segment ->> 'kind' = 'spoken' then
      spoken_count := spoken_count + 1;
    end if;
    for pronunciation_id_text in
      select jsonb_array_elements_text(segment -> 'pronunciationEntryIds')
    loop
      if not exists (
        select 1
        from public.pronunciation_entries entry
        join public.preflight_audio_identity_selections selection
          on selection.pronunciation_lexicon_version_id = entry.lexicon_version_id
        where entry.id = pronunciation_id_text::uuid
          and entry.workspace_id = p_workspace_id
          and selection.id = p_audio_identity_selection_id
          and entry.processing_start_scalar >= start_scalar
          and entry.processing_end_scalar <= end_scalar
          and entry.verification_status = 'verified'
      ) then
        raise exception 'uploaded narration pronunciation evidence is stale'
          using errcode = '40001';
      end if;
      insert into public.narration_segment_pronunciations (
        workspace_id,
        narration_segment_id,
        pronunciation_entry_id
      ) values (
        p_workspace_id,
        segment_id,
        pronunciation_id_text::uuid
      );
    end loop;
    previous_scalar := end_scalar;
    previous_end_ms := end_time;
  end loop;

  if previous_scalar <> script.processing_scalar_count
    or previous_end_ms <> duration
    or spoken_count < 1
  then
    raise exception 'uploaded narration alignment does not cover the transcript'
      using errcode = '40001';
  end if;
  return p_master_clock_id;
end;
$$;

revoke all on function public.get_active_narration_upload_ingest_policy()
from public, anon, authenticated;
grant execute on function public.get_active_narration_upload_ingest_policy()
to service_role;

revoke all on function public.command_prepare_episode_narration_upload(
  uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,bigint,text,text,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_prepare_episode_narration_upload(
  uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,bigint,text,text,uuid,text,text,uuid
) to authenticated;

revoke all on function public.command_ensure_episode_narration_upload_quarantine(
  uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.command_ensure_episode_narration_upload_quarantine(
  uuid,uuid,text,text
) to service_role;

revoke all on function public.command_attest_episode_narration_upload(
  uuid,uuid,uuid,uuid,text,text,bigint,integer,text,text,bigint,text,text,
  jsonb,text,jsonb,text,jsonb,text
) from public, anon, authenticated;
grant execute on function public.command_attest_episode_narration_upload(
  uuid,uuid,uuid,uuid,text,text,bigint,integer,text,text,bigint,text,text,
  jsonb,text,jsonb,text,jsonb,text
) to service_role;

revoke all on function public.command_promote_episode_narration_upload(
  uuid,uuid,uuid,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.command_promote_episode_narration_upload(
  uuid,uuid,uuid,uuid,text,text
) to service_role;

revoke all on function public.command_reject_episode_narration_upload(
  uuid,uuid,text
) from public, anon, authenticated;
grant execute on function public.command_reject_episode_narration_upload(
  uuid,uuid,text
) to service_role;

revoke all on function public.command_confirm_episode_narration_upload(
  uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,bytea,text,text,text,text,
  jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,
  uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_confirm_episode_narration_upload(
  uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,bytea,text,text,text,text,
  jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,
  uuid,text,text,uuid
) to authenticated;

revoke all on function public.command_record_uploaded_narration_master_clock(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.command_record_uploaded_narration_master_clock(
  uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb
) to service_role;

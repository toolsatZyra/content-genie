-- Phase 2 / 0018: separate remote-fetch evidence, quarantine-first ingest,
-- immutable promoted assets, probes, and production-reference isolation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'quarantine', 'quarantine', false, 104857600,
    array['image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4']::text[]
  ),
  (
    'workspace-media', 'workspace-media', false, 2147483648,
    array['image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4']::text[]
  )
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create type private.quarantine_asset_state as enum (
  'quarantined','scanning','rejected','promoted','late_evidence','expired'
);

create table private.remote_fetch_allowlist_versions (
  id uuid primary key default gen_random_uuid(),
  environment text not null check (environment in (
    'development','preview','production','test'
  )),
  fetch_class text not null check (fetch_class in (
    'provider_output','research_reference'
  )),
  version_number integer not null check (version_number > 0),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('active','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  withdrawn_at timestamptz,
  unique (environment, fetch_class, version_number),
  unique (environment, fetch_class, manifest_hash),
  check ((state = 'withdrawn') = (withdrawn_at is not null))
);
create unique index remote_fetch_one_active_allowlist_uq
  on private.remote_fetch_allowlist_versions (environment, fetch_class)
  where state = 'active';

create table private.remote_fetch_allowlist_entries (
  allowlist_version_id uuid not null
    references private.remote_fetch_allowlist_versions(id) on delete restrict,
  exact_hostname text not null check (
    exact_hostname = lower(exact_hostname)
    and exact_hostname ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
    and exact_hostname !~ '\.$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  primary key (allowlist_version_id, exact_hostname)
);

create table private.remote_fetch_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  fetch_class text not null check (fetch_class in (
    'provider_output','research_reference'
  )),
  allowlist_version_id uuid not null
    references private.remote_fetch_allowlist_versions(id) on delete restrict,
  exact_hostname text not null check (
    exact_hostname = lower(exact_hostname)
    and exact_hostname ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
    and exact_hostname !~ '\.$'
  ),
  canonical_url_hash text not null check (canonical_url_hash ~ '^[a-f0-9]{64}$'),
  allowlist_version_hash text not null check (allowlist_version_hash ~ '^[a-f0-9]{64}$'),
  resolved_address_hashes jsonb not null check (
    jsonb_typeof(resolved_address_hashes) = 'array'
    and jsonb_array_length(resolved_address_hashes) between 1 and 16
    and pg_column_size(resolved_address_hashes) <= 4096
  ),
  redirect_count integer not null check (redirect_count between 0 and 5),
  maximum_bytes bigint not null check (maximum_bytes between 1 and 104857600),
  timeout_ms integer not null check (timeout_ms between 1000 and 120000),
  status text not null check (status in (
    'authorized','fetched','rejected','failed'
  )),
  response_sha256 text check (
    response_sha256 is null or response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  safe_failure_class text check (
    safe_failure_class is null or safe_failure_class ~ '^[a-z][a-z0-9_.-]{2,100}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict,
  check (
    (status = 'authorized' and completed_at is null and response_sha256 is null)
    or (status = 'fetched' and completed_at is not null and response_sha256 is not null)
    or (status in ('rejected','failed') and completed_at is not null)
  )
);

create table private.quarantine_assets (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  stable_asset_id uuid not null,
  provider_request_id uuid references private.provider_requests(id) on delete restrict,
  remote_fetch_request_id uuid references private.remote_fetch_requests(id)
    on delete restrict,
  source_kind text not null check (source_kind in (
    'upload','research_fetch','provider_output'
  )),
  bucket_id text not null check (bucket_id = 'quarantine'),
  object_name text not null,
  display_filename text not null check (
    char_length(display_filename) between 1 and 255
    and display_filename !~ '[[:cntrl:]]'
  ),
  declared_mime text not null check (declared_mime in (
    'image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4'
  )),
  byte_length bigint not null check (byte_length between 1 and 104857600),
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  provenance_hash text not null check (provenance_hash ~ '^[a-f0-9]{64}$'),
  state private.quarantine_asset_state not null default 'quarantined',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (bucket_id, object_name),
  check (
    object_name = workspace_id::text || '/quarantine/' ||
      stable_asset_id::text || '/' || id::text || '/source'
    and object_name !~ '(^|/)\.\.(/|$)'
    and position(chr(92) in object_name) = 0
  ),
  check (
    (source_kind = 'provider_output' and provider_request_id is not null)
    or (source_kind = 'research_fetch' and remote_fetch_request_id is not null)
    or (source_kind = 'upload' and provider_request_id is null
      and remote_fetch_request_id is null)
  ),
  check (
    (state in ('rejected','promoted','late_evidence','expired') and completed_at is not null)
    or (state in ('quarantined','scanning') and completed_at is null)
  )
);

create index quarantine_assets_scan_idx
  on private.quarantine_assets (state, created_at)
  where state in ('quarantined','scanning');
create index quarantine_assets_provider_idx
  on private.quarantine_assets (provider_request_id)
  where provider_request_id is not null;

create table private.media_ingest_attestations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  quarantine_asset_version_id uuid not null references private.quarantine_assets(id)
    on delete restrict,
  schema_version text not null check (schema_version = 'genie.ingest-attestation.v1'),
  policy_version_id uuid not null,
  scan_engine text not null check (scan_engine ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$'),
  scan_version text not null check (scan_version ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$'),
  malware_status text not null check (malware_status in ('clean','infected','indeterminate')),
  parser_sandboxed boolean not null,
  metadata_stripped boolean not null,
  magic_mime text not null check (magic_mime in (
    'image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4'
  )),
  reencoded_mime text not null check (reencoded_mime in (
    'image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4'
  )),
  decompressed_bytes bigint not null check (
    decompressed_bytes between 1 and 268435456
  ),
  width integer check (width is null or width between 1 and 32768),
  height integer check (height is null or height between 1 and 32768),
  duration_ms bigint check (duration_ms is null or duration_ms between 1 and 1800000),
  frame_count bigint check (frame_count is null or frame_count between 1 and 36000),
  probe_sha256 text not null check (probe_sha256 ~ '^[a-f0-9]{64}$'),
  output_sha256 text not null check (output_sha256 ~ '^[a-f0-9]{64}$'),
  output_byte_length bigint not null check (output_byte_length between 1 and 104857600),
  scanner_task_id text not null check (
    scanner_task_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
  ),
  scanner_task_version text not null check (char_length(scanner_task_version) between 1 and 160),
  created_at timestamptz not null default statement_timestamp(),
  unique (quarantine_asset_version_id, output_sha256),
  unique (workspace_id, id),
  check (magic_mime = reencoded_mime),
  check (
    (magic_mime like 'image/%' and width is not null and height is not null
      and width::bigint * height::bigint <= 40000000
      and duration_ms is null and frame_count is null)
    or (magic_mime like 'audio/%' and width is null and height is null
      and duration_ms is not null)
    or (magic_mime = 'video/mp4' and width is not null and height is not null
      and duration_ms is not null and frame_count is not null)
  )
);

create table public.assets (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  asset_kind text not null check (asset_kind in (
    'character_anchor','location_anchor','narration','research_reference',
    'upload_reference','generated_image','alignment','safe_preview'
  )),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id)
);

create table public.asset_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  asset_id uuid not null,
  version_number integer not null check (version_number > 0),
  source_quarantine_version_id uuid not null,
  bucket_id text not null check (bucket_id = 'workspace-media'),
  object_name text not null,
  storage_version text not null check (char_length(storage_version) between 1 and 200),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  media_mime text not null check (media_mime in (
    'image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4'
  )),
  byte_length bigint not null check (byte_length between 1 and 104857600),
  policy_version_id uuid not null,
  provenance_hash text not null check (provenance_hash ~ '^[a-f0-9]{64}$'),
  promoted_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (asset_id, version_number),
  unique (source_quarantine_version_id),
  unique (bucket_id, object_name, storage_version),
  foreign key (workspace_id, asset_id)
    references public.assets(workspace_id, id) on delete restrict,
  foreign key (source_quarantine_version_id)
    references private.quarantine_assets(id) on delete restrict,
  check (
    object_name ~ ('^' || workspace_id::text || '/[a-z][a-z0-9_.-]{2,100}/' ||
      asset_id::text || '/' || id::text || '/source$')
    and object_name !~ '(^|/)\.\.(/|$)'
    and position(chr(92) in object_name) = 0
  )
);

create index asset_versions_workspace_asset_idx
  on public.asset_versions (workspace_id, asset_id, version_number desc);
create index asset_versions_content_idx
  on public.asset_versions (workspace_id, content_sha256);

create table public.media_probes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  asset_version_id uuid not null,
  probe_version text not null check (char_length(probe_version) between 1 and 100),
  probe_sha256 text not null check (probe_sha256 ~ '^[a-f0-9]{64}$'),
  width integer check (width is null or width between 1 and 32768),
  height integer check (height is null or height between 1 and 32768),
  duration_ms bigint check (duration_ms is null or duration_ms between 1 and 1800000),
  frame_count bigint check (frame_count is null or frame_count between 1 and 36000),
  streams jsonb not null check (
    jsonb_typeof(streams) = 'array' and jsonb_array_length(streams) between 1 and 16
    and pg_column_size(streams) <= 32768
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (asset_version_id, probe_version),
  unique (workspace_id, id),
  foreign key (workspace_id, asset_version_id)
    references public.asset_versions(workspace_id, id) on delete restrict
);

create table public.asset_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  subject_kind text not null check (subject_kind in (
    'configuration_candidate','preflight_stage','character_version','location_version',
    'shot_version','narration_version'
  )),
  subject_id uuid not null,
  reference_role text not null check (
    reference_role ~ '^[a-z][a-z0-9_.-]{2,100}$'
  ),
  asset_version_id uuid not null,
  reference_hash text not null check (reference_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (subject_kind, subject_id, reference_role, asset_version_id),
  unique (workspace_id, id),
  foreign key (workspace_id, asset_version_id)
    references public.asset_versions(workspace_id, id) on delete restrict
);

create trigger quarantine_assets_updated_at
before update on private.quarantine_assets
for each row execute function private.set_updated_at();
create trigger remote_fetch_requests_immutable
before update or delete on private.remote_fetch_requests
for each row execute function private.reject_mutation();
create trigger remote_fetch_allowlists_immutable
before update or delete on private.remote_fetch_allowlist_versions
for each row execute function private.reject_mutation();
create trigger remote_fetch_allowlist_entries_immutable
before update or delete on private.remote_fetch_allowlist_entries
for each row execute function private.reject_mutation();
create trigger ingest_attestations_immutable
before update or delete on private.media_ingest_attestations
for each row execute function private.reject_mutation();
create trigger assets_immutable
before update or delete on public.assets
for each row execute function private.reject_mutation();
create trigger asset_versions_immutable
before update or delete on public.asset_versions
for each row execute function private.reject_mutation();
create trigger media_probes_immutable
before update or delete on public.media_probes
for each row execute function private.reject_mutation();
create trigger asset_references_immutable
before update or delete on public.asset_references
for each row execute function private.reject_mutation();

create or replace function public.command_activate_remote_fetch_allowlist(
  p_environment text,
  p_fetch_class text,
  p_manifest_hash text,
  p_exact_hosts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare allowlist_id uuid; next_version integer; host text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_fetch_class not in ('provider_output','research_reference')
    or p_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_exact_hosts) <> 'array'
    or jsonb_array_length(p_exact_hosts) not between 1 and 64
    or pg_column_size(p_exact_hosts) > 16384
  then raise exception 'remote fetch allowlist is invalid' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_exact_hosts) h
    where h <> lower(h) or h !~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
      or h ~ '\.$'
  ) then raise exception 'remote fetch hostname is invalid' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'remote-fetch-allowlist:' || p_environment || ':' || p_fetch_class, 0
    )
  );
  select coalesce(max(version_number), 0) + 1 into next_version
  from private.remote_fetch_allowlist_versions
  where environment = p_environment and fetch_class = p_fetch_class;
  -- Immutable active versions are superseded by inserting a withdrawn copy is
  -- intentionally not supported. A changed allowlist requires an explicit
  -- incident/deployment migration until Phase 4 configuration commands land.
  if exists (
    select 1 from private.remote_fetch_allowlist_versions
    where environment = p_environment and fetch_class = p_fetch_class
      and state = 'active'
  ) then raise exception 'active remote fetch allowlist already exists'
    using errcode = '55000'; end if;
  insert into private.remote_fetch_allowlist_versions (
    environment, fetch_class, version_number, manifest_hash, state
  ) values (
    p_environment, p_fetch_class, next_version, p_manifest_hash, 'active'
  ) returning id into allowlist_id;
  for host in select distinct value from jsonb_array_elements_text(p_exact_hosts)
  loop
    insert into private.remote_fetch_allowlist_entries (
      allowlist_version_id, exact_hostname
    ) values (allowlist_id, host);
  end loop;
  return allowlist_id;
end;
$$;

create or replace function public.command_record_remote_fetch(
  p_workspace_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_fetch_class text,
  p_exact_hostname text,
  p_allowlist_version_id uuid,
  p_canonical_url_hash text,
  p_allowlist_version_hash text,
  p_resolved_address_hashes jsonb,
  p_redirect_count integer,
  p_maximum_bytes bigint,
  p_timeout_ms integer,
  p_status text,
  p_response_sha256 text,
  p_safe_failure_class text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare fetch_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.preflight_stage_attempts a
    join public.preflight_stage_runs s on s.id = a.preflight_stage_run_id
    join public.preflight_runs r on r.id = a.preflight_run_id
    where a.workspace_id = p_workspace_id and a.preflight_run_id = p_preflight_run_id
      and a.id = p_stage_attempt_id
      and a.state in ('running','waiting_external')
      and s.highest_fencing_token = a.fencing_token
      and r.authority_epoch = a.authority_epoch
      and r.state in ('running','waiting_external')
  ) then raise exception 'remote fetch authority is stale' using errcode = '40001'; end if;
  if not exists (
    select 1
    from private.remote_fetch_allowlist_versions v
    join private.remote_fetch_allowlist_entries e
      on e.allowlist_version_id = v.id
    where v.id = p_allowlist_version_id
      and v.fetch_class = p_fetch_class
      and v.state = 'active'
      and e.exact_hostname = p_exact_hostname
      and v.manifest_hash = p_allowlist_version_hash
  ) then raise exception 'remote fetch host is not allowlisted' using errcode = '42501'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_resolved_address_hashes) h
    where h !~ '^[a-f0-9]{64}$'
  ) then raise exception 'resolved address evidence is invalid' using errcode = '22023'; end if;
  insert into private.remote_fetch_requests (
    workspace_id, preflight_run_id, stage_attempt_id, fetch_class,
    allowlist_version_id,
    exact_hostname, canonical_url_hash, allowlist_version_hash,
    resolved_address_hashes, redirect_count, maximum_bytes, timeout_ms,
    status, response_sha256, safe_failure_class, completed_at
  ) values (
    p_workspace_id, p_preflight_run_id, p_stage_attempt_id, p_fetch_class,
    p_allowlist_version_id,
    p_exact_hostname, p_canonical_url_hash, p_allowlist_version_hash,
    p_resolved_address_hashes, p_redirect_count, p_maximum_bytes, p_timeout_ms,
    p_status, p_response_sha256, p_safe_failure_class,
    case when p_status <> 'authorized' then statement_timestamp() else null end
  ) returning id into fetch_id;
  return fetch_id;
end;
$$;

create or replace function public.command_register_quarantine_asset(
  p_quarantine_version_id uuid,
  p_workspace_id uuid,
  p_stable_asset_id uuid,
  p_provider_request_id uuid,
  p_remote_fetch_request_id uuid,
  p_source_kind text,
  p_object_name text,
  p_display_filename text,
  p_declared_mime text,
  p_byte_length bigint,
  p_source_sha256 text,
  p_provenance_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare initial_state private.quarantine_asset_state := 'quarantined';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_object_name <> p_workspace_id::text || '/quarantine/' ||
      p_stable_asset_id::text || '/' || p_quarantine_version_id::text || '/source'
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'quarantine' and o.name = p_object_name
    )
  then raise exception 'exact quarantine object is required' using errcode = '55000'; end if;
  if p_source_kind = 'provider_output' then
    if not exists (
      select 1 from private.provider_requests request
      where request.id = p_provider_request_id
        and request.workspace_id = p_workspace_id
    ) then raise exception 'provider request not found' using errcode = 'P0002'; end if;
    if exists (
      select 1 from private.provider_requests request
      where request.id = p_provider_request_id and request.state in (
        'succeeded','failed_retryable','failed_terminal','canceled'
      )
    ) then initial_state := 'late_evidence'; end if;
  end if;
  insert into private.quarantine_assets (
    id, workspace_id, stable_asset_id, provider_request_id,
    remote_fetch_request_id, source_kind, bucket_id, object_name,
    display_filename, declared_mime, byte_length, source_sha256,
    provenance_hash, state, completed_at
  ) values (
    p_quarantine_version_id, p_workspace_id, p_stable_asset_id,
    p_provider_request_id, p_remote_fetch_request_id, p_source_kind,
    'quarantine', p_object_name, p_display_filename, p_declared_mime,
    p_byte_length, p_source_sha256, p_provenance_hash, initial_state,
    case when initial_state = 'late_evidence' then statement_timestamp() else null end
  );
  return jsonb_build_object(
    'ok', true, 'quarantineAssetVersionId', p_quarantine_version_id,
    'state', initial_state
  );
end;
$$;

create or replace function public.command_record_ingest_attestation(
  p_workspace_id uuid,
  p_quarantine_asset_version_id uuid,
  p_policy_version_id uuid,
  p_scan_engine text,
  p_scan_version text,
  p_malware_status text,
  p_parser_sandboxed boolean,
  p_metadata_stripped boolean,
  p_magic_mime text,
  p_reencoded_mime text,
  p_decompressed_bytes bigint,
  p_width integer,
  p_height integer,
  p_duration_ms bigint,
  p_frame_count bigint,
  p_probe_sha256 text,
  p_output_sha256 text,
  p_output_byte_length bigint,
  p_scanner_task_id text,
  p_scanner_task_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare attestation_id uuid; quarantine private.quarantine_assets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  select * into quarantine from private.quarantine_assets
  where id = p_quarantine_asset_version_id and workspace_id = p_workspace_id
    and state in ('quarantined','scanning') for update;
  if not found then raise exception 'quarantine asset is not scannable' using errcode = 'P0002'; end if;
  if p_magic_mime <> quarantine.declared_mime
    or p_magic_mime <> p_reencoded_mime
    or p_malware_status <> 'clean'
    or not p_parser_sandboxed or not p_metadata_stripped
  then
    update private.quarantine_assets set state = 'rejected',
      completed_at = statement_timestamp() where id = quarantine.id;
    raise exception 'media ingest attestation failed closed' using errcode = '23514';
  end if;
  insert into private.media_ingest_attestations (
    workspace_id, quarantine_asset_version_id, schema_version,
    policy_version_id, scan_engine, scan_version, malware_status,
    parser_sandboxed, metadata_stripped, magic_mime, reencoded_mime,
    decompressed_bytes, width, height, duration_ms, frame_count,
    probe_sha256, output_sha256, output_byte_length, scanner_task_id,
    scanner_task_version
  ) values (
    p_workspace_id, quarantine.id, 'genie.ingest-attestation.v1',
    p_policy_version_id, p_scan_engine, p_scan_version, p_malware_status,
    p_parser_sandboxed, p_metadata_stripped, p_magic_mime, p_reencoded_mime,
    p_decompressed_bytes, p_width, p_height, p_duration_ms, p_frame_count,
    p_probe_sha256, p_output_sha256, p_output_byte_length, p_scanner_task_id,
    p_scanner_task_version
  ) returning id into attestation_id;
  update private.quarantine_assets set state = 'scanning' where id = quarantine.id;
  return attestation_id;
end;
$$;

create or replace function public.command_promote_quarantine_asset(
  p_workspace_id uuid,
  p_quarantine_asset_version_id uuid,
  p_ingest_attestation_id uuid,
  p_asset_kind text,
  p_asset_version_id uuid,
  p_final_object_name text,
  p_storage_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare quarantine private.quarantine_assets%rowtype;
  attestation private.media_ingest_attestations%rowtype;
  version_number integer;
  provider_request private.provider_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('asset-promote:' || p_quarantine_asset_version_id::text, 0)
  );
  select * into quarantine from private.quarantine_assets
  where id = p_quarantine_asset_version_id and workspace_id = p_workspace_id
  for update;
  select * into attestation from private.media_ingest_attestations
  where id = p_ingest_attestation_id
    and quarantine_asset_version_id = quarantine.id;
  if quarantine.state <> 'scanning' or attestation.id is null
    or attestation.malware_status <> 'clean'
    or not attestation.parser_sandboxed or not attestation.metadata_stripped
    or attestation.magic_mime <> quarantine.declared_mime
    or attestation.reencoded_mime <> attestation.magic_mime
    or p_final_object_name <> p_workspace_id::text || '/' || p_asset_kind || '/' ||
      quarantine.stable_asset_id::text || '/' || p_asset_version_id::text || '/source'
    or not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'workspace-media' and o.name = p_final_object_name
    )
  then raise exception 'asset promotion evidence is incomplete' using errcode = '55000'; end if;
  if quarantine.provider_request_id is not null then
    select * into provider_request from private.provider_requests
    where id = quarantine.provider_request_id for update;
    if provider_request.state not in ('submitted','accepted','polling')
      or not exists (
        select 1
        from public.preflight_stage_attempts a
        join public.preflight_stage_runs s on s.id = a.preflight_stage_run_id
        join public.preflight_runs r on r.id = a.preflight_run_id
        join private.provider_request_quote_claims claim
          on claim.provider_request_id = provider_request.id
        where a.id = provider_request.stage_attempt_id
          and a.state in ('running','waiting_external')
          and a.fencing_token = claim.fencing_token
          and a.authority_epoch = claim.authority_epoch
          and s.highest_fencing_token = a.fencing_token
          and r.authority_epoch = a.authority_epoch
          and r.state in ('running','waiting_external')
      )
    then raise exception 'provider output authority is stale' using errcode = '40001'; end if;
  end if;
  insert into public.assets (id, workspace_id, asset_kind)
  values (quarantine.stable_asset_id, p_workspace_id, p_asset_kind)
  on conflict (id) do nothing;
  if not exists (
    select 1 from public.assets a where a.id = quarantine.stable_asset_id
      and a.workspace_id = p_workspace_id and a.asset_kind = p_asset_kind
  ) then raise exception 'stable asset identity mismatch' using errcode = '23503'; end if;
  select coalesce(max(v.version_number), 0) + 1 into version_number
  from public.asset_versions v where v.asset_id = quarantine.stable_asset_id;
  insert into public.asset_versions (
    id, workspace_id, asset_id, version_number,
    source_quarantine_version_id, bucket_id, object_name, storage_version,
    content_sha256, media_mime, byte_length, policy_version_id,
    provenance_hash
  ) values (
    p_asset_version_id, p_workspace_id, quarantine.stable_asset_id,
    version_number, quarantine.id, 'workspace-media', p_final_object_name,
    p_storage_version, attestation.output_sha256, attestation.reencoded_mime,
    attestation.output_byte_length, attestation.policy_version_id,
    quarantine.provenance_hash
  );
  insert into public.media_probes (
    workspace_id, asset_version_id, probe_version, probe_sha256,
    width, height, duration_ms, frame_count, streams
  ) values (
    p_workspace_id, p_asset_version_id, attestation.scanner_task_version,
    attestation.probe_sha256, attestation.width, attestation.height,
    attestation.duration_ms, attestation.frame_count,
    jsonb_build_array(jsonb_build_object(
      'mime', attestation.reencoded_mime,
      'metadataStripped', true,
      'parserSandboxed', true
    ))
  );
  update private.quarantine_assets
  set state = 'promoted', completed_at = statement_timestamp()
  where id = quarantine.id;
  if provider_request.id is not null then
    update private.provider_requests
    set state = 'succeeded', completed_at = statement_timestamp(),
        aggregate_version = aggregate_version + 1
    where id = provider_request.id;
  end if;
  return jsonb_build_object(
    'ok', true, 'assetId', quarantine.stable_asset_id,
    'assetVersionId', p_asset_version_id, 'versionNumber', version_number,
    'providerRequestId', quarantine.provider_request_id
  );
end;
$$;

alter table public.assets enable row level security;
alter table public.asset_versions enable row level security;
alter table public.media_probes enable row level security;
alter table public.asset_references enable row level security;

create policy assets_member_select on public.assets
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy asset_versions_member_select on public.asset_versions
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy media_probes_member_select on public.media_probes
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy asset_references_member_select on public.asset_references
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

drop policy if exists workspace_media_member_select on storage.objects;
create policy workspace_media_member_select on storage.objects
for select to authenticated
using (
  bucket_id = 'workspace-media'
  and private.can_access_storage_object(private.storage_workspace_id(name), name)
  and storage.allow_any_operation(array[
    'storage.object.list','storage.object.list_v2',
    'storage.object.get_authenticated','object.get_authenticated_info',
    'object.head_authenticated_info'
  ])
);
-- Quarantine deliberately has no authenticated policy. Only trusted service
-- workers with one-object grants can read or write it.

revoke all on table public.assets, public.asset_versions, public.media_probes,
  public.asset_references from public, anon, authenticated;
grant select on table public.assets, public.asset_versions, public.media_probes,
  public.asset_references to authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

alter table private.provider_late_completions
  add constraint provider_late_quarantine_asset_fk
  foreign key (quarantined_asset_id)
  references private.quarantine_assets(id) on delete restrict;

revoke all on function public.command_activate_remote_fetch_allowlist(
  text,text,text,jsonb
), public.command_record_remote_fetch(
  uuid,uuid,uuid,text,text,uuid,text,text,jsonb,integer,bigint,integer,text,text,text
), public.command_register_quarantine_asset(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,text
), public.command_record_ingest_attestation(
  uuid,uuid,uuid,text,text,text,boolean,boolean,text,text,bigint,integer,integer,
  bigint,bigint,text,text,bigint,text,text
), public.command_promote_quarantine_asset(uuid,uuid,uuid,text,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.command_activate_remote_fetch_allowlist(
  text,text,text,jsonb
), public.command_record_remote_fetch(
  uuid,uuid,uuid,text,text,uuid,text,text,jsonb,integer,bigint,integer,text,text,text
), public.command_register_quarantine_asset(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,bigint,text,text
), public.command_record_ingest_attestation(
  uuid,uuid,uuid,text,text,text,boolean,boolean,text,text,bigint,integer,integer,
  bigint,bigint,text,text,bigint,text,text
), public.command_promote_quarantine_asset(uuid,uuid,uuid,text,uuid,text,text)
to service_role;

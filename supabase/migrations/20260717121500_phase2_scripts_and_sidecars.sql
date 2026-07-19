-- Phase 2 / 0010: exact script bytes, processing representation, coordinate
-- maps, immutable lock evidence, and additive sidecars.

create type public.script_source_kind as enum ('browser_text', 'uploaded_text');
create type public.script_annotation_kind as enum (
  'claim',
  'pronunciation',
  'visual_beat',
  'performance',
  'policy'
);

create or replace function private.verify_nonnegative_integer_tuple(
  p_values jsonb,
  p_expected_length integer
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  item_text text;
  item_position integer;
begin
  if p_expected_length < 0
    or jsonb_typeof(p_values) <> 'array'
    or jsonb_array_length(p_values) <> p_expected_length
  then
    return false;
  end if;

  if p_expected_length > 0 then
    for item_position in 0..p_expected_length - 1 loop
      if jsonb_typeof(p_values -> item_position) <> 'number' then
        return false;
      end if;
      item_text := (p_values -> item_position)::text;
      if item_text !~ '^(0|[1-9][0-9]{0,9})$'
        or char_length(item_text) > 10
      then
        return false;
      end if;
      if item_text::numeric > 2147483647 then
        return false;
      end if;
    end loop;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function private.verify_nonnegative_integer_tuple(
  jsonb,integer
) from public, anon, authenticated;

create or replace function private.verify_text_coordinate_index(
  p_index jsonb,
  p_text text,
  p_utf16_code_units integer,
  p_scalar_count integer,
  p_grapheme_count integer
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  actual_grapheme_end integer;
  expected_utf16_index jsonb;
  expected_utf8_index jsonb;
  grapheme_position integer;
  previous_grapheme_end integer := 0;
begin
  if p_scalar_count < 1
    or p_grapheme_count < 1
    or p_grapheme_count > p_scalar_count
    or p_utf16_code_units < p_scalar_count
    or jsonb_typeof(p_index) <> 'array'
    or jsonb_array_length(p_index) <> 3
    or not private.verify_nonnegative_integer_tuple(
      p_index -> 0,
      p_scalar_count + 1
    )
    or not private.verify_nonnegative_integer_tuple(
      p_index -> 1,
      p_scalar_count + 1
    )
    or not private.verify_nonnegative_integer_tuple(
      p_index -> 2,
      p_grapheme_count
    )
  then
    return false;
  end if;

  select
    jsonb_build_array(0) || pg_catalog.jsonb_agg(
      scalar_row.utf16_end order by scalar_row.ordinal
    ),
    jsonb_build_array(0) || pg_catalog.jsonb_agg(
      scalar_row.utf8_end order by scalar_row.ordinal
    )
    into expected_utf16_index, expected_utf8_index
  from (
    select
      scalar_item.ordinal,
      pg_catalog.sum(
        case when pg_catalog.ascii(scalar_item.value) > 65535 then 2 else 1 end
      ) over (order by scalar_item.ordinal) as utf16_end,
      pg_catalog.sum(octet_length(convert_to(scalar_item.value, 'UTF8')))
        over (order by scalar_item.ordinal) as utf8_end
    from pg_catalog.regexp_split_to_table(p_text, '')
      with ordinality as scalar_item(value, ordinal)
  ) scalar_row;
  if p_index -> 0 <> expected_utf16_index
    or p_index -> 1 <> expected_utf8_index
    or (p_index -> 0 ->> p_scalar_count)::integer <> p_utf16_code_units
    or (p_index -> 1 ->> p_scalar_count)::integer <>
      octet_length(convert_to(p_text, 'UTF8'))
  then
    return false;
  end if;

  for grapheme_position in 0..p_grapheme_count - 1 loop
    actual_grapheme_end := (p_index -> 2 ->> grapheme_position)::integer;
    if actual_grapheme_end <= previous_grapheme_end
      or actual_grapheme_end > p_scalar_count
    then
      return false;
    end if;
    previous_grapheme_end := actual_grapheme_end;
  end loop;
  if previous_grapheme_end <> p_scalar_count then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function private.verify_text_coordinate_index(
  jsonb,text,integer,integer,integer
) from public, anon, authenticated;

create or replace function private.verify_script_coordinate_map_envelope(
  p_coordinate_map jsonb,
  p_raw_text text,
  p_processing_text text,
  p_raw_utf16_code_units integer,
  p_raw_scalar_count integer,
  p_raw_grapheme_count integer,
  p_processing_utf16_code_units integer,
  p_processing_scalar_count integer,
  p_processing_grapheme_count integer
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  expected_reason integer;
  line_normalized_piece text;
  normalized_piece text;
  previous_processing_grapheme_end integer := 0;
  previous_raw_grapheme_end integer := 0;
  processing_grapheme_end integer;
  processing_grapheme_start integer;
  processing_piece text;
  processing_scalar_end integer;
  processing_scalar_start integer;
  raw_grapheme_end integer;
  raw_grapheme_start integer;
  raw_piece text;
  raw_scalar_end integer;
  raw_scalar_start integer;
  reason integer;
  segment_count integer;
  segment_item jsonb;
  segment_position integer;
begin
  if p_raw_scalar_count < 1
    or p_processing_scalar_count < 1
    or p_raw_grapheme_count < 1
    or p_processing_grapheme_count < 1
    or p_raw_grapheme_count > p_raw_scalar_count
    or p_processing_grapheme_count > p_processing_scalar_count
    or p_raw_utf16_code_units < p_raw_scalar_count
    or p_processing_utf16_code_units < p_processing_scalar_count
    or octet_length(convert_to(p_raw_text, 'UTF8')) > 8192
    or pg_column_size(p_coordinate_map) > 8388608
    or jsonb_typeof(p_coordinate_map) <> 'object'
  then
    return false;
  end if;

  if (select count(*) from pg_catalog.jsonb_object_keys(p_coordinate_map)) <> 5
    or not (p_coordinate_map ?& array['v','c','r','p','s'])
    or jsonb_typeof(p_coordinate_map -> 'v') <> 'number'
    or (p_coordinate_map -> 'v')::text <> '2'
    or jsonb_typeof(p_coordinate_map -> 'c') <> 'string'
    or p_coordinate_map ->> 'c' <> 'zero-based-half-open'
    or jsonb_typeof(p_coordinate_map -> 'r') <> 'array'
    or jsonb_typeof(p_coordinate_map -> 'p') <> 'array'
    or jsonb_typeof(p_coordinate_map -> 's') <> 'array'
    or jsonb_array_length(p_coordinate_map -> 'r') <> 3
    or jsonb_array_length(p_coordinate_map -> 'p') <> 3
    or jsonb_array_length(p_coordinate_map -> 's') < 1
    or not private.verify_text_coordinate_index(
      p_coordinate_map -> 'r',
      p_raw_text,
      p_raw_utf16_code_units,
      p_raw_scalar_count,
      p_raw_grapheme_count
    )
    or not private.verify_text_coordinate_index(
      p_coordinate_map -> 'p',
      p_processing_text,
      p_processing_utf16_code_units,
      p_processing_scalar_count,
      p_processing_grapheme_count
    )
  then
    return false;
  end if;

  segment_count := jsonb_array_length(p_coordinate_map -> 's');
  for segment_position in 0..segment_count - 1 loop
    segment_item := p_coordinate_map -> 's' -> segment_position;
    if not private.verify_nonnegative_integer_tuple(segment_item, 5) then
      return false;
    end if;

    reason := (segment_item ->> 0)::integer;
    raw_grapheme_start := (segment_item ->> 1)::integer;
    raw_grapheme_end := (segment_item ->> 2)::integer;
    processing_grapheme_start := (segment_item ->> 3)::integer;
    processing_grapheme_end := (segment_item ->> 4)::integer;

    if reason > 4
      or raw_grapheme_start <> previous_raw_grapheme_end
      or processing_grapheme_start <> previous_processing_grapheme_end
      or raw_grapheme_start >= raw_grapheme_end
      or processing_grapheme_start >= processing_grapheme_end
      or raw_grapheme_end > p_raw_grapheme_count
      or processing_grapheme_end > p_processing_grapheme_count
    then
      return false;
    end if;

    -- Bounds are proven above before any JSON-array position is derived.
    raw_scalar_start := case
      when raw_grapheme_start = 0 then 0
      else (
        p_coordinate_map #>> array[
          'r','2',(raw_grapheme_start - 1)::text
        ]
      )::integer
    end;
    raw_scalar_end := (
      p_coordinate_map #>> array['r','2',(raw_grapheme_end - 1)::text]
    )::integer;
    processing_scalar_start := case
      when processing_grapheme_start = 0 then 0
      else (
        p_coordinate_map #>> array[
          'p','2',(processing_grapheme_start - 1)::text
        ]
      )::integer
    end;
    processing_scalar_end := (
      p_coordinate_map #>> array[
        'p','2',(processing_grapheme_end - 1)::text
      ]
    )::integer;

    raw_piece := pg_catalog.substring(
      p_raw_text,
      raw_scalar_start + 1,
      raw_scalar_end - raw_scalar_start
    );
    processing_piece := pg_catalog.substring(
      p_processing_text,
      processing_scalar_start + 1,
      processing_scalar_end - processing_scalar_start
    );
    line_normalized_piece := pg_catalog.replace(
      pg_catalog.replace(raw_piece, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    );
    normalized_piece := normalize(line_normalized_piece, NFC);
    if processing_piece <> normalized_piece then
      return false;
    end if;

    expected_reason := case
      when raw_piece <> line_normalized_piece
        and line_normalized_piece <> normalized_piece then 3
      when raw_piece <> line_normalized_piece then 1
      when line_normalized_piece <> normalized_piece then 2
      else 0
    end;
    if reason = 4 then
      if segment_count <> 1
        or raw_grapheme_start <> 0
        or raw_grapheme_end <> p_raw_grapheme_count
        or processing_grapheme_start <> 0
        or processing_grapheme_end <> p_processing_grapheme_count
      then
        return false;
      end if;
    elsif reason <> expected_reason then
      return false;
    end if;

    previous_raw_grapheme_end := raw_grapheme_end;
    previous_processing_grapheme_end := processing_grapheme_end;
  end loop;

  if previous_raw_grapheme_end <> p_raw_grapheme_count
    or previous_processing_grapheme_end <> p_processing_grapheme_count
  then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$$;

revoke all on function private.verify_script_coordinate_map_envelope(
  jsonb,text,text,integer,integer,integer,integer,integer,integer
) from public, anon, authenticated;

create table private.script_coordinate_attestations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  episode_id uuid not null,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  raw_utf8_sha256 text not null check (raw_utf8_sha256 ~ '^[a-f0-9]{64}$'),
  processing_utf8_sha256 text not null
    check (processing_utf8_sha256 ~ '^[a-f0-9]{64}$'),
  coordinate_map_sha256 text not null check (coordinate_map_sha256 ~ '^[a-f0-9]{64}$'),
  runtime_evidence_sha256 text not null check (runtime_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete cascade
);

create index script_coordinate_attestations_expiry_idx
  on private.script_coordinate_attestations (expires_at);
create index script_coordinate_attestations_actor_idx
  on private.script_coordinate_attestations (
    actor_user_id
  );
create index script_coordinate_attestations_episode_idx
  on private.script_coordinate_attestations (workspace_id, episode_id);
create index script_coordinate_attestations_request_idx
  on private.script_coordinate_attestations (
    workspace_id,
    episode_id,
    actor_user_id,
    request_hash,
    raw_utf8_sha256,
    processing_utf8_sha256,
    coordinate_map_sha256,
    runtime_evidence_sha256
  );

revoke all on table private.script_coordinate_attestations
from public, anon, authenticated;

create or replace function public.attest_script_coordinate_map(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_actor_user_id uuid,
  p_request_hash text,
  p_raw_utf8_sha256 text,
  p_processing_utf8_sha256 text,
  p_coordinate_map jsonb,
  p_runtime_evidence jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  attestation_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_request_hash !~ '^[a-f0-9]{64}$'
    or p_raw_utf8_sha256 !~ '^[a-f0-9]{64}$'
    or p_processing_utf8_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid script attestation hash' using errcode = '22023';
  end if;
  if pg_column_size(p_coordinate_map) > 8388608
    or pg_column_size(p_runtime_evidence) > 4096
  then
    raise exception 'script attestation envelope is too large' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.episodes e
    join public.memberships m
      on m.workspace_id = e.workspace_id
     and m.user_id = p_actor_user_id
     and m.status = 'active'
    join public.workspaces w
      on w.id = e.workspace_id
     and w.state = 'active'
    where e.workspace_id = p_workspace_id
      and e.id = p_episode_id
      and e.archived_at is null
  ) then
    raise exception 'active Episode actor not found' using errcode = 'P0002';
  end if;

  delete from private.script_coordinate_attestations
  where expires_at <= statement_timestamp();

  insert into private.script_coordinate_attestations (
    workspace_id,
    episode_id,
    actor_user_id,
    request_hash,
    raw_utf8_sha256,
    processing_utf8_sha256,
    coordinate_map_sha256,
    runtime_evidence_sha256,
    expires_at
  )
  values (
    p_workspace_id,
    p_episode_id,
    p_actor_user_id,
    p_request_hash,
    p_raw_utf8_sha256,
    p_processing_utf8_sha256,
    encode(
      extensions.digest(convert_to(p_coordinate_map::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    encode(
      extensions.digest(convert_to(p_runtime_evidence::text, 'UTF8'), 'sha256'),
      'hex'
    ),
    statement_timestamp() + interval '2 minutes'
  )
  returning id into attestation_id;
  return attestation_id;
end;
$$;

revoke all on function public.attest_script_coordinate_map(
  uuid,uuid,uuid,text,text,text,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.attest_script_coordinate_map(
  uuid,uuid,uuid,text,text,text,jsonb,jsonb
) to service_role;

create or replace function public.revoke_script_coordinate_attestation(
  p_attestation_id uuid,
  p_actor_user_id uuid,
  p_request_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  delete from private.script_coordinate_attestations
  where id = p_attestation_id
    and actor_user_id = p_actor_user_id
    and request_hash = p_request_hash
  returning id into deleted_id;
  return deleted_id is not null;
end;
$$;

revoke all on function public.revoke_script_coordinate_attestation(
  uuid,uuid,text
) from public, anon, authenticated;
grant execute on function public.revoke_script_coordinate_attestation(
  uuid,uuid,text
) to service_role;

create or replace function private.estimate_hindi_narration_duration_v1(
  p_processing_text text
)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  clause_marks integer;
  line_breaks integer;
  normalized_text text := normalize(
    pg_catalog.replace(
      pg_catalog.replace(p_processing_text, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    NFC
  );
  performance_breaths integer;
  sentence_marks integer;
  word_count integer;
begin
  select count(*)::integer into word_count
  from pg_catalog.regexp_split_to_table(
    pg_catalog.btrim(normalized_text),
    E'\\s+'
  ) as token
  where token <> '';

  sentence_marks := pg_catalog.char_length(
    pg_catalog.regexp_replace(normalized_text, '[^.!?।॥]', '', 'g')
  );
  clause_marks := pg_catalog.char_length(
    pg_catalog.regexp_replace(normalized_text, '[^,;:—–]', '', 'g')
  );
  line_breaks := pg_catalog.char_length(normalized_text) -
    pg_catalog.char_length(pg_catalog.replace(normalized_text, E'\n', ''));
  performance_breaths := greatest(
    pg_catalog.ceil(word_count::numeric / 18)::integer - 1,
    0
  );

  return pg_catalog.round(
    greatest(word_count, 1)::numeric * 60 / 125 +
      sentence_marks::numeric * 0.42 +
      clause_marks::numeric * 0.18 +
      line_breaks::numeric * 0.25 +
      performance_breaths::numeric * 0.32,
    3
  );
end;
$$;

revoke all on function private.estimate_hindi_narration_duration_v1(text)
from public, anon, authenticated;

create table public.script_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  episode_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  source_kind public.script_source_kind not null,
  raw_text text not null check (char_length(raw_text) > 0 and char_length(btrim(raw_text)) > 0),
  raw_utf8 bytea not null
    constraint script_revisions_raw_utf8_size_check
    check (octet_length(raw_utf8) between 1 and 8192),
  raw_utf8_sha256 text not null check (raw_utf8_sha256 ~ '^[a-f0-9]{64}$'),
  processing_text text not null,
  processing_utf8_sha256 text not null check (processing_utf8_sha256 ~ '^[a-f0-9]{64}$'),
  processing_profile text not null check (processing_profile = 'genie-script-processing.v1'),
  coordinate_map jsonb not null,
  coordinate_map_verifier text not null default 'postgres-structural-v2'
    constraint script_revisions_coordinate_map_verifier_v2_check
    check (coordinate_map_verifier = 'postgres-structural-v2'),
  runtime_evidence jsonb not null,
  source_encoding_evidence jsonb not null default '{"kind":"browser-utf16"}'::jsonb,
  raw_utf16_code_units integer not null check (raw_utf16_code_units > 0),
  raw_scalar_count integer not null check (raw_scalar_count > 0),
  raw_grapheme_count integer not null check (raw_grapheme_count > 0),
  processing_utf16_code_units integer not null check (processing_utf16_code_units > 0),
  processing_scalar_count integer not null check (processing_scalar_count > 0),
  processing_grapheme_count integer not null check (processing_grapheme_count > 0),
  duration_estimation_profile text not null
    default 'genie-hindi-conversational-expressive-duration.v1'
    check (
      duration_estimation_profile =
        'genie-hindi-conversational-expressive-duration.v1'
    ),
  estimated_duration_seconds numeric(10,3) not null check (estimated_duration_seconds > 0),
  duration_out_of_band boolean not null,
  duration_acknowledged boolean not null,
  uploaded_asset_version_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, episode_id, id),
  unique (workspace_id, episode_id, revision_number),
  unique (episode_id, revision_number),
  unique (episode_id, raw_utf8_sha256),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  check (raw_utf8 = convert_to(raw_text, 'UTF8')),
  check (raw_utf8_sha256 = encode(extensions.digest(raw_utf8, 'sha256'), 'hex')),
  check (
    processing_utf8_sha256 =
      encode(extensions.digest(convert_to(processing_text, 'UTF8'), 'sha256'), 'hex')
  ),
  check (raw_scalar_count = char_length(raw_text)),
  check (processing_scalar_count = char_length(processing_text)),
  constraint script_revisions_coordinate_map_shape_v2_check check ((
    jsonb_typeof(coordinate_map) = 'object'
    and coordinate_map ?& array['v','c','r','p','s']
    and (
      coordinate_map - array['v','c','r','p','s']::text[]
    ) = '{}'::jsonb
    and jsonb_typeof(coordinate_map -> 'v') = 'number'
    and (coordinate_map -> 'v')::text = '2'
    and coordinate_map ->> 'c' = 'zero-based-half-open'
    and jsonb_typeof(coordinate_map -> 'r') = 'array'
    and jsonb_typeof(coordinate_map -> 'p') = 'array'
    and jsonb_typeof(coordinate_map -> 's') = 'array'
    and pg_column_size(coordinate_map) <= 8388608
  ) is true),
  constraint script_revisions_coordinate_map_semantics_v2_check check (
    private.verify_script_coordinate_map_envelope(
      coordinate_map,
      raw_text,
      processing_text,
      raw_utf16_code_units,
      raw_scalar_count,
      raw_grapheme_count,
      processing_utf16_code_units,
      processing_scalar_count,
      processing_grapheme_count
    )
  ),
  check ((
    jsonb_typeof(runtime_evidence) = 'object'
    and runtime_evidence ?& array[
      'nodeVersion',
      'icuVersion',
      'unicodeVersion',
      'graphemeSegmenterProfile',
      'graphemeProbeSha256'
    ]
    and (
      runtime_evidence - array[
        'nodeVersion',
        'icuVersion',
        'unicodeVersion',
        'graphemeSegmenterProfile',
        'graphemeProbeSha256'
      ]::text[]
    ) = '{}'::jsonb
    and jsonb_typeof(runtime_evidence -> 'nodeVersion') = 'string'
    and jsonb_typeof(runtime_evidence -> 'icuVersion') = 'string'
    and jsonb_typeof(runtime_evidence -> 'unicodeVersion') = 'string'
    and jsonb_typeof(runtime_evidence -> 'graphemeSegmenterProfile') = 'string'
    and jsonb_typeof(runtime_evidence -> 'graphemeProbeSha256') = 'string'
    and char_length(runtime_evidence ->> 'nodeVersion') between 1 and 64
    and char_length(runtime_evidence ->> 'icuVersion') between 1 and 64
    and char_length(runtime_evidence ->> 'unicodeVersion') between 1 and 64
    and char_length(runtime_evidence ->> 'graphemeSegmenterProfile')
      between 1 and 160
    and runtime_evidence ->> 'unicodeVersion' = '17.0.0'
    and runtime_evidence ->> 'graphemeSegmenterProfile' =
      'unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47'
    and runtime_evidence ->> 'graphemeProbeSha256' =
      '472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096'
    and pg_column_size(runtime_evidence) <= 4096
  ) is true),
  check ((
    jsonb_typeof(source_encoding_evidence) = 'object'
    and pg_column_size(source_encoding_evidence) <= 16384
  ) is true),
  check (not duration_out_of_band or duration_acknowledged),
  check (
    source_kind = 'browser_text' and uploaded_asset_version_id is null
  )
);

create table public.script_lock_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  episode_id uuid not null,
  script_revision_id uuid not null,
  raw_utf8_sha256 text not null check (raw_utf8_sha256 ~ '^[a-f0-9]{64}$'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_authority_epoch bigint not null check (actor_authority_epoch > 0),
  duration_acknowledged boolean not null,
  command_id uuid not null unique,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (script_revision_id),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, episode_id, script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict
);

create table public.script_annotations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  episode_id uuid not null,
  script_revision_id uuid not null,
  annotation_kind public.script_annotation_kind not null,
  annotation_version integer not null check (annotation_version > 0),
  raw_range jsonb not null,
  processing_range jsonb,
  payload jsonb not null,
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  created_by_kind text not null check (created_by_kind in ('user', 'agent', 'system')),
  created_by_principal text not null check (char_length(created_by_principal) between 3 and 240),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (
    script_revision_id,
    annotation_kind,
    annotation_version,
    payload_hash
  ),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, episode_id, script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict,
  check (
    jsonb_typeof(raw_range) = 'object'
    and raw_range ->> 'convention' = 'zero-based-half-open'
  ),
  check (processing_range is null or jsonb_typeof(processing_range) = 'object'),
  check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 131072)
);

create index script_revisions_created_by_idx
  on public.script_revisions (created_by);
create index script_lock_events_workspace_episode_idx
  on public.script_lock_events (workspace_id, episode_id);
create index script_lock_events_workspace_episode_script_idx
  on public.script_lock_events (workspace_id, episode_id, script_revision_id);
create index script_lock_events_workspace_script_idx
  on public.script_lock_events (workspace_id, script_revision_id);
create index script_lock_events_actor_idx
  on public.script_lock_events (actor_user_id);
create index script_annotations_workspace_episode_idx
  on public.script_annotations (workspace_id, episode_id);
create index script_annotations_workspace_episode_script_idx
  on public.script_annotations (workspace_id, episode_id, script_revision_id);

create trigger script_revisions_immutable
before update or delete on public.script_revisions
for each row execute function private.reject_mutation();

create trigger script_lock_events_immutable
before update or delete on public.script_lock_events
for each row execute function private.reject_mutation();

create trigger script_annotations_immutable
before update or delete on public.script_annotations
for each row execute function private.reject_mutation();

create or replace function public.command_lock_episode_script(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_expected_episode_version bigint,
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
  p_coordinate_attestation_id uuid,
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
  current_version bigint;
  current_workflow_state public.episode_workflow_state;
  estimated_seconds numeric(10,3);
  is_out_of_band boolean;
  next_revision integer;
  response jsonb;
  script_revision_id uuid;
  trusted_attestation_id uuid;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform private.assert_active_session(p_workspace_id);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || actor_id::text || p_idempotency_key,
      0
    )
  );
  response := private.existing_command_response(
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.script.lock',
    p_request_hash
  );
  if response is not null then
    return response;
  end if;

  select e.aggregate_version, e.workflow_state, m.authority_epoch
    into current_version, current_workflow_state, actor_epoch
  from public.episodes e
  join public.memberships m
    on m.workspace_id = e.workspace_id
   and m.user_id = actor_id
   and m.status = 'active'
  where e.workspace_id = p_workspace_id
    and e.id = p_episode_id
    and e.archived_at is null
  for update of e, m;
  if not found then
    raise exception 'Episode not found' using errcode = 'P0002';
  end if;
  if p_expected_episode_version is null
    or current_version is distinct from p_expected_episode_version
  then
    raise exception 'stale Episode version' using errcode = '40001';
  end if;
  if current_workflow_state <> 'draft' then
    raise exception 'Episode script is already locked' using errcode = '55000';
  end if;

  if octet_length(p_raw_utf8) > 8192
    or pg_column_size(p_coordinate_map) > 8388608
  then
    raise exception 'script integrity envelope rejected' using errcode = '22023';
  end if;

  delete from private.script_coordinate_attestations a
  where a.id = p_coordinate_attestation_id
    and a.workspace_id = p_workspace_id
    and a.episode_id = p_episode_id
    and a.actor_user_id = actor_id
    and a.request_hash = p_request_hash
    and a.raw_utf8_sha256 = p_raw_utf8_sha256
    and a.processing_utf8_sha256 = p_processing_utf8_sha256
    and a.coordinate_map_sha256 = encode(
      extensions.digest(convert_to(p_coordinate_map::text, 'UTF8'), 'sha256'),
      'hex'
    )
    and a.runtime_evidence_sha256 = encode(
      extensions.digest(convert_to(p_runtime_evidence::text, 'UTF8'), 'sha256'),
      'hex'
    )
    and a.expires_at > statement_timestamp()
  returning a.id into trusted_attestation_id;
  if trusted_attestation_id is null then
    raise exception 'trusted coordinate-map attestation required'
      using errcode = '42501';
  end if;

  if p_raw_utf8 <> convert_to(p_raw_text, 'UTF8')
    or p_raw_utf8_sha256 <>
      encode(extensions.digest(p_raw_utf8, 'sha256'), 'hex')
    or p_processing_profile <> 'genie-script-processing.v1'
    or p_processing_text <>
      normalize(
        pg_catalog.replace(
          pg_catalog.replace(p_raw_text, E'\r\n', E'\n'),
          E'\r',
          E'\n'
        ),
        NFC
    )
    or p_processing_utf8_sha256 <>
      encode(
        extensions.digest(convert_to(p_processing_text, 'UTF8'), 'sha256'),
        'hex'
      )
    or p_raw_scalar_count <> char_length(p_raw_text)
    or p_processing_scalar_count <> char_length(p_processing_text)
    or p_raw_utf16_code_units < p_raw_scalar_count
    or p_processing_utf16_code_units < p_processing_scalar_count
    or p_raw_grapheme_count > p_raw_scalar_count
    or p_processing_grapheme_count > p_processing_scalar_count
  then
    raise exception 'script integrity envelope rejected' using errcode = '22023';
  end if;

  estimated_seconds := private.estimate_hindi_narration_duration_v1(
    p_processing_text
  );
  is_out_of_band := estimated_seconds < 60 or estimated_seconds > 120;
  if is_out_of_band and not p_duration_acknowledged then
    raise exception 'duration estimate requires acknowledgement' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('script-revision:' || p_episode_id::text, 0)
  );
  select coalesce(max(s.revision_number), 0) + 1 into next_revision
  from public.script_revisions s
  where s.episode_id = p_episode_id;

  begin
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
      raw_utf16_code_units,
      raw_scalar_count,
      raw_grapheme_count,
      processing_utf16_code_units,
      processing_scalar_count,
      processing_grapheme_count,
      estimated_duration_seconds,
      duration_out_of_band,
      duration_acknowledged,
      created_by
    )
    values (
      p_workspace_id,
      p_episode_id,
      next_revision,
      'browser_text',
      p_raw_text,
      p_raw_utf8,
      p_raw_utf8_sha256,
      p_processing_text,
      p_processing_utf8_sha256,
      p_processing_profile,
      p_coordinate_map,
      p_runtime_evidence,
      p_raw_utf16_code_units,
      p_raw_scalar_count,
      p_raw_grapheme_count,
      p_processing_utf16_code_units,
      p_processing_scalar_count,
      p_processing_grapheme_count,
      estimated_seconds,
      is_out_of_band,
      p_duration_acknowledged,
      actor_id
    )
    returning id into script_revision_id;
  exception
    when check_violation then
      raise exception 'script integrity envelope rejected' using errcode = '22023';
  end;

  update public.episodes
  set aggregate_version = aggregate_version + 1,
      workflow_state = 'world_setup'
  where workspace_id = p_workspace_id and id = p_episode_id
  returning aggregate_version into current_version;

  update private.aggregate_versions as aggregate_state
  set current_version = aggregate_state.current_version + 1,
      updated_at = statement_timestamp()
  where aggregate_state.workspace_id = p_workspace_id
    and aggregate_state.aggregate_type = 'episode'
    and aggregate_state.aggregate_id = p_episode_id;

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
  )
  values (
    p_workspace_id,
    p_episode_id,
    script_revision_id,
    p_raw_utf8_sha256,
    actor_id,
    actor_epoch,
    p_duration_acknowledged,
    p_command_id,
    p_correlation_id
  );

  perform private.emit_domain_event(
    p_workspace_id,
    'episode.script_locked.v1',
    'episode',
    p_episode_id,
    current_version,
    p_correlation_id,
    jsonb_build_object(
      'episodeId', p_episode_id,
      'scriptRevisionId', script_revision_id,
      'revisionNumber', next_revision,
      'rawUtf8Sha256', p_raw_utf8_sha256,
      'durationOutOfBand', is_out_of_band
    )
  );

  response := jsonb_build_object(
    'ok', true,
    'episodeId', p_episode_id,
    'scriptRevisionId', script_revision_id,
    'scriptRevisionNumber', next_revision,
    'aggregateVersion', current_version,
    'estimatedDurationSeconds', estimated_seconds,
    'durationOutOfBand', is_out_of_band
  );
  perform private.record_command(
    p_command_id,
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.script.lock',
    'episode',
    p_episode_id,
    p_expected_episode_version,
    p_request_hash,
    response,
    p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id,
    'episode.script.lock',
    'script_revision',
    script_revision_id,
    next_revision,
    p_command_id,
    p_idempotency_key,
    p_correlation_id,
    'allow',
    'accepted',
    null,
    jsonb_build_object(
      'episodeId', p_episode_id,
      'rawUtf8Sha256', p_raw_utf8_sha256
    )
  );
  return response;
end;
$$;

alter table public.script_revisions enable row level security;
alter table public.script_revisions force row level security;
alter table public.script_lock_events enable row level security;
alter table public.script_lock_events force row level security;
alter table public.script_annotations enable row level security;
alter table public.script_annotations force row level security;

create policy script_revisions_read_active_workspace
on public.script_revisions for select
to authenticated
using (private.is_current_session_allowed(workspace_id));

create policy script_lock_events_read_active_workspace
on public.script_lock_events for select
to authenticated
using (private.is_current_session_allowed(workspace_id));

create policy script_annotations_read_active_workspace
on public.script_annotations for select
to authenticated
using (private.is_current_session_allowed(workspace_id));

revoke all on table public.script_revisions from public, anon, authenticated;
revoke all on table public.script_lock_events from public, anon, authenticated;
revoke all on table public.script_annotations from public, anon, authenticated;
grant select on table public.script_revisions to authenticated;
grant select on table public.script_lock_events to authenticated;
grant select on table public.script_annotations to authenticated;

revoke all on function public.command_lock_episode_script(
  uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,
  integer,integer,integer,integer,integer,integer,boolean,
  uuid,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_lock_episode_script(
  uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,
  integer,integer,integer,integer,integer,integer,boolean,
  uuid,uuid,text,text,uuid
) to authenticated;

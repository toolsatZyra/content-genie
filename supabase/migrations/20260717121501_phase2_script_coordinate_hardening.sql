-- Phase 2 / 0010 forward hardening: semantically verify every script
-- coordinate and bind one-time service attestations to exact script hashes.

delete from private.script_coordinate_attestations;

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

alter table public.script_revisions
  add column if not exists duration_estimation_profile text not null
    default 'genie-hindi-conversational-expressive-duration.v1';

alter table public.script_revisions
  drop constraint if exists script_revisions_duration_profile_v1_check,
  add constraint script_revisions_duration_profile_v1_check check (
    duration_estimation_profile =
      'genie-hindi-conversational-expressive-duration.v1'
  ),
  drop constraint if exists script_revisions_runtime_evidence_check,
  drop constraint if exists script_revisions_runtime_evidence_shape_v2_check,
  add constraint script_revisions_runtime_evidence_shape_v2_check check ((
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
  drop constraint if exists script_revisions_runtime_profile_v1_check,
  add constraint script_revisions_runtime_profile_v1_check check ((
    runtime_evidence ->> 'unicodeVersion' = '17.0.0'
    and runtime_evidence ->> 'graphemeSegmenterProfile' =
      'unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47'
    and runtime_evidence ->> 'graphemeProbeSha256' =
      '472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096'
  ) is true);

alter table private.script_coordinate_attestations
  add column if not exists raw_utf8_sha256 text
    check (raw_utf8_sha256 ~ '^[a-f0-9]{64}$'),
  add column if not exists processing_utf8_sha256 text
    check (processing_utf8_sha256 ~ '^[a-f0-9]{64}$');

alter table private.script_coordinate_attestations
  alter column raw_utf8_sha256 set not null,
  alter column processing_utf8_sha256 set not null;

drop index if exists private.script_coordinate_attestations_request_idx;
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

drop function if exists public.attest_script_coordinate_map(
  uuid,uuid,uuid,text,jsonb,jsonb
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

create or replace function private.compact_script_coordinate_map_v2(
  p_legacy_coordinate_map jsonb
)
returns jsonb
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'v', 2,
    'c', 'zero-based-half-open',
    'r', pg_catalog.jsonb_build_array(
      p_legacy_coordinate_map #> '{raw,scalarToUtf16}',
      p_legacy_coordinate_map #> '{raw,scalarToUtf8}',
      (
        select pg_catalog.jsonb_agg(
          (grapheme.item ->> 'scalarEnd')::integer order by grapheme.ordinal
        )
        from pg_catalog.jsonb_array_elements(
          p_legacy_coordinate_map #> '{raw,graphemes}'
        ) with ordinality as grapheme(item, ordinal)
      )
    ),
    'p', pg_catalog.jsonb_build_array(
      p_legacy_coordinate_map #> '{processing,scalarToUtf16}',
      p_legacy_coordinate_map #> '{processing,scalarToUtf8}',
      (
        select pg_catalog.jsonb_agg(
          (grapheme.item ->> 'scalarEnd')::integer order by grapheme.ordinal
        )
        from pg_catalog.jsonb_array_elements(
          p_legacy_coordinate_map #> '{processing,graphemes}'
        ) with ordinality as grapheme(item, ordinal)
      )
    ),
    's', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          case segment.item ->> 'reason'
            when 'identity' then 0
            when 'line-ending' then 1
            when 'nfc' then 2
            when 'line-ending+nfc' then 3
            when 'global-normalization' then 4
          end,
          (segment.item #>> '{raw,graphemeStart}')::integer,
          (segment.item #>> '{raw,graphemeEnd}')::integer,
          (segment.item #>> '{processing,graphemeStart}')::integer,
          (segment.item #>> '{processing,graphemeEnd}')::integer
        ) order by segment.ordinal
      )
      from pg_catalog.jsonb_array_elements(p_legacy_coordinate_map -> 'segments')
        with ordinality as segment(item, ordinal)
    )
  );
$$;

revoke all on function private.compact_script_coordinate_map_v2(jsonb)
from public, anon, authenticated;

alter table public.script_revisions
  add column if not exists script_size_policy_version smallint;

do $$
declare
  constraint_row record;
  actual_constraint_names text[];
  expected_constraint_names text[];
  legacy_constraint_names constant text[] := array[
    'script_revisions_check5',
    'script_revisions_coordinate_map_check',
    'script_revisions_coordinate_map_verifier_check',
    'script_revisions_raw_utf8_check'
  ];
  predecessor_constraint_names constant text[] := array[
    'script_revisions_coordinate_map_check',
    'script_revisions_coordinate_map_semantics_v1_check',
    'script_revisions_coordinate_map_verifier_check',
    'script_revisions_raw_utf8_check'
  ];
begin
  expected_constraint_names := array[
    'script_revisions_coordinate_map_semantics_v2_check',
    'script_revisions_coordinate_map_shape_v2_check',
    'script_revisions_coordinate_map_verifier_v2_check',
    'script_revisions_raw_utf8_size_check'
  ];
  if exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.script_revisions'::regclass
      and conname = 'script_revisions_size_policy_version_check'
  ) then
    expected_constraint_names := expected_constraint_names
      || array['script_revisions_size_policy_version_check'];
    select pg_catalog.array_agg(item order by item)
    into expected_constraint_names
    from pg_catalog.unnest(expected_constraint_names) as item;
  end if;

  select pg_catalog.array_agg(constraint_entry.conname order by constraint_entry.conname)
  into actual_constraint_names
  from pg_catalog.pg_constraint constraint_entry
  where constraint_entry.conrelid = 'public.script_revisions'::regclass
    and constraint_entry.contype = 'c'
    and (
      pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%octet_length(raw_utf8)%'
      or pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%coordinate_map_verifier%'
      or pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%script_size_policy_version%'
      or pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%pg_column_size(coordinate_map)%'
      or pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%verify_script_coordinate_map_envelope%'
    );

  if actual_constraint_names = legacy_constraint_names then
    expected_constraint_names := legacy_constraint_names;
  elsif actual_constraint_names = predecessor_constraint_names then
    expected_constraint_names := predecessor_constraint_names;
  elsif actual_constraint_names is distinct from expected_constraint_names then
    raise exception 'unexpected script revision constraint inventory: %',
      actual_constraint_names using errcode = '55000';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_entry
    where constraint_entry.conrelid = 'public.script_revisions'::regclass
      and constraint_entry.conname = any(expected_constraint_names)
      and case constraint_entry.conname
        when 'script_revisions_raw_utf8_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%octet_length(raw_utf8)%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid) not like '%65536%'
        when 'script_revisions_coordinate_map_verifier_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%coordinate_map_verifier%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%postgres-structural-v1%'
        when 'script_revisions_coordinate_map_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%pg_column_size(coordinate_map)%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid) not like '%8388608%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%zero-based-half-open%'
        when 'script_revisions_check5' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%verify_script_coordinate_map_envelope%'
        when 'script_revisions_coordinate_map_semantics_v1_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%verify_script_coordinate_map_envelope%'
        when 'script_revisions_raw_utf8_size_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%octet_length(raw_utf8)%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid) not like '%8192%'
        when 'script_revisions_size_policy_version_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%script_size_policy_version%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid) not like '%1%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid) not like '%2%'
        when 'script_revisions_coordinate_map_verifier_v2_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%coordinate_map_verifier%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%postgres-structural-v2%'
        when 'script_revisions_coordinate_map_shape_v2_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%pg_column_size(coordinate_map)%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid) not like '%8388608%'
          or pg_catalog.pg_get_constraintdef(constraint_entry.oid) not like '%zero-based-half-open%'
        when 'script_revisions_coordinate_map_semantics_v2_check' then
          pg_catalog.pg_get_constraintdef(constraint_entry.oid)
            not like '%verify_script_coordinate_map_envelope%'
        else true
      end
  ) then
    raise exception 'script revision predecessor constraint definition drifted'
      using errcode = '55000';
  end if;

  for constraint_row in
    select item as conname
    from pg_catalog.unnest(expected_constraint_names) as item
  loop
    execute pg_catalog.format(
      'alter table public.script_revisions drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.script_revisions
  disable trigger script_revisions_immutable;

update public.script_revisions
set coordinate_map = private.compact_script_coordinate_map_v2(coordinate_map),
    coordinate_map_verifier = 'postgres-structural-v2',
    script_size_policy_version = case
      when octet_length(raw_utf8) > 8192 then 1
      else 2
    end
where coordinate_map_verifier = 'postgres-structural-v1';

update public.script_revisions
set script_size_policy_version = 2
where script_size_policy_version is null;

alter table public.script_revisions
  enable trigger script_revisions_immutable;

alter table public.script_revisions
  alter column coordinate_map_verifier set default 'postgres-structural-v2',
  alter column script_size_policy_version set default 2,
  alter column script_size_policy_version set not null,
  add constraint script_revisions_raw_utf8_size_check
    check (
      (
        script_size_policy_version = 1
        and octet_length(raw_utf8) between 8193 and 65536
      )
      or (
        script_size_policy_version = 2
        and octet_length(raw_utf8) between 1 and 8192
      )
    ),
  add constraint script_revisions_size_policy_version_check
    check (script_size_policy_version in (1, 2)),
  add constraint script_revisions_coordinate_map_verifier_v2_check
    check (coordinate_map_verifier = 'postgres-structural-v2'),
  add constraint script_revisions_coordinate_map_shape_v2_check check ((
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
  add constraint script_revisions_coordinate_map_semantics_v2_check check (
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
  );

create or replace function private.enforce_script_revision_insert_size_policy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.script_size_policy_version <> 2
    or octet_length(new.raw_utf8) not between 1 and 8192
  then
    raise exception 'new script revisions require size policy v2 and at most 8192 bytes'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_script_revision_insert_size_policy()
from public, anon, authenticated;

drop trigger if exists script_revisions_insert_size_policy
on public.script_revisions;
create trigger script_revisions_insert_size_policy
before insert on public.script_revisions
for each row execute function private.enforce_script_revision_insert_size_policy();

drop function private.compact_script_coordinate_map_v2(jsonb);

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

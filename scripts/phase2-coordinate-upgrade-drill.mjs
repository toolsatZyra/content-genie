import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const predecessorVerifierSql = readFileSync(
  new URL(
    "../supabase/tests/fixtures/phase2_coordinate_v1_verifiers.sql",
    import.meta.url,
  ),
  "utf8",
);

export const PHASE2_COORDINATE_PREDECESSOR_FIXTURE = Object.freeze({
  capturedAt: "2026-07-18",
  lastAppliedMigration: "20260717121606",
  nextMigration: "20260717121607",
  sha256: "2df42a28cd04b193b0eaf97c882a17edfb13688cad7aca9bf8845408e9d7ec1c",
  source: "pg_get_functiondef",
  sourceProjectRef: "iuzijmzcimtwyowhwinu",
});

const fixture = Object.freeze({
  episodeId: "96400000-0000-4000-8000-000000000001",
  exactV2RevisionId: "96500000-0000-4000-8000-000000000003",
  legacyMaximumRevisionId: "96500000-0000-4000-8000-000000000002",
  legacyOverBoundaryRevisionId: "96500000-0000-4000-8000-000000000001",
  organizationId: "96000000-0000-4000-8000-000000000001",
  seriesId: "96300000-0000-4000-8000-000000000001",
  userId: "96200000-0000-4000-8000-000000000001",
  workspaceId: "96100000-0000-4000-8000-000000000001",
});

export function assertPhase2CoordinatePredecessorFixture(
  source = predecessorVerifierSql,
) {
  const digest = createHash("sha256").update(source, "utf8").digest("hex");
  if (digest !== PHASE2_COORDINATE_PREDECESSOR_FIXTURE.sha256) {
    throw new Error("The frozen Phase 2 v1 verifier fixture digest has drifted.");
  }
  const definitions = source.match(/CREATE OR REPLACE FUNCTION[\s\S]*?\$function\$;/g);
  if (
    definitions?.length !== 2 ||
    !source.includes(
      "CREATE OR REPLACE FUNCTION private.verify_text_coordinate_index",
    ) ||
    !source.includes(
      "CREATE OR REPLACE FUNCTION private.verify_script_coordinate_map_envelope",
    )
  ) {
    throw new Error("The frozen Phase 2 v1 verifier fixture is incomplete.");
  }
  return PHASE2_COORDINATE_PREDECESSOR_FIXTURE;
}

function rawSha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const expectedLegacyRows = Object.freeze([
  Object.freeze({
    bytes: 8193,
    evidencePrefix: "over_boundary",
    id: fixture.legacyOverBoundaryRevisionId,
    rawUtf8Sha256: rawSha256("a".repeat(8193)),
  }),
  Object.freeze({
    bytes: 65536,
    evidencePrefix: "legacy_maximum",
    id: fixture.legacyMaximumRevisionId,
    rawUtf8Sha256: rawSha256(
      `a${String.fromCodePoint(119143).repeat(16383)}${String.fromCodePoint(8413)}`,
    ),
  }),
]);

export function buildPhase2CoordinatePredecessorReconstructionSql() {
  return `
begin;

do $empty_disposable_predecessor$
begin
  if exists (select 1 from public.script_revisions)
    or exists (select 1 from private.script_coordinate_attestations)
  then
    raise exception 'predecessor reconstruction requires an empty disposable branch';
  end if;
end;
$empty_disposable_predecessor$;

drop trigger if exists script_revisions_insert_size_policy
on public.script_revisions;
drop function if exists private.enforce_script_revision_insert_size_policy();

do $drop_coordinate_constraints$
declare
  constraint_row record;
  actual_constraint_names text[];
  expected_constraint_names constant text[] := array[
    'script_revisions_coordinate_map_semantics_v2_check',
    'script_revisions_coordinate_map_shape_v2_check',
    'script_revisions_coordinate_map_verifier_v2_check',
    'script_revisions_raw_utf8_size_check',
    'script_revisions_size_policy_version_check'
  ];
begin
  select pg_catalog.array_agg(constraint_entry.conname order by constraint_entry.conname)
  into actual_constraint_names
  from pg_catalog.pg_constraint constraint_entry
  where constraint_entry.conrelid = 'public.script_revisions'::regclass
    and constraint_entry.contype = 'c'
    and constraint_entry.conname = any(expected_constraint_names);
  if actual_constraint_names is distinct from expected_constraint_names then
    raise exception 'disposable predecessor constraint inventory drifted: %',
      actual_constraint_names using errcode = '55000';
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
$drop_coordinate_constraints$;

alter table public.script_revisions
  drop column if exists script_size_policy_version;

${predecessorVerifierSql}

revoke all on function private.verify_text_coordinate_index(
  jsonb,text,integer,integer,integer
) from public, anon, authenticated;
revoke all on function private.verify_script_coordinate_map_envelope(
  jsonb,text,text,integer,integer,integer,integer,integer,integer
) from public, anon, authenticated;

alter table public.script_revisions
  alter column coordinate_map_verifier set default 'postgres-structural-v1',
  add constraint script_revisions_raw_utf8_check
    check (octet_length(raw_utf8) between 1 and 65536),
  add constraint script_revisions_coordinate_map_verifier_check
    check (coordinate_map_verifier = 'postgres-structural-v1'),
  add constraint script_revisions_coordinate_map_check check ((
    jsonb_typeof(coordinate_map) = 'object'
    and coordinate_map ->> 'rangeConvention' = 'zero-based-half-open'
    and jsonb_typeof(coordinate_map -> 'raw') = 'object'
    and jsonb_typeof(coordinate_map -> 'processing') = 'object'
    and jsonb_typeof(coordinate_map -> 'segments') = 'array'
    and pg_column_size(coordinate_map) <= 8388608
  ) is true),
  add constraint script_revisions_coordinate_map_semantics_v1_check check (
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

drop index if exists private.script_coordinate_attestations_request_idx;
create unique index script_coordinate_attestations_request_idx
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

commit;

select
  not exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.script_revisions'::regclass
      and attname = 'script_size_policy_version'
      and not attisdropped
  ) as size_policy_absent,
  exists (
    select 1
    from pg_catalog.pg_attribute attribute
    join pg_catalog.pg_attrdef default_value
      on default_value.adrelid = attribute.attrelid
     and default_value.adnum = attribute.attnum
    where attribute.attrelid = 'public.script_revisions'::regclass
      and attribute.attname = 'coordinate_map_verifier'
      and pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
        like '%postgres-structural-v1%'
  ) as v1_default_restored,
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_entry
    where constraint_entry.conrelid = 'public.script_revisions'::regclass
      and pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%octet_length(raw_utf8)%65536%'
  ) as legacy_size_constraint_restored,
  exists (
    select 1
    from pg_catalog.pg_index index_entry
    join pg_catalog.pg_class index_relation
      on index_relation.oid = index_entry.indexrelid
    where index_relation.relnamespace = 'private'::regnamespace
      and index_relation.relname = 'script_coordinate_attestations_request_idx'
      and index_entry.indisunique
  ) as legacy_unique_attestation_index_restored;
`;
}

export function buildPhase2CoordinatePredecessorSeedSql() {
  return `
begin;

insert into public.organizations (id, name, slug)
values ('${fixture.organizationId}', 'Phase 2 Upgrade Drill', 'phase2-upgrade-drill');

insert into public.workspaces (id, organization_id, name, slug)
values (
  '${fixture.workspaceId}',
  '${fixture.organizationId}',
  'Phase 2 Upgrade Drill',
  'phase2-upgrade-drill'
);

insert into auth.users (
  id, email, email_confirmed_at, created_at, updated_at, aud, role
)
values (
  '${fixture.userId}',
  'phase2-coordinate-upgrade@zyra.test',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp(),
  'authenticated',
  'authenticated'
);

insert into public.profiles (user_id, display_name)
values ('${fixture.userId}', 'Phase 2 Upgrade Drill');

insert into public.memberships (
  workspace_id, user_id, role, status, authority_epoch, activated_at
)
values (
  '${fixture.workspaceId}',
  '${fixture.userId}',
  'member',
  'active',
  1,
  statement_timestamp()
);

insert into public.series (
  id, workspace_id, slug, title, owner_user_id, created_by
)
values (
  '${fixture.seriesId}',
  '${fixture.workspaceId}',
  'phase2-upgrade-drill',
  'Phase 2 Upgrade Drill',
  '${fixture.userId}',
  '${fixture.userId}'
);

insert into public.episodes (
  id, workspace_id, series_id, episode_number, title, owner_user_id, created_by
)
values (
  '${fixture.episodeId}',
  '${fixture.workspaceId}',
  '${fixture.seriesId}',
  1,
  'Phase 2 Coordinate Upgrade',
  '${fixture.userId}',
  '${fixture.userId}'
);

with fixture_specs as (
  select
    'over-boundary'::text as label,
    '${fixture.legacyOverBoundaryRevisionId}'::uuid as revision_id,
    1::integer as revision_number,
    repeat('a', 8193) as raw_text,
    8193::integer as scalar_count,
    8193::integer as utf16_count,
    8193::integer as grapheme_count
  union all
  select
    'legacy-maximum',
    '${fixture.legacyMaximumRevisionId}'::uuid,
    2,
    'a' || repeat(chr(119143), 16383) || chr(8413),
    16385,
    32768,
    1
),
coordinate_indexes as (
  select
    fixture_specs.*,
    (
      select jsonb_agg(
        case
          when label = 'over-boundary' then scalar_offset
          when scalar_offset = 0 then 0
          when scalar_offset <= 16384 then 1 + (scalar_offset - 1) * 2
          else 32768
        end
        order by scalar_offset
      )
      from generate_series(0, scalar_count) as generated(scalar_offset)
    ) as scalar_to_utf16,
    (
      select jsonb_agg(
        case
          when label = 'over-boundary' then scalar_offset
          when scalar_offset = 0 then 0
          when scalar_offset <= 16384 then 1 + (scalar_offset - 1) * 4
          else 65536
        end
        order by scalar_offset
      )
      from generate_series(0, scalar_count) as generated(scalar_offset)
    ) as scalar_to_utf8
  from fixture_specs
),
coordinate_graphemes as (
  select
    coordinate_indexes.*,
    case
      when label = 'legacy-maximum' then jsonb_build_array(
        jsonb_build_object(
          'byteStart', 0,
          'byteEnd', 65536,
          'scalarStart', 0,
          'scalarEnd', scalar_count,
          'utf16Start', 0,
          'utf16End', utf16_count,
          'graphemeStart', 0,
          'graphemeEnd', 1,
          'text', raw_text
        )
      )
      else (
        select jsonb_agg(
          jsonb_build_object(
            'byteStart', grapheme_offset - 1,
            'byteEnd', grapheme_offset,
            'scalarStart', grapheme_offset - 1,
            'scalarEnd', grapheme_offset,
            'utf16Start', grapheme_offset - 1,
            'utf16End', grapheme_offset,
            'graphemeStart', grapheme_offset - 1,
            'graphemeEnd', grapheme_offset,
            'text', 'a'
          )
          order by grapheme_offset
        )
        from generate_series(1, grapheme_count) as generated(grapheme_offset)
      )
    end as graphemes
  from coordinate_indexes
),
legacy_maps as (
  select
    coordinate_graphemes.*,
    jsonb_build_object(
      'rangeConvention', 'zero-based-half-open',
      'raw', jsonb_build_object(
        'scalarToUtf16', scalar_to_utf16,
        'scalarToUtf8', scalar_to_utf8,
        'graphemes', graphemes
      ),
      'processing', jsonb_build_object(
        'scalarToUtf16', scalar_to_utf16,
        'scalarToUtf8', scalar_to_utf8,
        'graphemes', graphemes
      ),
      'segments', jsonb_build_array(
        jsonb_build_object(
          'reason', 'identity',
          'raw', jsonb_build_object(
            'byteStart', 0,
            'byteEnd', octet_length(convert_to(raw_text, 'UTF8')),
            'scalarStart', 0,
            'scalarEnd', scalar_count,
            'utf16Start', 0,
            'utf16End', utf16_count,
            'graphemeStart', 0,
            'graphemeEnd', grapheme_count
          ),
          'processing', jsonb_build_object(
            'byteStart', 0,
            'byteEnd', octet_length(convert_to(raw_text, 'UTF8')),
            'scalarStart', 0,
            'scalarEnd', scalar_count,
            'utf16Start', 0,
            'utf16End', utf16_count,
            'graphemeStart', 0,
            'graphemeEnd', grapheme_count
          )
        )
      )
    ) as coordinate_map
  from coordinate_graphemes
)
insert into public.script_revisions (
  id,
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
select
  revision_id,
  '${fixture.workspaceId}',
  '${fixture.episodeId}',
  revision_number,
  'browser_text',
  raw_text,
  convert_to(raw_text, 'UTF8'),
  encode(extensions.digest(convert_to(raw_text, 'UTF8'), 'sha256'), 'hex'),
  raw_text,
  encode(extensions.digest(convert_to(raw_text, 'UTF8'), 'sha256'), 'hex'),
  'genie-script-processing.v1',
  coordinate_map,
  jsonb_build_object(
    'nodeVersion', '22.14.0',
    'icuVersion', '76.1',
    'unicodeVersion', '17.0.0',
    'graphemeSegmenterProfile',
      'unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47',
    'graphemeProbeSha256',
      '472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096'
  ),
  utf16_count,
  scalar_count,
  grapheme_count,
  utf16_count,
  scalar_count,
  grapheme_count,
  0.480,
  true,
  true,
  '${fixture.userId}'
from legacy_maps;

commit;

select
  count(*)::integer as legacy_row_count,
  min(octet_length(raw_utf8))::integer as minimum_legacy_bytes,
  max(octet_length(raw_utf8))::integer as maximum_legacy_bytes,
  max(id::text) filter (
    where id = '${fixture.legacyOverBoundaryRevisionId}'
  ) as over_boundary_revision_id,
  max(octet_length(raw_utf8)) filter (
    where id = '${fixture.legacyOverBoundaryRevisionId}'
  )::integer as over_boundary_bytes,
  max(raw_utf8_sha256) filter (
    where id = '${fixture.legacyOverBoundaryRevisionId}'
  ) as over_boundary_raw_utf8_sha256,
  max(id::text) filter (
    where id = '${fixture.legacyMaximumRevisionId}'
  ) as legacy_maximum_revision_id,
  max(octet_length(raw_utf8)) filter (
    where id = '${fixture.legacyMaximumRevisionId}'
  )::integer as legacy_maximum_bytes,
  max(raw_utf8_sha256) filter (
    where id = '${fixture.legacyMaximumRevisionId}'
  ) as legacy_maximum_raw_utf8_sha256,
  bool_and(coordinate_map_verifier = 'postgres-structural-v1') as all_v1,
  bool_and(pg_column_size(coordinate_map) <= 8388608) as maps_within_legacy_limit,
  bool_and(private.verify_script_coordinate_map_envelope(
    coordinate_map,
    raw_text,
    processing_text,
    raw_utf16_code_units,
    raw_scalar_count,
    raw_grapheme_count,
    processing_utf16_code_units,
    processing_scalar_count,
    processing_grapheme_count
  )) as all_verified_v1
from public.script_revisions
where id in (
  '${fixture.legacyOverBoundaryRevisionId}',
  '${fixture.legacyMaximumRevisionId}'
);
`;
}

export function buildPhase2CoordinateUpgradeVerificationSql() {
  return `
with exact_v2_map as (
  select jsonb_build_object(
    'v', 2,
    'c', 'zero-based-half-open',
    'r', jsonb_build_array(
      (select jsonb_agg(value order by value) from generate_series(0, 8192) generated(value)),
      (select jsonb_agg(value order by value) from generate_series(0, 8192) generated(value)),
      (select jsonb_agg(value order by value) from generate_series(1, 8192) generated(value))
    ),
    'p', jsonb_build_array(
      (select jsonb_agg(value order by value) from generate_series(0, 8192) generated(value)),
      (select jsonb_agg(value order by value) from generate_series(0, 8192) generated(value)),
      (select jsonb_agg(value order by value) from generate_series(1, 8192) generated(value))
    ),
    's', jsonb_build_array(jsonb_build_array(0, 0, 8192, 0, 8192))
  ) as coordinate_map
)
insert into public.script_revisions (
  id, workspace_id, episode_id, revision_number, source_kind,
  raw_text, raw_utf8, raw_utf8_sha256,
  processing_text, processing_utf8_sha256, processing_profile,
  coordinate_map, runtime_evidence,
  raw_utf16_code_units, raw_scalar_count, raw_grapheme_count,
  processing_utf16_code_units, processing_scalar_count, processing_grapheme_count,
  estimated_duration_seconds, duration_out_of_band, duration_acknowledged, created_by
)
select
  '${fixture.exactV2RevisionId}',
  '${fixture.workspaceId}',
  '${fixture.episodeId}',
  3,
  'browser_text',
  repeat('b', 8192),
  convert_to(repeat('b', 8192), 'UTF8'),
  encode(extensions.digest(convert_to(repeat('b', 8192), 'UTF8'), 'sha256'), 'hex'),
  repeat('b', 8192),
  encode(extensions.digest(convert_to(repeat('b', 8192), 'UTF8'), 'sha256'), 'hex'),
  'genie-script-processing.v1',
  coordinate_map,
  jsonb_build_object(
    'nodeVersion', '22.14.0',
    'icuVersion', '76.1',
    'unicodeVersion', '17.0.0',
    'graphemeSegmenterProfile',
      'unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47',
    'graphemeProbeSha256',
      '472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096'
  ),
  8192, 8192, 8192,
  8192, 8192, 8192,
  0.480, true, true, '${fixture.userId}'
from exact_v2_map;

do $upgrade_drill$
declare
  rejected_message text;
begin
  begin
    insert into public.script_revisions (
      id, workspace_id, episode_id, revision_number, source_kind,
      raw_text, raw_utf8, raw_utf8_sha256,
      processing_text, processing_utf8_sha256, processing_profile,
      coordinate_map, runtime_evidence,
      raw_utf16_code_units, raw_scalar_count, raw_grapheme_count,
      processing_utf16_code_units, processing_scalar_count,
      processing_grapheme_count,
      estimated_duration_seconds, duration_out_of_band, duration_acknowledged, created_by
    )
    select
      '96500000-0000-4000-8000-000000000004',
      workspace_id,
      episode_id,
      4,
      source_kind,
      repeat('c', 8193),
      convert_to(repeat('c', 8193), 'UTF8'),
      encode(extensions.digest(convert_to(repeat('c', 8193), 'UTF8'), 'sha256'), 'hex'),
      repeat('c', 8193),
      encode(extensions.digest(convert_to(repeat('c', 8193), 'UTF8'), 'sha256'), 'hex'),
      processing_profile,
      coordinate_map,
      runtime_evidence,
      8193, 8193, 8193,
      8193, 8193, 8193,
      estimated_duration_seconds,
      true,
      true,
      created_by
    from public.script_revisions
    where id = '${fixture.exactV2RevisionId}';
    raise exception 'default v2 policy accepted an oversized new row';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_message = message_text;
      if rejected_message <>
        'new script revisions require size policy v2 and at most 8192 bytes'
      then
        raise;
      end if;
  end;

  begin
    insert into public.script_revisions (
      id, workspace_id, episode_id, revision_number, source_kind,
      raw_text, raw_utf8, raw_utf8_sha256,
      processing_text, processing_utf8_sha256, processing_profile,
      coordinate_map, runtime_evidence,
      raw_utf16_code_units, raw_scalar_count, raw_grapheme_count,
      processing_utf16_code_units, processing_scalar_count, processing_grapheme_count,
      estimated_duration_seconds, duration_out_of_band, duration_acknowledged,
      created_by, script_size_policy_version
    )
    select
      '96500000-0000-4000-8000-000000000005',
      workspace_id,
      episode_id,
      5,
      source_kind,
      repeat('d', 8193),
      convert_to(repeat('d', 8193), 'UTF8'),
      encode(extensions.digest(convert_to(repeat('d', 8193), 'UTF8'), 'sha256'), 'hex'),
      repeat('d', 8193),
      encode(extensions.digest(convert_to(repeat('d', 8193), 'UTF8'), 'sha256'), 'hex'),
      processing_profile,
      coordinate_map,
      runtime_evidence,
      8193, 8193, 8193,
      8193, 8193, 8193,
      estimated_duration_seconds,
      true,
      true,
      created_by,
      1
    from public.script_revisions
    where id = '${fixture.exactV2RevisionId}';
    raise exception 'a new row claimed the grandfathered legacy policy';
  exception
    when sqlstate '22023' then
      get stacked diagnostics rejected_message = message_text;
      if rejected_message <>
        'new script revisions require size policy v2 and at most 8192 bytes'
      then
        raise;
      end if;
  end;
end;
$upgrade_drill$;

select
  (
    select count(*) = 2
      and min(octet_length(raw_utf8)) = 8193
      and max(octet_length(raw_utf8)) = 65536
      and bool_and(script_size_policy_version = 1)
      and bool_and(coordinate_map_verifier = 'postgres-structural-v2')
      and bool_and(
        raw_utf8_sha256 = encode(
          extensions.digest(convert_to(raw_text, 'UTF8'), 'sha256'),
          'hex'
        )
      )
      and bool_and(
        case id
          when '${fixture.legacyOverBoundaryRevisionId}' then
            raw_text = repeat('a', 8193)
            and octet_length(raw_utf8) = 8193
          when '${fixture.legacyMaximumRevisionId}' then
            raw_text = 'a' || repeat(chr(119143), 16383) || chr(8413)
            and octet_length(raw_utf8) = 65536
          else false
        end
      )
      and bool_and(private.verify_script_coordinate_map_envelope(
        coordinate_map,
        raw_text,
        processing_text,
        raw_utf16_code_units,
        raw_scalar_count,
        raw_grapheme_count,
        processing_utf16_code_units,
        processing_scalar_count,
        processing_grapheme_count
      ))
    from public.script_revisions
    where id in (
      '${fixture.legacyOverBoundaryRevisionId}',
      '${fixture.legacyMaximumRevisionId}'
    )
  ) as legacy_rows_preserved,
  (
    select id::text
    from public.script_revisions
    where id = '${fixture.legacyOverBoundaryRevisionId}'
  ) as over_boundary_revision_id,
  (
    select octet_length(raw_utf8)::integer
    from public.script_revisions
    where id = '${fixture.legacyOverBoundaryRevisionId}'
  ) as over_boundary_bytes,
  (
    select raw_utf8_sha256
    from public.script_revisions
    where id = '${fixture.legacyOverBoundaryRevisionId}'
  ) as over_boundary_raw_utf8_sha256,
  (
    select id::text
    from public.script_revisions
    where id = '${fixture.legacyMaximumRevisionId}'
  ) as legacy_maximum_revision_id,
  (
    select octet_length(raw_utf8)::integer
    from public.script_revisions
    where id = '${fixture.legacyMaximumRevisionId}'
  ) as legacy_maximum_bytes,
  (
    select raw_utf8_sha256
    from public.script_revisions
    where id = '${fixture.legacyMaximumRevisionId}'
  ) as legacy_maximum_raw_utf8_sha256,
  (
    select octet_length(raw_utf8) = 8192
      and script_size_policy_version = 2
      and coordinate_map_verifier = 'postgres-structural-v2'
    from public.script_revisions
    where id = '${fixture.exactV2RevisionId}'
  ) as exact_v2_write_accepted,
  not exists (
    select 1
    from public.script_revisions
    where id in (
      '96500000-0000-4000-8000-000000000004',
      '96500000-0000-4000-8000-000000000005'
    )
  ) as oversized_v2_writes_rejected;
`;
}

function oneEvidenceRow(rows, label) {
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]) {
    throw new Error(`${label} did not return exactly one evidence row.`);
  }
  return rows[0];
}

function exactLegacyEvidence(row, label) {
  const evidence = expectedLegacyRows.map((expected) => {
    const id = row[`${expected.evidencePrefix}_revision_id`];
    const bytes = Number(row[`${expected.evidencePrefix}_bytes`]);
    const rawUtf8Sha256 = row[`${expected.evidencePrefix}_raw_utf8_sha256`];
    if (
      id !== expected.id ||
      bytes !== expected.bytes ||
      rawUtf8Sha256 !== expected.rawUtf8Sha256
    ) {
      throw new Error(`${label} did not preserve exact legacy row identity.`);
    }
    return Object.freeze({
      bytes,
      id,
      rawUtf8Sha256,
    });
  });
  return Object.freeze(evidence);
}

export function assertPhase2CoordinatePredecessorReconstruction(rows) {
  const row = oneEvidenceRow(rows, "Phase 2 predecessor reconstruction");
  if (
    row.size_policy_absent !== true ||
    row.v1_default_restored !== true ||
    row.legacy_size_constraint_restored !== true ||
    row.legacy_unique_attestation_index_restored !== true
  ) {
    throw new Error("Phase 2 predecessor reconstruction is not an authentic v1 state.");
  }
  return Object.freeze({
    legacySizeConstraintRestored: true,
    legacyUniqueAttestationIndexRestored: true,
    sizePolicyAbsent: true,
    v1DefaultRestored: true,
  });
}

export function assertPhase2CoordinatePredecessorSeed(rows) {
  const row = oneEvidenceRow(rows, "Phase 2 predecessor seed");
  const legacyRows = exactLegacyEvidence(row, "Phase 2 predecessor seed");
  if (
    Number(row.legacy_row_count) !== 2 ||
    Number(row.minimum_legacy_bytes) !== 8193 ||
    Number(row.maximum_legacy_bytes) !== 65536 ||
    row.all_v1 !== true ||
    row.maps_within_legacy_limit !== true ||
    row.all_verified_v1 !== true
  ) {
    throw new Error("Phase 2 predecessor seed did not prove valid v1 boundary rows.");
  }
  return Object.freeze({
    legacyRowCount: 2,
    maximumLegacyBytes: 65536,
    minimumLegacyBytes: 8193,
    legacyRows,
    verifiedV1: true,
  });
}

export function assertPhase2CoordinateUpgrade(rows) {
  const row = oneEvidenceRow(rows, "Phase 2 coordinate upgrade");
  const legacyRows = exactLegacyEvidence(row, "Phase 2 coordinate upgrade");
  if (
    row.legacy_rows_preserved !== true ||
    row.exact_v2_write_accepted !== true ||
    row.oversized_v2_writes_rejected !== true
  ) {
    throw new Error("Phase 2 coordinate upgrade did not preserve and cap exact rows.");
  }
  return Object.freeze({
    exactV2WriteAccepted: true,
    legacyRows,
    legacyRowsPreserved: true,
    oversizedV2WritesRejected: true,
  });
}

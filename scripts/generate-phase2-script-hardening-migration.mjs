import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourcePath = path.join(
  root,
  "supabase",
  "migrations",
  "20260717121500_phase2_scripts_and_sidecars.sql",
);
const outputSpecs = [
  {
    filename: "20260717121501_phase2_script_coordinate_hardening.sql",
    header:
      "-- Phase 2 / 0010 forward hardening: semantically verify every script\n" +
      "-- coordinate and bind one-time service attestations to exact script hashes.",
  },
  {
    filename: "20260717121607_phase2_script_coordinate_v2_forward.sql",
    header:
      "-- Phase 2 / 0010 forward correction: replay compact coordinate-map v2\n" +
      "-- for environments that already applied the predecessor Phase 2 versions.",
  },
].map(({ filename, header }) => ({
  callerIdentifiedAttestor: filename.includes("121607"),
  header,
  outputPath: path.join(root, "supabase", "migrations", filename),
}));
const checkOnly = process.argv.includes("--check");
const source = fs.readFileSync(sourcePath, "utf8");

function extractFunction(start) {
  const startIndex = source.indexOf(start);
  const endMarker = "\n$$;";
  const endIndex = source.indexOf(endMarker, startIndex);
  if (startIndex < 0 || endIndex < 0) {
    throw new Error(`Cannot extract hardening function: ${start}`);
  }
  return source.slice(startIndex, endIndex + endMarker.length);
}

const indexVerifier = extractFunction(
  "create or replace function private.verify_text_coordinate_index(",
);
const integerTupleVerifier = extractFunction(
  "create or replace function private.verify_nonnegative_integer_tuple(",
);
const boundedMapVerifier = extractFunction(
  "create or replace function private.verify_script_coordinate_map_envelope(",
);
const mapVerifier = boundedMapVerifier.replace(
  "\n    or octet_length(convert_to(p_raw_text, 'UTF8')) > 8192",
  "",
);
if (mapVerifier === boundedMapVerifier) {
  throw new Error(
    "Cannot remove the new-write byte cap from the row semantic verifier.",
  );
}
const attestor = extractFunction(
  "create or replace function public.attest_script_coordinate_map(",
);
const durationEstimator = extractFunction(
  "create or replace function private.estimate_hindi_narration_duration_v1(",
);

function replaceRequired(value, search, replacement, label) {
  const next = value.replace(search, () => replacement);
  if (next === value) {
    throw new Error(`Cannot generate caller-identified attestor: ${label}`);
  }
  return next;
}

let callerIdentifiedAttestor = replaceRequired(
  attestor,
  "create or replace function public.attest_script_coordinate_map(\n  p_workspace_id uuid,",
  "create or replace function public.attest_script_coordinate_map(\n" +
    "  p_attestation_id uuid,\n" +
    "  p_workspace_id uuid,",
  "function identity parameter",
);
callerIdentifiedAttestor = replaceRequired(
  callerIdentifiedAttestor,
  "  if p_request_hash !~ '^[a-f0-9]{64}$'",
  "  if p_attestation_id is null\n" +
    "    or p_attestation_id::text !~\n" +
    "      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'\n" +
    "  then\n" +
    "    raise exception 'invalid script attestation identity' using errcode = '22023';\n" +
    "  end if;\n" +
    "  if p_request_hash !~ '^[a-f0-9]{64}$'",
  "identity validation",
);
callerIdentifiedAttestor = replaceRequired(
  callerIdentifiedAttestor,
  "  insert into private.script_coordinate_attestations (\n    workspace_id,",
  "  insert into private.script_coordinate_attestations (\n" +
    "    id,\n" +
    "    workspace_id,",
  "identity insert column",
);
callerIdentifiedAttestor = replaceRequired(
  callerIdentifiedAttestor,
  "  values (\n    p_workspace_id,",
  "  values (\n    p_attestation_id,\n    p_workspace_id,",
  "identity insert value",
);
const revoker = extractFunction(
  "create or replace function public.revoke_script_coordinate_attestation(",
);
const lockCommand = extractFunction(
  "create or replace function public.command_lock_episode_script(",
);

const sharedHardeningBody = `delete from private.script_coordinate_attestations;

${durationEstimator}
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
drop function if exists public.attest_script_coordinate_map(
  uuid,uuid,uuid,text,text,text,jsonb,jsonb
);

${integerTupleVerifier}
revoke all on function private.verify_nonnegative_integer_tuple(
  jsonb,integer
) from public, anon, authenticated;

${indexVerifier}
revoke all on function private.verify_text_coordinate_index(
  jsonb,text,integer,integer,integer
) from public, anon, authenticated;

${mapVerifier}
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

${attestor}
revoke all on function public.attest_script_coordinate_map(
  uuid,uuid,uuid,text,text,text,jsonb,jsonb
) from public, anon, authenticated;
grant execute on function public.attest_script_coordinate_map(
  uuid,uuid,uuid,text,text,text,jsonb,jsonb
) to service_role;

${revoker}
revoke all on function public.revoke_script_coordinate_attestation(
  uuid,uuid,text
) from public, anon, authenticated;
grant execute on function public.revoke_script_coordinate_attestation(
  uuid,uuid,text
) to service_role;

${lockCommand}
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
`;

for (const {
  callerIdentifiedAttestor: useCallerIdentity,
  header,
  outputPath,
} of outputSpecs) {
  let body = sharedHardeningBody;
  if (useCallerIdentity) {
    body = replaceRequired(body, attestor, callerIdentifiedAttestor, "terminal body");
    body = replaceRequired(
      body,
      "revoke all on function public.attest_script_coordinate_map(\n  uuid,uuid,uuid,text,text,text,jsonb,jsonb\n) from public, anon, authenticated;",
      "revoke all on function public.attest_script_coordinate_map(\n  uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb\n) from public, anon, authenticated;",
      "terminal revoke signature",
    );
    body = replaceRequired(
      body,
      "grant execute on function public.attest_script_coordinate_map(\n  uuid,uuid,uuid,text,text,text,jsonb,jsonb\n) to service_role;",
      "grant execute on function public.attest_script_coordinate_map(\n  uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb\n) to service_role;",
      "terminal grant signature",
    );
  } else {
    body = replaceRequired(
      body,
      "drop function if exists public.attest_script_coordinate_map(\n  uuid,uuid,uuid,text,text,text,jsonb,jsonb\n);\n",
      "",
      "predecessor signature preservation",
    );
  }
  const output = `${header}\n\n${body}`;
  if (checkOnly) {
    if (!fs.existsSync(outputPath) || fs.readFileSync(outputPath, "utf8") !== output) {
      throw new Error(
        `Generated artifact is stale: ${path.relative(root, outputPath)}`,
      );
    }
  } else {
    fs.writeFileSync(outputPath, output, "utf8");
  }
  console.log(
    `${checkOnly ? "Verified" : "Generated"} ${path.relative(root, outputPath)}`,
  );
}

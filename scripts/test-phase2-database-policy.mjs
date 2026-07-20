import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  analyzePhase2Migrations,
  analyzePhase2PgTapSource,
  expectedMigrationSuffixes,
} from "./phase2-database-policy.mjs";
import {
  assertPhase2CoordinatePredecessorReconstruction,
  assertPhase2CoordinatePredecessorSeed,
  assertPhase2CoordinateUpgrade,
  buildPhase2CoordinatePredecessorReconstructionSql,
  buildPhase2CoordinatePredecessorSeedSql,
  buildPhase2CoordinateUpgradeVerificationSql,
} from "./phase2-coordinate-upgrade-drill.mjs";

const directory = join(process.cwd(), "supabase", "migrations");
const sources = readdirSync(directory)
  .filter((file) => expectedMigrationSuffixes.some((suffix) => file.endsWith(suffix)))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(directory, file), "utf8") }));

assert.deepEqual(analyzePhase2Migrations(sources).errors, []);
const pgTapSource = readFileSync(
  join(process.cwd(), "supabase", "tests", "phase2_zero_spend_foundation.test.sql"),
  "utf8",
);
assert.deepEqual(analyzePhase2PgTapSource(pgTapSource).errors, []);
assert.ok(
  analyzePhase2PgTapSource(
    pgTapSource.replaceAll("as generated_offset(value)", "as offset(value)"),
  ).errors.length > 0,
  "reserved pgTAP alias regression must fail the Phase 2 database policy",
);
assert.ok(
  analyzePhase2PgTapSource(
    pgTapSource.replace(
      "select set_config('request.jwt.claim.role', 'service_role', true);\nset local role service_role;",
      "set local role service_role;",
    ),
  ).errors.length > 0,
  "a service-role switch without matching auth.role() authority must fail policy",
);

const mutate = (needle, replacement) => {
  let changed = false;
  const result = sources.map((source) => {
    if (changed || !source.sql.includes(needle)) return source;
    changed = true;
    return { ...source, sql: source.sql.replace(needle, replacement) };
  });
  assert.ok(changed, `test mutation target is absent: ${needle}`);
  return result;
};

const mutateAll = (needle, replacement) => {
  let changes = 0;
  const result = sources.map((source) => {
    if (!source.sql.includes(needle)) return source;
    changes += 1;
    return { ...source, sql: source.sql.replaceAll(needle, replacement) };
  });
  assert.ok(changes > 0, `test mutation target is absent: ${needle}`);
  return result;
};

for (const [mutationIndex, mutation] of [
  mutate("alter table public.script_revisions force row level security;", ""),
  mutate(
    "create policy script_revisions_read_active_workspace",
    "create view script_revisions_read_active_workspace",
  ),
  mutate(
    "revoke all on table public.script_revisions from public, anon, authenticated;",
    "",
  ),
  mutate(
    "security definer\nset search_path = ''",
    "security definer\nset search_path = 'public'",
  ),
  mutate(
    "grant select on table public.script_revisions to authenticated;",
    "grant select on table public.script_revisions to anon;",
  ),
  mutate(
    "using (private.is_current_session_allowed(workspace_id));",
    "using (private.has_current_active_membership());",
  ),
  mutate("using (private.has_current_active_membership());", "using (true);"),
  mutate(
    "coordinate_map_verifier = 'postgres-structural-v2'",
    "coordinate_map_verifier = 'postgres-structural-v1'",
  ),
  mutate(
    "create index script_coordinate_attestations_request_idx",
    "create unique index script_coordinate_attestations_request_idx",
  ),
  mutate("octet_length(p_raw_utf8) > 8192", "octet_length(p_raw_utf8) > 65536"),
  mutateAll(
    "    p_attestation_id,\n    p_workspace_id,",
    "    gen_random_uuid(),\n    p_workspace_id,",
  ),
  mutateAll(
    "octet_length(raw_utf8) between 8193 and 65536",
    "octet_length(raw_utf8) between 1 and 65536",
  ),
  mutate(
    "create trigger script_revisions_insert_size_policy",
    "create trigger removed_script_revisions_insert_size_policy",
  ),
  mutateAll(
    "private.verify_nonnegative_integer_tuple",
    "private.verify_integer_tuple_without_type_guards",
  ),
  mutateAll("p_coordinate_map -> 's'", "p_coordinate_map -> 'segments'"),
  mutate(
    "alter table public.script_revisions\n  disable trigger script_revisions_immutable;",
    "",
  ),
  mutate("for update of a;", ";"),
  mutate("live broker nonce replayed", "live broker nonce accepted twice"),
  mutateAll(
    "lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit",
    "false",
  ),
  mutateAll(
    "create_lease_expires_at <= statement_timestamp()",
    "create_lease_expires_at is null",
  ),
  mutate(
    "create index live_broker_request_nonces_signer_created_idx",
    "create index removed_live_broker_request_nonces_signer_created_idx",
  ),
  mutate(
    "created_at < statement_timestamp() - interval '10 minutes'",
    "created_at < statement_timestamp() - interval '100 years'",
  ),
  mutate(
    "foreign key (workspace_id, continuity_state_version_id, series_id)",
    "foreign key (workspace_id, continuity_state_version_id)",
  ),
  mutate(
    "current_release_status is distinct from 'active'",
    "current_release_status is distinct from 'superseded'",
  ),
  mutate(
    "current_look_status is distinct from 'active'",
    "current_look_status is distinct from 'withdrawn'",
  ),
  mutate(
    "and continuity.series_id = p_series_id;",
    "and continuity.series_id <> p_series_id;",
  ),
  mutate(
    "-- Phase 2 terminal correction: bind Series release continuity to the exact",
    "-- Phase 2 terminal correction: bind Series release continuity to the exact\n" +
      "create unique index if not exists continuity_state_versions_workspace_id_id_series_id_terminal_uidx " +
      "on public.continuity_state_versions (workspace_id, id, series_id);\n\n" +
      "-- duplicate index negative control",
  ),
  mutateAll(
    "command_reconcile_live_broker_cancellation",
    "command_ignore_live_broker_cancellation",
  ),
  mutateAll(
    "unexpected script revision constraint inventory",
    "silently accepted script revision constraint inventory",
  ),
  mutateAll("legacy_constraint_names", "accepted_v1_constraint_names"),
  mutateAll(
    "script_revisions_runtime_evidence_shape_v2_check",
    "script_revisions_runtime_evidence_shape_ignored_check",
  ),
  mutateAll("greatest(", "pg_catalog.greatest("),
  mutateAll("{8,255}", "{8,256}"),
  mutate(
    "series_row.active_release_id = release.id",
    "series_row.active_release_id is not null",
  ),
  mutate(
    "voice_availability.status <> 'withdrawn'",
    "voice_availability.status = 'withdrawn'",
  ),
  mutate(
    "and availability.status <> 'withdrawn'\n  where release.id = new.pinned_series_release_id",
    "and availability.status = 'withdrawn'\n  where release.id = new.pinned_series_release_id",
  ),
  mutate("episode_state <> 'world_setup'", "episode_state = 'world_setup'"),
  mutate(
    "advisory_only boolean not null default true check (advisory_only)",
    "advisory_only boolean not null default false check (not advisory_only)",
  ),
  mutate("gate ->> 'effect' <> 'advisory'", "gate ->> 'effect' <> 'hard_block_stage'"),
  mutate(
    "completed advisory script rubric is required before planning",
    "script rubric is optional before planning",
  ),
  mutate(
    "create index preflight_runs_script_rubric_run_fk_idx",
    "create index removed_preflight_runs_script_rubric_run_fk_idx",
  ),
].entries()) {
  assert.ok(
    analyzePhase2Migrations(mutation).errors.length > 0,
    `Phase 2 database mutation ${mutationIndex} must be rejected`,
  );
}

assert.ok(analyzePhase2Migrations([...sources].reverse()).errors.length > 0);

const hardeningWithSemanticByteCap = sources.map((source) =>
  source.file.endsWith("phase2_script_coordinate_v2_forward.sql")
    ? {
        ...source,
        sql: source.sql.replace(
          "    or pg_column_size(p_coordinate_map) > 8388608",
          "    or octet_length(convert_to(p_raw_text, 'UTF8')) > 8192\n" +
            "    or pg_column_size(p_coordinate_map) > 8388608",
        ),
      }
    : source,
);
assert.ok(
  analyzePhase2Migrations(hardeningWithSemanticByteCap).errors.some((error) =>
    error.includes("new-write byte cap inside the legacy row semantic verifier"),
  ),
  "the v2 semantic verifier must accept grandfathered predecessor bytes",
);

const withoutForwardCorrection = sources.filter(
  ({ file }) => !file.endsWith("phase2_script_coordinate_v2_forward.sql"),
);
assert.equal(withoutForwardCorrection.length, sources.length - 1);
assert.ok(
  analyzePhase2Migrations(withoutForwardCorrection).errors.some(
    (error) =>
      error === "the ordered Phase 2 zero-spend migration set is incomplete" ||
      error === "the replayable coordinate-map hardening pair is incomplete",
  ),
  "removing the new forward correction must fail the Phase 2 migration policy",
);

const withoutEpisodeEligibility = sources.filter(
  ({ file }) => !file.endsWith("phase2_episode_release_eligibility.sql"),
);
assert.equal(withoutEpisodeEligibility.length, sources.length - 1);
assert.ok(
  analyzePhase2Migrations(withoutEpisodeEligibility).errors.some(
    (error) =>
      error === "the ordered Phase 2 zero-spend migration set is incomplete" ||
      error.startsWith("terminal Episode eligibility migration is missing:"),
  ),
  "removing the terminal Episode eligibility correction must fail policy",
);

const withoutCheckpointHardening = sources.filter(
  ({ file }) => !file.endsWith("phase2_checkpoint_adversarial_hardening.sql"),
);
assert.equal(withoutCheckpointHardening.length, sources.length - 1);
assert.ok(
  analyzePhase2Migrations(withoutCheckpointHardening).errors.some(
    (error) =>
      error === "the ordered Phase 2 zero-spend migration set is incomplete" ||
      error.startsWith("terminal checkpoint hardening migration is missing:"),
  ),
  "removing the checkpoint hardening migration must fail policy",
);

const predecessorSeedSql = buildPhase2CoordinatePredecessorSeedSql();
const predecessorReconstructionSql =
  buildPhase2CoordinatePredecessorReconstructionSql();
for (const required of [
  "predecessor reconstruction requires an empty disposable branch",
  "drop column if exists script_size_policy_version",
  "between 1 and 65536",
  "postgres-structural-v1",
  "verify_script_coordinate_map_envelope",
  "create unique index script_coordinate_attestations_request_idx",
]) {
  assert.ok(
    predecessorReconstructionSql.includes(required),
    `predecessor reconstruction is missing: ${required}`,
  );
}
for (const required of [
  "repeat('a', 8193)",
  "repeat(chr(119143), 16383)",
  "all_verified_v1",
  "maximum_legacy_bytes",
  "over_boundary_raw_utf8_sha256",
  "legacy_maximum_raw_utf8_sha256",
  "postgres-structural-v1",
]) {
  assert.ok(
    predecessorSeedSql.includes(required),
    `predecessor upgrade seed is missing: ${required}`,
  );
}
const upgradeVerificationSql = buildPhase2CoordinateUpgradeVerificationSql();
for (const required of [
  "script_size_policy_version = 1",
  "script_size_policy_version = 2",
  "repeat('b', 8192)",
  "repeat('c', 8193)",
  "legacy_rows_preserved",
  "raw_utf8_sha256 = encode(",
  "oversized_v2_writes_rejected",
]) {
  assert.ok(
    upgradeVerificationSql.includes(required),
    `coordinate upgrade verification is missing: ${required}`,
  );
}
assert.deepEqual(
  assertPhase2CoordinatePredecessorReconstruction([
    {
      legacy_size_constraint_restored: true,
      legacy_unique_attestation_index_restored: true,
      size_policy_absent: true,
      v1_default_restored: true,
    },
  ]),
  {
    legacySizeConstraintRestored: true,
    legacyUniqueAttestationIndexRestored: true,
    sizePolicyAbsent: true,
    v1DefaultRestored: true,
  },
);
assert.deepEqual(
  assertPhase2CoordinatePredecessorSeed([
    {
      all_v1: true,
      all_verified_v1: true,
      legacy_row_count: 2,
      legacy_maximum_bytes: 65536,
      legacy_maximum_raw_utf8_sha256:
        "fce4d906c666cb2bc9d0f2d42a5e871f418c5e8dac03b4a4a60eed343b3480ec",
      legacy_maximum_revision_id: "96500000-0000-4000-8000-000000000002",
      maps_within_legacy_limit: true,
      maximum_legacy_bytes: 65536,
      minimum_legacy_bytes: 8193,
      over_boundary_bytes: 8193,
      over_boundary_raw_utf8_sha256:
        "9c10c48d1f1d6618db88fde2c25409181c9201ed34ec6815d62bcf57c10d177b",
      over_boundary_revision_id: "96500000-0000-4000-8000-000000000001",
    },
  ]),
  {
    legacyRowCount: 2,
    legacyRows: [
      {
        bytes: 8193,
        id: "96500000-0000-4000-8000-000000000001",
        rawUtf8Sha256:
          "9c10c48d1f1d6618db88fde2c25409181c9201ed34ec6815d62bcf57c10d177b",
      },
      {
        bytes: 65536,
        id: "96500000-0000-4000-8000-000000000002",
        rawUtf8Sha256:
          "fce4d906c666cb2bc9d0f2d42a5e871f418c5e8dac03b4a4a60eed343b3480ec",
      },
    ],
    maximumLegacyBytes: 65536,
    minimumLegacyBytes: 8193,
    verifiedV1: true,
  },
);
assert.deepEqual(
  assertPhase2CoordinateUpgrade([
    {
      exact_v2_write_accepted: true,
      legacy_maximum_bytes: 65536,
      legacy_maximum_raw_utf8_sha256:
        "fce4d906c666cb2bc9d0f2d42a5e871f418c5e8dac03b4a4a60eed343b3480ec",
      legacy_maximum_revision_id: "96500000-0000-4000-8000-000000000002",
      legacy_rows_preserved: true,
      over_boundary_bytes: 8193,
      over_boundary_raw_utf8_sha256:
        "9c10c48d1f1d6618db88fde2c25409181c9201ed34ec6815d62bcf57c10d177b",
      over_boundary_revision_id: "96500000-0000-4000-8000-000000000001",
      oversized_v2_writes_rejected: true,
    },
  ]),
  {
    exactV2WriteAccepted: true,
    legacyRows: [
      {
        bytes: 8193,
        id: "96500000-0000-4000-8000-000000000001",
        rawUtf8Sha256:
          "9c10c48d1f1d6618db88fde2c25409181c9201ed34ec6815d62bcf57c10d177b",
      },
      {
        bytes: 65536,
        id: "96500000-0000-4000-8000-000000000002",
        rawUtf8Sha256:
          "fce4d906c666cb2bc9d0f2d42a5e871f418c5e8dac03b4a4a60eed343b3480ec",
      },
    ],
    legacyRowsPreserved: true,
    oversizedV2WritesRejected: true,
  },
);
assert.throws(() =>
  assertPhase2CoordinateUpgrade([
    {
      exact_v2_write_accepted: true,
      legacy_maximum_bytes: 65536,
      legacy_maximum_raw_utf8_sha256:
        "fce4d906c666cb2bc9d0f2d42a5e871f418c5e8dac03b4a4a60eed343b3480ec",
      legacy_maximum_revision_id: "96500000-0000-4000-8000-000000000002",
      legacy_rows_preserved: false,
      over_boundary_bytes: 8193,
      over_boundary_raw_utf8_sha256:
        "9c10c48d1f1d6618db88fde2c25409181c9201ed34ec6815d62bcf57c10d177b",
      over_boundary_revision_id: "96500000-0000-4000-8000-000000000001",
      oversized_v2_writes_rejected: true,
    },
  ]),
);
assert.throws(() =>
  assertPhase2CoordinateUpgrade([
    {
      exact_v2_write_accepted: true,
      legacy_maximum_bytes: 65536,
      legacy_maximum_raw_utf8_sha256:
        "fce4d906c666cb2bc9d0f2d42a5e871f418c5e8dac03b4a4a60eed343b3480ec",
      legacy_maximum_revision_id: "96500000-0000-4000-8000-000000000002",
      legacy_rows_preserved: true,
      over_boundary_bytes: 8193,
      over_boundary_raw_utf8_sha256: "0".repeat(64),
      over_boundary_revision_id: "96500000-0000-4000-8000-000000000001",
      oversized_v2_writes_rejected: true,
    },
  ]),
);

console.log("PASS Phase 2 database policy positive and negative-control mutations");

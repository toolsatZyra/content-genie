import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import postgres from "postgres";

import {
  assertDatabaseIdentityChallenge,
  assertEphemeralBranchDatabase,
} from "./database-harness-policy.mjs";
import {
  strictDatabaseInteger,
  terminalDatabaseRows,
} from "./direct-database-result.mjs";
import {
  assertCompletePgTapResult,
  getPlannedPgTapAssertions,
  hardenPgTapQuery,
} from "./pgtap-harness-policy.mjs";
import {
  assertPostgresCredentialAbsentFromArgv,
  buildPostgresPgpassTransport,
  digestCandidateEntries,
} from "./live-evidence-policy.mjs";
import {
  assertPrivateRuntimeFile,
  createPrivateRuntimeDirectory,
  DATABASE_PGPASS_PREFIX,
  LIVE_CREDENTIALS_PREFIX,
  privateRuntimePermissionLabel,
  removePrivateRuntimeDirectory,
  writePrivateRuntimeFile,
} from "./private-runtime-path.mjs";
import {
  assertPhase2CoordinatePredecessorFixture,
  assertPhase2CoordinatePredecessorSeed,
  assertPhase2CoordinateUpgrade,
  buildPhase2CoordinatePredecessorReconstructionSql,
  buildPhase2CoordinatePredecessorSeedSql,
  buildPhase2CoordinateUpgradeVerificationSql,
} from "./phase2-coordinate-upgrade-drill.mjs";
import {
  candidateMigrationVersion,
  loadPhase2CandidateMigrationInventory,
} from "./phase2-candidate-migration-inventory.mjs";
import {
  isTransientCliFailureOutput,
  isTransientDatabaseFailureOutput,
  isTransientReadinessStatus,
  isTransientTransportError,
} from "./transient-failure-policy.mjs";

const node = process.execPath;
const supabaseCli = resolve("node_modules", "supabase", "dist", "supabase.js");
const boundCandidateTree = process.env.GENIE_LIVE_BOUND_TREE?.trim();
const snapshotSeal = process.env.GENIE_LIVE_SNAPSHOT_SEAL?.trim();
const configuredArtifactPath = process.env.GENIE_LIVE_ARTIFACT_PATH?.trim();
if (
  !boundCandidateTree ||
  !/^[a-f0-9]{40,64}$/.test(boundCandidateTree) ||
  !snapshotSeal ||
  !configuredArtifactPath ||
  !isAbsolute(configuredArtifactPath)
) {
  throw new Error("The live suite requires a sealed staged-snapshot launcher.");
}
const liveArtifactPath = configuredArtifactPath;
const boundaryEvidencePath = ".tmp/phase2-live-boundary-evidence.json";
const startedAt = new Date().toISOString();

await mkdir(".tmp/artifacts", { recursive: true });
await writeFile(
  liveArtifactPath,
  JSON.stringify(
    {
      outcome: "running",
      schemaVersion: "genie-live-candidate-evidence.v3",
      startedAt,
      state: "running",
    },
    null,
    2,
  ),
);

const inheritedRuntimeEnvironment = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "OS",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

function operatingSystemEnvironment(source) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined && inheritedRuntimeEnvironment.has(name.toUpperCase()),
    ),
  );
}

const operatingEnvironment = operatingSystemEnvironment(process.env);
async function collectDirectoryFiles(directory) {
  const collected = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory())
      collected.push(...(await collectDirectoryFiles(entryPath)));
    else if (entry.isFile()) collected.push(entryPath);
  }
  return collected;
}

async function digestCandidateFiles({ directories = [], files = [] }) {
  const paths = [...files];
  for (const directory of directories) {
    paths.push(...(await collectDirectoryFiles(directory)));
  }
  return digestCandidateEntries(
    await Promise.all(
      paths.map(async (path) => ({ contents: await readFile(path), path })),
    ),
  );
}

async function buildCandidateBinding() {
  return Object.freeze({
    databaseTests: await digestCandidateFiles({ directories: ["supabase/tests"] }),
    gitTree: boundCandidateTree,
    liveTests: await digestCandidateFiles({
      directories: ["tests/live"],
      files: ["playwright.live.config.ts"],
    }),
    migrations: await digestCandidateFiles({ directories: ["supabase/migrations"] }),
    snapshotSeal,
    source: await digestCandidateFiles({
      directories: ["src", "scripts", "public", "supabase/templates"],
      files: ["package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json"],
    }),
  });
}

function run(command, args, options = {}) {
  if (!options.env || options.env === process.env) {
    throw new Error("Every child process requires an explicit isolated environment.");
  }
  assertDatabaseSecretsAbsentFromArgv(args);
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options.env,
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (options.allowTransientFailure && isTransientCliFailureOutput(output)) {
      return "";
    }
    throw new Error(options.failureMessage ?? `${command} exited unsuccessfully.`);
  }
  return result.stdout ?? "";
}

async function runRetrying(
  command,
  args,
  { attempts = 30, env, failureMessage, intervalMs = 5_000 } = {},
) {
  if (!env || env === process.env) {
    throw new Error(
      "Every retrying child process requires an explicit isolated environment.",
    );
  }
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    assertDatabaseSecretsAbsentFromArgv(args);
    const result = spawnSync(command, args, {
      encoding: "utf8",
      env,
      shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
      stdio: "pipe",
    });
    if (result.error) throw result.error;
    if (result.status === 0) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return;
    }
    const transient = isTransientCliFailureOutput(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
    if (!transient || attempt === attempts) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      throw new Error(
        !transient
          ? `Non-transient database failure: ${failureMessage ?? `${command} exited unsuccessfully.`}`
          : (failureMessage ?? `${command} exited unsuccessfully.`),
      );
    }
    console.warn(
      `Database operation is not ready (attempt ${attempt}/${attempts}); retrying.`,
    );
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function branchValue(details, name) {
  return details && typeof details === "object" && typeof details[name] === "string"
    ? details[name]
    : null;
}

async function executeDirectSql(query) {
  if (!databaseCredentialSourceUrl) {
    throw new Error("The disposable database target is unavailable.");
  }
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const sql = postgres(databaseCredentialSourceUrl, {
      connect_timeout: 20,
      idle_timeout: 1,
      max: 1,
      onnotice: () => {},
      prepare: false,
      ssl: "require",
    });
    try {
      return terminalDatabaseRows(await sql.unsafe(query));
    } catch (error) {
      if (!isTransientDatabaseFailureOutput(String(error)) || attempt === 15) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
  throw new Error("Disposable database query exhausted its retry budget.");
}

async function proveDirectDatabaseTarget() {
  const challengeNonce = process.env.GENIE_LIVE_DB_CHALLENGE_NONCE?.trim();
  const challengeTable = process.env.GENIE_LIVE_DB_CHALLENGE_TABLE?.trim();
  if (
    !/^[0-9a-f-]{36}$/i.test(challengeNonce ?? "") ||
    !/^phase2_connection_challenge_[0-9a-f]{32}$/.test(challengeTable ?? "") ||
    process.env.GENIE_LIVE_PRODUCTION_ABSENCE_VERIFIED !== "1"
  ) {
    throw new Error("Trusted database identity challenge is invalid.");
  }
  try {
    const directRows = await executeDirectSql(
      `select challenge_nonce::text as challenge_nonce from private.${challengeTable}`,
    );
    assertDatabaseIdentityChallenge({
      directRows,
      expectedNonce: challengeNonce,
      productionRows: [{ challenge_present: false }],
    });
  } finally {
    await executeDirectSql(`drop table if exists private.${challengeTable}`);
  }
}

async function runRemotePgTap() {
  const testFiles = (await readdir("supabase/tests"))
    .filter((file) => file.endsWith(".test.sql"))
    .sort();
  if (testFiles.length === 0) {
    throw new Error("No pgTAP test files were found.");
  }
  const evidence = [];
  for (const testFile of testFiles) {
    const source = await readFile(`supabase/tests/${testFile}`, "utf8");
    const planned = getPlannedPgTapAssertions(source, testFile);
    const query = hardenPgTapQuery(source, testFile);
    const result = await executeDirectSql(query);
    assertCompletePgTapResult(result, planned, testFile);
    evidence.push(
      Object.freeze({
        assertionsPassed: planned,
        hardenedQuerySha256: sha256(query),
        databaseResultSha256: sha256(JSON.stringify(result)),
        plannedAssertions: planned,
        resultRowCount: result.length,
        sourceSha256: sha256(source),
        testFile,
      }),
    );
    console.log(`PASS remote pgTAP ${testFile}: ${planned}/${planned}`);
  }
  return Object.freeze(evidence);
}

async function waitForSupabaseApi(supabaseUrl, anonKey) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers: { apikey: anonKey },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return attempt;
      if (!isTransientReadinessStatus(response.status)) {
        throw new Error(
          `The live-suite Supabase Auth API failed deterministically with HTTP ${response.status}.`,
        );
      }
    } catch (error) {
      if (!isTransientTransportError(error)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("The live-suite Supabase Auth API did not become ready.");
}

const phase2RawScript =
  "प्रभात की पहली श्वास\r\nदेवी ने é की ध्वनि सुनी और मुस्कुराईं। 👩🏽‍🚀\r\nॐ नमः शिवाय।";
const phase2FemaleVoiceVersionId = "bb2db360-9e44-5e17-95d3-a1e38ef21fa7";
const phase2DivineFuryLookVersionId = "d2020261-8b9e-586a-aed6-f206a0d753c5";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function verifyPhase2Persistence(episodeId) {
  if (!/^[0-9a-f-]{36}$/i.test(episodeId)) {
    throw new Error("The live Episode ID is not a UUID.");
  }
  const rows = await executeDirectSql(
    `select s.raw_text, encode(s.raw_utf8, 'hex') as raw_utf8_hex, s.raw_utf8_sha256, s.processing_text, s.processing_utf8_sha256, s.processing_profile, s.coordinate_map, s.runtime_evidence, s.duration_estimation_profile, s.duration_out_of_band, s.duration_acknowledged, e.workflow_state, e.aggregate_version as episode_version, c.aggregate_version as configuration_version, c.narrator_gender, c.voice_version_id, c.look_version_id, (select count(*)::integer from public.script_lock_events le where le.script_revision_id = s.id) as lock_event_count, (select count(*)::integer from public.episode_configuration_candidates candidate where candidate.script_revision_id = s.id and candidate.state = 'world_design') as configuration_count, (select count(*)::integer from private.script_coordinate_attestations a where a.episode_id = s.episode_id) as remaining_attestations from public.script_revisions s join public.episodes e on e.workspace_id = s.workspace_id and e.id = s.episode_id join public.episode_configuration_candidates c on c.workspace_id = s.workspace_id and c.episode_id = s.episode_id and c.script_revision_id = s.id and c.state = 'world_design' where s.episode_id = '${episodeId}'::uuid`,
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  const processingText = phase2RawScript
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC");
  assert.equal(row.raw_text, phase2RawScript);
  assert.equal(row.raw_utf8_hex, Buffer.from(phase2RawScript, "utf8").toString("hex"));
  assert.equal(row.raw_utf8_sha256, sha256(phase2RawScript));
  assert.equal(row.processing_text, processingText);
  assert.equal(row.processing_utf8_sha256, sha256(processingText));
  assert.equal(row.processing_profile, "genie-script-processing.v1");
  assert.equal(row.coordinate_map.v, 2);
  assert.equal(row.coordinate_map.c, "zero-based-half-open");
  assert.deepEqual(Object.keys(row.coordinate_map).sort(), ["c", "p", "r", "s", "v"]);
  assert.equal(
    row.coordinate_map.s.some(([reason]) => reason === 1 || reason === 3),
    true,
  );
  assert.equal(
    row.coordinate_map.s.some(([reason]) => reason === 2 || reason === 3),
    true,
  );
  assert.deepEqual(Object.keys(row.runtime_evidence).sort(), [
    "graphemeProbeSha256",
    "graphemeSegmenterProfile",
    "icuVersion",
    "nodeVersion",
    "unicodeVersion",
  ]);
  assert.equal(
    row.runtime_evidence.graphemeSegmenterProfile,
    "unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47",
  );
  assert.equal(row.runtime_evidence.unicodeVersion, "17.0.0");
  assert.equal(
    row.runtime_evidence.graphemeProbeSha256,
    "472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096",
  );
  assert.equal(
    row.duration_estimation_profile,
    "genie-hindi-conversational-expressive-duration.v2",
  );
  const episodeVersion = strictDatabaseInteger(
    row.episode_version,
    "Episode aggregate version",
  );
  const configurationVersion = strictDatabaseInteger(
    row.configuration_version,
    "configuration aggregate version",
  );
  const lockEventCount = strictDatabaseInteger(
    row.lock_event_count,
    "script lock-event count",
  );
  const configurationCount = strictDatabaseInteger(
    row.configuration_count,
    "configuration count",
  );
  const remainingAttestations = strictDatabaseInteger(
    row.remaining_attestations,
    "remaining coordinate-attestation count",
  );
  assert.equal(row.duration_out_of_band, true);
  assert.equal(row.duration_acknowledged, true);
  assert.equal(row.workflow_state, "world_setup");
  assert.equal(episodeVersion, 4);
  assert.equal(configurationVersion, 3);
  assert.equal(row.narrator_gender, "female");
  assert.equal(row.voice_version_id, phase2FemaleVoiceVersionId);
  assert.equal(row.look_version_id, phase2DivineFuryLookVersionId);
  assert.equal(lockEventCount, 1);
  assert.equal(configurationCount, 1);
  assert.equal(remainingAttestations, 0);
  return Object.freeze({
    configurationCount,
    coordinateMapVersion: row.coordinate_map.v,
    episodeId,
    lockEventCount,
    processingUtf8Sha256: row.processing_utf8_sha256,
    rawUtf8Sha256: row.raw_utf8_sha256,
    remainingAttestations,
  });
}

function parseBoundaryEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The live boundary evidence is not an object.");
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "accepted",
    "browserRoundTrip",
    "rejected",
    "schemaVersion",
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error("The live boundary evidence has unexpected keys.");
  }
  const { accepted, rejected } = value;
  if (
    value.schemaVersion !== "genie-script-boundary-evidence.v1" ||
    value.browserRoundTrip !== true ||
    !accepted ||
    typeof accepted !== "object" ||
    Array.isArray(accepted) ||
    accepted.bytes !== 8192 ||
    accepted.status !== 200 ||
    typeof accepted.episodeId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(accepted.episodeId) ||
    typeof accepted.scriptRevisionId !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(accepted.scriptRevisionId) ||
    typeof accepted.rawUtf8Sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(accepted.rawUtf8Sha256) ||
    !rejected ||
    typeof rejected !== "object" ||
    Array.isArray(rejected) ||
    rejected.bytes !== 8193 ||
    rejected.status !== 400 ||
    rejected.code !== "SCRIPT_TOO_LARGE"
  ) {
    throw new Error("The live boundary evidence is incomplete or invalid.");
  }
  return value;
}

function parseHarnessHandoff(value) {
  const handoff = JSON.parse(value.trim());
  const credentialKeys = [
    "email",
    "episodeId",
    "objectPath",
    "outsiderEmail",
    "password",
    "seriesId",
    "workspaceId",
  ];
  if (
    !handoff ||
    typeof handoff !== "object" ||
    Array.isArray(handoff) ||
    JSON.stringify(Object.keys(handoff).sort()) !==
      JSON.stringify(["credentials", "evidence"]) ||
    !handoff.credentials ||
    JSON.stringify(Object.keys(handoff.credentials).sort()) !==
      JSON.stringify(credentialKeys) ||
    credentialKeys.some(
      (key) =>
        typeof handoff.credentials[key] !== "string" || !handoff.credentials[key],
    ) ||
    !handoff.evidence ||
    typeof handoff.evidence !== "object"
  ) {
    throw new Error("The live harness returned an invalid private handoff.");
  }
  return handoff;
}

async function verifyBoundaryPersistence(browserEvidence) {
  const accepted = browserEvidence.accepted;
  const rows = await executeDirectSql(
    `select s.id::text as script_revision_id, octet_length(s.raw_utf8)::integer as raw_utf8_bytes, s.raw_utf8_sha256, s.coordinate_map ->> 'v' as coordinate_map_version, s.coordinate_map_verifier, pg_column_size(s.coordinate_map)::integer as coordinate_map_bytes, (select count(*)::integer from private.script_coordinate_attestations a where a.episode_id = s.episode_id) as remaining_attestations from public.script_revisions s where s.episode_id = '${accepted.episodeId}'::uuid`,
  );
  assert.equal(rows.length, 1);
  const row = rows[0];
  const rawUtf8Bytes = strictDatabaseInteger(
    row.raw_utf8_bytes,
    "raw UTF-8 byte count",
  );
  const coordinateMapBytes = strictDatabaseInteger(
    row.coordinate_map_bytes,
    "coordinate-map byte count",
  );
  const remainingAttestations = strictDatabaseInteger(
    row.remaining_attestations,
    "remaining boundary coordinate-attestation count",
  );
  assert.equal(row.script_revision_id, accepted.scriptRevisionId);
  assert.equal(rawUtf8Bytes, 8192);
  assert.equal(row.raw_utf8_sha256, accepted.rawUtf8Sha256);
  assert.equal(row.coordinate_map_version, "2");
  assert.equal(row.coordinate_map_verifier, "postgres-structural-v2");
  assert.ok(coordinateMapBytes > 0 && coordinateMapBytes <= 8388608);
  assert.equal(remainingAttestations, 0);
  return Object.freeze({
    ...browserEvidence,
    database: Object.freeze({
      coordinateMapBytes,
      coordinateMapVerifier: row.coordinate_map_verifier,
      coordinateMapVersion: 2,
      rawUtf8Bytes,
      rawUtf8Sha256: row.raw_utf8_sha256,
      remainingAttestations,
      scriptRevisionId: row.script_revision_id,
    }),
  });
}

function migrationVersions(rows) {
  if (!Array.isArray(rows))
    throw new Error("Migration history query returned no row array.");
  return rows.map((row) => {
    const version = row?.version;
    if (typeof version !== "string" || !/^\d{14}$/.test(version)) {
      throw new Error("Migration history returned an invalid version.");
    }
    return version;
  });
}

const branchName = process.env.GENIE_LIVE_BRANCH_NAME?.trim() ?? null;
let candidate = null;
let candidateBindingVerified = false;
let candidateRevalidatedAt = null;
let predecessorFixture = null;
const productionProjectRef =
  process.env.GENIE_LIVE_PRODUCTION_PROJECT_REF?.trim() ?? null;
const branchId = process.env.GENIE_LIVE_BRANCH_ID?.trim() ?? null;
const branchProjectRef = process.env.GENIE_LIVE_TEST_PROJECT_REF?.trim() ?? null;
let apiReadinessAttempts = 0;
let databaseIdentityChallenge = "not-run";
let forwardRollback = "not-run";
let outcome = "failed";
let boundaryEvidence = null;
let forwardUpgradeEvidence = null;
let pgTapSuites = [];
let phase2PersistenceEvidence = null;
let databasePgpassEnvironment = null;
let databasePgpassDirectoryPath = null;
let databasePgpassFilePath = null;
let databaseTargetUrl = null;
let databasePgpassDirectoryCreated = false;
let databasePgpassDirectoryDeleted = true;
let databasePgpassFileCreated = false;
let databasePgpassFileDeleted = true;
let databasePgpassFileMode = null;
let databaseArgvGuardedInvocations = 0;
let databaseCredentialSourceUrl = null;
let liveCredentialsDirectoryPath = null;
let liveCredentialsFilePath = null;
let liveCredentialsDirectoryCreated = false;
let liveCredentialsDirectoryDeleted = true;
let liveCredentialsFileCreated = false;
let liveCredentialsFileMode = null;
let executionCompleted = false;
let executionError = null;
let cleanupError = null;
let candidateBindingError = null;

function assertDatabaseSecretsAbsentFromArgv(args) {
  if (!databaseCredentialSourceUrl) return;
  assertPostgresCredentialAbsentFromArgv(args, databaseCredentialSourceUrl);
  databaseArgvGuardedInvocations += 1;
}

try {
  candidate = await buildCandidateBinding();
  predecessorFixture = assertPhase2CoordinatePredecessorFixture();
  await writeFile(
    liveArtifactPath,
    JSON.stringify(
      {
        candidate,
        outcome: "running",
        predecessorFixture,
        schemaVersion: "genie-live-candidate-evidence.v3",
        startedAt,
        state: "running",
      },
      null,
      2,
    ),
  );
  const details = Object.freeze({
    POSTGRES_URL: process.env.GENIE_LIVE_POSTGRES_URL?.trim(),
    SUPABASE_ANON_KEY: process.env.GENIE_LIVE_SUPABASE_ANON_KEY?.trim(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY?.trim(),
    SUPABASE_URL: process.env.GENIE_LIVE_SUPABASE_URL?.trim(),
  });
  if (
    !branchName ||
    !branchId ||
    !branchProjectRef ||
    !productionProjectRef ||
    Object.values(details).some((value) => !value) ||
    new URL(details.SUPABASE_URL).hostname.split(".")[0] !== branchProjectRef ||
    branchProjectRef === productionProjectRef
  ) {
    throw new Error("The trusted launcher supplied an invalid disposable branch.");
  }
  const supabaseUrl = details.SUPABASE_URL;
  const databaseUrl = details.POSTGRES_URL.replace(":6543/", ":5432/");
  assertEphemeralBranchDatabase(
    databaseUrl,
    undefined,
    branchProjectRef,
    productionProjectRef,
  );
  databaseCredentialSourceUrl = databaseUrl;
  await proveDirectDatabaseTarget();
  databaseIdentityChallenge = "passed";
  const pgpassTransport = buildPostgresPgpassTransport(databaseUrl);
  databasePgpassDirectoryPath =
    await createPrivateRuntimeDirectory(DATABASE_PGPASS_PREFIX);
  databasePgpassDirectoryCreated = true;
  databasePgpassDirectoryDeleted = false;
  databasePgpassFilePath = join(databasePgpassDirectoryPath, "credentials.pgpass");
  await writePrivateRuntimeFile(
    databasePgpassFilePath,
    pgpassTransport.pgpassLine,
    DATABASE_PGPASS_PREFIX,
  );
  databasePgpassFileCreated = true;
  databasePgpassFileDeleted = false;
  databasePgpassFileMode = privateRuntimePermissionLabel();
  databaseTargetUrl = pgpassTransport.passwordlessUrl;
  databasePgpassEnvironment = {
    ...operatingEnvironment,
    GENIE_EPHEMERAL_DB_TARGET: databaseTargetUrl,
    GENIE_EPHEMERAL_DB_IDENTITY_VERIFIED: branchProjectRef,
    PGPASSFILE: databasePgpassFilePath,
  };
  const phase1MigrationVersions = (await readdir("supabase/migrations"))
    .filter((file) => file.endsWith(".sql") && file.includes("_phase1_"))
    .map((file) => file.split("_", 1)[0])
    .sort();
  if (phase1MigrationVersions.length === 0) {
    throw new Error("No Phase 1 migrations were found for cloned-schema repair.");
  }
  const expectedPhase2MigrationPaths = await loadPhase2CandidateMigrationInventory();
  const expectedPhase2Versions = expectedPhase2MigrationPaths.map(
    candidateMigrationVersion,
  );
  const terminalForwardMigration = "20260717121607";
  const predecessorPhase2Versions = expectedPhase2Versions.filter(
    (version) => version !== terminalForwardMigration,
  );
  if (!expectedPhase2Versions.includes(terminalForwardMigration)) {
    throw new Error("The Phase 2 terminal forward migration is missing.");
  }
  const phase2HistoryQuery = `select version::text as version from supabase_migrations.schema_migrations where version::text = any(array[${expectedPhase2Versions.map((version) => `'${version}'`).join(",")}]) order by version`;
  await runRetrying(
    node,
    [
      supabaseCli,
      "migration",
      "repair",
      ...phase1MigrationVersions,
      "--status",
      "applied",
      "--db-url",
      databaseTargetUrl,
    ],
    {
      env: databasePgpassEnvironment,
      failureMessage: "The live-suite database did not accept history repair.",
    },
  );
  await runRetrying(
    node,
    [
      supabaseCli,
      "migration",
      "repair",
      terminalForwardMigration,
      "--status",
      "applied",
      "--db-url",
      databaseTargetUrl,
    ],
    {
      env: databasePgpassEnvironment,
      failureMessage:
        "The live-suite database could not pause before the terminal migration.",
    },
  );
  await runRetrying(
    node,
    [
      supabaseCli,
      "migration",
      "up",
      "--db-url",
      databaseTargetUrl,
      "--include-all",
      "--yes",
    ],
    {
      env: databasePgpassEnvironment,
      failureMessage: "The live-suite database did not accept migration up.",
    },
  );
  await runRetrying(
    node,
    [
      supabaseCli,
      "migration",
      "repair",
      terminalForwardMigration,
      "--status",
      "reverted",
      "--db-url",
      databaseTargetUrl,
    ],
    {
      env: databasePgpassEnvironment,
      failureMessage:
        "The live-suite database could not expose the terminal migration.",
    },
  );
  const preexistingPhase2Versions = migrationVersions(
    await executeDirectSql(phase2HistoryQuery),
  );
  assert.deepEqual(preexistingPhase2Versions, predecessorPhase2Versions);
  const executionPredecessorFixture = assertPhase2CoordinatePredecessorFixture();
  assert.deepEqual(executionPredecessorFixture, predecessorFixture);
  const predecessorContractRows = await executeDirectSql(
    buildPhase2CoordinatePredecessorReconstructionSql(),
  );
  assert.deepEqual(predecessorContractRows, [
    {
      legacy_size_constraint_restored: true,
      legacy_unique_attestation_index_restored: true,
      size_policy_absent: true,
      v1_default_restored: true,
    },
  ]);
  const predecessorContract = Object.freeze({
    coordinateMapVerifierDefault: "postgres-structural-v1",
    legacyMaximumBytes: 65536,
    scriptSizePolicyColumnAbsent: true,
    uniqueAttestationIndex: true,
  });
  const predecessorSeed = assertPhase2CoordinatePredecessorSeed(
    await executeDirectSql(buildPhase2CoordinatePredecessorSeedSql()),
  );
  await runRetrying(
    node,
    [
      supabaseCli,
      "migration",
      "up",
      "--db-url",
      databaseTargetUrl,
      "--include-all",
      "--yes",
    ],
    {
      env: databasePgpassEnvironment,
      failureMessage:
        "The live-suite database rejected the terminal forward migration.",
    },
  );
  const appliedPhase2Versions = migrationVersions(
    await executeDirectSql(phase2HistoryQuery),
  );
  assert.deepEqual(appliedPhase2Versions, expectedPhase2Versions);
  const exercisedUpgrade = assertPhase2CoordinateUpgrade(
    await executeDirectSql(buildPhase2CoordinateUpgradeVerificationSql()),
  );
  forwardUpgradeEvidence = Object.freeze({
    appliedPhase2Versions,
    expectedPhase2Versions,
    predecessorContract,
    predecessorFixture: executionPredecessorFixture,
    predecessorSeed,
    predecessorUpgradeExercised: true,
    preexistingPhase2Versions,
    terminalForwardMigration,
    upgrade: exercisedUpgrade,
  });
  pgTapSuites = await runRemotePgTap();
  await runRetrying(
    node,
    [
      supabaseCli,
      "db",
      "lint",
      "--db-url",
      databaseTargetUrl,
      "--schema",
      "public,private,audit",
      "--level",
      "error",
      "--fail-on",
      "error",
    ],
    {
      env: databasePgpassEnvironment,
      failureMessage: "Disposable branch schema lint failed.",
    },
  );
  run(
    node,
    [
      "scripts/run-phase1-forward-rollback-drill.mjs",
      "--branch-ref",
      branchProjectRef,
      "--production-project-ref",
      productionProjectRef,
    ],
    {
      env: databasePgpassEnvironment,
      failureMessage: "Disposable branch forward-rollback drill failed.",
    },
  );
  forwardRollback = "passed";
  apiReadinessAttempts = await waitForSupabaseApi(
    supabaseUrl,
    branchValue(details, "SUPABASE_ANON_KEY"),
  );
  liveCredentialsDirectoryPath = await createPrivateRuntimeDirectory(
    LIVE_CREDENTIALS_PREFIX,
  );
  liveCredentialsDirectoryCreated = true;
  liveCredentialsDirectoryDeleted = false;
  liveCredentialsFilePath = join(liveCredentialsDirectoryPath, "credentials.json");
  liveCredentialsFileMode = privateRuntimePermissionLabel();
  const liveSetupEnvironment = {
    ...operatingEnvironment,
    // Newly reset Supabase preview branches do not attach the Realtime
    // replication tenant reliably. Realtime isolation is a separate live gate
    // against the long-lived preview project; every other boundary remains
    // isolated here and the trusted launcher deletes the whole branch.
    GENIE_LIVE_SKIP_REALTIME: "1",
    GENIE_LIVE_SUPABASE_ANON_KEY: branchValue(details, "SUPABASE_ANON_KEY"),
    GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY: branchValue(
      details,
      "SUPABASE_SERVICE_ROLE_KEY",
    ),
    GENIE_LIVE_SUPABASE_URL: supabaseUrl,
  };
  const harnessHandoff = parseHarnessHandoff(
    run(node, ["scripts/phase1-live-harness.mjs"], {
      capture: true,
      env: liveSetupEnvironment,
      failureMessage: "Phase 1 live setup and authorization probes failed.",
    }),
  );
  await writePrivateRuntimeFile(
    liveCredentialsFilePath,
    JSON.stringify(harnessHandoff.credentials),
    LIVE_CREDENTIALS_PREFIX,
  );
  await assertPrivateRuntimeFile(liveCredentialsFilePath, LIVE_CREDENTIALS_PREFIX);
  liveCredentialsFileCreated = true;
  const credentials = JSON.parse(await readFile(liveCredentialsFilePath, "utf8"));
  await rm(boundaryEvidencePath, { force: true });
  run(node, ["scripts/run-isolated-next-dev.mjs", "4176"], {
    env: {
      ...operatingEnvironment,
      GENIE_LIVE_SUPABASE_ANON_KEY: branchValue(details, "SUPABASE_ANON_KEY"),
      GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY: branchValue(
        details,
        "SUPABASE_SERVICE_ROLE_KEY",
      ),
      GENIE_LIVE_SUPABASE_URL: supabaseUrl,
      GENIE_LIVE_TEST_EMAIL: credentials.email,
      GENIE_LIVE_TEST_EPISODE_ID: credentials.episodeId,
      GENIE_LIVE_TEST_OBJECT_PATH: credentials.objectPath,
      GENIE_LIVE_TEST_OUTSIDER_EMAIL: credentials.outsiderEmail,
      GENIE_LIVE_TEST_PASSWORD: credentials.password,
      GENIE_LIVE_TEST_PROJECT_REF: branchProjectRef,
    },
    failureMessage: "Phase 1 authenticated live-browser journey failed.",
  });
  const browserBoundaryEvidence = parseBoundaryEvidence(
    JSON.parse(await readFile(boundaryEvidencePath, "utf8")),
  );
  phase2PersistenceEvidence = await verifyPhase2Persistence(credentials.episodeId);
  boundaryEvidence = await verifyBoundaryPersistence(browserBoundaryEvidence);
  executionCompleted = true;
} catch (error) {
  executionError = error;
} finally {
  try {
    const credentialCleanupErrors = [];
    try {
      await rm(".tmp/phase1-live-credentials.json", { force: true });
      await rm(boundaryEvidencePath, { force: true });
    } catch (error) {
      credentialCleanupErrors.push(error);
    }
    if (liveCredentialsDirectoryPath) {
      liveCredentialsFileCreated ||= Boolean(
        liveCredentialsFilePath && existsSync(liveCredentialsFilePath),
      );
      try {
        await removePrivateRuntimeDirectory(
          liveCredentialsDirectoryPath,
          LIVE_CREDENTIALS_PREFIX,
        );
      } catch (error) {
        credentialCleanupErrors.push(error);
      }
    }
    liveCredentialsDirectoryDeleted =
      !liveCredentialsDirectoryPath || !existsSync(liveCredentialsDirectoryPath);
    if (!liveCredentialsDirectoryDeleted) {
      credentialCleanupErrors.push(
        new Error("The live credentials directory still exists."),
      );
    }
    if (databasePgpassDirectoryPath) {
      try {
        await removePrivateRuntimeDirectory(
          databasePgpassDirectoryPath,
          DATABASE_PGPASS_PREFIX,
        );
      } catch (error) {
        credentialCleanupErrors.push(error);
      }
    }
    databasePgpassDirectoryDeleted =
      !databasePgpassDirectoryPath || !existsSync(databasePgpassDirectoryPath);
    databasePgpassFileDeleted =
      !databasePgpassFilePath || !existsSync(databasePgpassFilePath);
    if (!databasePgpassDirectoryDeleted || !databasePgpassFileDeleted) {
      credentialCleanupErrors.push(
        new Error("The PostgreSQL credential runtime still exists."),
      );
    }
    if (credentialCleanupErrors.length > 0) {
      throw new AggregateError(
        credentialCleanupErrors,
        "Private credential cleanup failed.",
      );
    }
  } catch (error) {
    const credentialError = error instanceof Error ? error.message : String(error);
    cleanupError = cleanupError
      ? `${cleanupError}; credential cleanup: ${credentialError}`
      : `credential cleanup: ${credentialError}`;
  }

  try {
    if (!candidate) {
      throw new Error("The initial candidate binding was not completed.");
    }
    const finalCandidate = await buildCandidateBinding();
    try {
      assert.deepEqual(finalCandidate, candidate);
    } catch {
      throw new Error(
        "The final candidate binding differs from the executed candidate.",
      );
    }
    const finalPredecessorFixture = assertPhase2CoordinatePredecessorFixture();
    try {
      assert.deepEqual(finalPredecessorFixture, predecessorFixture);
    } catch {
      throw new Error("The predecessor fixture provenance changed during execution.");
    }
    candidateBindingVerified = true;
    candidateRevalidatedAt = new Date().toISOString();
  } catch (error) {
    candidateBindingError = error instanceof Error ? error.message : String(error);
  }
  outcome =
    executionCompleted &&
    !executionError &&
    !cleanupError &&
    !candidateBindingError &&
    databaseArgvGuardedInvocations > 0 &&
    databasePgpassDirectoryDeleted &&
    databasePgpassFileDeleted &&
    liveCredentialsDirectoryDeleted
      ? "passed"
      : "failed";

  await writeFile(
    liveArtifactPath,
    JSON.stringify(
      {
        apiReadinessAttempts,
        boundaryEvidence,
        candidate,
        candidateBindingError,
        candidateBindingVerified,
        candidateRevalidatedAt,
        cleanupError,
        browserCredentialEvidence: {
          credentialDirectoryAbsent: liveCredentialsDirectoryDeleted,
          credentialDirectoryCreated: liveCredentialsDirectoryCreated,
          credentialFileCreated: liveCredentialsFileCreated,
          credentialFileMode: liveCredentialsFileMode,
        },
        databaseCredentialEvidence: {
          credentialDirectoryAbsent: databasePgpassDirectoryDeleted,
          credentialDirectoryCreated: databasePgpassDirectoryCreated,
          credentialFileAbsent: databasePgpassFileDeleted,
          credentialFileCreated: databasePgpassFileCreated,
          credentialFileMode: databasePgpassFileMode,
          guardedChildInvocations: databaseArgvGuardedInvocations,
          passwordlessTargetPassedInChildArgv: databaseArgvGuardedInvocations > 0,
          productionCredentialExcluded:
            databaseIdentityChallenge === "passed" &&
            Boolean(branchProjectRef) &&
            branchProjectRef !== productionProjectRef,
          secretPassedInChildArgv: databaseArgvGuardedInvocations > 0 ? false : null,
          transport: "pgpass",
        },
        databaseIdentityChallenge,
        executionCompleted,
        executionError: executionError ? "live-suite-execution-failed" : null,
        finishedAt: new Date().toISOString(),
        forwardRollback,
        forwardUpgradeEvidence,
        outcome,
        pgTapSuites,
        phase2PersistenceEvidence,
        predecessorFixture,
        schemaVersion: "genie-live-candidate-evidence.v3",
        startedAt,
        state: "finished",
      },
      null,
      2,
    ),
  );
}

const terminalErrors = [
  executionError,
  cleanupError ? new Error(cleanupError) : null,
  candidateBindingError ? new Error(candidateBindingError) : null,
].filter(Boolean);
if (terminalErrors.length === 1) throw terminalErrors[0];
if (terminalErrors.length > 1) {
  throw new AggregateError(terminalErrors, "The isolated live suite failed safely.");
}

console.log("PASS isolated candidate suite; trusted launcher owns branch cleanup");

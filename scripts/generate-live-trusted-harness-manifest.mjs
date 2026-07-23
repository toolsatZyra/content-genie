import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  getPlannedPgTapAssertions,
  hardenPgTapQuery,
} from "./pgtap-harness-policy.mjs";
import { assertPhase2CoordinatePredecessorFixture } from "./phase2-coordinate-upgrade-drill.mjs";
import {
  loadPhase2CandidateMigrationInventory,
  PHASE2_CANDIDATE_MIGRATION_INVENTORY_PATH,
} from "./phase2-candidate-migration-inventory.mjs";

export const TRUSTED_HARNESS_MANIFEST_PATH =
  "scripts/live-trusted-harness-manifest.v1.json";

const trustedSourceEntries = [
  ["src/app/api/internal/live-broker/route.ts", "broker-route"],
  ["src/server/live-broker-contract.ts", "broker-contract"],
  ["src/server/live-broker-evidence.ts", "evidence-signer"],
  ["src/server/live-broker-ledger.ts", "broker-ledger"],
  ["src/server/live-sandbox-control.ts", "broker-controller"],
  ["scripts/live-broker-signing.mjs", "request-signer"],
  ["scripts/trusted-live-branch-control.mjs", "trusted-branch-controller"],
  ["scripts/live-branch-reaper.mjs", "durable-branch-reaper"],
  ["scripts/reap-trusted-live-branches.mjs", "scheduled-reaper-entrypoint"],
  [".github/workflows/live-branch-reaper.yml", "scheduled-reaper-workflow"],
  ["scripts/remote-live-broker.mjs", "remote-broker-client"],
  ["scripts/run-frozen-live-suite.mjs", "trusted-launcher"],
  ["scripts/run-phase1-live-suite.mjs", "candidate-runner"],
  ["scripts/live-candidate-evidence.mjs", "strict-evidence-validator"],
  ["scripts/database-harness-policy.mjs", "database-boundary-policy"],
  ["scripts/direct-database-result.mjs", "database-result-validator"],
  ["scripts/live-evidence-policy.mjs", "candidate-binding-policy"],
  ["scripts/pgtap-harness-policy.mjs", "pgtap-hardening-policy"],
  ["scripts/phase1-live-harness.mjs", "live-authorization-harness"],
  ["scripts/phase2-coordinate-upgrade-drill.mjs", "predecessor-fixture-validator"],
  ["scripts/private-runtime-path.mjs", "credential-containment-policy"],
  ["scripts/run-isolated-next-dev.mjs", "isolated-browser-runner"],
  ["scripts/run-phase1-forward-rollback-drill.mjs", "forward-rollback-runner"],
  ["scripts/transient-failure-policy.mjs", "retry-policy"],
  [
    "scripts/phase2-candidate-migration-inventory.mjs",
    "candidate-migration-inventory-validator",
  ],
  [PHASE2_CANDIDATE_MIGRATION_INVENTORY_PATH, "candidate-migration-inventory"],
  ["supabase/tests/fixtures/phase2_coordinate_v1_verifiers.sql", "predecessor-fixture"],
  ["package.json", "package-manifest"],
  ["pnpm-lock.yaml", "dependency-lock"],
  ["pnpm-workspace.yaml", "package-manager-workspace"],
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalTrustedTextSource(value) {
  return value.replace(/\r\n/gu, "\n");
}

async function hashEntry(workspace, path, role) {
  const source = canonicalTrustedTextSource(
    await readFile(resolve(workspace, path), "utf8"),
  );
  return Object.freeze({
    path,
    role,
    sha256: sha256(source),
  });
}

async function namedFiles(workspace, directory, predicate) {
  return (await readdir(resolve(workspace, directory), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && predicate(entry.name))
    .map((entry) => `${directory}/${entry.name}`)
    .sort();
}

export function canonicalTrustedHarnessManifestSha256(manifest) {
  return sha256(JSON.stringify(manifest));
}

export async function buildTrustedHarnessManifest(workspace = resolve(".")) {
  const phase2Migrations = await loadPhase2CandidateMigrationInventory(workspace);
  const liveSpecs = [
    "playwright.live.config.ts",
    ...(await namedFiles(workspace, "tests/live", (name) => name.endsWith(".spec.ts"))),
  ];
  const pgTapPaths = await namedFiles(workspace, "supabase/tests", (name) =>
    name.endsWith(".test.sql"),
  );
  const pgTapSuites = await Promise.all(
    pgTapPaths.map(async (path) => {
      const source = canonicalTrustedTextSource(
        await readFile(resolve(workspace, path), "utf8"),
      );
      const testFile = path.split("/").at(-1);
      return Object.freeze({
        hardenedQuerySha256: sha256(hardenPgTapQuery(source, testFile)),
        plannedAssertions: getPlannedPgTapAssertions(source, testFile),
        sourceSha256: sha256(source),
        testFile,
      });
    }),
  );
  const entries = await Promise.all([
    ...trustedSourceEntries.map(([path, role]) => hashEntry(workspace, path, role)),
    ...phase2Migrations.map((path) => hashEntry(workspace, path, "phase2-migration")),
    ...liveSpecs.map((path) => hashEntry(workspace, path, "live-browser-spec")),
    ...pgTapPaths.map((path) => hashEntry(workspace, path, "pgtap-source")),
  ]);
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  const packageJson = JSON.parse(
    await readFile(resolve(workspace, "package.json"), "utf8"),
  );
  return Object.freeze({
    entries,
    liveSpecs,
    manifestPath: TRUSTED_HARNESS_MANIFEST_PATH,
    packageManager: Object.freeze({
      declaration: packageJson.packageManager,
      name: "pnpm",
      version: "11.9.0",
    }),
    pgTapSuites,
    phase2Migrations,
    predecessorFixture: assertPhase2CoordinatePredecessorFixture(),
    predecessorFixtureSource:
      "supabase/tests/fixtures/phase2_coordinate_v1_verifiers.sql",
    schemaVersion: "genie-live-trusted-harness-manifest.v1",
  });
}

export async function assertTrustedHarnessManifest(manifest, workspace = resolve(".")) {
  const expected = await buildTrustedHarnessManifest(workspace);
  assert.deepEqual(manifest, expected, "trusted live-harness manifest drifted");
  return Object.freeze({
    manifest,
    sha256: canonicalTrustedHarnessManifestSha256(manifest),
  });
}

async function main() {
  const workspace = resolve(".");
  const path = resolve(workspace, TRUSTED_HARNESS_MANIFEST_PATH);
  const expected = await buildTrustedHarnessManifest(workspace);
  const serialized = `${JSON.stringify(expected, null, 2)}\n`;
  if (process.argv.includes("--check")) {
    assert.equal(
      await readFile(path, "utf8"),
      serialized,
      "trusted live-harness manifest is not regenerated",
    );
  } else {
    await writeFile(path, serialized, "utf8");
  }
  console.log(
    `PASS trusted live-harness manifest ${canonicalTrustedHarnessManifestSha256(expected)}`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await main();
}

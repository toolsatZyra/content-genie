import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertTrustedHarnessManifest,
  canonicalTrustedHarnessManifestSha256,
  TRUSTED_HARNESS_MANIFEST_PATH,
} from "./generate-live-trusted-harness-manifest.mjs";

const manifest = JSON.parse(await readFile(TRUSTED_HARNESS_MANIFEST_PATH, "utf8"));
const validated = await assertTrustedHarnessManifest(manifest);
assert.match(validated.sha256, /^[a-f0-9]{64}$/u);
assert.equal(validated.sha256, canonicalTrustedHarnessManifestSha256(manifest));
assert.ok(manifest.entries.some(({ role }) => role === "candidate-runner"));
assert.ok(manifest.entries.some(({ role }) => role === "strict-evidence-validator"));
assert.ok(manifest.entries.some(({ role }) => role === "trusted-branch-controller"));
assert.ok(manifest.entries.some(({ role }) => role === "durable-branch-reaper"));
assert.ok(manifest.entries.some(({ role }) => role === "scheduled-reaper-entrypoint"));
assert.ok(manifest.entries.some(({ role }) => role === "scheduled-reaper-workflow"));
assert.equal(manifest.phase2Migrations.length, 88);
assert.deepEqual(
  manifest.pgTapSuites.map(({ testFile }) => testFile),
  [
    "phase1_foundation.test.sql",
    "phase2_executable_plan.test.sql",
    "phase2_preflight_provider_ingest.test.sql",
    "phase2_world_cultural.test.sql",
    "phase2_zero_spend_foundation.test.sql",
  ],
);
assert.deepEqual(manifest.packageManager, {
  declaration: "pnpm@11.9.0",
  name: "pnpm",
  version: "11.9.0",
});

for (const mutate of [
  (value) => {
    value.entries.find(({ role }) => role === "candidate-runner").sha256 = "0".repeat(
      64,
    );
  },
  (value) => {
    value.phase2Migrations.pop();
  },
  (value) => {
    value.liveSpecs.push("tests/live/hostile.spec.ts");
  },
  (value) => {
    value.pgTapSuites[0].hardenedQuerySha256 = "0".repeat(64);
  },
  (value) => {
    value.predecessorFixture.sha256 = "0".repeat(64);
  },
  (value) => {
    value.packageManager.version = "11.9.1";
  },
]) {
  const hostile = structuredClone(manifest);
  mutate(hostile);
  await assert.rejects(() => assertTrustedHarnessManifest(hostile));
}

console.log("PASS committed trusted-harness manifest and hostile drift controls");

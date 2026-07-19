import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  classifyStrictStaleBranch,
  liveBranchReaperTest,
  reapTrustedLiveBranches,
  reconcileTrustedBranchCleanupLeases,
  trustedLiveBranchReaperEnvironment,
} from "./live-branch-reaper.mjs";

const productionRef = "p".repeat(20);
const branchRef = "b".repeat(20);
const branchId = "72000000-0000-4000-8000-000000000001";
const branchName = "genie-live-12345678-9ab";
const cleanupLeaseId = "73000000-0000-4000-8000-000000000001";
const reaperOwner = "74000000-0000-4000-8000-000000000001";
const nowMs = Date.parse("2026-07-19T12:00:00.000Z");
const staleBranch = Object.freeze({
  created_at: "2026-07-19T04:00:00.000Z",
  id: branchId,
  is_default: false,
  name: branchName,
  parent_project_ref: productionRef,
  persistent: false,
  project_ref: branchRef,
});
const lease = Object.freeze({
  branchId,
  branchName,
  branchRef,
  cleanupLeaseId,
  leaseSource: "candidate",
  productionProjectRef: productionRef,
  reaperOwner,
  state: "reaping",
});

assert.throws(
  () =>
    trustedLiveBranchReaperEnvironment(
      { SUPABASE_PROJECT_REF: productionRef },
      { scheduled: true },
    ),
  /Scheduled live branch reaping requires SUPABASE_ACCESS_TOKEN/,
);
assert.throws(
  () =>
    trustedLiveBranchReaperEnvironment(
      { SUPABASE_ACCESS_TOKEN: "token", SUPABASE_PROJECT_REF: "wrong" },
      { scheduled: true },
    ),
  /not an exact project reference/,
);
assert.throws(
  () =>
    trustedLiveBranchReaperEnvironment({
      GENIE_LIVE_BRANCH_REAPER_MIN_AGE_MINUTES: "59",
      SUPABASE_ACCESS_TOKEN: "token",
      SUPABASE_PROJECT_REF: productionRef,
    }),
  /at least 60 minutes/,
);
assert.equal(
  trustedLiveBranchReaperEnvironment({
    SUPABASE_ACCESS_TOKEN: "token",
    SUPABASE_PROJECT_REF: productionRef,
  }).minimumAgeMs,
  6 * 60 * 60 * 1000,
);

assert.equal(
  classifyStrictStaleBranch({
    branch: staleBranch,
    minimumAgeMs: 6 * 60 * 60 * 1000,
    nowMs,
    productionRef,
  }).eligible,
  true,
);
assert.deepEqual(
  classifyStrictStaleBranch({
    branch: { ...staleBranch, name: "production" },
    minimumAgeMs: 6 * 60 * 60 * 1000,
    nowMs,
    productionRef,
  }),
  { eligible: false, ignored: true, reason: "name-pattern" },
);
assert.equal(
  classifyStrictStaleBranch({
    branch: { ...staleBranch, created_at: "2026-07-19T11:30:00.000Z" },
    minimumAgeMs: 6 * 60 * 60 * 1000,
    nowMs,
    productionRef,
  }).reason,
  "age-threshold",
);
for (const hostile of [
  { is_default: true },
  { persistent: true },
  { parent_project_ref: "q".repeat(20) },
  { project_ref: productionRef },
  { created_at: "not-a-date" },
  { id: "not-a-uuid" },
]) {
  assert.throws(() =>
    classifyStrictStaleBranch({
      branch: { ...staleBranch, ...hostile },
      minimumAgeMs: 6 * 60 * 60 * 1000,
      nowMs,
      productionRef,
    }),
  );
}

assert.throws(
  () =>
    liveBranchReaperTest.exactLeaseCollision(
      [{ ...lease, branchId: "72000000-0000-4000-8000-000000000099" }],
      {
        branchId,
        branchName,
        branchRef,
      },
    ),
  /hostile partial identity collision/,
);

const successfulOrder = [];
let successfulClaims = 0;
const reconciliation = await reconcileTrustedBranchCleanupLeases({
  accessToken: "token",
  async claimImpl() {
    successfulClaims += 1;
    return successfulClaims === 1 ? [lease] : [];
  },
  async cleanupImpl() {
    successfulOrder.push("three-absence-snapshots");
    return {
      confirmedAbsentSnapshots: 3,
      deleteRequested: true,
      outcome: "branch-delete-confirmed",
    };
  },
  async completeImpl({ cleanup }) {
    assert.equal(cleanup.confirmedAbsentSnapshots, 3);
    successfulOrder.push("durable-tombstone");
  },
  environment: {},
  node: "node",
  productionRef,
  reaperOwner,
  async releaseImpl() {
    throw new Error("release must not run after success");
  },
  supabaseCli: "supabase.js",
});
assert.deepEqual(successfulOrder, ["three-absence-snapshots", "durable-tombstone"]);
assert.equal(reconciliation.cleaned.length, 1);

let completionCalled = false;
const failedLease = { ...lease };
const laterLease = {
  ...lease,
  branchId: "72000000-0000-4000-8000-000000000002",
  branchName: "genie-live-aaaaaaaa-bbb",
  branchRef: "c".repeat(20),
  cleanupLeaseId: "73000000-0000-4000-8000-000000000002",
};
const releasedAfterFailure = [];
let failureClaims = 0;
const isolatedFailure = await reconcileTrustedBranchCleanupLeases({
  accessToken: "token",
  async claimImpl() {
    failureClaims += 1;
    return failureClaims === 1 ? [failedLease, laterLease] : [];
  },
  async cleanupImpl({ branchId: cleanupBranchId }) {
    return {
      confirmedAbsentSnapshots: cleanupBranchId === failedLease.branchId ? 2 : 3,
      deleteRequested: true,
    };
  },
  async completeImpl({ lease: completedLease }) {
    assert.equal(completedLease.cleanupLeaseId, laterLease.cleanupLeaseId);
    completionCalled = true;
  },
  environment: {},
  node: "node",
  productionRef,
  reaperOwner,
  async releaseImpl({ lease: releasedLease }) {
    releasedAfterFailure.push(releasedLease.cleanupLeaseId);
  },
  supabaseCli: "supabase.js",
});
assert.equal(completionCalled, true);
assert.deepEqual(releasedAfterFailure, [failedLease.cleanupLeaseId]);
assert.equal(isolatedFailure.cleaned.length, 1);
assert.equal(isolatedFailure.failures.length, 1);
assert.equal(isolatedFailure.failures[0].cleanupLeaseId, failedLease.cleanupLeaseId);
assert.equal(isolatedFailure.failures[0].releasedForRetry, true);

let orphanAdoptions = 0;
let orphanCompletions = 0;
let scheduledClaims = 0;
let scheduledFailureReleased = false;
const orphanResult = await reapTrustedLiveBranches({
  accessToken: "token",
  async adoptImpl({ branch, cleanupLeaseId: adoptedLeaseId, reaperOwner: owner }) {
    orphanAdoptions += 1;
    return {
      ...branch,
      cleanupLeaseId: adoptedLeaseId,
      leaseSource: "orphan_discovery",
      productionProjectRef: productionRef,
      reaperOwner: owner,
      state: "reaping",
    };
  },
  async claimImpl() {
    scheduledClaims += 1;
    return scheduledClaims === 1 ? [laterLease] : [];
  },
  async cleanupImpl({ branchId: cleanedId, branchRef: cleanedRef }) {
    if (cleanedId === laterLease.branchId) {
      throw new Error("simulated earlier lease failure");
    }
    assert.equal(cleanedId, branchId);
    assert.equal(cleanedRef, branchRef);
    return {
      confirmedAbsentSnapshots: 3,
      deleteRequested: true,
      outcome: "branch-delete-confirmed",
    };
  },
  async completeImpl({ cleanup }) {
    assert.equal(cleanup.confirmedAbsentSnapshots, 3);
    orphanCompletions += 1;
  },
  environment: {},
  listBranchesImpl() {
    return [
      staleBranch,
      { ...staleBranch, id: "72000000-0000-4000-8000-000000000002", name: "main" },
      {
        ...staleBranch,
        created_at: "2026-07-19T11:30:00.000Z",
        id: "72000000-0000-4000-8000-000000000003",
        name: "genie-live-aaaaaaaa-bbb",
        project_ref: "c".repeat(20),
      },
    ];
  },
  async listLeasesImpl() {
    return [];
  },
  minimumAgeMs: 6 * 60 * 60 * 1000,
  node: "node",
  nowMs,
  productionRef,
  reaperOwner,
  async releaseImpl({ lease: releasedLease }) {
    assert.equal(releasedLease.cleanupLeaseId, laterLease.cleanupLeaseId);
    scheduledFailureReleased = true;
  },
  supabaseCli: "supabase.js",
  uuidImpl: () => "75000000-0000-4000-8000-000000000001",
});
assert.equal(scheduledClaims, 2);
assert.equal(scheduledFailureReleased, true);
assert.equal(orphanAdoptions, 1);
assert.equal(orphanCompletions, 1);
assert.equal(orphanResult.orphaned.length, 1);
assert.equal(orphanResult.failures.length, 1);
assert.equal(orphanResult.failures[0].cleanupLeaseId, laterLease.cleanupLeaseId);

const workflow = await readFile(
  new URL("../.github/workflows/live-branch-reaper.yml", import.meta.url),
  "utf8",
);
assert.match(workflow, /schedule:/u);
assert.doesNotMatch(workflow, /workflow_dispatch:/u);
assert.match(workflow, /cancel-in-progress: false/u);
assert.match(workflow, /environment: genie-production-control/u);
assert.doesNotMatch(workflow, /\bref:\s*\$\{\{/u);
const reconciliationStep = workflow.indexOf(
  "- name: Reconcile exact disposable live branches",
);
assert.ok(reconciliationStep > workflow.indexOf("pnpm install --frozen-lockfile"));
assert.ok(
  workflow.indexOf("environment: genie-production-control") < reconciliationStep,
);
assert.doesNotMatch(
  workflow.slice(0, reconciliationStep),
  /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF/u,
);
assert.match(
  workflow.slice(reconciliationStep),
  /SUPABASE_ACCESS_TOKEN: \$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/u,
);
assert.match(
  workflow.slice(reconciliationStep),
  /SUPABASE_PROJECT_REF: \$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}/u,
);
assert.match(workflow, /GENIE_LIVE_BRANCH_REAPER_SCHEDULED: "true"/u);
assert.match(workflow, /pnpm live-branch:reap/u);

const runner = await readFile(
  new URL("./run-frozen-live-suite.mjs", import.meta.url),
  "utf8",
);
const startupReconciliation = runner.indexOf(
  "await reconcileTrustedBranchCleanupLeases",
);
const branchCreation = runner.indexOf("branch = await createTrustedDisposableBranch");
assert.ok(startupReconciliation >= 0 && startupReconciliation < branchCreation);
assert.ok(
  runner.indexOf("startupReconciliation.failures.length") > startupReconciliation &&
    runner.indexOf("startupReconciliation.failures.length") < branchCreation,
);
assert.match(runner, /onExactIdentity: async \(exactBranch\)/u);
assert.match(runner, /registerTrustedBranchCleanupLease/u);
assert.match(runner, /coordinatorOwner: cleanupReaperOwner/u);
assert.match(
  runner,
  /const ownFailure = reconciliation\.failures\.find\([\s\S]*ownFailure\.message/su,
);

const controlPlane = await readFile(
  new URL(
    "../supabase/migrations/20260717121609_phase2_live_broker_control_plane.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.match(controlPlane, /coordinator_owner uuid/u);
assert.match(controlPlane, /coordinator_lease_expires_at timestamptz/u);
assert.match(controlPlane, /statement_timestamp\(\) \+ interval '2 hours'/u);
assert.match(
  controlPlane,
  /state = 'registered'[\s\S]*coordinator_owner = p_reaper_owner[\s\S]*coordinator_lease_expires_at <= statement_timestamp\(\)/u,
);
assert.match(
  controlPlane,
  /state = 'reaping'[\s\S]*reaper_owner = p_reaper_owner[\s\S]*reaper_lease_expires_at <= statement_timestamp\(\)/u,
);

const reaperCli = await readFile(
  new URL("./reap-trusted-live-branches.mjs", import.meta.url),
  "utf8",
);
assert.doesNotMatch(reaperCli, /SERVICE_ROLE|NEXT_PUBLIC_SUPABASE/u);
assert.match(
  reaperCli,
  /environment\.SUPABASE_ACCESS_TOKEN = configuration\.accessToken/u,
);
assert.match(reaperCli, /failureCount: result\.failures\.length/u);
assert.match(reaperCli, /process\.exitCode = 1/u);

console.log(
  "PASS crash-resilient branch lease reconciliation, hostile identity guards, and scheduled orphan reaping",
);

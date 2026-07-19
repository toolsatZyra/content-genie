import assert from "node:assert/strict";

import {
  cleanupTrustedDisposableBranch,
  createTrustedDisposableBranch,
  trustedBranchIdentityTest,
} from "./trusted-live-branch-control.mjs";

const branchId = "71000000-0000-4000-8000-000000000001";
const branchName = "genie-live-12345678-9ab";
const productionRef = "p".repeat(20);
const branchRef = "b".repeat(20);
const exact = {
  created_at: "2026-07-18T00:00:00.000Z",
  id: branchId,
  is_default: false,
  name: branchName,
  parent_project_ref: productionRef,
  persistent: false,
  project_ref: branchRef,
};

assert.deepEqual(
  trustedBranchIdentityTest.exactIdentitySnapshot([exact], branchId, branchName).exact,
  [exact],
);
assert.deepEqual(
  trustedBranchIdentityTest.exactIdentitySnapshot(
    [{ id: "unrelated", name: "unrelated" }],
    branchId,
    branchName,
  ).exact,
  [],
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactIdentitySnapshot(
      [{ id: "different-id", name: branchName }],
      branchId,
      branchName,
    ),
  /ambiguous or has changed/,
);
assert.equal(
  trustedBranchIdentityTest.exactIdentitySnapshot(
    [exact],
    branchId,
    branchName,
    branchRef,
    productionRef,
  ).disposable.branchRef,
  branchRef,
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactIdentitySnapshot(
      [{ ...exact, persistent: true }],
      branchId,
      branchName,
      branchRef,
      productionRef,
    ),
  /never disposable/,
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactIdentitySnapshot(
      [{ ...exact, is_default: true }],
      branchId,
      branchName,
      branchRef,
      productionRef,
    ),
  /never disposable/,
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactIdentitySnapshot(
      [{ ...exact, parent_project_ref: "q".repeat(20) }],
      branchId,
      branchName,
      branchRef,
      productionRef,
    ),
  /not isolated under the exact parent/,
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactIdentitySnapshot(
      [
        exact,
        {
          ...exact,
          id: "71000000-0000-4000-8000-000000000099",
          name: "genie-live-aaaaaaaa-bbb",
        },
      ],
      branchId,
      branchName,
      branchRef,
      productionRef,
    ),
  /ambiguous or has changed/,
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactIdentitySnapshot(
      [{ id: branchId, name: "renamed" }],
      branchId,
      branchName,
    ),
  /ambiguous or has changed/,
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactIdentitySnapshot(
      [exact, { ...exact }],
      branchId,
      branchName,
    ),
  /duplicated/,
);

assert.equal(
  trustedBranchIdentityTest.exactNameSnapshot([exact], branchName).branchId,
  branchId,
);
assert.throws(
  () =>
    trustedBranchIdentityTest.exactNameSnapshot(
      [exact, { id: "another-id", name: branchName }],
      branchName,
    ),
  /name is duplicated/,
);

let createCalls = 0;
let readinessCalls = 0;
let registeredBeforeReadiness = false;
const recovered = await createTrustedDisposableBranch({
  branchName,
  environment: {},
  node: "node",
  onExactIdentity(exactBranch) {
    assert.equal(readinessCalls, 2);
    assert.equal(exactBranch.branchRef, branchRef);
    registeredBeforeReadiness = true;
  },
  productionRef,
  runCliImpl({ args }) {
    if (args[1] === "list") {
      readinessCalls += 1;
      if (readinessCalls === 1) return "[]";
      return JSON.stringify([
        {
          id: branchId,
          is_default: false,
          name: branchName,
          parent_project_ref: productionRef,
          persistent: false,
          preview_project_status: "ACTIVE_HEALTHY",
          project_ref: branchRef,
          status: "FUNCTIONS_DEPLOYED",
        },
      ]);
    }
    if (args[1] === "get") {
      return JSON.stringify({
        POSTGRES_URL: `postgresql://postgres:secret@db.${branchRef}.supabase.co:5432/postgres`,
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        SUPABASE_URL: `https://${branchRef}.supabase.co`,
      });
    }
    throw new Error(`Unexpected branch-control command: ${args.join(" ")}`);
  },
  runCliOutcomeImpl() {
    createCalls += 1;
    return {
      completionUnknown: true,
      output:
        "Timeout while shutting down PostHog. Some events may not have been sent.",
      status: 1,
      stdout: "",
    };
  },
  sleep: async () => {},
  supabaseCli: "supabase.js",
});
assert.equal(createCalls, 1, "an ambiguous creation must never be retried");
assert.equal(recovered.branchId, branchId);
assert.equal(recovered.branchRef, branchRef);
assert.equal(recovered.createCompletionUnknown, true);
assert.equal(registeredBeforeReadiness, true);

await assert.rejects(
  () =>
    createTrustedDisposableBranch({
      branchName,
      environment: {},
      node: "node",
      async onExactIdentity() {
        throw new Error("durable registration unavailable");
      },
      productionRef,
      runCliImpl({ args }) {
        if (args[1] === "list") return "[]";
        throw new Error(`Unexpected branch-control command: ${args.join(" ")}`);
      },
      runCliOutcomeImpl() {
        return {
          completionUnknown: false,
          output: "",
          status: 0,
          stdout: JSON.stringify(exact),
        };
      },
      sleep: async () => {},
      supabaseCli: "supabase.js",
    }),
  (error) => {
    assert.match(error.message, /durable registration unavailable/);
    assert.equal(error.branchId, branchId);
    assert.equal(error.branchRef, branchRef);
    assert.equal(error.exactIdentityRegistered, false);
    return true;
  },
);

const cleanupCalls = [];
let cleanupListCalls = 0;
const cleanup = await cleanupTrustedDisposableBranch({
  branchId: null,
  branchName,
  createAttempted: true,
  environment: {},
  node: "node",
  productionRef,
  runCliImpl({ args }) {
    cleanupCalls.push(args);
    if (args[1] === "delete") return "";
    cleanupListCalls += 1;
    return cleanupListCalls === 1 ? JSON.stringify([exact]) : "[]";
  },
  sleep: async () => {},
  supabaseCli: "supabase.js",
});
assert.equal(cleanup.outcome, "branch-delete-confirmed");
assert.equal(cleanup.branchId, branchId);
assert.equal(cleanup.branchRef, branchRef);
assert.equal(
  cleanupCalls.filter((args) => args[1] === "delete").length,
  1,
  "a recovered identity must be deleted exactly once",
);

await assert.rejects(
  () =>
    cleanupTrustedDisposableBranch({
      branchId: null,
      branchName,
      createAttempted: true,
      environment: {},
      node: "node",
      productionRef,
      runCliImpl() {
        return JSON.stringify([
          exact,
          {
            ...exact,
            id: "71000000-0000-4000-8000-000000000002",
          },
        ]);
      },
      sleep: async () => {},
      supabaseCli: "supabase.js",
    }),
  /name is duplicated/,
);

console.log(
  "PASS exact branch ID/name state machine, ambiguous-create recovery, and orphan cleanup hostile cases",
);

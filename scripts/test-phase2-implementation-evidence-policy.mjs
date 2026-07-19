import assert from "node:assert/strict";
import fs from "node:fs";

import { assertPhase2PromotionInputs } from "./phase2-implementation-evidence-policy.mjs";

const candidateCommit = "a".repeat(40);
const candidateTree = "b".repeat(40);
const candidateCommittedAt = Date.parse("2026-07-19T00:00:00.000Z");
const now = Date.parse("2026-07-19T04:00:00.000Z");

function validInputs() {
  return {
    candidateCommit,
    candidateCommittedAt,
    candidateTree,
    localGate: {
      candidate: { commit: candidateCommit, tree: candidateTree },
      completedAt: "2026-07-19T01:00:00.000Z",
      exitCode: 0,
      outcome: "passed",
      schemaVersion: "genie-precheckpoint-gate.v1",
    },
    now,
    remoteLiveSuite: {
      branchCleanup: {
        confirmedAbsentSnapshots: 3,
        outcome: "branch-delete-confirmed",
      },
      candidate: { gitTree: candidateTree },
      candidateBindingError: null,
      candidateBindingVerified: true,
      cleanupError: null,
      executionCompleted: true,
      executionError: null,
      executionSnapshot: {
        candidateCommit,
        candidateTree,
        dependencyTree: { verifiedUnchanged: true },
        directoryAbsent: true,
        source: "published-git-commit-in-vercel-firecracker-microvm",
      },
      finishedAt: "2026-07-19T02:00:00.000Z",
      outcome: "passed",
      remoteExecution: {
        brokerArtifact: {
          command: { exitCode: 0 },
          schemaVersion: "genie-trusted-live-harness-evidence.v1",
        },
        networkPolicyVerified: true,
        sandboxDeleted: true,
        sourceSealVerified: true,
      },
      schemaVersion: "genie-live-suite-evidence.v3",
      state: "finished",
      trustedControl: {
        candidateReceivedManagementToken: false,
        candidateReceivedProductionDatabaseCredential: false,
        candidateReceivedProductionServiceRole: false,
        validationError: null,
      },
    },
    reviews: [
      ["acceptance", "cold-acceptance-reviewer"],
      ["security", "cold-security-reviewer"],
      ["ui-ux", "cold-ui-reviewer"],
    ].map(([scope, reviewerId]) => ({
      candidateCommit,
      candidateTree,
      disposition: "passed",
      findings: [],
      openP0: 0,
      openP1: 0,
      openP2: 0,
      reviewedAt: "2026-07-19T03:00:00.000Z",
      reviewerId,
      schemaVersion: "genie-cold-review.v1",
      scope,
    })),
  };
}

assert.deepEqual(assertPhase2PromotionInputs(validInputs()).candidate, {
  commit: candidateCommit,
  tree: candidateTree,
});

const wrongLocalTree = validInputs();
wrongLocalTree.localGate.candidate.tree = "c".repeat(40);
assert.throws(
  () => assertPhase2PromotionInputs(wrongLocalTree),
  /same-candidate precheckpoint/,
);

const wrongRemoteCommit = validInputs();
wrongRemoteCommit.remoteLiveSuite.executionSnapshot.candidateCommit = "c".repeat(40);
assert.throws(
  () => assertPhase2PromotionInputs(wrongRemoteCommit),
  /same-candidate remote live-suite/,
);

const localOnlyArtifact = validInputs();
localOnlyArtifact.remoteLiveSuite.executionSnapshot.source =
  "git-index-checkout-with-offline-frozen-dependencies";
assert.throws(
  () => assertPhase2PromotionInputs(localOnlyArtifact),
  /same-candidate remote live-suite/,
);

const missingReviewer = validInputs();
missingReviewer.reviews.pop();
assert.throws(
  () => assertPhase2PromotionInputs(missingReviewer),
  /exactly three cold-review manifests/,
);

const duplicateReviewer = validInputs();
duplicateReviewer.reviews[1].reviewerId = duplicateReviewer.reviews[0].reviewerId;
assert.throws(
  () => assertPhase2PromotionInputs(duplicateReviewer),
  /distinct acceptance, security, and UI\/UX reviews/,
);

const staleReviewer = validInputs();
staleReviewer.reviews[2].reviewedAt = "2026-07-19T01:30:00.000Z";
assert.throws(
  () => assertPhase2PromotionInputs(staleReviewer),
  /ui-ux review is stale/,
);

const openP1 = validInputs();
openP1.reviews[0].openP1 = 1;
assert.throws(
  () => assertPhase2PromotionInputs(openP1),
  /invalid cold-review manifest/,
);

const openP2 = validInputs();
openP2.reviews[1].openP2 = 1;
assert.throws(
  () => assertPhase2PromotionInputs(openP2),
  /invalid cold-review manifest/,
);

const openP2Finding = validInputs();
openP2Finding.reviews[2].findings = [
  { id: "UI-P2-001", severity: "P2", status: "open", title: "open P2" },
];
assert.throws(
  () => assertPhase2PromotionInputs(openP2Finding),
  /contains an invalid finding/,
);

const generatorSource = fs.readFileSync(
  new URL("./create-phase2-implementation-evidence.mjs", import.meta.url),
  "utf8",
);
for (const requiredBinding of [
  "phase1-live-suite.json",
  "phase2-cold-review.${scope}.v1.json",
  "assertPhase2PromotionInputs",
  "genie-implementation-evidence.v2",
]) {
  assert.ok(
    generatorSource.includes(requiredBinding),
    `implementation evidence generator is missing ${requiredBinding}`,
  );
}
const liveSuiteSource = fs.readFileSync(
  new URL("./run-frozen-live-suite.mjs", import.meta.url),
  "utf8",
);
assert.match(liveSuiteSource, /candidateCommit: candidate\.commit/);

console.log(
  "PASS Phase 2 implementation promotion requires exact local, remote, and three-review evidence",
);

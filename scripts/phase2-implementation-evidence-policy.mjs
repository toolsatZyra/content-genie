export const PHASE2_REVIEW_COVERAGE = Object.freeze([
  "acceptance",
  "media",
  "security",
  "ui-ux",
]);
export const PHASE2_REVIEW_TYPE = "independent-context-minimized-comprehensive";

const fullGitIdentity = /^[a-f0-9]{40}$/u;
const reviewerIdentity = /^[a-z0-9][a-z0-9._-]{2,79}$/u;

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function timestamp(value, label, now) {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed) || parsed > now) {
    throw new Error(`${label} has an invalid timestamp.`);
  }
  return parsed;
}

export function assertPhase2PromotionInputs({
  candidateCommit,
  candidateCommittedAt,
  candidateTree,
  localGate,
  now = Date.now(),
  remoteLiveSuite,
  review,
}) {
  if (
    !fullGitIdentity.test(candidateCommit) ||
    !fullGitIdentity.test(candidateTree) ||
    !Number.isFinite(candidateCommittedAt) ||
    candidateCommittedAt > now
  ) {
    throw new Error("Phase 2 promotion requires an exact committed candidate.");
  }

  if (
    localGate?.schemaVersion !== "genie-precheckpoint-gate.v1" ||
    localGate.outcome !== "passed" ||
    localGate.exitCode !== 0 ||
    !exactKeys(localGate.candidate, ["commit", "tree"]) ||
    localGate.candidate.commit !== candidateCommit ||
    localGate.candidate.tree !== candidateTree
  ) {
    throw new Error(
      "Phase 2 promotion requires a passing same-candidate precheckpoint.",
    );
  }
  const localCompletedAt = timestamp(
    localGate.completedAt,
    "The Phase 2 precheckpoint",
    now,
  );
  if (localCompletedAt < candidateCommittedAt) {
    throw new Error("The Phase 2 precheckpoint predates its candidate.");
  }

  if (
    remoteLiveSuite?.schemaVersion !== "genie-live-suite-evidence.v3" ||
    remoteLiveSuite.outcome !== "passed" ||
    remoteLiveSuite.state !== "finished" ||
    remoteLiveSuite.executionCompleted !== true ||
    remoteLiveSuite.executionError !== null ||
    remoteLiveSuite.cleanupError !== null ||
    remoteLiveSuite.candidateBindingVerified !== true ||
    remoteLiveSuite.candidateBindingError !== null ||
    remoteLiveSuite.candidate?.gitTree !== candidateTree ||
    remoteLiveSuite.executionSnapshot?.candidateCommit !== candidateCommit ||
    remoteLiveSuite.executionSnapshot?.candidateTree !== candidateTree ||
    remoteLiveSuite.executionSnapshot?.source !==
      "published-git-commit-in-vercel-firecracker-microvm" ||
    remoteLiveSuite.executionSnapshot?.directoryAbsent !== true ||
    remoteLiveSuite.executionSnapshot?.dependencyTree?.verifiedUnchanged !== true ||
    remoteLiveSuite.remoteExecution?.sourceSealVerified !== true ||
    remoteLiveSuite.remoteExecution?.networkPolicyVerified !== true ||
    remoteLiveSuite.remoteExecution?.sandboxDeleted !== true ||
    remoteLiveSuite.remoteExecution?.brokerArtifact?.schemaVersion !==
      "genie-trusted-live-harness-evidence.v1" ||
    remoteLiveSuite.remoteExecution?.brokerArtifact?.command?.exitCode !== 0 ||
    remoteLiveSuite.branchCleanup?.outcome !== "branch-delete-confirmed" ||
    remoteLiveSuite.branchCleanup?.confirmedAbsentSnapshots !== 3 ||
    remoteLiveSuite.trustedControl?.validationError !== null ||
    remoteLiveSuite.trustedControl?.candidateReceivedManagementToken !== false ||
    remoteLiveSuite.trustedControl?.candidateReceivedProductionDatabaseCredential !==
      false ||
    remoteLiveSuite.trustedControl?.candidateReceivedProductionServiceRole !== false
  ) {
    throw new Error(
      "Phase 2 promotion requires a passing same-candidate remote live-suite artifact.",
    );
  }
  const remoteCompletedAt = timestamp(
    remoteLiveSuite.finishedAt,
    "The Phase 2 remote live suite",
    now,
  );
  if (remoteCompletedAt < Math.max(candidateCommittedAt, localCompletedAt)) {
    throw new Error(
      "The Phase 2 remote live suite is stale relative to the candidate or precheckpoint.",
    );
  }

  if (
    !exactKeys(review, [
      "candidateCommit",
      "candidateTree",
      "coverage",
      "disposition",
      "findings",
      "openP0",
      "openP1",
      "openP2",
      "reviewedAt",
      "reviewerId",
      "reviewType",
      "schemaVersion",
    ]) ||
    review.schemaVersion !== "genie-cold-review.v2" ||
    review.candidateCommit !== candidateCommit ||
    review.candidateTree !== candidateTree ||
    review.reviewType !== PHASE2_REVIEW_TYPE ||
    JSON.stringify(review.coverage) !== JSON.stringify(PHASE2_REVIEW_COVERAGE) ||
    review.disposition !== "passed" ||
    review.openP0 !== 0 ||
    review.openP1 !== 0 ||
    review.openP2 !== 0 ||
    !reviewerIdentity.test(review.reviewerId ?? "") ||
    !Array.isArray(review.findings)
  ) {
    throw new Error(
      "Phase 2 promotion requires one valid independent context-minimized comprehensive review.",
    );
  }
  const freshnessFloor = Math.max(
    candidateCommittedAt,
    localCompletedAt,
    remoteCompletedAt,
  );
  const reviewedAt = timestamp(
    review.reviewedAt,
    "The comprehensive Phase 2 review",
    now,
  );
  if (reviewedAt < freshnessFloor) {
    throw new Error("The comprehensive Phase 2 review is stale for this evidence set.");
  }
  for (const finding of review.findings) {
    if (
      !exactKeys(finding, ["id", "severity", "status", "title"]) ||
      !["P0", "P1", "P2", "P3"].includes(finding.severity) ||
      !["closed", "open"].includes(finding.status) ||
      (["P0", "P1", "P2"].includes(finding.severity) && finding.status !== "closed")
    ) {
      throw new Error("The comprehensive Phase 2 review contains an invalid finding.");
    }
  }

  return Object.freeze({
    candidate: Object.freeze({ commit: candidateCommit, tree: candidateTree }),
    localCompletedAt: localGate.completedAt,
    remoteCompletedAt: remoteLiveSuite.finishedAt,
    reviewCoverage: PHASE2_REVIEW_COVERAGE,
    reviewType: PHASE2_REVIEW_TYPE,
  });
}

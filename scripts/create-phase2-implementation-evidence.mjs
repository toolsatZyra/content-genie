import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  PHASE2_REVIEW_COVERAGE,
  PHASE2_REVIEW_TYPE,
  assertPhase2PromotionInputs,
} from "./phase2-implementation-evidence-policy.mjs";

const root = process.cwd();
const artifactRelativePath =
  "docs/evidence/phase2/p2-01-through-p2-14.implementation.json";
const artifactPath = path.join(root, ...artifactRelativePath.split("/"));
const gateSourcePath = path.join(
  root,
  ".tmp",
  "artifacts",
  "precheckpoint-gate.v1.json",
);
const gateArtifactRelativePath = "docs/evidence/phase2/precheckpoint-gate.v1.json";
const gateArtifactPath = path.join(root, ...gateArtifactRelativePath.split("/"));
const remoteSourcePath = path.join(root, ".tmp", "artifacts", "phase1-live-suite.json");
const remoteArtifactRelativePath = "docs/evidence/phase2/remote-live-suite.v3.json";
const remoteArtifactPath = path.join(root, ...remoteArtifactRelativePath.split("/"));
const reviewSource = {
  artifactPath: path.join(
    root,
    "docs",
    "evidence",
    "phase2",
    "cold-review.comprehensive.v2.json",
  ),
  artifactRelativePath: "docs/evidence/phase2/cold-review.comprehensive.v2.json",
  sourcePath: path.join(
    root,
    ".tmp",
    "artifacts",
    "phase2-cold-review.comprehensive.v2.json",
  ),
};
const evidencePath = path.join(
  root,
  "reference",
  "acceptance",
  "traceability-evidence.v1.json",
);
const planPath = path.join(
  root,
  "reference",
  "acceptance",
  "traceability-plan.v1.json",
);
const plan = readJson(
  planPath,
  "Generate the traceability plan before Phase 2 implementation evidence.",
  "The traceability plan is unreadable.",
);
const phase2Obligations = plan.requirements.flatMap((requirement) =>
  (requirement.obligations ?? []).filter(
    (obligation) => obligation.checkpoint === "phase2",
  ),
);
const obligationIds = phase2Obligations.map(({ obligationId }) => obligationId).sort();
const workPackages = [
  ...new Set(phase2Obligations.flatMap((obligation) => obligation.workPackages)),
].sort();
const expectedWorkPackages = Array.from(
  { length: 14 },
  (_, index) => `P2-${String(index + 1).padStart(2, "0")}`,
);
if (
  obligationIds.length !== 96 ||
  new Set(obligationIds).size !== obligationIds.length ||
  JSON.stringify(workPackages) !== JSON.stringify(expectedWorkPackages)
) {
  throw new Error(
    "Phase 2 implementation evidence requires the exact 96-obligation P2-01 through P2-14 traceability contract.",
  );
}

function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Git evidence command failed: ${args[0]}`);
  }
  return result.stdout;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(inputPath, missingMessage, unreadableMessage) {
  if (!fs.existsSync(inputPath)) throw new Error(missingMessage);
  try {
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch {
    throw new Error(unreadableMessage);
  }
}

const candidateCommit = git(["rev-parse", "HEAD"]).trim();
const candidateTree = git(["rev-parse", "HEAD^{tree}"]).trim();
if (!/^[a-f0-9]{40}$/.test(candidateCommit)) {
  throw new Error("Phase 2 implementation evidence requires a full candidate commit.");
}
if (!/^[a-f0-9]{40}$/.test(candidateTree)) {
  throw new Error("Phase 2 implementation evidence requires a full candidate tree.");
}
const stagedTree = git(["write-tree"]).trim();
if (stagedTree !== candidateTree) {
  throw new Error(
    "Evidence generation requires the index to equal the candidate tree.",
  );
}
const trackedChanges = git(["status", "--porcelain=v1", "--untracked-files=no"]);
if (trackedChanges.trim()) {
  throw new Error("Evidence generation requires a clean tracked worktree.");
}
const candidateCommittedAt = Date.parse(
  git(["show", "-s", "--format=%cI", candidateCommit]).trim(),
);

if (!fs.existsSync(gateSourcePath)) {
  throw new Error(
    "Run pnpm precheckpoint-gates for the committed candidate before generating evidence.",
  );
}
const gateReport = readJson(
  gateSourcePath,
  "Run pnpm precheckpoint-gates for the committed candidate before generating evidence.",
  "The tree-bound precheckpoint gate report is unreadable.",
);
if (
  gateReport?.schemaVersion !== "genie-precheckpoint-gate.v1" ||
  gateReport.outcome !== "passed" ||
  gateReport.exitCode !== 0 ||
  gateReport.candidate?.commit !== candidateCommit ||
  gateReport.candidate?.tree !== candidateTree ||
  JSON.stringify(gateReport.definition?.command) !==
    JSON.stringify(["pnpm", "precheckpoint-gates:raw"]) ||
  gateReport.definition?.packageScript !== "precheckpoint-gates:raw" ||
  gateReport.definition?.runnerPath !== "scripts/run-precheckpoint-gates.mjs" ||
  gateReport.definition?.runnerSha256 !==
    sha256(
      git(["show", `${candidateCommit}:scripts/run-precheckpoint-gates.mjs`], null),
    ) ||
  gateReport.definition?.packageJsonSha256 !==
    sha256(git(["show", `${candidateCommit}:package.json`], null)) ||
  !Number.isInteger(gateReport.durationMs) ||
  gateReport.durationMs < 0 ||
  Number.isNaN(Date.parse(gateReport.startedAt)) ||
  Number.isNaN(Date.parse(gateReport.completedAt)) ||
  Date.parse(gateReport.completedAt) < Date.parse(gateReport.startedAt)
) {
  throw new Error("The precheckpoint gate report is not bound to this candidate.");
}
const remoteLiveSuite = readJson(
  remoteSourcePath,
  "Run the remote live suite for the same committed candidate before generating Phase 2 implementation evidence.",
  "The remote live-suite artifact is unreadable.",
);
const review = readJson(
  reviewSource.sourcePath,
  "A fresh independent context-minimized comprehensive review manifest is required before Phase 2 implementation promotion.",
  "The comprehensive Phase 2 review manifest is unreadable.",
);
assertPhase2PromotionInputs({
  candidateCommit,
  candidateCommittedAt,
  candidateTree,
  localGate: gateReport,
  remoteLiveSuite,
  review,
});

fs.mkdirSync(path.dirname(gateArtifactPath), { recursive: true });
fs.copyFileSync(gateSourcePath, gateArtifactPath);
const gateArtifactSha256 = sha256(fs.readFileSync(gateArtifactPath));
fs.copyFileSync(remoteSourcePath, remoteArtifactPath);
const remoteArtifactSha256 = sha256(fs.readFileSync(remoteArtifactPath));
fs.copyFileSync(reviewSource.sourcePath, reviewSource.artifactPath);
const reviewArtifact = {
  artifact: {
    path: reviewSource.artifactRelativePath,
    sha256: sha256(fs.readFileSync(reviewSource.artifactPath)),
  },
  coverage: PHASE2_REVIEW_COVERAGE,
  reviewedAt: review.reviewedAt,
  reviewerId: review.reviewerId,
  reviewType: PHASE2_REVIEW_TYPE,
};

const allCandidatePaths = git(["ls-tree", "-r", "--name-only", candidateCommit])
  .split(/\r?\n/u)
  .filter(Boolean);
const exactPaths = new Set([
  "src/app/api/commands/route.test.ts",
  "src/app/api/commands/route.ts",
  "src/app/api/episodes/[episodeId]/script-lock/route.test.ts",
  "src/app/api/episodes/[episodeId]/script-lock/route.ts",
  "src/components/creation/creation-studio.tsx",
  "src/server/creation-query.test.ts",
  "src/server/creation-query.ts",
  "src/server/execute-command.test.ts",
  "src/server/execute-command.ts",
  "src/server/script-lock.test.ts",
  "src/server/script-lock.ts",
  "src/server/voice-provider-registry.test.ts",
  "src/server/voice-provider-registry.ts",
  "supabase/tests/phase2_zero_spend_foundation.test.sql",
  "tests/browser/creation.spec.ts",
  "tests/live/phase2-script-live.spec.ts",
]);
const prefixes = [
  "public/looks/",
  "scripts/",
  "src/",
  "supabase/migrations/",
  "supabase/tests/",
  "tests/",
  "trigger/",
];
const boundPaths = allCandidatePaths
  .filter(
    (candidatePath) =>
      exactPaths.has(candidatePath) ||
      prefixes.some((prefix) => candidatePath.startsWith(prefix)) ||
      candidatePath === "trigger.config.ts",
  )
  .sort();
for (const requiredPath of exactPaths) {
  if (!boundPaths.includes(requiredPath)) {
    throw new Error(`Candidate is missing required Phase 2 path: ${requiredPath}`);
  }
}
if (
  boundPaths.filter((candidatePath) => candidatePath.startsWith("public/looks/"))
    .length !== 117
) {
  throw new Error("Candidate evidence requires exactly 117 committed look thumbnails.");
}

const boundFiles = boundPaths.map((candidatePath) => ({
  path: candidatePath,
  sha256: sha256(git(["show", `${candidateCommit}:${candidatePath}`], null)),
}));
const generatedAt = new Date().toISOString();
const artifact = {
  boundFiles,
  candidate: { commit: candidateCommit, tree: candidateTree },
  checkpoint: "phase2",
  disposition: "implemented_unverified",
  generatedAt,
  localGates: {
    artifact: {
      path: gateArtifactRelativePath,
      sha256: gateArtifactSha256,
    },
    command: ["pnpm", "precheckpoint-gates"],
    tree: candidateTree,
  },
  obligationIds,
  remoteLiveSuite: {
    artifact: {
      path: remoteArtifactRelativePath,
      sha256: remoteArtifactSha256,
    },
    completedAt: remoteLiveSuite.finishedAt,
  },
  review: reviewArtifact,
  schemaVersion: "genie-implementation-evidence.v3",
  workPackages,
};
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
const artifactSha256 = sha256(fs.readFileSync(artifactPath));

const obligationById = new Map();
for (const requirement of plan.requirements) {
  for (const obligation of requirement.obligations ?? []) {
    obligationById.set(obligation.obligationId, obligation);
  }
}
const evidenceSource = JSON.parse(fs.readFileSync(evidencePath, "utf8"));
for (const obligationId of obligationIds) {
  const obligation = obligationById.get(obligationId);
  if (!obligation || obligation.status !== "unimplemented") {
    throw new Error(`Unexpected current traceability state for ${obligationId}`);
  }
  evidenceSource.entries[obligationId] = {
    commit: candidateCommit,
    evidence: [{ path: artifactRelativePath, sha256: artifactSha256 }],
    obligationDefinitionHash: obligation.obligationDefinitionHash,
    status: "implemented_unverified",
    verifiedAt: generatedAt,
    workPackages: obligation.workPackages,
  };
}
evidenceSource.entries = Object.fromEntries(
  Object.entries(evidenceSource.entries).sort(([left], [right]) =>
    left.localeCompare(right),
  ),
);
fs.writeFileSync(evidencePath, `${JSON.stringify(evidenceSource, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify({
    artifact: artifactRelativePath,
    candidateCommit,
    candidateTree,
    obligationCount: obligationIds.length,
  }),
);

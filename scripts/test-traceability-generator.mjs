import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tempRoot = path.resolve(root, ".tmp", "genie-build", "traceability-test");
const allowedRoot = path.resolve(root, ".tmp", "genie-build");
if (
  tempRoot === allowedRoot ||
  !tempRoot.startsWith(`${allowedRoot}${path.sep}`)
) {
  throw new Error(`Unsafe traceability test directory: ${tempRoot}`);
}
fs.rmSync(tempRoot, { recursive: true, force: true });

const copy = (relativePath) => {
  const source = path.join(root, relativePath);
  const destination = path.join(tempRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
};
for (const file of [
  "docs/design.md",
  "docs/traceability.md",
  "docs/implementation-plan.md",
  "docs/qc-release-contract.md",
  "docs/threat-model.md",
  "docs/verification-matrix.md",
  "scripts/generate-traceability-plan.mjs",
  "scripts/phase2-implementation-evidence-policy.mjs",
  "reference/acceptance/traceability-evidence.v1.json",
  "reference/acceptance/traceability-evidence.schema.json",
]) {
  copy(file);
}

const evidencePath = path.join(
  tempRoot,
  "reference",
  "acceptance",
  "traceability-evidence.v1.json",
);
const tracePath = path.join(tempRoot, "docs", "traceability.md");
const originalTrace = fs.readFileSync(tracePath, "utf8");
const designPath = path.join(tempRoot, "docs", "design.md");
const originalDesign = fs.readFileSync(designPath, "utf8");
const implementationPlanPath = path.join(
  tempRoot,
  "docs",
  "implementation-plan.md",
);
const originalImplementationPlan = fs.readFileSync(
  implementationPlanPath,
  "utf8",
);
const generatorPath = path.join(
  tempRoot,
  "scripts",
  "generate-traceability-plan.mjs",
);
const originalGenerator = fs.readFileSync(generatorPath, "utf8");
const artifactRelativePath =
  "docs/evidence/phase2/example.checkpoint.json";
const artifactPath = path.join(tempRoot, ...artifactRelativePath.split("/"));
const ciAttestationRelativePath =
  "docs/evidence/phase2/github-ci-attestation.json";
const precheckpointReportRelativePath =
  "docs/evidence/phase2/precheckpoint-command.json";
const liveReportRelativePath =
  "docs/evidence/phase2/live-command.json";
const databaseReportRelativePath =
  "docs/evidence/phase2/preview-database.json";
const reviewReportRelativePaths = {
  acceptance: "docs/evidence/phase2/cold-acceptance.json",
  security: "docs/evidence/phase2/cold-security.json",
  "ui-ux": "docs/evidence/phase2/cold-ui-ux.json",
};
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
const digestFile = (filePath) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
const artifactFor = (relativePath) => ({
  path: relativePath,
  sha256: digestFile(path.join(tempRoot, ...relativePath.split("/"))),
});
const writeJson = (relativePath, value) => {
  const absolutePath = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
};
const runGenerator = (expectedSuccess, expectedError) => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-traceability-plan.mjs"],
    {
      cwd: tempRoot,
      encoding: "utf8",
    },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(result.status === 0, expectedSuccess, output);
  if (expectedError) assert.match(output, expectedError);
  return result;
};
const writeEvidence = (entries) =>
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(
      { schemaVersion: "traceability-evidence.v1", entries },
      null,
      2,
    )}\n`,
    "utf8",
  );

const runGit = (args) => {
  const result = spawnSync("git", args, {
    cwd: tempRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};
runGit(["init", "--quiet"]);
runGit(["config", "user.email", "traceability-test@zyra.invalid"]);
runGit(["config", "user.name", "Genie Traceability Test"]);

const writeFixtureFile = (relativePath, contents) => {
  const destination = path.join(tempRoot, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, contents, "utf8");
};
const fixtureMigrationPath =
  "supabase/migrations/20260717120000_phase2_fixture.sql";
for (const [relativePath, contents] of [
  [".github/workflows/ci.yml", "name: Genie CI\n"],
  ["package.json", '{"name":"genie-traceability-fixture"}\n'],
  ["pnpm-lock.yaml", "lockfileVersion: '9.0'\n"],
  ["src/fixture.ts", "export const fixture = true;\n"],
  ["tests/fixture.test.ts", "export {};\n"],
  [fixtureMigrationPath, "select 1;\n"],
  ["supabase/tests/fixture.test.sql", "select 1;\n"],
]) {
  writeFixtureFile(relativePath, contents);
}
runGit(["add", "."]);
runGit(["commit", "--quiet", "-m", "test: add exact candidate"]);
const candidateCommit = runGit(["rev-parse", "HEAD"]);
const candidateTree = runGit(["rev-parse", "HEAD^{tree}"]);
const generatedAt = new Date().toISOString();
const workflowSha256 = digestFile(
  path.join(tempRoot, ".github", "workflows", "ci.yml"),
);
const migrationSha256ByPath = {
  [fixtureMigrationPath]: digestFile(
    path.join(tempRoot, ...fixtureMigrationPath.split("/")),
  ),
};
const branchId = "fa699be8-ea8d-427a-bacd-cad5797d17b9";
const projectRef = "abcdefghijklmnopqrst";
const ciRunId = "1";
const ciRunAttempt = 1;

writeJson(ciAttestationRelativePath, {
  schemaVersion: "genie-github-ci-attestation.v1",
  candidateCommit,
  candidateTree,
  conclusion: "success",
  generatedAt,
  repository: "toolsatZyra/content-genie",
  runAttempt: ciRunAttempt,
  runId: ciRunId,
  workflow: ".github/workflows/ci.yml",
  workflowSha256,
});
for (const [relativePath, command, passed] of [
  [precheckpointReportRelativePath, "pnpm precheckpoint-gates", 100],
  [
    liveReportRelativePath,
    "node --env-file=.env.local scripts/run-phase1-live-suite.mjs",
    70,
  ],
]) {
  writeJson(relativePath, {
    schemaVersion: "genie-command-report.v1",
    candidateCommit,
    command,
    completedAt: generatedAt,
    exitCode: 0,
    failed: 0,
    passed,
  });
}
writeJson(databaseReportRelativePath, {
  schemaVersion: "genie-preview-database-report.v1",
  advisorFindings: 0,
  branchId,
  candidateCommit,
  completedAt: generatedAt,
  migrationSha256ByPath,
  pgTapFailed: 0,
  pgTapPassed: 70,
  projectRef,
});
for (const [scope, reviewerId] of [
  ["acceptance", "cold-acceptance-reviewer"],
  ["security", "cold-security-reviewer"],
  ["ui-ux", "cold-ui-reviewer"],
]) {
  writeJson(reviewReportRelativePaths[scope], {
    schemaVersion: "genie-cold-review.v1",
    candidateCommit,
    candidateTree,
    disposition: "passed",
    findings: [],
    openP0: 0,
    openP1: 0,
    openP2: 0,
    reviewedAt: generatedAt,
    reviewerId,
    scope,
  });
}

writeJson(artifactRelativePath, {
  schemaVersion: "genie-checkpoint-evidence.v2",
  checkpoint: "phase2",
  disposition: "passed",
  generatedAt,
  obligationIds: ["GEN-PROD-001@phase2"],
  candidate: { commit: candidateCommit, tree: candidateTree },
  ci: {
    attestationArtifact: artifactFor(ciAttestationRelativePath),
    commit: candidateCommit,
    provider: "github-actions",
    repository: "toolsatZyra/content-genie",
    runAttempt: ciRunAttempt,
    runId: ciRunId,
    url:
      "https://github.com/toolsatZyra/content-genie/actions/runs/1/attempts/1",
    workflow: ".github/workflows/ci.yml",
  },
  commands: [
    {
      command: "pnpm precheckpoint-gates",
      durationMs: 1,
      exitCode: 0,
      reportArtifact: artifactFor(precheckpointReportRelativePath),
    },
    {
      command:
        "node --env-file=.env.local scripts/run-phase1-live-suite.mjs",
      durationMs: 1,
      exitCode: 0,
      reportArtifact: artifactFor(liveReportRelativePath),
    },
  ],
  database: {
    branchId,
    migrationSha256ByPath,
    projectRef,
    reportArtifact: artifactFor(databaseReportRelativePath),
  },
  reviews: [
    {
      disposition: "passed",
      openP0: 0,
      openP1: 0,
      openP2: 0,
      reportArtifact: artifactFor(reviewReportRelativePaths.acceptance),
      reviewerId: "cold-acceptance-reviewer",
      scope: "acceptance",
    },
    {
      disposition: "passed",
      openP0: 0,
      openP1: 0,
      openP2: 0,
      reportArtifact: artifactFor(reviewReportRelativePaths.security),
      reviewerId: "cold-security-reviewer",
      scope: "security",
    },
    {
      disposition: "passed",
      openP0: 0,
      openP1: 0,
      openP2: 0,
      reportArtifact: artifactFor(reviewReportRelativePaths["ui-ux"]),
      reviewerId: "cold-ui-reviewer",
      scope: "ui-ux",
    },
  ],
});
runGit(["add", "docs/evidence"]);
runGit(["commit", "--quiet", "-m", "test: bind evidence to candidate"]);
let evidenceCommit = runGit(["rev-parse", "HEAD"]);
let artifactSha256 = digestFile(artifactPath);

writeEvidence({});
runGenerator(true);
let generated = JSON.parse(
  fs.readFileSync(
    path.join(
      tempRoot,
      "reference",
      "acceptance",
      "traceability-plan.v1.json",
    ),
    "utf8",
  ),
);
let requirement = generated.requirements.find(
  (item) => item.id === "GEN-PROD-001",
);
let sourceObligation = requirement.obligations.find(
  (item) => item.checkpoint === "phase2",
);
const verifiedEntry = {
  workPackages: sourceObligation.workPackages,
  obligationDefinitionHash: sourceObligation.obligationDefinitionHash,
  status: "verified",
  evidence: [
    {
      path: artifactRelativePath,
      sha256: artifactSha256,
    },
  ],
  commit: evidenceCommit,
  verifiedAt: new Date(Date.now() - 1000).toISOString(),
};
writeEvidence({ "GEN-PROD-001@phase2": verifiedEntry });
runGenerator(false, /externally authenticated provenance/);

const unverifiedEntry = {
  ...verifiedEntry,
  status: "implemented_unverified",
};
writeEvidence({ "GEN-PROD-001@phase2": unverifiedEntry });
runGenerator(true);
generated = JSON.parse(
  fs.readFileSync(
    path.join(
      tempRoot,
      "reference",
      "acceptance",
      "traceability-plan.v1.json",
    ),
    "utf8",
  ),
);
requirement = generated.requirements.find(
  (item) => item.id === "GEN-PROD-001",
);
const obligation = requirement.obligations.find(
  (item) => item.checkpoint === "phase2",
);
assert.equal(obligation.status, "implemented_unverified");
assert.deepEqual(obligation.evidence, unverifiedEntry.evidence);
assert.equal(obligation.commit, unverifiedEntry.commit);
assert.equal(obligation.verifiedAt, unverifiedEntry.verifiedAt);
assert.equal(
  obligation.obligationDefinitionHash,
  unverifiedEntry.obligationDefinitionHash,
);

writeEvidence({ "GEN-PROD-001@phase2": verifiedEntry });
runGenerator(false, /externally authenticated provenance/);

const originalManifest = fs.readFileSync(artifactPath, "utf8");
const originalCheckpointManifest = JSON.parse(originalManifest);
const rewriteEvidenceCommit = () => {
  runGit(["add", artifactRelativePath]);
  runGit(["commit", "--quiet", "--amend", "--no-edit"]);
  evidenceCommit = runGit(["rev-parse", "HEAD"]);
  artifactSha256 = digestFile(artifactPath);
  verifiedEntry.commit = evidenceCommit;
  verifiedEntry.evidence = [
    { path: artifactRelativePath, sha256: artifactSha256 },
  ];
  writeEvidence({ "GEN-PROD-001@phase2": verifiedEntry });
};
const expectCheckpointMutationRejected = (mutate) => {
  const mutated = structuredClone(originalCheckpointManifest);
  mutate(mutated);
  writeJson(artifactRelativePath, mutated);
  rewriteEvidenceCommit();
  runGenerator(false);

  writeJson(artifactRelativePath, originalCheckpointManifest);
  rewriteEvidenceCommit();
  runGenerator(false, /externally authenticated provenance/);
};

expectCheckpointMutationRejected((manifest) => {
  manifest.candidate.commit = evidenceCommit;
});
expectCheckpointMutationRejected((manifest) => {
  manifest.ci.repository = "attacker/content-genie";
  manifest.ci.url =
    "https://github.com/attacker/content-genie/actions/runs/1/attempts/1";
});
expectCheckpointMutationRejected((manifest) => {
  manifest.commands.pop();
});
expectCheckpointMutationRejected((manifest) => {
  [
    manifest.commands[0].reportArtifact,
    manifest.commands[1].reportArtifact,
  ] = [
    manifest.commands[1].reportArtifact,
    manifest.commands[0].reportArtifact,
  ];
});
expectCheckpointMutationRejected((manifest) => {
  manifest.database.migrationSha256ByPath[fixtureMigrationPath] = "0".repeat(64);
});
expectCheckpointMutationRejected((manifest) => {
  manifest.database.migrationSha256ByPath[
    "supabase/migrations/99999999999999_phase2_fabricated.sql"
  ] = "a".repeat(64);
});
expectCheckpointMutationRejected((manifest) => {
  manifest.reviews[1].reviewerId = manifest.reviews[0].reviewerId;
});
expectCheckpointMutationRejected((manifest) => {
  manifest.reviews[1].reportArtifact =
    manifest.reviews[0].reportArtifact;
});
fs.writeFileSync(
  artifactPath,
  originalManifest.replace('"disposition": "passed"', '"disposition": "failed"'),
  "utf8",
);
runGenerator(false);
fs.writeFileSync(artifactPath, originalManifest, "utf8");

fs.writeFileSync(
  designPath,
  originalDesign.replace(
    "The product promise is not merely automated video generation.",
    "The product promise is merely automated video generation.",
  ),
  "utf8",
);
runGenerator(false);
fs.writeFileSync(designPath, originalDesign, "utf8");

fs.writeFileSync(
  implementationPlanPath,
  originalImplementationPlan.replace(
    "#### `P2-01` Exact script ingestion",
    "#### `P2-01` Weakened exact script ingestion",
  ),
  "utf8",
);
runGenerator(false);
fs.writeFileSync(implementationPlanPath, originalImplementationPlan, "utf8");

writeEvidence({
  "GEN-PROD-001@phase2": {
    ...verifiedEntry,
    evidence: [],
  },
});
runGenerator(false);

writeEvidence({
  "GEN-PROD-001@phase2": {
    ...verifiedEntry,
    evidence: [
      {
        path: "docs/evidence/phase2/absent.json",
        sha256: artifactSha256,
      },
    ],
  },
});
runGenerator(false);

writeEvidence({
  "GEN-PROD-001@phase2": {
    ...verifiedEntry,
    commit: "deadbee",
  },
});
runGenerator(false);

writeEvidence({
  "GEN-PROD-001@phase2": {
    ...verifiedEntry,
    evidence: [
      {
        path: artifactRelativePath,
        sha256: "0".repeat(64),
      },
    ],
  },
});
runGenerator(false);

writeEvidence({
  "GEN-PROD-001@phase2": {
    ...verifiedEntry,
    obligationDefinitionHash: "0".repeat(64),
  },
});
runGenerator(false);

writeEvidence({
  "GEN-PROD-001@phase2": {
    ...verifiedEntry,
    verifiedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  },
});
runGenerator(false);

writeEvidence({
  "GEN-PROD-001@phase2": {
    ...verifiedEntry,
    workPackages: ["P2-01"],
  },
});
runGenerator(false);

writeEvidence({ "GEN-PROD-001@phase2": verifiedEntry });
fs.writeFileSync(
  tracePath,
  originalTrace.replace(
    "`docs/design.md` — Script integrity",
    "`docs/design.md` — Changed script integrity",
  ),
  "utf8",
);
runGenerator(false);

writeEvidence({});
fs.writeFileSync(
  tracePath,
  originalTrace.replace(
    "Phase 4 / `P4-01`, `P4-02`",
    "Phase 4 / `P4-01..02`",
  ),
  "utf8",
);
runGenerator(false);

fs.writeFileSync(
  tracePath,
  originalTrace.replace(
    "; Phase 4 / `P4-01`, `P4-02` | agent/QC/approval",
    " | agent/QC/approval",
  ),
  "utf8",
);
runGenerator(false);

fs.writeFileSync(tracePath, originalTrace, "utf8");
fs.writeFileSync(
  generatorPath,
  originalGenerator.replace(
    "V-P2-031 and V-P2-034 cross-project/environment client/key/grant tests",
    "V-P2-031 and V-P3-027 cross-project/environment client/key/grant tests",
  ),
  "utf8",
);
runGenerator(false);

fs.writeFileSync(
  generatorPath,
  originalGenerator.replace(
    "V-P2-001, V-P2-002, V-P2-003, V-P2-004 source/hash/map/mutation suite",
    "V-P2-001..004 source/hash/map/mutation suite",
  ),
  "utf8",
);
runGenerator(false);

fs.writeFileSync(
  generatorPath,
  originalGenerator.replace(
    "V-P2-006 exact 117-ID/default/no-Recommended/manifest parity suite",
    "exact 117-ID/default/no-Recommended/manifest parity suite",
  ),
  "utf8",
);
runGenerator(false);

fs.writeFileSync(
  generatorPath,
  originalGenerator
    .replace(
      "V-P2-005 exact ID/default/no-fallback tests",
      "V-P2-006 exact ID/default/no-fallback tests",
    )
    .replace(
      "V-P2-006 exact 117-ID/default/no-Recommended/manifest parity suite",
      "V-P2-005 exact 117-ID/default/no-Recommended/manifest parity suite",
    ),
  "utf8",
);
runGenerator(false);

fs.writeFileSync(generatorPath, originalGenerator, "utf8");
runGenerator(true);
generated = JSON.parse(
  fs.readFileSync(
    path.join(
      tempRoot,
      "reference",
      "acceptance",
      "traceability-plan.v1.json",
    ),
    "utf8",
  ),
);
const obligationsFor = (id) =>
  generated.requirements.find((item) => item.id === id).obligations;
assert.deepEqual(
  obligationsFor("GQC-MASTER-006").map((item) => item.checkpoint),
  ["phase4"],
);
assert.deepEqual(
  obligationsFor("GQC-MASTER-010").map((item) => item.checkpoint),
  ["phase4"],
);
assert.deepEqual(
  obligationsFor("CAL-RUBRIC-001").map((item) => item.checkpoint),
  ["product_calibrated"],
);

writeEvidence({});
const implementationBindings = [
  "public/looks/test.webp",
  "scripts/run-precheckpoint-gates.mjs",
  "src/components/creation/creation-studio.tsx",
  "src/domain/look/look-pack.v1.json",
  "src/domain/look/look-registry.ts",
  "src/domain/profile/launch-profile.ts",
  "src/domain/script/integrity.ts",
  "src/domain/voice/voice-registry.ts",
  "supabase/migrations/20260717121500_phase2_scripts_and_sidecars.sql",
  "supabase/migrations/20260717121600_phase2_looks_voices_and_config.sql",
  "supabase/tests/phase2_zero_spend_foundation.test.sql",
  "tests/browser/creation.spec.ts",
  "tests/live/phase2-script-live.spec.ts",
];
for (const binding of implementationBindings) {
  const absolute = path.join(tempRoot, ...binding.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `bound fixture: ${binding}\n`, "utf8");
}
writeFixtureFile(
  "package.json",
  `${JSON.stringify({
    name: "genie-traceability-fixture",
    scripts: {
      "precheckpoint-gates": "node scripts/run-precheckpoint-gates.mjs",
      "precheckpoint-gates:raw": "pnpm test:fixture",
    },
  })}\n`,
);
runGit(["add", "."]);
runGit(["commit", "--quiet", "-m", "test: create implementation candidate"]);
const implementationCommit = runGit(["rev-parse", "HEAD"]);
const implementationTree = runGit(["rev-parse", "HEAD^{tree}"]);
runGenerator(true);
generated = JSON.parse(
  fs.readFileSync(
    path.join(tempRoot, "reference", "acceptance", "traceability-plan.v1.json"),
    "utf8",
  ),
);
const implementationObligation = generated.requirements
  .find((item) => item.id === "GEN-PROD-002")
  .obligations.find((item) => item.checkpoint === "phase2");
const implementationGeneratedAt = new Date().toISOString();
const implementationArtifactRelativePath =
  "docs/evidence/phase2/test.implementation.json";
const implementationGateRelativePath =
  "docs/evidence/phase2/test-precheckpoint-gate.v1.json";
const implementationRemoteRelativePath =
  "docs/evidence/phase2/test-remote-live-suite.v3.json";
const implementationGateStartedAt = new Date(
  Date.parse(implementationGeneratedAt) - 1_000,
).toISOString();
const implementationGateCompletedAt = implementationGeneratedAt;
writeJson(implementationGateRelativePath, {
  candidate: { commit: implementationCommit, tree: implementationTree },
  completedAt: implementationGateCompletedAt,
  definition: {
    command: ["pnpm", "precheckpoint-gates:raw"],
    packageJsonSha256: digestFile(path.join(tempRoot, "package.json")),
    packageScript: "precheckpoint-gates:raw",
    runnerPath: "scripts/run-precheckpoint-gates.mjs",
    runnerSha256: digestFile(
      path.join(tempRoot, "scripts", "run-precheckpoint-gates.mjs"),
    ),
  },
  durationMs: 1_000,
  exitCode: 0,
  log: {
    path: ".tmp/artifacts/precheckpoint-gate.v1.log",
    sha256: "a".repeat(64),
    stderrSha256: "b".repeat(64),
    stdoutSha256: "c".repeat(64),
  },
  outcome: "passed",
  schemaVersion: "genie-precheckpoint-gate.v1",
  startedAt: implementationGateStartedAt,
});
writeJson(implementationRemoteRelativePath, {
  branchCleanup: {
    confirmedAbsentSnapshots: 3,
    outcome: "branch-delete-confirmed",
  },
  candidate: { gitTree: implementationTree },
  candidateBindingError: null,
  candidateBindingVerified: true,
  cleanupError: null,
  executionCompleted: true,
  executionError: null,
  executionSnapshot: {
    candidateCommit: implementationCommit,
    candidateTree: implementationTree,
    dependencyTree: { verifiedUnchanged: true },
    directoryAbsent: true,
    source: "published-git-commit-in-vercel-firecracker-microvm",
  },
  finishedAt: implementationGeneratedAt,
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
});
const implementationReviews = [
  ["acceptance", "implementation-acceptance-reviewer"],
  ["security", "implementation-security-reviewer"],
  ["ui-ux", "implementation-ui-reviewer"],
].map(([scope, reviewerId]) => {
  const relativePath = `docs/evidence/phase2/test-cold-review.${scope}.v1.json`;
  writeJson(relativePath, {
    candidateCommit: implementationCommit,
    candidateTree: implementationTree,
    disposition: "passed",
    findings: [],
    openP0: 0,
    openP1: 0,
    openP2: 0,
    reviewedAt: implementationGeneratedAt,
    reviewerId,
    schemaVersion: "genie-cold-review.v1",
    scope,
  });
  return {
    artifact: artifactFor(relativePath),
    reviewedAt: implementationGeneratedAt,
    reviewerId,
    scope,
  };
});
const implementationArtifact = {
  boundFiles: implementationBindings
    .map((binding) => ({
      path: binding,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(tempRoot, ...binding.split("/"))))
        .digest("hex"),
    }))
    .sort((left, right) => left.path.localeCompare(right.path)),
  candidate: { commit: implementationCommit, tree: implementationTree },
  checkpoint: "phase2",
  disposition: "implemented_unverified",
  generatedAt: implementationGeneratedAt,
  localGates: {
    artifact: artifactFor(implementationGateRelativePath),
    command: ["pnpm", "precheckpoint-gates"],
    tree: implementationTree,
  },
  obligationIds: ["GEN-PROD-002@phase2"],
  remoteLiveSuite: {
    artifact: artifactFor(implementationRemoteRelativePath),
    completedAt: implementationGeneratedAt,
  },
  reviews: implementationReviews,
  schemaVersion: "genie-implementation-evidence.v2",
  workPackages: ["P2-01", "P2-02", "P2-03"],
};
writeJson(implementationArtifactRelativePath, implementationArtifact);
const implementationArtifactPath = path.join(
  tempRoot,
  ...implementationArtifactRelativePath.split("/"),
);
const implementationEntry = {
  commit: implementationCommit,
  evidence: [
    {
      path: implementationArtifactRelativePath,
      sha256: digestFile(implementationArtifactPath),
    },
  ],
  obligationDefinitionHash:
    implementationObligation.obligationDefinitionHash,
  status: "implemented_unverified",
  verifiedAt: implementationGeneratedAt,
  workPackages: implementationObligation.workPackages,
};
writeEvidence({ "GEN-PROD-002@phase2": implementationEntry });
runGenerator(true);

const originalImplementationGate = JSON.parse(
  fs.readFileSync(
    path.join(tempRoot, ...implementationGateRelativePath.split("/")),
    "utf8",
  ),
);
const forgedGate = { ...originalImplementationGate, outcome: "failed" };
writeJson(implementationGateRelativePath, forgedGate);
implementationArtifact.localGates.artifact = artifactFor(
  implementationGateRelativePath,
);
writeJson(implementationArtifactRelativePath, implementationArtifact);
implementationEntry.evidence[0].sha256 = digestFile(implementationArtifactPath);
writeEvidence({ "GEN-PROD-002@phase2": implementationEntry });
runGenerator(false, /tree-bound gate report/);

writeJson(implementationGateRelativePath, originalImplementationGate);
implementationArtifact.localGates.artifact = artifactFor(
  implementationGateRelativePath,
);
writeJson(implementationArtifactRelativePath, implementationArtifact);
implementationEntry.evidence[0].sha256 = digestFile(implementationArtifactPath);
writeEvidence({ "GEN-PROD-002@phase2": implementationEntry });
runGenerator(true);

const changedBinding = structuredClone(implementationArtifact);
changedBinding.boundFiles[0].sha256 = "0".repeat(64);
writeJson(implementationArtifactRelativePath, changedBinding);
implementationEntry.evidence[0].sha256 = digestFile(implementationArtifactPath);
writeEvidence({ "GEN-PROD-002@phase2": implementationEntry });
runGenerator(false);

writeJson(implementationArtifactRelativePath, implementationArtifact);
implementationEntry.evidence[0].sha256 = digestFile(implementationArtifactPath);
writeEvidence({ "GEN-PROD-002@phase2": implementationEntry });
runGenerator(true);

console.log(
  "PASS traceability generator evidence, fingerprint, range, checkpoint, implementation, and human-gate tests",
);

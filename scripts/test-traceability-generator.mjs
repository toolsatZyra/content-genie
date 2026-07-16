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
  "docs/traceability.md",
  "docs/implementation-plan.md",
  "docs/qc-release-contract.md",
  "docs/threat-model.md",
  "docs/verification-matrix.md",
  "scripts/generate-traceability-plan.mjs",
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
const generatorPath = path.join(
  tempRoot,
  "scripts",
  "generate-traceability-plan.mjs",
);
const originalGenerator = fs.readFileSync(generatorPath, "utf8");
const artifactRelativePath = "docs/evidence/phase2/example.json";
const artifactPath = path.join(tempRoot, ...artifactRelativePath.split("/"));
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
fs.writeFileSync(
  artifactPath,
  `${JSON.stringify({ gate: "phase2", result: "fixture" })}\n`,
  "utf8",
);
const artifactSha256 = crypto
  .createHash("sha256")
  .update(fs.readFileSync(artifactPath))
  .digest("hex");

const runGenerator = (expectedSuccess) => {
  const result = spawnSync(
    process.execPath,
    ["scripts/generate-traceability-plan.mjs"],
    {
      cwd: tempRoot,
      encoding: "utf8",
    },
  );
  assert.equal(
    result.status === 0,
    expectedSuccess,
    `${result.stdout}\n${result.stderr}`,
  );
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
runGit(["add", artifactRelativePath]);
runGit(["commit", "--quiet", "-m", "test: add evidence fixture"]);
const evidenceCommit = runGit(["rev-parse", "HEAD"]);

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
let obligation = requirement.obligations.find(
  (item) => item.checkpoint === "phase2",
);
assert.equal(obligation.status, "verified");
assert.deepEqual(obligation.evidence, verifiedEntry.evidence);
assert.equal(obligation.commit, verifiedEntry.commit);
assert.equal(obligation.verifiedAt, verifiedEntry.verifiedAt);
assert.equal(
  obligation.obligationDefinitionHash,
  verifiedEntry.obligationDefinitionHash,
);
assert.equal(
  requirement.parentStatus,
  "unimplemented",
  "one verified child cannot verify a multi-checkpoint parent",
);
runGenerator(true);

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

console.log(
  "PASS traceability generator evidence, fingerprint, range, checkpoint, and human-gate tests",
);

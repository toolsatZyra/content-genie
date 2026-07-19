import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const runnerPath = path.join(root, "scripts", "run-precheckpoint-gates.mjs");
const source = fs.readFileSync(runnerPath, "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);

function assertPostRunBindingPolicy(candidate) {
  assert.match(candidate, /const postRunCommit = git\(\["rev-parse", "HEAD"\]\)/);
  assert.match(candidate, /const postRunIndexTree = git\(\["write-tree"\]\)/);
  assert.match(candidate, /"--untracked-files=no"/);
  assert.match(candidate, /postRunCommit === candidateCommit/);
  assert.match(candidate, /postRunIndexTree === candidateTree/);
  assert.match(candidate, /postRunTrackedStatus\.length === 0/);
  assert.match(candidate, /exitCode === 0 && postRunBindingPassed \? 0 : 1/);
  assert.match(candidate, /if \(!postRunBindingPassed\)/);
}

assertPostRunBindingPolicy(source);
assert.throws(() =>
  assertPostRunBindingPolicy(
    source.replaceAll("postRunTrackedStatus.length === 0", "true"),
  ),
);

const phase0 = packageJson.scripts["test:phase0"]
  .split("&&")
  .map((step) => step.trim());
assert.ok(
  phase0.indexOf("pnpm test:browser") < phase0.indexOf("pnpm build:canary"),
  "the production build must run after next dev so generated tracked types return to the committed form",
);

console.log("PASS precheckpoint post-run binding and generated-file ordering policy");

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = process.cwd();
const artifactRoot = path.join(root, ".tmp", "artifacts");
const artifactPath = path.join(artifactRoot, "precheckpoint-gate.v1.json");
const logPath = path.join(artifactRoot, "precheckpoint-gate.v1.log");
const gateCommand = ["pnpm", "precheckpoint-gates:raw"];

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function git(args, encoding = "utf8") {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`Git precheckpoint command failed: ${args.join(" ")}`);
  }
  return result.stdout;
}

const candidateCommit = git(["rev-parse", "HEAD"]).trim();
const candidateTree = git(["rev-parse", "HEAD^{tree}"]).trim();
if (!/^[a-f0-9]{40}$/.test(candidateCommit) || !/^[a-f0-9]{40}$/.test(candidateTree)) {
  throw new Error("Precheckpoint gates require a full committed candidate identity.");
}
if (git(["write-tree"]).trim() !== candidateTree) {
  throw new Error("Precheckpoint gates require the index to equal the candidate tree.");
}
if (git(["status", "--porcelain=v1", "--untracked-files=no"]).trim()) {
  throw new Error("Precheckpoint gates require a clean tracked worktree.");
}

const runnerBytes = git(
  ["show", `${candidateCommit}:scripts/run-precheckpoint-gates.mjs`],
  null,
);
const packageBytes = git(["show", `${candidateCommit}:package.json`], null);
fs.mkdirSync(artifactRoot, { recursive: true });
fs.rmSync(artifactPath, { force: true });
fs.rmSync(logPath, { force: true });

const startedAt = new Date().toISOString();
const stdoutHash = crypto.createHash("sha256");
const stderrHash = crypto.createHash("sha256");
const log = fs.createWriteStream(logPath, { encoding: "utf8", flags: "wx" });
const executable = process.platform === "win32" ? "pnpm.cmd" : gateCommand[0];
const child = spawn(
  process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : executable,
  process.platform === "win32"
    ? ["/d", "/s", "/c", `${executable} ${gateCommand.slice(1).join(" ")}`]
    : gateCommand.slice(1),
  {
    cwd: root,
    env: process.env,
    shell: false,
    windowsHide: true,
  },
);

child.stdout.on("data", (chunk) => {
  stdoutHash.update(chunk);
  log.write(chunk);
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  stderrHash.update(chunk);
  log.write(chunk);
  process.stderr.write(chunk);
});

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code) => resolve(code ?? 1));
});
await new Promise((resolve, reject) => {
  log.once("error", reject);
  log.end(resolve);
});

const postRunCommit = git(["rev-parse", "HEAD"]).trim();
const postRunIndexTree = git(["write-tree"]).trim();
const postRunTrackedStatus = git([
  "status",
  "--porcelain=v1",
  "--untracked-files=no",
]).trim();
const postRunBindingPassed =
  postRunCommit === candidateCommit &&
  postRunIndexTree === candidateTree &&
  postRunTrackedStatus.length === 0;
const effectiveExitCode = exitCode === 0 && postRunBindingPassed ? 0 : 1;

const completedAt = new Date().toISOString();
const report = {
  candidate: { commit: candidateCommit, tree: candidateTree },
  completedAt,
  definition: {
    command: gateCommand,
    packageJsonSha256: sha256(packageBytes),
    packageScript: "precheckpoint-gates:raw",
    runnerPath: "scripts/run-precheckpoint-gates.mjs",
    runnerSha256: sha256(runnerBytes),
  },
  durationMs: Date.parse(completedAt) - Date.parse(startedAt),
  exitCode: effectiveExitCode,
  log: {
    path: ".tmp/artifacts/precheckpoint-gate.v1.log",
    sha256: sha256(fs.readFileSync(logPath)),
    stderrSha256: stderrHash.digest("hex"),
    stdoutSha256: stdoutHash.digest("hex"),
  },
  outcome: effectiveExitCode === 0 ? "passed" : "failed",
  postRunBinding: {
    commit: postRunCommit,
    indexTree: postRunIndexTree,
    trackedWorktreeClean: postRunTrackedStatus.length === 0,
  },
  schemaVersion: "genie-precheckpoint-gate.v1",
  startedAt,
};
fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (exitCode !== 0) {
  throw new Error(`Precheckpoint gates failed with exit code ${exitCode}.`);
}
if (!postRunBindingPassed) {
  throw new Error("Precheckpoint gates changed the exact tracked candidate binding.");
}
console.log(`Bound precheckpoint gates to ${candidateCommit} (${candidateTree}).`);

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  createPrivateRuntimeDirectory,
  LIVE_SNAPSHOT_PREFIX,
  privateRuntimeSnapshotLabel,
  removePrivateRuntimeDirectory,
  sealPrivateRuntimeSnapshot,
} from "./private-runtime-path.mjs";
import { digestCandidateEntries } from "./live-evidence-policy.mjs";
import { assertClosedCandidateArtifact } from "./live-candidate-evidence.mjs";
import {
  getPlannedPgTapAssertions,
  hardenPgTapQuery,
} from "./pgtap-harness-policy.mjs";
import { assertPhase2CoordinatePredecessorFixture } from "./phase2-coordinate-upgrade-drill.mjs";
import { LIVE_BROKER_SEAL, runRemoteLiveCandidate } from "./remote-live-broker.mjs";
import { reconcileTrustedBranchCleanupLeases } from "./live-branch-reaper.mjs";
import {
  cleanupTrustedDisposableBranch,
  createTrustedDisposableBranch,
  createTrustedIdentityChallenge,
  productionProjectRef,
  registerTrustedBranchCleanupLease,
  trustedBranchEnvironment,
} from "./trusted-live-branch-control.mjs";

const workspace = resolve(".");
const artifactDirectory = join(workspace, ".tmp", "artifacts");
const artifactPath = join(artifactDirectory, "phase1-live-suite.json");
const artifactTemporaryPath = join(
  artifactDirectory,
  "phase1-live-suite.wrapper.tmp.json",
);
const smokeOnly = process.argv.includes("--snapshot-smoke");

const operatingEnvironmentNames = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "OS",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

function narrowOperatingEnvironment(source) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined && operatingEnvironmentNames.has(name.toUpperCase()),
    ),
  );
}

const operatingEnvironment = narrowOperatingEnvironment(process.env);

function run(
  command,
  args,
  { cwd = workspace, env = operatingEnvironment, inherit = false } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env,
    shell: false,
    stdio: inherit ? "inherit" : "pipe",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed in trusted live-suite control.`);
  }
  return result.stdout?.trim() ?? "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

const trustedHarnessManifest = JSON.parse(
  await readFile(
    new URL("./live-trusted-harness-manifest.v1.json", import.meta.url),
    "utf8",
  ),
);
const trustedHarnessManifestSha256 = sha256(JSON.stringify(trustedHarnessManifest));

function assertTrustedManifestExpectations({ pgTapSuites, predecessorFixture }) {
  if (
    trustedHarnessManifest.schemaVersion !== "genie-live-trusted-harness-manifest.v1" ||
    trustedHarnessManifest.packageManager?.declaration !== "pnpm@11.9.0" ||
    trustedHarnessManifest.packageManager?.version !== "11.9.0" ||
    JSON.stringify(pgTapSuites) !==
      JSON.stringify(trustedHarnessManifest.pgTapSuites) ||
    JSON.stringify(predecessorFixture) !==
      JSON.stringify(trustedHarnessManifest.predecessorFixture)
  ) {
    throw new Error("The committed trusted-harness manifest has drifted.");
  }
}

function assertOriginalCandidate() {
  const tree = run("git", ["write-tree"]);
  if (!/^[a-f0-9]{40,64}$/.test(tree)) {
    throw new Error("git write-tree returned an invalid staged tree.");
  }
  run("git", ["diff", "--quiet", "--no-ext-diff"]);
  const commit = run("git", ["rev-parse", "HEAD"]);
  const headTree = run("git", ["rev-parse", "HEAD^{tree}"]);
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^[a-f0-9]{40}$/.test(headTree)) {
    throw new Error("The live snapshot requires an exact Git commit identity.");
  }
  if (!smokeOnly && tree !== headTree) {
    throw new Error("Remote live proof requires the staged tree to equal HEAD.");
  }
  const relevantStatus = run("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    "src",
    "scripts",
    "public",
    "supabase/migrations",
    "supabase/templates",
    "supabase/tests",
    "tests/live",
    "package.json",
    "pnpm-lock.yaml",
    "next.config.ts",
    "playwright.live.config.ts",
    "tsconfig.json",
  ]);
  if (relevantStatus.split(/\r?\n/u).some((line) => line.startsWith("?? "))) {
    throw new Error("The live snapshot refuses untracked candidate source or tests.");
  }
  const gitDirectory = run("git", ["rev-parse", "--absolute-git-dir"]);
  if (!isAbsolute(gitDirectory)) {
    throw new Error("The live snapshot requires an absolute Git directory.");
  }
  return Object.freeze({ commit, gitDirectory, tree });
}

function assertRemoteCandidate(commit) {
  const candidateRef =
    process.env.GENIE_LIVE_CANDIDATE_REF?.trim() || "refs/heads/main";
  if (!/^refs\/heads\/(?:main|codex\/[a-z0-9._/-]+)$/.test(candidateRef)) {
    throw new Error("The remote live candidate ref is invalid.");
  }
  const listing = run("git", [
    "ls-remote",
    "https://github.com/toolsatZyra/content-genie.git",
    candidateRef,
  ]);
  const [remoteCommit, remoteRef, extra] = listing.split(/\s+/u);
  if (remoteCommit !== commit || remoteRef !== candidateRef || extra) {
    throw new Error("The exact live candidate commit is not published at its ref.");
  }
  return candidateRef;
}

function pnpmEntrypoint() {
  const candidates = [
    join(dirname(process.execPath), "node_modules", "corepack", "dist", "pnpm.js"),
  ];
  for (const pathEntry of (process.env.PATH ?? "").split(";")) {
    if (!pathEntry) continue;
    candidates.push(
      join(pathEntry, "node_modules", "corepack", "dist", "pnpm.js"),
      resolve(pathEntry, "..", "..", "node", "node_modules", "pnpm", "bin", "pnpm.mjs"),
    );
  }
  const entrypoint = candidates.find((candidate) => existsSync(candidate));
  if (!entrypoint) throw new Error("A direct pnpm entrypoint is unavailable.");
  return entrypoint;
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function inside(root, candidate) {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== "..");
}

async function dependencyTreeEvidence(snapshotDirectory) {
  const dependencyRoot = join(snapshotDirectory, "node_modules");
  const entries = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(snapshotDirectory, path).replaceAll("\\", "/");
      const status = await lstat(path);
      if (status.isSymbolicLink()) {
        const target = await readlink(path);
        const resolvedTarget = await realpath(path);
        if (!inside(dependencyRoot, resolvedTarget)) {
          throw new Error("Installed dependency link escapes the sealed snapshot.");
        }
        entries.push(`L\0${relativePath}\0${target.replaceAll("\\", "/")}`);
      } else if (status.isDirectory()) {
        await visit(path);
      } else if (status.isFile()) {
        if (status.nlink !== 1) {
          throw new Error("Installed dependency uses a shared hard link.");
        }
        entries.push(`F\0${relativePath}\0${await hashFile(path)}`);
      } else {
        throw new Error("Installed dependency has an unsupported filesystem type.");
      }
    }
  }
  await visit(dependencyRoot);
  entries.sort();
  return Object.freeze({
    entryCount: entries.length,
    independentCopies: true,
    sha256: sha256(entries.join("\n")),
  });
}

async function installFrozenDependencies(snapshotDirectory) {
  const pnpm = pnpmEntrypoint();
  const installEnvironment = {
    ...operatingEnvironment,
    CI: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
  };
  const packageManagerVersion = run(process.execPath, [pnpm, "--version"], {
    cwd: snapshotDirectory,
    env: installEnvironment,
  });
  if (packageManagerVersion !== "11.9.0") {
    throw new Error("The frozen dependency installer version has drifted.");
  }
  run(
    process.execPath,
    [
      pnpm,
      "install",
      "--offline",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--package-import-method=copy",
    ],
    { cwd: snapshotDirectory, env: installEnvironment },
  );
  const supabasePackage = JSON.parse(
    await readFile(join(snapshotDirectory, "node_modules", "supabase", "package.json")),
  );
  const supabaseCli = join(
    snapshotDirectory,
    "node_modules",
    "supabase",
    "dist",
    "supabase.js",
  );
  if (supabasePackage.version !== "2.109.1" || !existsSync(supabaseCli)) {
    throw new Error("The installed Supabase CLI pin has drifted.");
  }
  return Object.freeze({
    installMode: "offline-frozen-lockfile-independent-copy",
    lockfileSha256: sha256(await readFile(join(snapshotDirectory, "pnpm-lock.yaml"))),
    packageManagerVersion,
    supabaseCli,
    supabaseCliSha256: await hashFile(supabaseCli),
    supabaseCliVersion: supabasePackage.version,
    tree: await dependencyTreeEvidence(snapshotDirectory),
  });
}

async function collectSourceFiles(directory) {
  const collected = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collected.push(...(await collectSourceFiles(path)));
    else if (entry.isFile()) collected.push(path);
    else throw new Error("Candidate source has an unsupported filesystem type.");
  }
  return collected;
}

async function digestCandidateFiles(
  snapshotDirectory,
  { directories = [], files = [] },
) {
  const paths = files.map((path) => join(snapshotDirectory, path));
  for (const directory of directories) {
    paths.push(...(await collectSourceFiles(join(snapshotDirectory, directory))));
  }
  return digestCandidateEntries(
    await Promise.all(
      paths.map(async (path) => ({
        contents: await readFile(path),
        path: relative(snapshotDirectory, path),
      })),
    ),
  );
}

async function expectedCandidateBinding(snapshotDirectory, tree, snapshotSeal) {
  return Object.freeze({
    databaseTests: await digestCandidateFiles(snapshotDirectory, {
      directories: ["supabase/tests"],
    }),
    gitTree: tree,
    liveTests: await digestCandidateFiles(snapshotDirectory, {
      directories: ["tests/live"],
      files: ["playwright.live.config.ts"],
    }),
    migrations: await digestCandidateFiles(snapshotDirectory, {
      directories: ["supabase/migrations"],
    }),
    snapshotSeal,
    source: await digestCandidateFiles(snapshotDirectory, {
      directories: ["src", "scripts", "public", "supabase/templates"],
      files: ["package.json", "pnpm-lock.yaml", "next.config.ts", "tsconfig.json"],
    }),
  });
}

async function expectedPgTapSuites(snapshotDirectory) {
  const testDirectory = join(snapshotDirectory, "supabase", "tests");
  const testFiles = (await readdir(testDirectory))
    .filter((file) => file.endsWith(".test.sql"))
    .sort();
  const expectedFiles = [
    "phase1_foundation.test.sql",
    "phase2_zero_spend_foundation.test.sql",
  ];
  if (
    testFiles.length !== expectedFiles.length ||
    testFiles.some((file, index) => file !== expectedFiles[index])
  ) {
    throw new Error("The exact two-suite pgTAP collection has drifted.");
  }
  return Promise.all(
    testFiles.map(async (testFile) => {
      const source = await readFile(join(testDirectory, testFile), "utf8");
      const query = hardenPgTapQuery(source, testFile);
      return Object.freeze({
        hardenedQuerySha256: sha256(query),
        plannedAssertions: getPlannedPgTapAssertions(source, testFile),
        sourceSha256: sha256(source),
        testFile,
      });
    }),
  );
}

async function publishArtifact(value) {
  await writeFile(artifactTemporaryPath, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    flag: "w",
  });
  await rename(artifactTemporaryPath, artifactPath);
}

await mkdir(artifactDirectory, { recursive: true });
const candidate = assertOriginalCandidate();
if (!smokeOnly) {
  await publishArtifact({
    outcome: "running",
    schemaVersion: "genie-live-suite-evidence.v3",
    state: "running",
  });
}

let branch = null;
let branchCleanup = null;
let branchCleanupLease = null;
let branchName = null;
let branchError = null;
let candidateArtifact = null;
let candidateBinding = null;
let candidateEvidenceExpectations = null;
let childStatus = null;
let dependencyEvidence = null;
let finalDependencyEvidence = null;
let identityChallenge = null;
let remoteExecution = null;
let snapshotCleanupError = null;
let snapshotDirectory = null;
const sealLabel = smokeOnly ? privateRuntimeSnapshotLabel() : LIVE_BROKER_SEAL;

try {
  snapshotDirectory = await createPrivateRuntimeDirectory(LIVE_SNAPSHOT_PREFIX);
  const prefix = `${snapshotDirectory}${sep}`;
  run("git", ["checkout-index", "--all", "--force", `--prefix=${prefix}`]);
  dependencyEvidence = await installFrozenDependencies(snapshotDirectory);
  candidateBinding = await expectedCandidateBinding(
    snapshotDirectory,
    candidate.tree,
    sealLabel,
  );
  candidateEvidenceExpectations = Object.freeze({
    candidateBinding,
    pgTapSuites: await expectedPgTapSuites(snapshotDirectory),
    predecessorFixture: assertPhase2CoordinatePredecessorFixture(),
  });
  assertTrustedManifestExpectations(candidateEvidenceExpectations);

  const frozenGitEnvironment = {
    ...operatingEnvironment,
    GIT_DIR: candidate.gitDirectory,
    GIT_WORK_TREE: snapshotDirectory,
  };
  if (run("git", ["write-tree"], { env: frozenGitEnvironment }) !== candidate.tree) {
    throw new Error("The staged snapshot tree changed during materialization.");
  }
  run("git", ["diff", "--quiet", "--no-ext-diff"], {
    env: frozenGitEnvironment,
  });

  const writablePaths = [".next", ".tmp", "supabase/.temp"];
  await sealPrivateRuntimeSnapshot(
    snapshotDirectory,
    LIVE_SNAPSHOT_PREFIX,
    writablePaths,
  );

  if (smokeOnly) {
    childStatus = 0;
  } else {
    assertRemoteCandidate(candidate.commit);
    const productionRef = productionProjectRef(process.env);
    const trustedEnvironment = trustedBranchEnvironment(
      process.env,
      operatingEnvironment,
    );
    const cleanupReaperOwner = randomUUID();
    const startupReconciliation = await reconcileTrustedBranchCleanupLeases({
      accessToken: trustedEnvironment.accessToken,
      environment: trustedEnvironment.childEnvironment,
      node: process.execPath,
      productionRef,
      reaperOwner: cleanupReaperOwner,
      supabaseCli: dependencyEvidence.supabaseCli,
    });
    if (startupReconciliation.failures.length > 0) {
      throw new Error(
        `Live proof startup cleanup failed for ${startupReconciliation.failures.length} lease(s).`,
      );
    }
    const approvedBrokerDeploymentCommit =
      process.env.GENIE_APPROVED_LIVE_BROKER_COMMIT?.trim();
    if (approvedBrokerDeploymentCommit !== candidate.commit) {
      throw new Error(
        "Live proof requires the candidate to equal the independently reviewed broker deployment.",
      );
    }
    branchName = `genie-live-${randomUUID().slice(0, 12)}`;
    const cleanupLeaseId = randomUUID();
    try {
      branch = await createTrustedDisposableBranch({
        branchName,
        environment: trustedEnvironment.childEnvironment,
        node: process.execPath,
        onExactIdentity: async (exactBranch) => {
          branchCleanupLease = await registerTrustedBranchCleanupLease({
            accessToken: trustedEnvironment.accessToken,
            branch: exactBranch,
            candidate: { commit: candidate.commit, tree: candidate.tree },
            cleanupLeaseId,
            coordinatorOwner: cleanupReaperOwner,
            productionRef,
          });
        },
        productionRef,
        supabaseCli: dependencyEvidence.supabaseCli,
      });
      identityChallenge = await createTrustedIdentityChallenge({
        accessToken: trustedEnvironment.accessToken,
        branchRef: branch.branchRef,
        productionRef,
      });
      remoteExecution = await runRemoteLiveCandidate({
        accessToken: trustedEnvironment.accessToken,
        approvedBrokerDeploymentCommit,
        branch,
        candidate: { commit: candidate.commit, tree: candidate.tree },
        identityChallenge,
        productionRef,
      });
      candidateArtifact = remoteExecution.candidateArtifact;
      childStatus = 0;
    } catch (error) {
      if (error && typeof error === "object" && error.branchId && !branch) {
        branch = {
          branchId: error.branchId,
          branchName,
          branchRef: error.branchRef ?? null,
        };
      }
      branchError = error instanceof Error ? error.message : String(error);
      childStatus = 1;
    } finally {
      try {
        if (branchCleanupLease) {
          const reconciliation = await reconcileTrustedBranchCleanupLeases({
            accessToken: trustedEnvironment.accessToken,
            environment: trustedEnvironment.childEnvironment,
            node: process.execPath,
            productionRef,
            reaperOwner: cleanupReaperOwner,
            supabaseCli: dependencyEvidence.supabaseCli,
          });
          const completed = reconciliation.cleaned.find(
            (entry) => entry.cleanupLeaseId === branchCleanupLease.cleanupLeaseId,
          );
          const ownFailure = reconciliation.failures.find(
            (entry) => entry.cleanupLeaseId === branchCleanupLease.cleanupLeaseId,
          );
          if (ownFailure) {
            throw new Error(
              `Registered branch cleanup lease failed: ${ownFailure.message}`,
            );
          }
          if (!completed) {
            throw new Error("Registered branch cleanup lease was not reconciled.");
          }
          branchCleanup = completed.cleanup;
        } else {
          branchCleanup = await cleanupTrustedDisposableBranch({
            branchId: branch?.branchId ?? null,
            branchName,
            branchRef: branch?.branchRef ?? null,
            createAttempted: Boolean(branchName),
            environment: trustedEnvironment.childEnvironment,
            node: process.execPath,
            productionRef,
            supabaseCli: dependencyEvidence.supabaseCli,
          });
        }
      } catch (error) {
        branchError = branchError
          ? `${branchError}; trusted cleanup failed`
          : error instanceof Error
            ? error.message
            : "Trusted cleanup failed.";
      }
    }
  }
  finalDependencyEvidence = await dependencyTreeEvidence(snapshotDirectory);
  if (
    finalDependencyEvidence.sha256 !== dependencyEvidence.tree.sha256 ||
    finalDependencyEvidence.entryCount !== dependencyEvidence.tree.entryCount
  ) {
    throw new Error("The sealed dependency tree changed during execution.");
  }
} catch (error) {
  childStatus = 1;
  branchError = branchError ?? (error instanceof Error ? error.message : String(error));
} finally {
  if (snapshotDirectory) {
    try {
      await removePrivateRuntimeDirectory(snapshotDirectory, LIVE_SNAPSHOT_PREFIX);
    } catch (error) {
      snapshotCleanupError =
        error instanceof Error ? error.message : "Staged snapshot cleanup failed.";
    }
  }
}

if (smokeOnly) {
  if (childStatus !== 0 || branchError || snapshotCleanupError) {
    throw new Error("The staged snapshot smoke test failed safely.");
  }
  console.log("PASS sealed staged source and independent frozen dependencies");
} else {
  let validatedCandidate = null;
  let validationError = null;
  try {
    if (childStatus !== 0) throw new Error("Candidate live suite did not pass.");
    if (branchError || snapshotCleanupError) {
      throw new Error("Trusted live-suite cleanup did not pass.");
    }
    if (
      !branchCleanup ||
      !["branch-delete-confirmed", "branch-absence-confirmed"].includes(
        branchCleanup.outcome,
      )
    ) {
      throw new Error("Exact branch absence is unproven.");
    }
    if (!dependencyEvidence || !finalDependencyEvidence) {
      throw new Error("Frozen dependency evidence is incomplete.");
    }
    validatedCandidate = assertClosedCandidateArtifact(
      candidateArtifact,
      candidateEvidenceExpectations,
    );
    if (
      !remoteExecution?.brokerArtifact ||
      remoteExecution.brokerArtifact.candidateArtifactSha256 !==
        sha256(JSON.stringify(candidateArtifact)) ||
      remoteExecution.brokerArtifact.harnessSha256 !== trustedHarnessManifestSha256 ||
      remoteExecution.brokerArtifact.database.boundaryScripts < 1 ||
      remoteExecution.brokerArtifact.database.lookCount !== 117 ||
      remoteExecution.brokerArtifact.database.policyBoundLookCount !== 117 ||
      remoteExecution.brokerArtifact.database.voiceCount !== 2
    ) {
      throw new Error("The broker-owned live evidence did not validate independently.");
    }
  } catch (error) {
    validationError = error instanceof Error ? error.message : String(error);
  }

  const passed = Boolean(validatedCandidate) && !validationError;
  await publishArtifact({
    ...(validatedCandidate ?? {}),
    branchCleanup,
    executionSnapshot: {
      candidateCommit: candidate.commit,
      candidateTree: candidate.tree,
      dependencyTree: dependencyEvidence
        ? {
            entryCount: dependencyEvidence.tree.entryCount,
            installMode: dependencyEvidence.installMode,
            lockfileSha256: dependencyEvidence.lockfileSha256,
            packageManagerVersion: dependencyEvidence.packageManagerVersion,
            sha256: dependencyEvidence.tree.sha256,
            supabaseCliSha256: dependencyEvidence.supabaseCliSha256,
            supabaseCliVersion: dependencyEvidence.supabaseCliVersion,
            verifiedUnchanged: Boolean(finalDependencyEvidence),
          }
        : null,
      directoryAbsent: !snapshotCleanupError,
      seal: sealLabel,
      source: "published-git-commit-in-vercel-firecracker-microvm",
    },
    outcome: passed ? "passed" : "failed",
    schemaVersion: "genie-live-suite-evidence.v3",
    state: "finished",
    remoteExecution: remoteExecution
      ? {
          brokerDeploymentCommit: remoteExecution.brokerDeploymentCommit,
          brokerArtifact: remoteExecution.brokerArtifact,
          commandDurationMs: remoteExecution.commandDurationMs,
          commandId: remoteExecution.commandId,
          networkPolicyVerified: remoteExecution.networkPolicyVerified,
          runtime: remoteExecution.runtime,
          sandboxDeleted: remoteExecution.sandboxDeleted,
          sandboxName: remoteExecution.sandboxName,
          seal: remoteExecution.seal,
          sourceSealVerified: remoteExecution.sourceSealVerified,
        }
      : null,
    trustedControl: {
      branchIdentityFields: ["id", "name"],
      candidateReceivedManagementToken: false,
      candidateReceivedProductionDatabaseCredential: false,
      candidateReceivedProductionServiceRole: false,
      evidenceChannel: "parent-owned-closed-schema",
      executionBoundary:
        "vercel-firecracker-microvm-root-owned-source-low-privilege-candidate",
      productionChallengeAbsent: identityChallenge?.productionAbsenceVerified ?? false,
      validationError,
    },
  });
  if (!passed) throw new Error("The trusted staged live suite failed safely.");
}

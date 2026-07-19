import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertPostgresCredentialAbsentFromArgv,
  buildPostgresPgpassTransport,
  digestCandidateEntries,
} from "./live-evidence-policy.mjs";
import {
  assertPhase2CoordinatePredecessorFixture,
  PHASE2_COORDINATE_PREDECESSOR_FIXTURE,
} from "./phase2-coordinate-upgrade-drill.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function requirePatterns(errors, label, source, patterns) {
  for (const pattern of patterns) {
    if (!pattern.test(source)) errors.push(`${label} is missing ${pattern}`);
  }
}

function assertContract({
  branchControl,
  browser,
  config,
  harness,
  packageSource,
  privateRuntime,
  retryPolicy,
  rollback,
  runner,
  suite,
  upgradeDrill,
  wrapper,
}) {
  const errors = [];

  requirePatterns(errors, "isolated runner", runner, [
    /runtimeDirectory\.startsWith\(`\$\{temporaryRoot\}\$\{sep\}`\)/,
    /try\s*\{\s*await waitForServer\(\);\s*await runPlaywright\(\);\s*\}\s*finally\s*\{\s*stopServer\(\);\s*await cleanup\(\);\s*\}/s,
    /taskkill\.exe[\s\S]*"\/T"[\s\S]*"\/F"/,
    /async function cleanup\(\)[\s\S]*attempt <= 20[\s\S]*\["EBUSY", "ENOTEMPTY", "EPERM"\]/s,
    /const playwrightEnvironmentNames = new Set\(\[[\s\S]*"GENIE_LIVE_TEST_PASSWORD"[\s\S]*\]\);/,
    /const playwrightExecutable = require\.resolve\("@playwright\/test\/cli"\)/,
  ]);
  if (/shell:\s*true/.test(runner)) errors.push("isolated runner uses a shell");
  const runnerRuntimeAllowlist = runner.match(
    /const inheritedRuntimeEnvironment = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  if (
    !runnerRuntimeAllowlist ||
    /"(?:LD_LIBRARY_PATH|NODE_OPTIONS|NODE_PATH)"/.test(runnerRuntimeAllowlist)
  ) {
    errors.push("isolated runner inherits interpreter-control variables");
  }
  const playwrightAllowlist = runner.match(
    /const playwrightEnvironmentNames = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  if (
    !playwrightAllowlist ||
    /SERVICE_ROLE|ACCESS_TOKEN|TEST_PROJECT_REF/.test(playwrightAllowlist)
  ) {
    errors.push("Playwright receives privileged credentials");
  }

  requirePatterns(errors, "candidate live suite", suite, [
    /const boundCandidateTree = process\.env\.GENIE_LIVE_BOUND_TREE/,
    /schemaVersion: "genie-live-candidate-evidence\.v3"/,
    /async function executeDirectSql\(query\)[\s\S]*postgres\(databaseCredentialSourceUrl/s,
    /terminalDatabaseRows\(await sql\.unsafe\(query\)\)/,
    /process\.env\.GENIE_LIVE_PRODUCTION_ABSENCE_VERIFIED !== "1"/,
    /assertDatabaseIdentityChallenge\(\{[\s\S]*productionRows: \[\{ challenge_present: false \}\]/s,
    /assertEphemeralBranchDatabase\([\s\S]*databaseUrl,[\s\S]*undefined,[\s\S]*branchProjectRef,[\s\S]*productionProjectRef/s,
    /async function runRemotePgTap\(\)[\s\S]*hardenPgTapQuery\(source, testFile\)[\s\S]*executeDirectSql\(query\)[\s\S]*assertCompletePgTapResult/s,
    /databaseResultSha256: sha256\(JSON\.stringify\(result\)\)/,
    /await runRetrying\([\s\S]*supabaseCli,[\s\S]*"db",[\s\S]*"lint"[\s\S]*"public,private,audit"/s,
    /const harnessHandoff = parseHarnessHandoff\([\s\S]*capture: true/s,
    /await writePrivateRuntimeFile\([\s\S]*liveCredentialsFilePath,[\s\S]*harnessHandoff\.credentials/s,
    /const finalCandidate = await buildCandidateBinding\(\);[\s\S]*assert\.deepEqual\(finalCandidate, candidate\)/s,
    /candidateBindingVerified = true;[\s\S]*outcome\s*=[\s\S]*executionCompleted/s,
    /databasePgpassDirectoryDeleted[\s\S]*liveCredentialsDirectoryDeleted/s,
    /secretPassedInChildArgv: databaseArgvGuardedInvocations > 0 \? false : null/,
    /const supabaseCli = resolve\([\s\S]*"node_modules",[\s\S]*"supabase",[\s\S]*"dist",[\s\S]*"supabase\.js"/s,
  ]);
  if (/SUPABASE_ACCESS_TOKEN|SUPABASE_DB_URL|GENIE_LIVE_FROZEN_GIT_DIR/.test(suite)) {
    errors.push("candidate suite can observe a production control credential");
  }
  if (/"branches",\s*"(?:create|delete|list|get)"/.test(suite)) {
    errors.push("candidate suite owns branch lifecycle control");
  }
  if (/const pnpm\b|\bpnpm\.cmd\b/.test(suite)) {
    errors.push("candidate suite invokes a package manager");
  }
  if (/\.\.\.process\.env|\benv:\s*process\.env\b/.test(suite)) {
    errors.push("candidate suite passes ambient environment to a child");
  }
  if (
    (suite.match(/^\s+assertDatabaseSecretsAbsentFromArgv\(args\);$/gmu)?.length ?? 0) <
    2
  ) {
    errors.push("candidate child launchers bypass the argv credential guard");
  }

  requirePatterns(errors, "trusted branch control", branchControl, [
    /function ownString\(value, name\)/,
    /const idMatches = branches\.filter[\s\S]*const nameMatches = branches\.filter/s,
    /idMatches\.some\([\s\S]*nameMatches\.some\(/s,
    /throw new Error\("Disposable branch identity is ambiguous or has changed\."\)/,
    /const createdName = ownString\(created, "name"\);[\s\S]*createdName !== branchName/s,
    /identity\.exact\.length === 1[\s\S]*"branches",[\s\S]*"delete",[\s\S]*branchId/s,
    /const minimumAbsenceAttempt = 3;/,
    /consecutiveAbsentSnapshots >= 3/,
    /executeManagementSql\([\s\S]*productionRef,[\s\S]*to_regclass/s,
    /productionRows\[0\]\?\.challenge_present !== false/,
  ]);
  if (/"delete",\s*branchName/.test(branchControl)) {
    errors.push("branch control deletes by name");
  }

  requirePatterns(errors, "trusted frozen wrapper", wrapper, [
    /git", \["checkout-index", "--all", "--force", `--prefix=\$\{prefix\}`\]/,
    /createPrivateRuntimeDirectory\(LIVE_SNAPSHOT_PREFIX\)/,
    /"--offline",[\s\S]*"--frozen-lockfile",[\s\S]*"--ignore-scripts",[\s\S]*"--package-import-method=copy"/s,
    /status\.nlink !== 1/,
    /Installed dependency link escapes the sealed snapshot/,
    /supabaseCliSha256: await hashFile\(supabaseCli\)/,
    /supabaseCliVersion: supabasePackage\.version/,
    /sealPrivateRuntimeSnapshot\([\s\S]*LIVE_SNAPSHOT_PREFIX[\s\S]*writablePaths/s,
    /runRemoteLiveCandidate\(\{[\s\S]*candidate: \{ commit: candidate\.commit, tree: candidate\.tree \}/s,
    /import \{ assertClosedCandidateArtifact \} from "\.\/live-candidate-evidence\.mjs"/,
    /async function expectedCandidateBinding\([\s\S]*databaseTests:[\s\S]*liveTests:[\s\S]*migrations:[\s\S]*source:/s,
    /candidateReceivedManagementToken: false/,
    /candidateReceivedProductionDatabaseCredential: false/,
    /candidateReceivedProductionServiceRole: false/,
    /evidenceChannel: "parent-owned-closed-schema"/,
    /cleanupTrustedDisposableBranch\(\{[\s\S]*branchId:[\s\S]*branchName,/s,
    /removePrivateRuntimeDirectory\(snapshotDirectory, LIVE_SNAPSHOT_PREFIX\)/,
    /source: "published-git-commit-in-vercel-firecracker-microvm"/,
  ]);
  const wrapperOperatingAllowlist = wrapper.match(
    /const operatingEnvironmentNames = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  if (
    !wrapperOperatingAllowlist ||
    /SUPABASE|NODE_OPTIONS|NODE_PATH|LD_LIBRARY_PATH/.test(wrapperOperatingAllowlist)
  ) {
    errors.push("trusted wrapper operating allowlist includes authority or loaders");
  }
  if (/spawnSync\([\s\S]*scripts\/run-phase1-live-suite\.mjs/s.test(wrapper)) {
    errors.push("trusted wrapper still executes the candidate under the local user");
  }
  if (/symlink\([\s\S]*workspace[\s\S]*node_modules/s.test(wrapper)) {
    errors.push("wrapper links mutable workspace dependencies");
  }
  if (/\.\.\.process\.env|\benv:\s*process\.env\b/.test(wrapper)) {
    errors.push("trusted wrapper passes ambient environment to a child");
  }

  requirePatterns(errors, "private runtime", privateRuntime, [
    /runtime parent owner is untrusted/,
    /const managedDirectoryIdentities = new Map\(\)/,
    /const managedFileIdentities = new Map\(\)/,
    /status\.dev\}:\$\{status\.ino\}:\$\{status\.birthtimeNs\}/,
    /await rememberIdentity\(managedDirectoryIdentities, directory\)/,
    /Private runtime \$\{label\} object identity changed/,
    /Private runtime cleanup has no created object identity/,
    /if \(created\) runWindowsAcl\(root, "directory", "protect"\);[\s\S]*else runWindowsAcl\(root, "directory", "verify"\);/s,
    /flag: "wx"/,
    /dirname\(absolute\) !== root/,
    /'\/inheritance:r'/,
    /\$rules\.Count -ne 1/,
  ]);

  requirePatterns(errors, "live harness", harness, [
    /credentials: \{[\s\S]*email: ownerEmail[\s\S]*password/s,
    /evidence: \{[\s\S]*crossWorkspaceCrud: "denied"/s,
  ]);
  if (/GENIE_LIVE_CREDENTIALS_PATH|writePrivateRuntimeFile/.test(harness)) {
    errors.push("live harness writes a path supplied by another process");
  }

  requirePatterns(errors, "forward rollback", rollback, [
    /PGPASSFILE: environment\.PGPASSFILE/,
    /"--db-url",\s*environment\.GENIE_EPHEMERAL_DB_TARGET/,
    /const supabaseCli = resolve\([\s\S]*"supabase\.js"/s,
    /spawn\([\s\S]*node,[\s\S]*\[supabaseCli, "db", "query"/s,
  ]);
  if (/const pnpm\b|spawn\(\s*pnpm\b/.test(rollback)) {
    errors.push("forward rollback invokes a package manager");
  }

  requirePatterns(errors, "live browser evidence", browser, [
    /writeFile\([\s\S]*"\.tmp\/phase2-live-boundary-evidence\.json"/s,
    /rawUtf8Sha256: createHash\("sha256"\)[\s\S]*coordinateBoundaryScript/s,
    /bytes: Buffer\.byteLength\(`\$\{coordinateBoundaryScript\}a`, "utf8"\)/,
    /schemaVersion: "genie-script-boundary-evidence\.v1"/,
  ]);
  requirePatterns(errors, "coordinate upgrade drill", upgradeDrill, [
    /drop column if exists script_size_policy_version/,
    /alter column coordinate_map_verifier set default 'postgres-structural-v1'/,
    /octet_length\(raw_utf8\) between 1 and 65536/,
    /buildPhase2CoordinatePredecessorSeedSql/,
    /buildPhase2CoordinateUpgradeVerificationSql/,
    /new script revisions require size policy v2 and at most 8192 bytes/,
  ]);
  const pinnedFixtureSha256 = upgradeDrill.match(
    /PHASE2_COORDINATE_PREDECESSOR_FIXTURE = Object\.freeze\(\{[\s\S]*?sha256: "([a-f0-9]{64})"/,
  )?.[1];
  if (pinnedFixtureSha256 !== PHASE2_COORDINATE_PREDECESSOR_FIXTURE.sha256) {
    errors.push("coordinate predecessor fixture digest pin changed");
  }

  if (/\bwebServer\s*:/.test(config) || !/GENIE_LIVE_BASE_URL/.test(config)) {
    errors.push("Playwright does not use the parent-owned server");
  }
  if (!/outputDir: "\.tmp\/playwright-results"/.test(config)) {
    errors.push("Playwright output escapes the writable snapshot area");
  }
  if (/SERVICE_ROLE|ACCESS_TOKEN|TEST_PROJECT_REF/.test(config)) {
    errors.push("Playwright config reads privileged credentials");
  }
  if (
    !/"test:live:phase1":\s*"node --env-file-if-exists=\.env\.local scripts\/run-frozen-live-suite\.mjs"/.test(
      packageSource,
    ) ||
    !/"test:live:phase2":\s*"node --env-file-if-exists=\.env\.local scripts\/run-frozen-live-suite\.mjs"/.test(
      packageSource,
    ) ||
    !/run-frozen-live-suite\.mjs --snapshot-smoke/.test(packageSource)
  ) {
    errors.push("package gates bypass the trusted frozen wrapper");
  }
  if (/\/(?:dns|timeout)\/i|could not translate host/i.test(retryPolicy)) {
    errors.push("retry policy contains a broad transient classifier");
  }

  if (errors.length > 0) throw new Error(errors.join("\n"));
}

const safe = {
  branchControl: read("scripts/trusted-live-branch-control.mjs"),
  browser: read("tests/live/phase2-script-live.spec.ts"),
  config: read("playwright.live.config.ts"),
  harness: read("scripts/phase1-live-harness.mjs"),
  packageSource: read("package.json"),
  privateRuntime: read("scripts/private-runtime-path.mjs"),
  retryPolicy: read("scripts/transient-failure-policy.mjs"),
  rollback: read("scripts/run-phase1-forward-rollback-drill.mjs"),
  runner: read("scripts/run-isolated-next-dev.mjs"),
  suite: read("scripts/run-phase1-live-suite.mjs"),
  upgradeDrill: read("scripts/phase2-coordinate-upgrade-drill.mjs"),
  wrapper: read("scripts/run-frozen-live-suite.mjs"),
};

const fixtureSource = read(
  "supabase/tests/fixtures/phase2_coordinate_v1_verifiers.sql",
);
assert.deepEqual(
  assertPhase2CoordinatePredecessorFixture(fixtureSource),
  PHASE2_COORDINATE_PREDECESSOR_FIXTURE,
);
assert.throws(
  () => assertPhase2CoordinatePredecessorFixture(`${fixtureSource}\n-- drift`),
  /digest has drifted/,
);

const portableEntries = [
  { contents: Buffer.from("alpha"), path: "src\\alpha.ts" },
  { contents: Buffer.from("beta"), path: "tests\\live\\beta.ts" },
];
const portableDigest = digestCandidateEntries(portableEntries);
assert.deepEqual(
  portableDigest,
  digestCandidateEntries([
    { contents: Buffer.from("beta"), path: "tests/live/beta.ts" },
    { contents: Buffer.from("alpha"), path: "./src/alpha.ts" },
  ]),
);
assert.throws(
  () =>
    digestCandidateEntries([
      { contents: Buffer.from("one"), path: "src\\same.ts" },
      { contents: Buffer.from("two"), path: "src/same.ts" },
    ]),
  /duplicate normalized paths/,
);

const credentialSource =
  "postgresql://postgres.branchref:p%40ss%3Aword%5Ctail@branchref.db.example.test:5432/postgres?sslmode=require&application_name=discarded";
const pgpassTransport = buildPostgresPgpassTransport(credentialSource);
assert.equal(
  pgpassTransport.passwordlessUrl,
  "postgresql://postgres.branchref@branchref.db.example.test:5432/postgres?sslmode=require",
);
assertPostgresCredentialAbsentFromArgv(
  ["--db-url", pgpassTransport.passwordlessUrl],
  credentialSource,
);
for (const exposed of [credentialSource, "p%40ss%3Aword%5Ctail", "p@ss:word\\tail"]) {
  assert.throws(
    () =>
      assertPostgresCredentialAbsentFromArgv(["--db-url", exposed], credentialSource),
    /contains branch database credentials/,
  );
}

assertContract(safe);

const mutations = [
  { key: "runner", from: '"taskkill.exe"', to: '"taskkill-disabled.exe"' },
  { key: "runner", from: "} finally {", to: "}\nif (false) {" },
  {
    key: "suite",
    from: "async function executeDirectSql(query)",
    to: "async function disabledDirectSql(query)",
  },
  {
    key: "suite",
    from: 'process.env.GENIE_LIVE_PRODUCTION_ABSENCE_VERIFIED !== "1"',
    to: "false",
  },
  {
    key: "suite",
    from: "assertCompletePgTapResult(result, planned, testFile);",
    to: "void result;",
  },
  { key: "suite", from: "capture: true,", to: "capture: false," },
  {
    key: "suite",
    from: "assertDatabaseSecretsAbsentFromArgv(args);",
    to: "void args;",
  },
  { key: "branchControl", from: "idMatches.some(", to: "[].some(" },
  { key: "branchControl", from: "nameMatches.some(", to: "[].some(" },
  {
    key: "branchControl",
    from: "identity.exact.length === 1",
    to: "identity.exact.length >= 0",
  },
  {
    key: "branchControl",
    from: "consecutiveAbsentSnapshots >= 3",
    to: "consecutiveAbsentSnapshots >= 0",
  },
  { key: "wrapper", from: '"--offline",', to: '"--prefer-offline",' },
  {
    key: "wrapper",
    from: '"--package-import-method=copy",',
    to: '"--package-import-method=hardlink",',
  },
  { key: "wrapper", from: "status.nlink !== 1", to: "false" },
  {
    key: "wrapper",
    from: 'import { assertClosedCandidateArtifact } from "./live-candidate-evidence.mjs";',
    to: 'import { trustCandidateArtifact } from "./live-candidate-evidence.mjs";',
  },
  {
    key: "wrapper",
    from: "candidateReceivedManagementToken: false",
    to: "candidateReceivedManagementToken: true",
  },
  {
    key: "wrapper",
    from: "await sealPrivateRuntimeSnapshot(",
    to: "void unsafeMutableSnapshot(",
  },
  {
    key: "wrapper",
    from: "await removePrivateRuntimeDirectory(snapshotDirectory, LIVE_SNAPSHOT_PREFIX);",
    to: "void snapshotDirectory;",
  },
  {
    key: "privateRuntime",
    from: "runtime parent owner is untrusted",
    to: "owner ignored",
  },
  {
    key: "privateRuntime",
    from: "await rememberIdentity(managedDirectoryIdentities, directory);",
    to: "void directory;",
  },
  { key: "privateRuntime", from: 'flag: "wx"', to: 'flag: "w"' },
  { key: "harness", from: "credentials: {", to: "privateCredentials: {" },
  { key: "rollback", from: '"supabase.js"', to: '"unsafe-wrapper.js"' },
  {
    key: "config",
    from: 'outputDir: ".tmp/playwright-results"',
    to: 'outputDir: "test-results"',
  },
  {
    key: "upgradeDrill",
    from: PHASE2_COORDINATE_PREDECESSOR_FIXTURE.sha256,
    to: "0".repeat(64),
  },
];

for (const [index, mutation] of mutations.entries()) {
  assert.ok(safe[mutation.key].includes(mutation.from), `mutation ${index} is stale`);
  const unsafe = {
    ...safe,
    [mutation.key]: safe[mutation.key].replace(mutation.from, mutation.to),
  };
  assert.throws(
    () => assertContract(unsafe),
    undefined,
    `unsafe live-boundary mutation ${index} was accepted`,
  );
}

console.log("PASS trusted live boundary, exact cleanup, and hostile policy controls");

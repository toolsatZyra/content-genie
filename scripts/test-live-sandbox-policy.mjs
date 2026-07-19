import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function requirePatterns(errors, label, source, patterns) {
  for (const pattern of patterns) {
    if (!pattern.test(source)) errors.push(`${label} is missing ${pattern}`);
  }
}

function assertPolicy({
  contract,
  directProof,
  evidence,
  ledger,
  manifest,
  remote,
  route,
  sandbox,
  signing,
  wrapper,
}) {
  const errors = [];
  const trustedManifest = JSON.parse(manifest);
  const declaredMigrationVersions = [
    ...(sandbox
      .match(/const expectedPhase2MigrationVersions = \[([\s\S]*?)\] as const;/u)?.[1]
      .matchAll(/"(\d{14})"/gu) ?? []),
  ].map((match) => match[1]);
  const manifestMigrationVersions = trustedManifest.phase2Migrations.map(
    (path) => path.split("/").at(-1).split("_", 1)[0],
  );
  if (
    JSON.stringify(declaredMigrationVersions) !==
    JSON.stringify(manifestMigrationVersions)
  ) {
    errors.push("sandbox terminal migration contract differs from the sealed manifest");
  }
  requirePatterns(errors, "disabled direct database proof", directProof, [
    /Standalone remote database proof is disabled/u,
    /exact-identity trusted live controller/u,
    /throw new Error\(/u,
  ]);
  if (/process\.env|from "postgres"|postgres\(/u.test(directProof)) {
    errors.push("standalone database proof still accepts ambient database authority");
  }
  requirePatterns(errors, "broker contract", contract, [
    /LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64/,
    /MAX_BODY_BYTES = 32 \* 1024/,
    /MAX_CLOCK_SKEW_MS = 120_000/,
    /liveBrokerSignaturePayload\([\s\S]*bodySha256/s,
    /verify\([\s\S]*createPublicKey/s,
    /supabaseUrl !== `https:\/\/\$\{branchRef\}\.supabase\.co`/,
    /expectedHost = `db\.\$\{branchRef\}\.supabase\.co`/,
    /branchRef === productionRef/,
    /allow: \[`\$\{branchRef\}\.supabase\.co`, `db\.\$\{branchRef\}\.supabase\.co`\]/,
  ]);
  requirePatterns(errors, "sandbox control", sandbox, [
    /Sandbox\.create\(\{/,
    /persistent: false/,
    /runtime: "node24"/,
    /url: LIVE_BROKER_REPOSITORY_URL/,
    /"--frozen-lockfile"[\s\S]*"--ignore-pnpmfile"[\s\S]*"--ignore-scripts"[\s\S]*"--package-import-method=copy"/s,
    /packageConfigPreflightProgram/,
    /sourceFingerprintProgram/,
    /await assertNoCandidateProcesses\(sandbox\)/,
    /import postgres from "postgres"/,
    /expectedPhase2MigrationVersions/,
    /trustedHarnessManifestJson/,
    /assertDeployedCandidate\(request\.candidate\.commit\)/,
    /await verifyTrustedHarness\(sandbox, request\.candidate\.tree\)/,
    /assertClosedCandidateArtifact\(candidateArtifact/,
    /await trustedDatabaseEvidence\(controlBranch, "preflight"\)/,
    /await trustedDatabaseEvidence\(control\.branch, "terminal"\)/,
    /parsePreflightDatabaseEvidence/,
    /parseTerminalDatabaseEvidence/,
    /genie-trusted-live-harness-evidence\.v1/,
    /boundedCandidateCommandProgram/,
    /COMMAND_OUTPUT_MAX_BYTES = 8 \* 1024 \* 1024/,
    /ARTIFACT_MAX_BYTES = 2 \* 1024 \* 1024/,
    /runuser',[\s\S]*'candidate'[\s\S]*'scripts\/run-phase1-live-suite\.mjs'/s,
    /stat\.isFile\(\)[\s\S]*stat\.isSymbolicLink\(\)[\s\S]*stat\.nlink!==1/s,
    /stat\.nlink!==1\|\|stat\.size<\$\{minimumBytes\}/,
    /await assertNoCandidateProcesses\(sandbox\)[\s\S]*boundedFileEvidence\([\s\S]*CANDIDATE_ARTIFACT_PATH/s,
    /sandbox\.createUser\("candidate"\)/,
    /"chown", \["-R", "root:root", sandbox\.cwd\]/,
    /"chmod", \["-R", "a-w", sandbox\.cwd\]/,
    /candidateWritablePaths = \["\.next", "\.tmp", "supabase\/\.temp"\]/,
    /await assertCandidateWriteScope\(sandbox\)/,
    /await sandbox\.update\(\{[\s\S]*networkPolicy: runtimeNetworkPolicy/s,
    /const command = await sandbox\.runCommand\(\{[\s\S]*boundedCandidateCommandProgram[\s\S]*detached: true,[\s\S]*GENIE_LIVE_POSTGRES_URL/s,
    /candidate: request\.candidate\.commit,[\s\S]*tree: request\.candidate\.tree/s,
    /consecutiveAbsence >= 3/,
    /await sandbox\.delete\(\)/,
  ]);
  if (/allow-all/.test(sandbox)) {
    errors.push("sandbox control contains an allow-all network path");
  }
  if (
    /SUPABASE_ACCESS_TOKEN|VERCEL_(?!GIT_COMMIT_SHA)|NEXT_PUBLIC_|shell:\s*true/.test(
      sandbox,
    )
  ) {
    errors.push("sandbox control can observe ambient or management authority");
  }
  const candidateEnvironment = sandbox.match(
    /const command = await sandbox\.runCommand\(\{[\s\S]*?env: \{([\s\S]*?)\},[\s\S]*?timeoutMs: COMMAND_TIMEOUT_MS/s,
  )?.[1];
  if (
    !candidateEnvironment ||
    /SUPABASE_ACCESS_TOKEN|VERCEL|NEXT_PUBLIC_SUPABASE_URL|process\.env/.test(
      candidateEnvironment,
    )
  ) {
    errors.push("candidate environment is not an explicit disposable-only allowlist");
  }
  requirePatterns(errors, "broker route", route, [
    /process\.env\.VERCEL_ENV !== "production"/,
    /process\.env\.VERCEL_GIT_COMMIT_SHA/,
    /authenticateLiveBrokerRequest\(request\.headers, rawBody\)/,
    /parseLiveBrokerRequest\(rawBody\)/,
    /claimLiveBrokerRequest\(\{/,
    /recordLiveBrokerCreated/,
    /reconcileLiveBrokerCancellation/,
    /signLiveBrokerEvidence\(\{/,
    /export const maxDuration = 300/,
    /Cache-Control": "no-store, max-age=0"/,
    /errorName: error instanceof Error \? error\.name/,
    /readLiveBrokerBody\(request\)/,
    /LIVE_BROKER_MAX_BODY_BYTES/,
    /await reader\.cancel\(\)/,
    /fatal: true/,
  ]);
  if (/request\.(?:text|arrayBuffer)\(/.test(route)) {
    errors.push("broker route buffers the request before enforcing its byte limit");
  }
  if (
    route.indexOf("authenticateLiveBrokerRequest") >
    route.indexOf("parseLiveBrokerRequest(rawBody)")
  ) {
    errors.push("broker route parses the credential body before authentication");
  }
  if (/error\.message|String\(error\)/.test(route)) {
    errors.push("broker route exposes internal failure text");
  }
  requirePatterns(errors, "durable broker ledger", ledger, [
    /import "server-only"/,
    /SUPABASE_SERVICE_ROLE_KEY/,
    /command_claim_live_broker_request/,
    /command_record_live_broker_created/,
    /command_record_live_broker_state/,
    /get_live_broker_lifecycle/,
    /command_reconcile_live_broker_cancellation/,
    /error\.code === "23505" \|\| error\.code === "54000"/,
  ]);
  requirePatterns(errors, "broker evidence signer", evidence, [
    /import "server-only"/,
    /GENIE_LIVE_EVIDENCE_PRIVATE_KEY_PKCS8_BASE64/,
    /LIVE_BROKER_EVIDENCE_PUBLIC_KEY_SPKI_BASE64/,
    /createPrivateKey\(\{/,
    /sign\(/,
    /canonicalLiveBrokerEvidenceJson/,
  ]);
  requirePatterns(errors, "local broker signing", signing, [
    /GENIE_LIVE_BROKER_SIGNING_PRIVATE_KEY_PKCS8_BASE64/,
    /type: "pkcs8"/,
    /asymmetricKeyType !== "ed25519"/,
    /publicKey !== LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64/,
    /sign\([\s\S]*privateKey/s,
  ]);
  if (/console\.log|SUPABASE_ACCESS_TOKEN|privateKeyFromAccessToken/.test(signing)) {
    errors.push("signing module logs or names the management credential");
  }
  requirePatterns(errors, "trusted harness manifest", manifest, [
    /genie-live-trusted-harness-manifest\.v1/,
    /"role": "candidate-runner"/,
    /"role": "strict-evidence-validator"/,
    /"role": "pgtap-source"/,
    /"role": "phase2-migration"/,
    /"role": "predecessor-fixture"/,
    /"role": "live-browser-spec"/,
    /"declaration": "pnpm@11\.9\.0"/,
    /"hardenedQuerySha256"/,
  ]);
  requirePatterns(errors, "remote broker parent", remote, [
    /https:\/\/content-genie-three\.vercel\.app\/api\/internal\/live-broker/,
    /assertEndpoint\(endpoint\)/,
    /signer\(rawBody, accessToken\)/,
    /signer = signLiveBrokerBody/,
    /finally \{[\s\S]*controlRequest\("stop"/s,
    /stopResponse\.brokerDeploymentCommit !== brokerDeploymentCommit/,
    /approvedBrokerDeploymentCommit/,
    /not the independently approved pin/,
    /LIVE_BROKER_EVIDENCE_PUBLIC_KEY_SPKI_BASE64/,
    /assertBrokerEvidence\(\{/,
    /createPublicKey\(\{/,
    /verify\(/,
    /value\.absenceSnapshots !== 3/,
    /value\.sourceSealVerified !== true/,
    /value\.networkPolicyVerified !== true/,
    /MAX_BROKER_RESPONSE_BYTES = 3 \* 1024 \* 1024/,
    /readBoundedBrokerResponse\(response\)/,
    /await reader\.cancel\(\)/,
  ]);
  if (/response\.(?:text|arrayBuffer)\(/.test(remote)) {
    errors.push("remote broker buffers a response before enforcing its byte limit");
  }
  if (/http:\/\//.test(remote)) {
    errors.push("remote broker accepts a plaintext control endpoint");
  }
  requirePatterns(errors, "trusted wrapper", wrapper, [
    /tree !== headTree/,
    /git", \[[\s\S]*"ls-remote"[\s\S]*content-genie\.git/s,
    /runRemoteLiveCandidate\(\{/,
    /GENIE_APPROVED_LIVE_BROKER_COMMIT/,
    /candidate: \{ commit: candidate\.commit, tree: candidate\.tree \}/,
    /remoteExecution\.sandboxDeleted/,
    /remoteExecution\.sourceSealVerified/,
    /remoteExecution\.brokerArtifact/,
    /approvedBrokerDeploymentCommit !== candidate\.commit/,
    /brokerArtifact\.harnessSha256 !== trustedHarnessManifestSha256/,
    /executionBoundary:[\s\S]*vercel-firecracker-microvm-root-owned-source-low-privilege-candidate/s,
  ]);
  if (/spawnSync\([\s\S]*scripts\/run-phase1-live-suite\.mjs/s.test(wrapper)) {
    errors.push("trusted wrapper still executes the secret-bearing candidate locally");
  }
  if (/await command\.(?:stdout|stderr)\(\)/u.test(sandbox)) {
    errors.push(
      "broker materializes candidate command output instead of bounded log files",
    );
  }
  if (
    sandbox.indexOf("const artifactEvidence = await boundedFileEvidence(") >
    sandbox.indexOf("const artifactBytes = await sandbox.readFileToBuffer(")
  ) {
    errors.push(
      "broker reads the candidate artifact before trusted stat/hash validation",
    );
  }
  const candidateCommandIndex = sandbox.indexOf(
    "const command = await sandbox.runCommand({",
  );
  const startManifestIndex = sandbox.indexOf(
    "const trustedHarness = await verifyTrustedHarness(",
  );
  const artifactEvidenceIndex = sandbox.indexOf(
    "const artifactEvidence = await boundedFileEvidence(",
  );
  const terminalProcessIndex = sandbox.lastIndexOf(
    "await assertNoCandidateProcesses(sandbox);",
  );
  const terminalManifestIndex = sandbox.lastIndexOf(
    "const trustedHarness = await verifyTrustedHarness(",
  );
  const semanticValidationIndex = sandbox.indexOf(
    "const validatedCandidateArtifact = assertClosedCandidateArtifact(",
  );
  const terminalDatabaseIndex = sandbox.indexOf(
    'await trustedDatabaseEvidence(control.branch, "terminal")',
  );
  if (
    startManifestIndex < 0 ||
    startManifestIndex > candidateCommandIndex ||
    terminalProcessIndex < 0 ||
    terminalProcessIndex > artifactEvidenceIndex ||
    terminalManifestIndex < terminalProcessIndex ||
    terminalManifestIndex > artifactEvidenceIndex ||
    semanticValidationIndex < artifactEvidenceIndex ||
    semanticValidationIndex > terminalDatabaseIndex
  ) {
    errors.push("broker TCB verification or semantic-validation order is unsafe");
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

const safe = {
  contract: read("src/server/live-broker-contract.ts"),
  directProof: read("scripts/run-remote-database-proof.mjs"),
  evidence: read("src/server/live-broker-evidence.ts"),
  ledger: read("src/server/live-broker-ledger.ts"),
  manifest: read("scripts/live-trusted-harness-manifest.v1.json"),
  remote: read("scripts/remote-live-broker.mjs"),
  route: read("src/app/api/internal/live-broker/route.ts"),
  sandbox: read("src/server/live-sandbox-control.ts"),
  signing: read("scripts/live-broker-signing.mjs"),
  wrapper: read("scripts/run-frozen-live-suite.mjs"),
};

assertPolicy(safe);

const mutations = [
  { key: "sandbox", from: "persistent: false", to: "persistent: true" },
  { key: "sandbox", from: '"--ignore-scripts"', to: '"--enable-scripts"' },
  {
    key: "directProof",
    from: "throw new Error(",
    to: "void (",
  },
  {
    key: "sandbox",
    from: 'sandbox.createUser("candidate")',
    to: 'sandbox.asUser("vercel-sandbox")',
  },
  {
    key: "sandbox",
    from: '"chmod", ["-R", "a-w", sandbox.cwd]',
    to: '"chmod", ["-R", "a+w", sandbox.cwd]',
  },
  {
    key: "sandbox",
    from: "networkPolicy: runtimeNetworkPolicy(request.branch.branchRef)",
    to: 'networkPolicy: "allow-all"',
  },
  { key: "sandbox", from: '"--ignore-pnpmfile"', to: '"--use-pnpmfile"' },
  {
    key: "route",
    from: "authenticateLiveBrokerRequest(request.headers, rawBody)",
    to: "void request.headers;",
  },
  {
    key: "route",
    from: "signLiveBrokerEvidence({",
    to: "Object.freeze({",
  },
  {
    key: "signing",
    from: "publicKey !== LIVE_BROKER_PUBLIC_KEY_SPKI_BASE64",
    to: "false",
  },
  {
    key: "sandbox",
    from: "assertDeployedCandidate(request.candidate.commit);",
    to: "void request.candidate.commit;",
  },
  {
    key: "sandbox",
    from: '  "20260717121612",',
    to: "",
  },
  {
    key: "sandbox",
    from: "stat.nlink!==1||stat.size<${minimumBytes}",
    to: "false",
  },
  {
    key: "wrapper",
    from: "approvedBrokerDeploymentCommit !== candidate.commit",
    to: "false",
  },
  {
    key: "evidence",
    from: "createPrivateKey({",
    to: "createPublicKey({",
  },
  {
    key: "ledger",
    from: 'error.code === "23505" || error.code === "54000"',
    to: "false",
  },
  {
    key: "remote",
    from: 'controlRequest("stop", candidate, sandboxName)',
    to: 'controlRequest("status", candidate, sandboxName)',
  },
  {
    key: "wrapper",
    from: "tree !== headTree",
    to: "false",
  },
];

for (const [index, mutation] of mutations.entries()) {
  assert.ok(safe[mutation.key].includes(mutation.from), `mutation ${index} is stale`);
  assert.throws(
    () =>
      assertPolicy({
        ...safe,
        [mutation.key]: safe[mutation.key].replace(mutation.from, mutation.to),
      }),
    undefined,
    `unsafe sandbox mutation ${index} was accepted`,
  );
}

console.log(
  "PASS signed Firecracker broker, low-privilege candidate, and cleanup policy",
);

import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

import { LIVE_BROKER_SEAL, runRemoteLiveCandidate } from "./remote-live-broker.mjs";

const brokerDeploymentCommit = "d".repeat(40);
const candidate = { commit: brokerDeploymentCommit, tree: "b".repeat(40) };
const branchRef = "c".repeat(20);
const branch = {
  branchId: "12345678-1234-4123-8123-123456789abc",
  branchName: "genie-live-12345678-abc",
  branchRef,
  credentials: {
    anonKey: `anon.${"a".repeat(50)}`,
    databaseUrl: `postgresql://postgres:secret@db.${branchRef}.supabase.co:5432/postgres`,
    serviceRoleKey: `service.${"b".repeat(50)}`,
    supabaseUrl: `https://${branchRef}.supabase.co`,
  },
};
const identityChallenge = {
  nonce: "22345678-1234-4123-8123-123456789abc",
  table: "phase2_connection_challenge_0123456789abcdef0123456789abcdef",
};
const evidenceKeys = generateKeyPairSync("ed25519");
const evidencePublicKeySpkiBase64 = evidenceKeys.publicKey
  .export({ format: "der", type: "spki" })
  .toString("base64");
const commandId = "command-12345678";
const signer = () => ({
  issuedAt: "1784361600000",
  nonce: "32345678-1234-4123-8123-123456789abc",
  signature: "A".repeat(86) + "==",
});

function jsonResponse(value, status = 200) {
  const body = JSON.stringify(value);
  return new Response(body, {
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "application/json; charset=utf-8",
    },
    status,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function brokerResponse(body, result) {
  const payload = {
    action: body.action,
    brokerDeploymentCommit,
    requestBodySha256: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
    resultSha256: createHash("sha256").update(canonicalJson(result)).digest("hex"),
    schemaVersion: "genie-live-broker-evidence-payload.v1",
    signedAt: new Date().toISOString(),
  };
  return jsonResponse({
    brokerDeploymentCommit,
    brokerEvidence: {
      algorithm: "Ed25519",
      keyId: "genie-live-evidence-ed25519-v1",
      payload,
      schemaVersion: "genie-live-broker-evidence-envelope.v1",
      signatureBase64: sign(
        null,
        Buffer.from(canonicalJson(payload), "utf8"),
        evidenceKeys.privateKey,
      ).toString("base64"),
    },
    ok: true,
    result,
  });
}

const actions = [];
let sandboxName;
let statusCalls = 0;
let stopCalls = 0;
const fetchImpl = async (_url, init) => {
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-genie-live-signature"], "A".repeat(86) + "==");
  const body = JSON.parse(init.body);
  actions.push(body.action);
  sandboxName ??= body.sandboxName;
  assert.equal(body.sandboxName, sandboxName);
  if (body.action === "start") {
    assert.equal(body.branch.credentials.databaseUrl, branch.credentials.databaseUrl);
    assert.equal(Object.hasOwn(body, "accessToken"), false);
    return brokerResponse(body, {
      commandId,
      networkPolicyVerified: true,
      runtime: "node24",
      sandboxName,
      sandboxSessionId: "session_12345678",
      seal: LIVE_BROKER_SEAL,
      sourceCommit: candidate.commit,
      sourceTree: candidate.tree,
    });
  }
  if (body.action === "status") {
    statusCalls += 1;
    return brokerResponse(
      body,
      statusCalls === 1
        ? {
            brokerArtifact: null,
            candidateArtifact: null,
            commandDurationMs: null,
            commandExitCode: null,
            commandId,
            networkPolicyVerified: false,
            sandboxName,
            seal: LIVE_BROKER_SEAL,
            sourceSealVerified: false,
            state: "running",
          }
        : {
            brokerArtifact: {
              candidateArtifactSha256: createHash("sha256")
                .update(JSON.stringify({ outcome: "passed" }))
                .digest("hex"),
              command: {
                durationMs: 42,
                exitCode: 0,
                stderrBytes: 0,
                stderrSha256: "a".repeat(64),
                stdoutBytes: 128,
                stdoutSha256: "b".repeat(64),
              },
              database: {
                boundaryScripts: 1,
                branchRef,
                lookCount: 117,
                migrationVersions: [
                  "20260717121500",
                  "20260717121501",
                  "20260717121600",
                  "20260717121601",
                  "20260717121602",
                  "20260717121603",
                  "20260717121604",
                  "20260717121605",
                  "20260717121606",
                  "20260717121607",
                  "20260717121608",
                  "20260717121609",
                  "20260717121610",
                  "20260717121611",
                  "20260717121612",
                ],
                policyBoundLookCount: 117,
                voiceCount: 2,
              },
              harnessSha256: "c".repeat(64),
              preflightDatabaseEvidence: {
                branchRef,
                challengeVerified: true,
              },
              schemaVersion: "genie-trusted-live-harness-evidence.v1",
            },
            candidateArtifact: { outcome: "passed" },
            commandDurationMs: 42,
            commandExitCode: 0,
            commandId,
            networkPolicyVerified: true,
            sandboxName,
            seal: LIVE_BROKER_SEAL,
            sourceSealVerified: true,
            state: "finished",
          },
    );
  }
  assert.equal(body.action, "stop");
  stopCalls += 1;
  if (stopCalls === 1) {
    return brokerResponse(body, {
      absenceSnapshots: 3,
      deleted: false,
      retryAfterMs: 1_000,
      sandboxName,
    });
  }
  return brokerResponse(body, {
    absenceSnapshots: 3,
    deleted: true,
    sandboxName,
  });
};

const result = await runRemoteLiveCandidate({
  accessToken: "fixture-token",
  approvedBrokerDeploymentCommit: brokerDeploymentCommit,
  branch,
  candidate,
  evidencePublicKeySpkiBase64,
  fetchImpl,
  identityChallenge,
  productionRef: "e".repeat(20),
  signer,
  sleep: async () => undefined,
});
assert.deepEqual(actions, ["start", "status", "status", "stop", "stop"]);
assert.equal(result.sandboxDeleted, true);
assert.equal(result.sourceSealVerified, true);
assert.deepEqual(result.candidateArtifact, { outcome: "passed" });

await assert.rejects(
  runRemoteLiveCandidate({
    accessToken: "fixture-token",
    approvedBrokerDeploymentCommit: "f".repeat(40),
    branch,
    candidate,
    evidencePublicKeySpkiBase64,
    fetchImpl,
    identityChallenge,
    productionRef: "e".repeat(20),
    signer,
    sleep: async () => undefined,
  }),
  /exact independently approved broker deployment/,
);

let failedCleanupAttempted = false;
await assert.rejects(
  runRemoteLiveCandidate({
    accessToken: "fixture-token",
    approvedBrokerDeploymentCommit: brokerDeploymentCommit,
    branch,
    candidate,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "stop") {
        failedCleanupAttempted = true;
        return brokerResponse(body, {
          absenceSnapshots: 3,
          deleted: true,
          sandboxName: body.sandboxName,
        });
      }
      return jsonResponse({ code: "BROKER_OPERATION_FAILED", ok: false }, 502);
    },
    identityChallenge,
    evidencePublicKeySpkiBase64,
    productionRef: "e".repeat(20),
    signer,
    sleep: async () => undefined,
  }),
  /failed safely/,
);
assert.equal(failedCleanupAttempted, true);

let forgedEvidenceCleanupAttempted = false;
await assert.rejects(
  runRemoteLiveCandidate({
    accessToken: "fixture-token",
    approvedBrokerDeploymentCommit: brokerDeploymentCommit,
    branch,
    candidate,
    evidencePublicKeySpkiBase64,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "stop") {
        forgedEvidenceCleanupAttempted = true;
        return brokerResponse(body, {
          absenceSnapshots: 3,
          deleted: true,
          sandboxName: body.sandboxName,
        });
      }
      const valid = JSON.parse(
        await brokerResponse(body, {
          commandId,
          networkPolicyVerified: true,
          runtime: "node24",
          sandboxName: body.sandboxName,
          sandboxSessionId: "session_12345678",
          seal: LIVE_BROKER_SEAL,
          sourceCommit: candidate.commit,
          sourceTree: candidate.tree,
        }).text(),
      );
      valid.brokerEvidence.signatureBase64 = `${"A".repeat(86)}==`;
      return jsonResponse(valid);
    },
    identityChallenge,
    productionRef: "e".repeat(20),
    signer,
    sleep: async () => undefined,
  }),
  /evidence signature is invalid/,
);
assert.equal(forgedEvidenceCleanupAttempted, true);

let declaredOversizeReaderAccessed = false;
await assert.rejects(
  runRemoteLiveCandidate({
    accessToken: "fixture-token",
    approvedBrokerDeploymentCommit: brokerDeploymentCommit,
    branch,
    candidate,
    evidencePublicKeySpkiBase64,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "stop") {
        return brokerResponse(body, {
          absenceSnapshots: 3,
          deleted: true,
          sandboxName: body.sandboxName,
        });
      }
      return {
        body: {
          getReader() {
            declaredOversizeReaderAccessed = true;
            throw new Error("oversized declared responses must not be read");
          },
        },
        headers: new Headers({ "content-length": String(3 * 1024 * 1024 + 1) }),
        ok: true,
        status: 200,
      };
    },
    identityChallenge,
    productionRef: "e".repeat(20),
    signer,
    sleep: async () => undefined,
  }),
  /oversized response/,
);
assert.equal(declaredOversizeReaderAccessed, false);

let streamedResponseReads = 0;
let streamedResponseCancels = 0;
let streamedResponseReleases = 0;
await assert.rejects(
  runRemoteLiveCandidate({
    accessToken: "fixture-token",
    approvedBrokerDeploymentCommit: brokerDeploymentCommit,
    branch,
    candidate,
    evidencePublicKeySpkiBase64,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.action === "stop") {
        return brokerResponse(body, {
          absenceSnapshots: 3,
          deleted: true,
          sandboxName: body.sandboxName,
        });
      }
      const reader = {
        async cancel() {
          streamedResponseCancels += 1;
        },
        async read() {
          streamedResponseReads += 1;
          if (streamedResponseReads === 1) {
            return { done: false, value: new Uint8Array(3 * 1024 * 1024) };
          }
          if (streamedResponseReads === 2) {
            return { done: false, value: new Uint8Array(1) };
          }
          throw new Error("the bounded reader consumed beyond the overflow chunk");
        },
        releaseLock() {
          streamedResponseReleases += 1;
        },
      };
      return {
        body: { getReader: () => reader },
        headers: new Headers(),
        ok: true,
        status: 200,
      };
    },
    identityChallenge,
    productionRef: "e".repeat(20),
    signer,
    sleep: async () => undefined,
  }),
  /oversized response/,
);
assert.equal(streamedResponseReads, 2);
assert.equal(streamedResponseCancels, 1);
assert.equal(streamedResponseReleases, 1);

console.log("PASS signed remote live-broker orchestration and cleanup controls");

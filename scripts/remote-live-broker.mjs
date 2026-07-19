import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";

import { signLiveBrokerBody } from "./live-broker-signing.mjs";

export const LIVE_BROKER_ENDPOINT =
  "https://content-genie-three.vercel.app/api/internal/live-broker";
export const LIVE_BROKER_SEAL =
  "vercel-firecracker-root-owned-low-privilege-candidate-v1";
export const LIVE_BROKER_EVIDENCE_PUBLIC_KEY_SPKI_BASE64 =
  "MCowBQYDK2VwAyEA7ZqqCX0l0WFGdiMIN5qzdEgjAT/Nn2t4/hI4B4mQ2tA=";
const schemaVersion = "genie-live-broker-request.v1";
const MAX_BROKER_RESPONSE_BYTES = 3 * 1024 * 1024;
const exactEndpoint = new URL(LIVE_BROKER_ENDPOINT);
const expectedPhase2MigrationVersions = [
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
];

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
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

function assertBrokerEvidence({
  body,
  brokerDeploymentCommit,
  envelope,
  publicKeySpkiBase64,
  rawBody,
  result,
}) {
  if (
    !exactKeys(envelope, [
      "algorithm",
      "keyId",
      "payload",
      "schemaVersion",
      "signatureBase64",
    ]) ||
    envelope.algorithm !== "Ed25519" ||
    envelope.keyId !== "genie-live-evidence-ed25519-v1" ||
    envelope.schemaVersion !== "genie-live-broker-evidence-envelope.v1" ||
    !/^[A-Za-z0-9+/]{80,100}={0,2}$/.test(envelope.signatureBase64) ||
    !exactKeys(envelope.payload, [
      "action",
      "brokerDeploymentCommit",
      "requestBodySha256",
      "resultSha256",
      "schemaVersion",
      "signedAt",
    ]) ||
    envelope.payload.action !== body.action ||
    envelope.payload.brokerDeploymentCommit !== brokerDeploymentCommit ||
    envelope.payload.requestBodySha256 !==
      createHash("sha256").update(rawBody).digest("hex") ||
    envelope.payload.resultSha256 !==
      createHash("sha256").update(canonicalJson(result)).digest("hex") ||
    envelope.payload.schemaVersion !== "genie-live-broker-evidence-payload.v1" ||
    typeof envelope.payload.signedAt !== "string" ||
    Number.isNaN(Date.parse(envelope.payload.signedAt)) ||
    Math.abs(Date.now() - Date.parse(envelope.payload.signedAt)) > 300_000
  ) {
    throw new Error("The live broker evidence envelope is invalid.");
  }
  let signatureValid = false;
  try {
    signatureValid = verify(
      null,
      Buffer.from(canonicalJson(envelope.payload), "utf8"),
      createPublicKey({
        format: "der",
        key: Buffer.from(publicKeySpkiBase64, "base64"),
        type: "spki",
      }),
      Buffer.from(envelope.signatureBase64, "base64"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new Error("The live broker evidence signature is invalid.");
  }
}

function assertEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== exactEndpoint.origin ||
    parsed.pathname !== exactEndpoint.pathname ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("The live suite refuses a non-canonical broker endpoint.");
  }
}

async function cancelResponseReader(reader) {
  try {
    await reader.cancel();
  } catch {
    // Preserve the bounded-read failure if cancellation itself fails.
  }
}

async function readBoundedBrokerResponse(response) {
  const declaredValue = response.headers?.get?.("content-length") ?? null;
  if (declaredValue !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declaredValue)) {
      throw new Error("The live broker returned an invalid content length.");
    }
    const declaredBytes = Number(declaredValue);
    if (!Number.isSafeInteger(declaredBytes)) {
      throw new Error("The live broker returned an invalid content length.");
    }
    if (declaredBytes > MAX_BROKER_RESPONSE_BYTES) {
      throw new Error("The live broker returned an oversized response.");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new Error("The live broker returned no readable response body.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      let part;
      try {
        part = await reader.read();
      } catch {
        await cancelResponseReader(reader);
        throw new Error("The live broker response could not be read safely.");
      }
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) {
        await cancelResponseReader(reader);
        throw new Error("The live broker returned a malformed response stream.");
      }
      const nextTotal = totalBytes + part.value.byteLength;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > MAX_BROKER_RESPONSE_BYTES) {
        await cancelResponseReader(reader);
        throw new Error("The live broker returned an oversized response.");
      }
      chunks.push(part.value);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks, totalBytes),
    );
  } catch {
    throw new Error("The live broker returned malformed UTF-8.");
  }
}

async function signedRequest({
  accessToken,
  body,
  evidencePublicKeySpkiBase64,
  endpoint,
  fetchImpl,
  signer,
  timeoutMs,
}) {
  assertEndpoint(endpoint);
  const rawBody = JSON.stringify(body);
  const signature = signer(rawBody, accessToken);
  const response = await fetchImpl(endpoint, {
    body: rawBody,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-genie-live-issued-at": signature.issuedAt,
      "x-genie-live-nonce": signature.nonce,
      "x-genie-live-signature": signature.signature,
    },
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const responseText = await readBoundedBrokerResponse(response);
  let result;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error("The live broker returned malformed JSON.");
  }
  if (!response.ok || result?.ok !== true) {
    const code =
      typeof result?.code === "string" ? result.code : `HTTP_${response.status}`;
    throw new Error(`The live broker failed safely (${code}).`);
  }
  if (
    !exactKeys(result, ["brokerDeploymentCommit", "brokerEvidence", "ok", "result"]) ||
    !/^[a-f0-9]{40}$/.test(result.brokerDeploymentCommit)
  ) {
    throw new Error("The live broker omitted its exact deployment identity.");
  }
  assertBrokerEvidence({
    body,
    brokerDeploymentCommit: result.brokerDeploymentCommit,
    envelope: result.brokerEvidence,
    publicKeySpkiBase64: evidencePublicKeySpkiBase64,
    rawBody,
    result: result.result,
  });
  return result;
}

function controlRequest(action, candidate, sandboxName) {
  return {
    action,
    candidate,
    sandboxName,
    schemaVersion,
  };
}

function assertStartResult(value, request) {
  if (
    !exactKeys(value, [
      "commandId",
      "networkPolicyVerified",
      "runtime",
      "sandboxName",
      "sandboxSessionId",
      "seal",
      "sourceCommit",
      "sourceTree",
    ]) ||
    value.sandboxName !== request.sandboxName ||
    value.sourceCommit !== request.candidate.commit ||
    value.sourceTree !== request.candidate.tree ||
    value.seal !== LIVE_BROKER_SEAL ||
    value.runtime !== "node24" ||
    !/^[A-Za-z0-9_-]{8,255}$/.test(value.sandboxSessionId) ||
    value.networkPolicyVerified !== true ||
    !/^[A-Za-z0-9._:-]{8,256}$/.test(value.commandId)
  ) {
    throw new Error("The live broker returned invalid start evidence.");
  }
  return value;
}

function assertStatusResult(value, start) {
  if (
    !exactKeys(value, [
      "candidateArtifact",
      "brokerArtifact",
      "commandDurationMs",
      "commandExitCode",
      "commandId",
      "networkPolicyVerified",
      "sandboxName",
      "seal",
      "sourceSealVerified",
      "state",
    ]) ||
    value.commandId !== start.commandId ||
    value.sandboxName !== start.sandboxName ||
    value.seal !== LIVE_BROKER_SEAL ||
    !["running", "finished"].includes(value.state)
  ) {
    throw new Error("The live broker returned invalid status evidence.");
  }
  if (
    value.state === "running" &&
    (value.candidateArtifact !== null ||
      value.brokerArtifact !== null ||
      value.commandDurationMs !== null ||
      value.commandExitCode !== null ||
      value.networkPolicyVerified !== false ||
      value.sourceSealVerified !== false)
  ) {
    throw new Error("The live broker returned contradictory running evidence.");
  }
  if (
    value.state === "finished" &&
    (value.commandExitCode !== 0 ||
      value.networkPolicyVerified !== true ||
      !Number.isFinite(value.commandDurationMs) ||
      value.commandDurationMs < 0 ||
      value.sourceSealVerified !== true ||
      !value.candidateArtifact ||
      typeof value.candidateArtifact !== "object" ||
      !value.brokerArtifact ||
      typeof value.brokerArtifact !== "object")
  ) {
    throw new Error("The remote candidate did not finish with a sealed pass.");
  }
  if (value.state === "finished") {
    const artifact = value.brokerArtifact;
    if (
      !exactKeys(artifact, [
        "candidateArtifactSha256",
        "command",
        "database",
        "harnessSha256",
        "preflightDatabaseEvidence",
        "schemaVersion",
      ]) ||
      artifact.schemaVersion !== "genie-trusted-live-harness-evidence.v1" ||
      artifact.candidateArtifactSha256 !==
        createHash("sha256")
          .update(JSON.stringify(value.candidateArtifact))
          .digest("hex") ||
      !/^[a-f0-9]{64}$/.test(artifact.harnessSha256) ||
      !exactKeys(artifact.preflightDatabaseEvidence, [
        "branchRef",
        "challengeVerified",
      ]) ||
      artifact.preflightDatabaseEvidence.challengeVerified !== true ||
      !exactKeys(artifact.command, [
        "durationMs",
        "exitCode",
        "stderrBytes",
        "stderrSha256",
        "stdoutBytes",
        "stdoutSha256",
      ]) ||
      artifact.command.exitCode !== 0 ||
      !Number.isFinite(artifact.command.durationMs) ||
      artifact.command.durationMs < 0 ||
      !Number.isSafeInteger(artifact.command.stderrBytes) ||
      !Number.isSafeInteger(artifact.command.stdoutBytes) ||
      !/^[a-f0-9]{64}$/.test(artifact.command.stderrSha256) ||
      !/^[a-f0-9]{64}$/.test(artifact.command.stdoutSha256) ||
      !exactKeys(artifact.database, [
        "boundaryScripts",
        "branchRef",
        "lookCount",
        "migrationVersions",
        "policyBoundLookCount",
        "voiceCount",
      ]) ||
      artifact.database.branchRef !== artifact.preflightDatabaseEvidence.branchRef ||
      artifact.database.lookCount !== 117 ||
      artifact.database.policyBoundLookCount !== 117 ||
      artifact.database.voiceCount !== 2 ||
      !Number.isSafeInteger(artifact.database.boundaryScripts) ||
      artifact.database.boundaryScripts < 1 ||
      JSON.stringify(artifact.database.migrationVersions) !==
        JSON.stringify(expectedPhase2MigrationVersions)
    ) {
      throw new Error("The trusted broker artifact is invalid.");
    }
  }
  return value;
}

function assertStopResult(value, sandboxName) {
  if (value?.deleted === true) {
    if (
      !exactKeys(value, ["absenceSnapshots", "deleted", "sandboxName"]) ||
      value.absenceSnapshots !== 3 ||
      value.sandboxName !== sandboxName
    ) {
      throw new Error("The live broker returned malformed deletion evidence.");
    }
    return value;
  }
  if (
    !exactKeys(value, ["absenceSnapshots", "deleted", "retryAfterMs", "sandboxName"]) ||
    value.absenceSnapshots !== 3 ||
    value.deleted !== false ||
    value.sandboxName !== sandboxName ||
    !Number.isSafeInteger(value.retryAfterMs) ||
    value.retryAfterMs < 1_000 ||
    value.retryAfterMs > 60_000
  ) {
    throw new Error("The live broker returned malformed pending cleanup evidence.");
  }
  return value;
}

export async function runRemoteLiveCandidate({
  accessToken,
  approvedBrokerDeploymentCommit,
  branch,
  candidate,
  endpoint = LIVE_BROKER_ENDPOINT,
  evidencePublicKeySpkiBase64 = LIVE_BROKER_EVIDENCE_PUBLIC_KEY_SPKI_BASE64,
  fetchImpl = fetch,
  identityChallenge,
  productionRef,
  signer = signLiveBrokerBody,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}) {
  if (!/^[a-f0-9]{40}$/.test(approvedBrokerDeploymentCommit ?? "")) {
    throw new Error("An independently approved live-broker commit is required.");
  }
  if (candidate?.commit !== approvedBrokerDeploymentCommit) {
    throw new Error(
      "The live candidate must be the exact independently approved broker deployment.",
    );
  }
  const sandboxName = `genie-live-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  const startRequest = {
    action: "start",
    branch: {
      branchId: branch.branchId,
      branchName: branch.branchName,
      branchRef: branch.branchRef,
      challengeNonce: identityChallenge.nonce,
      challengeTable: identityChallenge.table,
      credentials: branch.credentials,
    },
    candidate,
    productionRef,
    sandboxName,
    schemaVersion,
  };
  let brokerDeploymentCommit = null;
  let start = null;
  let terminal = null;
  let cleanupError = null;
  try {
    const startResponse = await signedRequest({
      accessToken,
      body: startRequest,
      endpoint,
      evidencePublicKeySpkiBase64,
      fetchImpl,
      signer,
      timeoutMs: 300_000,
    });
    brokerDeploymentCommit = startResponse.brokerDeploymentCommit;
    if (brokerDeploymentCommit !== approvedBrokerDeploymentCommit) {
      throw new Error(
        "The live broker deployment is not the independently approved pin.",
      );
    }
    start = assertStartResult(startResponse.result, startRequest);
    for (let attempt = 1; attempt <= 180; attempt += 1) {
      const statusResponse = await signedRequest({
        accessToken,
        body: controlRequest("status", candidate, sandboxName),
        endpoint,
        evidencePublicKeySpkiBase64,
        fetchImpl,
        signer,
        timeoutMs: 60_000,
      });
      if (statusResponse.brokerDeploymentCommit !== brokerDeploymentCommit) {
        throw new Error("The trusted broker deployment changed during the run.");
      }
      const status = assertStatusResult(statusResponse.result, start);
      if (status.state === "finished") {
        terminal = status;
        break;
      }
      if (attempt % 6 === 0) {
        console.log(`Live sandbox still running (${attempt * 5}s elapsed)`);
      }
      await sleep(5_000);
    }
    if (!terminal) throw new Error("The remote live suite exceeded its poll budget.");
  } finally {
    try {
      const cleanupDeadline = Date.now() + 12 * 60_000;
      let deleted = false;
      while (!deleted && Date.now() < cleanupDeadline) {
        const stopResponse = await signedRequest({
          accessToken,
          body: controlRequest("stop", candidate, sandboxName),
          endpoint,
          evidencePublicKeySpkiBase64,
          fetchImpl,
          signer,
          timeoutMs: 60_000,
        });
        if (
          stopResponse.brokerDeploymentCommit !== approvedBrokerDeploymentCommit ||
          (brokerDeploymentCommit &&
            stopResponse.brokerDeploymentCommit !== brokerDeploymentCommit)
        ) {
          throw new Error("The trusted broker deployment changed before cleanup.");
        }
        const cleanup = assertStopResult(stopResponse.result, sandboxName);
        brokerDeploymentCommit ??= stopResponse.brokerDeploymentCommit;
        deleted = cleanup.deleted;
        if (!deleted) await sleep(cleanup.retryAfterMs);
      }
      if (!deleted) {
        throw new Error(
          "The live broker cleanup lease did not settle before deadline.",
        );
      }
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError) {
    throw new Error("The remote sandbox cleanup did not complete safely.", {
      cause: cleanupError,
    });
  }
  if (!start || !terminal || !brokerDeploymentCommit) {
    throw new Error("The remote live suite returned incomplete terminal evidence.");
  }
  return Object.freeze({
    approvedBrokerDeploymentCommit,
    brokerDeploymentCommit,
    brokerArtifact: terminal.brokerArtifact,
    candidateArtifact: terminal.candidateArtifact,
    commandDurationMs: terminal.commandDurationMs,
    commandId: terminal.commandId,
    networkPolicyVerified: terminal.networkPolicyVerified,
    runtime: start.runtime,
    sandboxDeleted: true,
    sandboxName,
    seal: terminal.seal,
    sourceSealVerified: terminal.sourceSealVerified,
  });
}

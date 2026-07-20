import { createPublicKey, verify } from "node:crypto";

import type { MicroProviderOperation, ProviderBrokerRequest } from "./broker-contract";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const principalPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$/u;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/u;

export type BrokerVerificationContext = Readonly<{
  audience: string;
  brokerClientId: string;
  brokerClientPublicKeySpkiBase64: string;
  capabilityIssuer: string;
  capabilityPublicKeySpkiBase64: string;
  environment: "development" | "preview" | "production" | "test";
  keyId: string;
  nowSeconds?: number;
  triggerProject: string;
}>;

export type VerifiedBrokerAuthorization = Readonly<{
  assertionJti: string;
  assertionSubject: string;
  capabilityJti: string;
  expiresAt: number;
  keyId: string;
}>;

export class BrokerAssertionError extends Error {
  override readonly name = "BrokerAssertionError";
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function decodePart(value: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new BrokerAssertionError("Broker token encoding is invalid.");
  }
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new BrokerAssertionError("Broker token JSON is invalid.");
  }
}

function verifiedJwt(
  token: string,
  publicKeySpkiBase64: string,
): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new BrokerAssertionError("Broker token is malformed.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  const header = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  if (!header || typeof header !== "object" || Array.isArray(header)) {
    throw new BrokerAssertionError("Broker token header is invalid.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BrokerAssertionError("Broker token payload is invalid.");
  }
  let signatureValid = false;
  try {
    signatureValid = verify(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
      createPublicKey({
        format: "der",
        key: Buffer.from(publicKeySpkiBase64, "base64"),
        type: "spki",
      }),
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new BrokerAssertionError("Broker token signature is invalid.");
  }
  return {
    header: header as Record<string, unknown>,
    payload: payload as Record<string, unknown>,
  };
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new BrokerAssertionError(`${field} is invalid.`);
  }
  return value as number;
}

function string(value: unknown, field: string, pattern = principalPattern): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new BrokerAssertionError(`${field} is invalid.`);
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  return string(value, field, uuidPattern).toLowerCase();
}

function assertTemporal(
  payload: Record<string, unknown>,
  now: number,
  maximumLifetimeSeconds: number,
): { exp: number; iat: number; nbf: number } {
  const exp = integer(payload.exp, "exp");
  const iat = integer(payload.iat, "iat");
  const nbf = integer(payload.nbf, "nbf");
  if (
    nbf < iat - 5 ||
    nbf > now + 5 ||
    iat > now + 5 ||
    iat < now - maximumLifetimeSeconds - 5 ||
    exp <= now - 5 ||
    exp <= nbf ||
    exp - iat > maximumLifetimeSeconds
  ) {
    throw new BrokerAssertionError("Broker token time window is invalid.");
  }
  return { exp, iat, nbf };
}

function expectedSubject(taskId: string, runId: string, stageId: string): string {
  return `${taskId}:${runId}:${stageId}`;
}

export function verifyBrokerAuthorization(
  serviceAssertion: string,
  capabilityToken: string,
  request: ProviderBrokerRequest,
  context: BrokerVerificationContext,
): VerifiedBrokerAuthorization {
  const now = context.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const service = verifiedJwt(
    serviceAssertion,
    context.brokerClientPublicKeySpkiBase64,
  );
  if (
    !exactObject(service.header, ["alg", "kid", "typ"]) ||
    service.header.alg !== "EdDSA" ||
    service.header.typ !== "JWT" ||
    service.header.kid !== context.keyId ||
    !keyIdPattern.test(context.keyId)
  ) {
    throw new BrokerAssertionError("Broker assertion header is invalid.");
  }
  const serviceKeys = [
    "aud",
    "environment",
    "exp",
    "grant_id",
    "iat",
    "iss",
    "jti",
    "nbf",
    "run_id",
    "stage_id",
    "sub",
    "task_id",
    "trigger_project",
  ] as const;
  if (!exactObject(service.payload, serviceKeys)) {
    throw new BrokerAssertionError("Broker assertion claims are not exact.");
  }
  const serviceTime = assertTemporal(service.payload, now, 60);
  const taskId = string(service.payload.task_id, "task_id");
  const runId = string(service.payload.run_id, "run_id");
  const stageId = uuid(service.payload.stage_id, "stage_id");
  const subject = expectedSubject(taskId, runId, stageId);
  if (
    service.payload.iss !== context.brokerClientId ||
    service.payload.aud !== context.audience ||
    service.payload.environment !== context.environment ||
    service.payload.trigger_project !== context.triggerProject ||
    service.payload.sub !== subject ||
    stageId !== request.stageRunId ||
    uuid(service.payload.grant_id, "grant_id") !== request.capabilityGrantId
  ) {
    throw new BrokerAssertionError("Broker assertion binding is invalid.");
  }

  const capability = verifiedJwt(
    capabilityToken,
    context.capabilityPublicKeySpkiBase64,
  );
  if (
    !exactObject(capability.header, ["alg", "kid", "typ"]) ||
    capability.header.alg !== "EdDSA" ||
    capability.header.typ !== "JWT" ||
    typeof capability.header.kid !== "string" ||
    !keyIdPattern.test(capability.header.kid)
  ) {
    throw new BrokerAssertionError("Capability header is invalid.");
  }
  const capabilityKeys = [
    "attempt_id",
    "aud",
    "authority_epoch",
    "capability",
    "exp",
    "fencing_token",
    "grant_id",
    "iat",
    "input_manifest_sha256",
    "iss",
    "jti",
    "nbf",
    "preflight_run_id",
    "quote_line_id",
    "stage_id",
    "sub",
    "workspace_id",
  ] as const;
  if (!exactObject(capability.payload, capabilityKeys)) {
    throw new BrokerAssertionError("Capability claims are not exact.");
  }
  const capabilityTime = assertTemporal(capability.payload, now, 300);
  if (
    capability.payload.iss !== context.capabilityIssuer ||
    capability.payload.aud !== context.audience ||
    capability.payload.sub !== request.stageAttemptId ||
    uuid(capability.payload.workspace_id, "workspace_id") !== request.workspaceId ||
    uuid(capability.payload.preflight_run_id, "preflight_run_id") !==
      request.preflightRunId ||
    uuid(capability.payload.stage_id, "stage_id") !== request.stageRunId ||
    uuid(capability.payload.attempt_id, "attempt_id") !== request.stageAttemptId ||
    uuid(capability.payload.grant_id, "grant_id") !== request.capabilityGrantId ||
    uuid(capability.payload.quote_line_id, "quote_line_id") !== request.quoteLineId ||
    capability.payload.capability !== request.operation ||
    integer(capability.payload.authority_epoch, "authority_epoch") !==
      request.authorityEpoch ||
    integer(capability.payload.fencing_token, "fencing_token") !==
      request.fencingToken ||
    capability.payload.input_manifest_sha256 !== request.inputManifestSha256
  ) {
    throw new BrokerAssertionError("Capability binding is invalid.");
  }
  return Object.freeze({
    assertionJti: uuid(service.payload.jti, "jti"),
    assertionSubject: subject,
    capabilityJti: uuid(capability.payload.jti, "jti"),
    expiresAt: Math.min(serviceTime.exp, capabilityTime.exp),
    keyId: context.keyId,
  });
}

export function isMicroProviderOperation(
  value: unknown,
): value is MicroProviderOperation {
  return ["gen_image", "edit_image", "gen_speech", "align_speech"].includes(
    String(value),
  );
}

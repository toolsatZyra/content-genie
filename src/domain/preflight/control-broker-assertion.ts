import { createPublicKey, verify } from "node:crypto";

import type { PreflightControlRequest } from "./control-broker-contract";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const principalPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$/u;
const keyIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/u;

export type PreflightControlVerificationContext = Readonly<{
  audience: string;
  brokerClientId: string;
  brokerClientPublicKeySpkiBase64: string;
  environment: "development" | "preview" | "production" | "test";
  keyId: string;
  nowSeconds?: number;
  triggerProject: string;
}>;

export type VerifiedPreflightControlAssertion = Readonly<{
  expiresAt: number;
  issuedAt: number;
  jti: string;
  subject: string;
  taskId: string;
  triggerRunId: string;
}>;

export class PreflightControlAssertionError extends Error {
  override readonly name = "PreflightControlAssertionError";
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
    throw new PreflightControlAssertionError("Control assertion encoding is invalid.");
  }
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new PreflightControlAssertionError("Control assertion JSON is invalid.");
  }
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) {
    throw new PreflightControlAssertionError(`${field} is invalid.`);
  }
  return value as number;
}

function text(value: unknown, field: string, pattern = principalPattern): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new PreflightControlAssertionError(`${field} is invalid.`);
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  return text(value, field, uuidPattern).toLowerCase();
}

export function verifyPreflightControlAssertion(
  token: string,
  request: PreflightControlRequest,
  context: PreflightControlVerificationContext,
): VerifiedPreflightControlAssertion {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new PreflightControlAssertionError("Control assertion is malformed.");
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [
    string,
    string,
    string,
  ];
  const header = decodePart(encodedHeader);
  const payload = decodePart(encodedPayload);
  if (
    !exactObject(header, ["alg", "kid", "typ"]) ||
    (header as Record<string, unknown>).alg !== "EdDSA" ||
    (header as Record<string, unknown>).typ !== "JWT" ||
    (header as Record<string, unknown>).kid !== context.keyId ||
    !keyIdPattern.test(context.keyId)
  ) {
    throw new PreflightControlAssertionError("Control assertion header is invalid.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PreflightControlAssertionError("Control assertion claims are invalid.");
  }
  let signatureValid = false;
  try {
    signatureValid = verify(
      null,
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
      createPublicKey({
        format: "der",
        key: Buffer.from(context.brokerClientPublicKeySpkiBase64, "base64"),
        type: "spki",
      }),
      Buffer.from(encodedSignature, "base64url"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    throw new PreflightControlAssertionError("Control assertion signature is invalid.");
  }
  const claims = payload as Record<string, unknown>;
  const keys = [
    "aud",
    "environment",
    "exp",
    "iat",
    "iss",
    "jti",
    "nbf",
    "operation",
    "preflight_run_id",
    "stage_attempt_id",
    "stage_run_id",
    "sub",
    "task_id",
    "trigger_project",
    "trigger_run_id",
  ] as const;
  if (!exactObject(claims, keys)) {
    throw new PreflightControlAssertionError("Control assertion claims are not exact.");
  }
  const now = context.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const iat = integer(claims.iat, "iat");
  const nbf = integer(claims.nbf, "nbf");
  const exp = integer(claims.exp, "exp");
  if (
    nbf < iat - 5 ||
    nbf > now + 5 ||
    iat > now + 5 ||
    iat < now - 65 ||
    exp <= now - 5 ||
    exp <= nbf ||
    exp - iat > 60
  ) {
    throw new PreflightControlAssertionError(
      "Control assertion time window is invalid.",
    );
  }
  const taskId = text(claims.task_id, "task_id");
  const triggerRunId = text(claims.trigger_run_id, "trigger_run_id");
  const subject = `${taskId}:${triggerRunId}:${request.preflightRunId}:${request.stageAttemptId ?? "run"}`;
  const stageAttemptId =
    claims.stage_attempt_id === null
      ? null
      : uuid(claims.stage_attempt_id, "stage_attempt_id");
  const stageRunId =
    claims.stage_run_id === null ? null : uuid(claims.stage_run_id, "stage_run_id");
  if (
    claims.iss !== context.brokerClientId ||
    claims.aud !== context.audience ||
    claims.environment !== context.environment ||
    claims.trigger_project !== context.triggerProject ||
    claims.operation !== request.operation ||
    uuid(claims.preflight_run_id, "preflight_run_id") !== request.preflightRunId ||
    stageAttemptId !== request.stageAttemptId ||
    stageRunId !== request.stageRunId ||
    claims.sub !== subject
  ) {
    throw new PreflightControlAssertionError("Control assertion binding is invalid.");
  }
  return Object.freeze({
    expiresAt: exp,
    issuedAt: iat,
    jti: uuid(claims.jti, "jti"),
    subject,
    taskId,
    triggerRunId,
  });
}

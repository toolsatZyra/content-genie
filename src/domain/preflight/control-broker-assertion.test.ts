import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  PreflightControlAssertionError,
  verifyPreflightControlAssertion,
  type PreflightControlVerificationContext,
} from "./control-broker-assertion";
import {
  PREFLIGHT_CONTROL_SCHEMA_VERSION,
  type PreflightControlRequest,
} from "./control-broker-contract";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const now = 2_000_000_000;
const keys = generateKeyPairSync("ed25519");
const request: PreflightControlRequest = {
  operation: "execute",
  preflightRunId: id("1"),
  schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
  stageAttemptId: id("2"),
  stageRunId: id("3"),
};
const context: PreflightControlVerificationContext = {
  audience: "https://genie.test/api/internal/provider-broker",
  brokerClientId: "genie-control-preview",
  brokerClientPublicKeySpkiBase64: keys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64"),
  environment: "preview",
  keyId: "control-preview-k1",
  nowSeconds: now,
  triggerProject: "proj_control_preview",
};
const taskId = "genie-preflight-plan-evaluation-v1";
const triggerRunId = "run_preview_123";

function token(overrides: Record<string, unknown> = {}, wrongKey = false): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", kid: context.keyId, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: context.audience,
      environment: context.environment,
      exp: now + 55,
      iat: now,
      iss: context.brokerClientId,
      jti: id("4"),
      nbf: now - 1,
      operation: request.operation,
      preflight_run_id: request.preflightRunId,
      stage_attempt_id: request.stageAttemptId,
      stage_run_id: request.stageRunId,
      sub: `${taskId}:${triggerRunId}:${request.preflightRunId}:${request.stageAttemptId}`,
      task_id: taskId,
      trigger_project: context.triggerProject,
      trigger_run_id: triggerRunId,
      ...overrides,
    }),
  ).toString("base64url");
  const signingKey = wrongKey
    ? generateKeyPairSync("ed25519").privateKey
    : keys.privateKey;
  const signature = sign(
    null,
    Buffer.from(`${header}.${payload}`, "utf8"),
    signingKey,
  ).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("preflight control broker assertion", () => {
  it("accepts an exact short-lived assertion bound to one fenced stage", () => {
    const verified = verifyPreflightControlAssertion(token(), request, context);
    expect(verified.jti).toBe(id("4"));
    expect(verified.taskId).toBe(taskId);
    expect(verified.triggerRunId).toBe(triggerRunId);
  });

  it.each([
    ["audience", { aud: "https://attacker.test" }],
    ["project", { trigger_project: "proj_other" }],
    ["operation", { operation: "finalize" }],
    ["run", { preflight_run_id: id("5") }],
    ["attempt", { stage_attempt_id: id("6") }],
    ["subject", { sub: "wrong:subject:binding" }],
    ["expiry", { exp: now + 61 }],
  ])("rejects wrong %s binding", (_name, overrides) => {
    expect(() =>
      verifyPreflightControlAssertion(token(overrides), request, context),
    ).toThrow(PreflightControlAssertionError);
  });

  it("rejects a forged signature", () => {
    expect(() =>
      verifyPreflightControlAssertion(token({}, true), request, context),
    ).toThrow("signature");
  });
});

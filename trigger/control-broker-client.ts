import { createPrivateKey, randomUUID, sign } from "node:crypto";

import {
  PREFLIGHT_CONTROL_SCHEMA_VERSION,
  type PreflightControlOperation,
  type PreflightControlRequest,
} from "../src/domain/preflight/control-broker-contract";
import type { PreflightTaskEnvelope } from "./preflight-contract";
import { getTriggerEnvironment } from "./config";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertion(
  request: PreflightControlRequest,
  taskId: string,
  triggerRunId: string,
): string {
  const environment = getTriggerEnvironment();
  const now = Math.floor(Date.now() / 1_000);
  const subject = `${taskId}:${triggerRunId}:${request.preflightRunId}:${request.stageAttemptId ?? "run"}`;
  const header = encode({ alg: "EdDSA", kid: environment.brokerClientKid, typ: "JWT" });
  const payload = encode({
    aud: environment.brokerAudience,
    environment: environment.environment,
    exp: now + 55,
    iat: now,
    iss: environment.brokerClientId,
    jti: randomUUID(),
    nbf: now - 1,
    operation: request.operation,
    preflight_run_id: request.preflightRunId,
    stage_attempt_id: request.stageAttemptId,
    stage_run_id: request.stageRunId,
    sub: subject,
    task_id: taskId,
    trigger_project: environment.triggerProject,
    trigger_run_id: triggerRunId,
  });
  let privateKey;
  try {
    privateKey = createPrivateKey({
      format: "der",
      key: Buffer.from(environment.brokerClientSigningPrivateKey, "base64"),
      type: "pkcs8",
    });
  } catch {
    throw new Error("Trigger control-broker signing authority is invalid.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Trigger control-broker signing authority must be Ed25519.");
  }
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(null, Buffer.from(unsigned, "utf8"), privateKey).toString("base64url")}`;
}

export async function callPreflightControlBroker<T>(input: {
  operation: PreflightControlOperation;
  preflightRunId: string;
  stageAttemptId: string | null;
  stageRunId: string | null;
  taskId: string;
  triggerRunId: string;
  envelope?: PreflightTaskEnvelope;
}): Promise<T> {
  const environment = getTriggerEnvironment();
  const request: PreflightControlRequest = {
    operation: input.operation,
    preflightRunId: input.preflightRunId,
    schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
    stageAttemptId: input.stageAttemptId,
    stageRunId: input.stageRunId,
  };
  const headers: Record<string, string> = {
    authorization: `Bearer ${assertion(request, input.taskId, input.triggerRunId)}`,
    "content-type": "application/json",
    "x-genie-broker-client-id": environment.brokerClientId,
    "x-genie-broker-kid": environment.brokerClientKid,
    "x-genie-trigger-project": environment.triggerProject,
  };
  if (input.envelope) {
    headers["x-genie-preflight-envelope"] = JSON.stringify(input.envelope);
  }
  const response = await fetch(`${environment.brokerAudience}/control`, {
    body: JSON.stringify(request),
    headers,
    method: "POST",
    signal: AbortSignal.timeout(60_000),
  });
  const value = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Preflight control broker rejected ${input.operation}.`);
  }
  return value as T;
}

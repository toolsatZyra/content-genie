import { createPrivateKey, randomUUID, sign } from "node:crypto";

import type { ProviderBrokerRequest } from "../src/domain/provider/broker-contract";
import { getTriggerEnvironment } from "./config";

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function assertion(
  request: ProviderBrokerRequest,
  taskId: string,
  triggerRunId: string,
): string {
  const environment = getTriggerEnvironment();
  const now = Math.floor(Date.now() / 1_000);
  const header = encode({
    alg: "EdDSA",
    kid: environment.brokerClientKid,
    typ: "JWT",
  });
  const subject = `${taskId}:${triggerRunId}:${request.stageRunId}`;
  const payload = encode({
    aud: environment.brokerAudience,
    environment: environment.environment,
    exp: now + 55,
    grant_id: request.capabilityGrantId,
    iat: now,
    iss: environment.brokerClientId,
    jti: randomUUID(),
    nbf: now - 1,
    run_id: triggerRunId,
    stage_id: request.stageRunId,
    sub: subject,
    task_id: taskId,
    trigger_project: environment.triggerProject,
  });
  let privateKey;
  try {
    privateKey = createPrivateKey({
      format: "der",
      key: Buffer.from(environment.brokerClientSigningPrivateKey, "base64"),
      type: "pkcs8",
    });
  } catch {
    throw new Error("Trigger provider-broker signing authority is invalid.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error("Trigger provider-broker signing authority must be Ed25519.");
  }
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(null, Buffer.from(unsigned, "utf8"), privateKey).toString("base64url")}`;
}

export async function callProviderBroker(input: {
  capabilityToken: string;
  request: ProviderBrokerRequest;
  taskId: string;
  triggerRunId: string;
}): Promise<void> {
  const environment = getTriggerEnvironment();
  const response = await fetch(environment.brokerAudience, {
    body: JSON.stringify(input.request),
    headers: {
      authorization: `Bearer ${assertion(input.request, input.taskId, input.triggerRunId)}`,
      "content-type": "application/json",
      "x-genie-broker-client-id": environment.brokerClientId,
      "x-genie-broker-kid": environment.brokerClientKid,
      "x-genie-capability": input.capabilityToken,
      "x-genie-trigger-project": environment.triggerProject,
    },
    method: "POST",
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    throw new Error(`Provider broker rejected exact request with ${response.status}.`);
  }
}

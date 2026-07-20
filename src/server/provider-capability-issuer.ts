import "server-only";

import { createPrivateKey, sign } from "node:crypto";

import type { ProviderBrokerRequest } from "@/domain/provider/broker-contract";

const kidPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$/u;

export class ProviderCapabilityIssuerError extends Error {
  override readonly name = "ProviderCapabilityIssuerError";
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function issueProviderCapabilityToken(
  input: Readonly<{
    audience: string;
    capabilityJti: string;
    issuer: string;
    kid: string;
    privateKeyPkcs8Base64: string;
    request: ProviderBrokerRequest;
    ttlSeconds?: number;
  }>,
): string {
  const ttlSeconds = input.ttlSeconds ?? 240;
  if (
    !kidPattern.test(input.kid) ||
    !/^https:\/\/[A-Za-z0-9.-]+(?::443)?\/api\/internal\/provider-broker$/u.test(
      input.audience,
    ) ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$/u.test(input.issuer) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.capabilityJti,
    ) ||
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds < 30 ||
    ttlSeconds > 300
  ) {
    throw new ProviderCapabilityIssuerError("Capability issuer envelope is invalid.");
  }
  let privateKey;
  try {
    privateKey = createPrivateKey({
      format: "der",
      key: Buffer.from(input.privateKeyPkcs8Base64, "base64"),
      type: "pkcs8",
    });
  } catch {
    throw new ProviderCapabilityIssuerError("Capability signing authority is invalid.");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new ProviderCapabilityIssuerError(
      "Capability signing authority must be Ed25519.",
    );
  }
  const now = Math.floor(Date.now() / 1_000);
  const header = encode({ alg: "EdDSA", kid: input.kid, typ: "JWT" });
  const payload = encode({
    attempt_id: input.request.stageAttemptId,
    aud: input.audience,
    authority_epoch: input.request.authorityEpoch,
    capability: input.request.operation,
    exp: now + ttlSeconds,
    fencing_token: input.request.fencingToken,
    grant_id: input.request.capabilityGrantId,
    iat: now,
    input_manifest_sha256: input.request.inputManifestSha256,
    iss: input.issuer,
    jti: input.capabilityJti,
    nbf: now - 1,
    preflight_run_id: input.request.preflightRunId,
    quote_line_id: input.request.quoteLineId,
    stage_id: input.request.stageRunId,
    sub: input.request.stageAttemptId,
    workspace_id: input.request.workspaceId,
  });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(null, Buffer.from(unsigned, "utf8"), privateKey).toString("base64url")}`;
}

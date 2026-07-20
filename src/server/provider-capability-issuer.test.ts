import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  issueProviderCapabilityToken,
  ProviderCapabilityIssuerError,
} from "./provider-capability-issuer";
import { verifyBrokerAuthorization } from "@/domain/provider/broker-assertion";
import {
  PROVIDER_BROKER_SCHEMA_VERSION,
  type ProviderBrokerRequest,
} from "@/domain/provider/broker-contract";
import { sign } from "node:crypto";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const capabilityKeys = generateKeyPairSync("ed25519");
const brokerKeys = generateKeyPairSync("ed25519");
const request: ProviderBrokerRequest = {
  authorityEpoch: 2,
  capabilityGrantId: id("1"),
  fencingToken: 3,
  inputManifestId: id("2"),
  inputManifestSha256: "a".repeat(64),
  operation: "gen_image",
  preflightRunId: id("3"),
  providerRequestId: id("4"),
  quoteLineId: id("5"),
  schemaVersion: PROVIDER_BROKER_SCHEMA_VERSION,
  stageAttemptId: id("6"),
  stageRunId: id("7"),
  workspaceId: id("8"),
};

function serviceAssertion(now: number) {
  const header = Buffer.from(
    JSON.stringify({ alg: "EdDSA", kid: "broker-preview-k1", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      aud: "https://genie.example/api/internal/provider-broker",
      environment: "preview",
      exp: now + 45,
      grant_id: request.capabilityGrantId,
      iat: now,
      iss: "genie-control-preview",
      jti: id("9"),
      nbf: now,
      run_id: "run_preview_123",
      stage_id: request.stageRunId,
      sub: `genie-preflight-world-images-v1:run_preview_123:${request.stageRunId}`,
      task_id: "genie-preflight-world-images-v1",
      trigger_project: "proj_control_preview",
    }),
  ).toString("base64url");
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(null, Buffer.from(unsigned), brokerKeys.privateKey).toString("base64url")}`;
}

describe("provider capability issuer", () => {
  it("mints the exact independently verifiable attempt grant", () => {
    const now = Math.floor(Date.now() / 1_000);
    const token = issueProviderCapabilityToken({
      audience: "https://genie.example/api/internal/provider-broker",
      capabilityJti: id("10"),
      issuer: "genie-capability-preview",
      kid: "capability-preview-k1",
      privateKeyPkcs8Base64: capabilityKeys.privateKey
        .export({ format: "der", type: "pkcs8" })
        .toString("base64"),
      request,
    });
    expect(
      verifyBrokerAuthorization(serviceAssertion(now), token, request, {
        audience: "https://genie.example/api/internal/provider-broker",
        brokerClientId: "genie-control-preview",
        brokerClientPublicKeySpkiBase64: brokerKeys.publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64"),
        capabilityIssuer: "genie-capability-preview",
        capabilityPublicKeySpkiBase64: capabilityKeys.publicKey
          .export({ format: "der", type: "spki" })
          .toString("base64"),
        environment: "preview",
        keyId: "broker-preview-k1",
        nowSeconds: now,
        triggerProject: "proj_control_preview",
      }).capabilityJti,
    ).toBe(id("10"));
  });

  it("rejects invalid key material and excessive lifetime", () => {
    expect(() =>
      issueProviderCapabilityToken({
        audience: "https://genie.example/api/internal/provider-broker",
        capabilityJti: id("10"),
        issuer: "genie-capability-preview",
        kid: "capability-preview-k1",
        privateKeyPkcs8Base64: "not-a-key",
        request,
      }),
    ).toThrow(ProviderCapabilityIssuerError);
    expect(() =>
      issueProviderCapabilityToken({
        audience: "https://genie.example/api/internal/provider-broker",
        capabilityJti: id("10"),
        issuer: "genie-capability-preview",
        kid: "capability-preview-k1",
        privateKeyPkcs8Base64: capabilityKeys.privateKey
          .export({ format: "der", type: "pkcs8" })
          .toString("base64"),
        request,
        ttlSeconds: 301,
      }),
    ).toThrow(ProviderCapabilityIssuerError);
  });
});

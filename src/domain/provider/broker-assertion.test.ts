import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  BrokerAssertionError,
  verifyBrokerAuthorization,
  type BrokerVerificationContext,
} from "./broker-assertion";
import {
  PROVIDER_BROKER_SCHEMA_VERSION,
  type ProviderBrokerRequest,
} from "./broker-contract";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const now = 2_000_000_000;
const brokerKeys = generateKeyPairSync("ed25519");
const capabilityKeys = generateKeyPairSync("ed25519");

const request: ProviderBrokerRequest = {
  authorityEpoch: 3,
  capabilityGrantId: id("1"),
  fencingToken: 7,
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

const context: BrokerVerificationContext = {
  audience: "https://genie.test/api/internal/provider-broker",
  brokerClientId: "genie-control-preview",
  brokerClientPublicKeySpkiBase64: brokerKeys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64"),
  capabilityIssuer: "genie-capability-preview",
  capabilityPublicKeySpkiBase64: capabilityKeys.publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64"),
  environment: "preview",
  keyId: "control-preview-k1",
  nowSeconds: now,
  triggerProject: "proj_control_preview",
};

function jwt(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  privateKey: typeof brokerKeys.privateKey,
): string {
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    privateKey,
  ).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function service(overrides: Record<string, unknown> = {}) {
  return jwt(
    { alg: "EdDSA", kid: context.keyId, typ: "JWT" },
    {
      aud: context.audience,
      environment: context.environment,
      exp: now + 45,
      grant_id: request.capabilityGrantId,
      iat: now,
      iss: context.brokerClientId,
      jti: id("9"),
      nbf: now,
      run_id: "run_preview_123",
      stage_id: request.stageRunId,
      sub: `genie-preflight-world-images-v1:run_preview_123:${request.stageRunId}`,
      task_id: "genie-preflight-world-images-v1",
      trigger_project: context.triggerProject,
      ...overrides,
    },
    brokerKeys.privateKey,
  );
}

function capability(overrides: Record<string, unknown> = {}) {
  return jwt(
    { alg: "EdDSA", kid: "capability-preview-k1", typ: "JWT" },
    {
      attempt_id: request.stageAttemptId,
      aud: context.audience,
      authority_epoch: request.authorityEpoch,
      capability: request.operation,
      exp: now + 120,
      fencing_token: request.fencingToken,
      grant_id: request.capabilityGrantId,
      iat: now,
      input_manifest_sha256: request.inputManifestSha256,
      iss: context.capabilityIssuer,
      jti: id("10"),
      nbf: now,
      preflight_run_id: request.preflightRunId,
      quote_line_id: request.quoteLineId,
      stage_id: request.stageRunId,
      sub: request.stageAttemptId,
      workspace_id: request.workspaceId,
      ...overrides,
    },
    capabilityKeys.privateKey,
  );
}

describe("provider broker dual authorization", () => {
  it("accepts an exact project assertion and independently signed grant", () => {
    const verified = verifyBrokerAuthorization(
      service(),
      capability(),
      request,
      context,
    );
    expect(verified.assertionJti).toBe(id("9"));
    expect(verified.capabilityJti).toBe(id("10"));
  });

  it.each([
    ["wrong issuer", { iss: "unknown-client" }, {}],
    ["wrong audience", { aud: "https://attacker.test" }, {}],
    ["wrong project", { trigger_project: "proj_other" }, {}],
    ["wrong environment", { environment: "production" }, {}],
    ["wrong task subject", { task_id: "other-task" }, {}],
    ["wrong run subject", { run_id: "run_other_123" }, {}],
    ["wrong stage subject", { stage_id: id("13") }, {}],
    ["forged subject", { sub: "other-task:run_other:stage" }, {}],
    ["unknown grant", { grant_id: id("11") }, {}],
    ["expired assertion", { exp: now - 1 }, {}],
    ["future assertion", { nbf: now + 6 }, {}],
    ["long assertion", { exp: now + 61 }, {}],
    ["wrong capability issuer", {}, { iss: "unknown-capability-issuer" }],
    ["wrong capability audience", {}, { aud: "https://attacker.test" }],
    ["wrong preflight run", {}, { preflight_run_id: id("14") }],
    ["wrong capability stage", {}, { stage_id: id("15") }],
    ["wrong capability attempt", {}, { attempt_id: id("16") }],
    ["wrong capability subject", {}, { sub: id("17") }],
    ["future capability", {}, { nbf: now + 6 }],
    ["expired capability", {}, { exp: now - 1 }],
    ["wrong fence", {}, { fencing_token: request.fencingToken + 1 }],
    ["wrong capability", {}, { capability: "gen_video" }],
    ["wrong quote", {}, { quote_line_id: id("12") }],
    ["stale manifest", {}, { input_manifest_sha256: "b".repeat(64) }],
  ])("rejects %s before provider authority", (_name, servicePatch, grantPatch) => {
    expect(() =>
      verifyBrokerAuthorization(
        service(servicePatch),
        capability(grantPatch),
        request,
        context,
      ),
    ).toThrow(BrokerAssertionError);
  });

  it("rejects unknown kid and bad signatures", () => {
    const unknownKid = jwt(
      { alg: "EdDSA", kid: "unknown-kid", typ: "JWT" },
      {
        aud: context.audience,
        environment: context.environment,
        exp: now + 45,
        grant_id: request.capabilityGrantId,
        iat: now,
        iss: context.brokerClientId,
        jti: id("9"),
        nbf: now,
        run_id: "run_preview_123",
        stage_id: request.stageRunId,
        sub: `genie-preflight-world-images-v1:run_preview_123:${request.stageRunId}`,
        task_id: "genie-preflight-world-images-v1",
        trigger_project: context.triggerProject,
      },
      brokerKeys.privateKey,
    );
    expect(() =>
      verifyBrokerAuthorization(unknownKid, capability(), request, context),
    ).toThrow(BrokerAssertionError);
    const other = generateKeyPairSync("ed25519");
    const forgedContext = {
      ...context,
      brokerClientPublicKeySpkiBase64: other.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
    };
    expect(() =>
      verifyBrokerAuthorization(service(), capability(), request, forgedContext),
    ).toThrow("signature");
  });
});

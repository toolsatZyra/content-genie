import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  consume: vi.fn(),
  context: vi.fn(),
  environment: vi.fn(),
  manifest: vi.fn(),
  quarantine: vi.fn(),
  rejection: vi.fn(),
  submit: vi.fn(),
  transition: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/config/provider-broker-env", () => ({
  getProviderBrokerEnvironment: mocks.environment,
}));
vi.mock("@/domain/provider/broker-assertion", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/domain/provider/broker-assertion")>();
  return { ...original, verifyBrokerAuthorization: mocks.verify };
});
vi.mock("@/server/provider-adapters", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/provider-adapters")>();
  return { ...original, submitProviderAdapter: mocks.submit };
});
vi.mock("@/server/provider-broker-ledger", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/provider-broker-ledger")>();
  return {
    ...original,
    consumeProviderBrokerAuthority: mocks.consume,
    getDatabaseBrokerVerificationContext: mocks.context,
    getProviderDispatchManifest: mocks.manifest,
    quarantineImmediateProviderBytes: mocks.quarantine,
    recordProviderBrokerSecurityRejection: mocks.rejection,
    transitionProviderRequest: mocks.transition,
  };
});

import { POST } from "@/app/api/internal/provider-broker/route";
import { BrokerAssertionError } from "@/domain/provider/broker-assertion";
import {
  PROVIDER_BROKER_MAX_BODY_BYTES,
  type ProviderBrokerRequest,
} from "@/domain/provider/broker-contract";
import { ProviderAdapterError } from "@/server/provider-adapters";
import { ProviderBrokerLedgerError } from "@/server/provider-broker-ledger";

const ids = {
  capabilityGrantId: "b1010000-0000-4000-8000-000000000001",
  inputManifestId: "b1020000-0000-4000-8000-000000000001",
  preflightRunId: "b1030000-0000-4000-8000-000000000001",
  providerRequestId: "b1040000-0000-4000-8000-000000000001",
  quoteLineId: "b1050000-0000-4000-8000-000000000001",
  stageAttemptId: "b1060000-0000-4000-8000-000000000001",
  stageRunId: "b1070000-0000-4000-8000-000000000001",
  targetAssetId: "b1080000-0000-4000-8000-000000000001",
  workspaceId: "b1090000-0000-4000-8000-000000000001",
};
const sha = "a".repeat(64);
const brokerRequest: ProviderBrokerRequest = {
  authorityEpoch: 2,
  capabilityGrantId: ids.capabilityGrantId,
  fencingToken: 3,
  inputManifestId: ids.inputManifestId,
  inputManifestSha256: sha,
  operation: "gen_image",
  preflightRunId: ids.preflightRunId,
  providerRequestId: ids.providerRequestId,
  quoteLineId: ids.quoteLineId,
  schemaVersion: "genie.provider-broker-request.v1",
  stageAttemptId: ids.stageAttemptId,
  stageRunId: ids.stageRunId,
  workspaceId: ids.workspaceId,
};
const audience = "https://content-genie-three.vercel.app/api/internal/provider-broker";
const jwt = `e30.${Buffer.from(
  JSON.stringify({ exp: 2_000_000_030, iat: 2_000_000_000 }),
).toString("base64url")}.signature`;

function request(
  body = JSON.stringify(brokerRequest),
  headers: Record<string, string> = {},
) {
  return new Request(audience, {
    body,
    headers: {
      authorization: `Bearer ${jwt}`,
      "content-type": "application/json",
      "x-genie-broker-client-id": "genie-preview-client",
      "x-genie-broker-kid": "genie-preview-key-v1",
      "x-genie-capability": "capability.jwt.signature",
      "x-genie-trigger-project": "genie-preview",
      ...headers,
    },
    method: "POST",
  });
}

const manifest = {
  aggregateVersion: 2,
  correlationId: "b1100000-0000-4000-8000-000000000001",
  credentialSecretRef: "FAL_KEY" as const,
  endpointKey: "queue.submit",
  expectedCostMinor: 40,
  inputManifestHash: sha,
  maximumCostMinor: 40,
  modelKey: "fal-ai/flux/dev",
  operation: "gen_image" as const,
  payload: {
    imageSize: "portrait_9_16",
    numImages: 1,
    outputFormat: "png",
    prompt: "Shiva beneath moonlight",
    targetAssetId: ids.targetAssetId,
  },
  payloadSchemaVersion: "genie.fal-image.v1",
  provider: "fal" as const,
  providerRequestId: ids.providerRequestId,
  workspaceId: ids.workspaceId,
};

describe("internal provider broker route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.environment.mockReturnValue({
      audience,
      capabilityIssuer: "genie-capability-preview",
      capabilityVerifyPublicKeySpkiBase64: "A".repeat(64),
      elevenLabsApiKey: "elevenlabs-secret",
      environment: "preview",
      falKey: "fal-secret-value-123",
      falWebhookBaseUrl:
        "https://content-genie-three.vercel.app/api/internal/provider-webhooks/fal",
    });
    mocks.context.mockResolvedValue({
      audience,
      brokerClientDatabaseId: "b1110000-0000-4000-8000-000000000001",
      brokerKeyDatabaseId: "b1120000-0000-4000-8000-000000000001",
      clientId: "genie-preview-client",
      environment: "preview",
      kid: "genie-preview-key-v1",
      publicKeySpkiBase64: "B".repeat(64),
      triggerProject: "genie-preview",
    });
    mocks.verify.mockReturnValue({
      assertionJti: "b1130000-0000-4000-8000-000000000001",
      assertionSubject: "trigger:task:world-images",
      capabilityJti: "b1140000-0000-4000-8000-000000000001",
    });
    mocks.consume.mockResolvedValue({
      aggregateVersion: 2,
      providerRequestId: ids.providerRequestId,
      state: "queued",
    });
    mocks.manifest.mockResolvedValue(manifest);
    mocks.transition
      .mockResolvedValueOnce({
        aggregateVersion: 3,
        providerRequestId: ids.providerRequestId,
        state: "submitted",
      })
      .mockResolvedValueOnce({
        aggregateVersion: 4,
        providerRequestId: ids.providerRequestId,
        state: "accepted",
      });
    mocks.submit.mockResolvedValue({
      externalJobId: "fal-request-123",
      kind: "async",
      responseHash: "b".repeat(64),
    });
    mocks.quarantine.mockResolvedValue({
      quarantineAssetVersionId: "b1150000-0000-4000-8000-000000000001",
      state: "quarantined",
    });
    mocks.rejection.mockResolvedValue("b1160000-0000-4000-8000-000000000001");
  });

  it("rejects non-JSON requests before reading authority", async () => {
    const response = await POST(request("text", { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toEqual({
      code: "JSON_REQUIRED",
      ok: false,
    });
    expect(mocks.environment).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("rejects an oversized declared body before verification", async () => {
    const oversized = {
      body: { getReader: vi.fn() },
      headers: new Headers({
        "content-length": String(PROVIDER_BROKER_MAX_BODY_BYTES + 1),
        "content-type": "application/json",
      }),
    } as unknown as Request;
    const response = await POST(oversized);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      code: "BROKER_REQUEST_TOO_LARGE",
      ok: false,
    });
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("consumes exact authority before dispatching an asynchronous provider job", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      aggregateVersion: 4,
      ok: true,
      providerRequestId: ids.providerRequestId,
      quarantineAssetVersionId: null,
      state: "accepted",
    });
    expect(mocks.consume.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.submit.mock.invocationCallOrder[0]!,
    );
    expect(mocks.transition).toHaveBeenNthCalledWith(1, {
      event: "submit",
      expectedVersion: 2,
      providerRequestId: ids.providerRequestId,
    });
    expect(mocks.transition).toHaveBeenNthCalledWith(2, {
      event: "accept",
      expectedVersion: 3,
      externalJobId: "fal-request-123",
      providerRequestId: ids.providerRequestId,
      safeResponseHash: "b".repeat(64),
    });
  });

  it("quarantines synchronous speech bytes before returning", async () => {
    const speechManifest = {
      ...manifest,
      credentialSecretRef: "ELEVENLABS_API_KEY" as const,
      modelKey: "eleven_multilingual_v2",
      operation: "gen_speech" as const,
      provider: "elevenlabs" as const,
    };
    mocks.manifest.mockResolvedValue(speechManifest);
    mocks.submit.mockResolvedValue({
      bytes: Buffer.from("id3-audio"),
      contentType: "audio/mpeg",
      externalJobId: "sync-b110",
      kind: "quarantine_bytes",
      responseHash: "c".repeat(64),
      targetAssetId: ids.targetAssetId,
    });
    const response = await POST(
      request(JSON.stringify({ ...brokerRequest, operation: "gen_speech" })),
    );
    expect(response.status).toBe(202);
    expect(mocks.quarantine).toHaveBeenCalledWith(
      expect.objectContaining({
        providerRequestId: ids.providerRequestId,
        responseHash: "c".repeat(64),
        workspaceId: ids.workspaceId,
      }),
    );
    expect((await response.json()).quarantineAssetVersionId).toBe(
      "b1150000-0000-4000-8000-000000000001",
    );
  });

  it("rejects invalid authority before ledger consumption or provider work", async () => {
    mocks.verify.mockImplementation(() => {
      throw new BrokerAssertionError("wrong project");
    });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.rejection).toHaveBeenCalledWith({
      clientId: "genie-preview-client",
      environment: "preview",
      kid: "genie-preview-key-v1",
      reasonCode: "assertion_invalid",
      triggerProject: "genie-preview",
    });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("returns a conflict for replayed durable authority before provider work", async () => {
    mocks.consume.mockRejectedValue(new ProviderBrokerLedgerError("replay", true));
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      code: "BROKER_REPLAY_OR_STALE_AUTHORITY",
      ok: false,
    });
    expect(mocks.rejection).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "replay_or_stale" }),
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("returns a safe provider failure without exposing provider text", async () => {
    mocks.transition.mockReset();
    mocks.transition
      .mockResolvedValueOnce({
        aggregateVersion: 3,
        providerRequestId: ids.providerRequestId,
        state: "submitted",
      })
      .mockResolvedValueOnce({
        aggregateVersion: 4,
        providerRequestId: ids.providerRequestId,
        state: "failed_retryable",
      });
    mocks.submit.mockRejectedValue(
      new ProviderAdapterError(
        "provider credential shaped response",
        "retryable",
        "fal.http_429",
      ),
    );
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("credential shaped response");
    expect(mocks.transition).toHaveBeenNthCalledWith(2, {
      event: "fail_retryable",
      expectedVersion: 3,
      providerRequestId: ids.providerRequestId,
    });
  });

  it("fails closed when the manifest no longer matches consumed authority", async () => {
    mocks.manifest.mockResolvedValue({ ...manifest, workspaceId: ids.targetAssetId });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});

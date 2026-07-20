import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  record: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("@/server/fal-webhook-verifier", () => ({ verifyFalWebhook: mocks.verify }));
vi.mock("@/server/provider-broker-ledger", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/provider-broker-ledger")>();
  return {
    ...original,
    getFalWebhookBinding: mocks.binding,
    recordFalSignedWebhook: mocks.record,
  };
});

import { POST } from "@/app/api/internal/provider-webhooks/fal/[providerRequestId]/route";
import { FalWebhookError } from "@/domain/provider/fal-webhook";
import { ProviderBrokerLedgerError } from "@/server/provider-broker-ledger";

const providerRequestId = "30000000-0000-4000-8000-000000000001";
const targetAssetId = "30000000-0000-4000-8000-000000000002";
const falRequestId = "123e4567-e89b-12d3-a456-426614174000";
const body = JSON.stringify({
  gateway_request_id: falRequestId,
  payload: {
    images: [
      {
        content_type: "image/png",
        height: 1792,
        url: "https://v3.fal.media/files/result.png",
        width: 1024,
      },
    ],
  },
  request_id: falRequestId,
  status: "OK",
});

function request(contentType = "application/json") {
  return new Request(
    `https://content-genie-three.vercel.app/api/internal/provider-webhooks/fal/${providerRequestId}`,
    { body, headers: { "content-type": contentType }, method: "POST" },
  );
}

const context = {
  params: Promise.resolve({ providerRequestId }),
};

describe("FAL signed webhook route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verify.mockResolvedValue({ requestId: falRequestId, userId: "fal-user" });
    mocks.binding.mockResolvedValue({
      providerRequestId,
      targetAssetId,
      workspaceId: "30000000-0000-4000-8000-000000000003",
    });
    mocks.record.mockResolvedValue({
      aggregateVersion: 4,
      candidateIds: ["30000000-0000-4000-8000-000000000004"],
      disposition: "accepted",
      duplicate: false,
      ok: true,
      providerRequestId,
      state: "polling",
    });
  });

  it("verifies raw bytes before resolving a database binding", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      disposition: "accepted",
      duplicate: false,
      ok: true,
    });
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.binding.mock.invocationCallOrder[0]!,
    );
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEventId: falRequestId,
        providerRequestId,
      }),
    );
  });

  it("rejects an invalid signature before any database call", async () => {
    mocks.verify.mockRejectedValue(new FalWebhookError("bad signature", true));
    const response = await POST(request(), context);
    expect(response.status).toBe(401);
    expect(mocks.binding).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("rejects non-JSON before verification", async () => {
    const response = await POST(request("text/plain"), context);
    expect(response.status).toBe(415);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("returns a replay conflict without exposing ledger details", async () => {
    mocks.record.mockRejectedValue(
      new ProviderBrokerLedgerError("internal replay detail", true),
    );
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("internal replay detail");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), verify: vi.fn() }));

vi.mock("@/server/fal-webhook-verifier", () => ({ verifyFalWebhook: mocks.verify }));
vi.mock("@/server/mvp-media-dispatch", () => ({
  reconcileMvpMediaDispatchWebhook: mocks.reconcile,
}));

import { POST } from "@/app/api/internal/provider-webhooks/fal-mvp/[providerDispatchId]/route";
import { FalWebhookError } from "@/domain/provider/fal-webhook";

const providerDispatchId = "30000000-0000-4000-8000-000000000001";
const falRequestId = "123e4567-e89b-12d3-a456-426614174000";
const callbackToken = "A".repeat(43);
const body = JSON.stringify({
  gateway_request_id: falRequestId,
  payload: { video: { url: "https://v3.fal.media/files/result.mp4" } },
  request_id: falRequestId,
  status: "OK",
});
const context = { params: Promise.resolve({ providerDispatchId }) };

function request(rawBody = body) {
  return new Request(
    `https://content-genie-three.vercel.app/api/internal/provider-webhooks/fal-mvp/${providerDispatchId}?token=${callbackToken}`,
    {
      body: rawBody,
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

describe("FAL MVP receipt callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verify.mockResolvedValue({ requestId: falRequestId, userId: "fal-user" });
    mocks.reconcile.mockResolvedValue(undefined);
  });

  it("verifies the signed request id before reconciling the reserved dispatch", async () => {
    const result = await POST(request(), context);
    expect(result.status).toBe(202);
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.reconcile.mock.invocationCallOrder[0]!,
    );
    expect(mocks.reconcile).toHaveBeenCalledWith({
      callbackToken,
      externalRequestId: falRequestId,
      providerDispatchId,
    });
  });

  it("rejects a body identity that differs from the verified signature", async () => {
    const result = await POST(
      request(body.replaceAll(falRequestId, "123e4567-e89b-12d3-a456-426614174999")),
      context,
    );
    expect(result.status).toBe(400);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before dispatch reconciliation", async () => {
    mocks.verify.mockRejectedValue(new FalWebhookError("bad signature", true));
    const result = await POST(request(), context);
    expect(result.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("asks fal.ai to retry when the ledger is temporarily unavailable", async () => {
    mocks.reconcile.mockRejectedValue(new Error("database unavailable"));
    const result = await POST(request(), context);
    expect(result.status).toBe(503);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  candidate: vi.fn(),
  manifest: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/server/provider-broker-ledger", () => ({
  getNextFalAuthenticatedPollCandidate: mocks.candidate,
  getProviderDispatchManifest: mocks.manifest,
  recordFalSignedWebhook: mocks.record,
}));

import { recoverNextCompletedFalResult } from "./fal-result-recovery";

const providerRequestId = "30000000-0000-4000-8000-000000000004";
const targetAssetId = "30000000-0000-4000-8000-000000000006";

describe("FAL authenticated result recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.candidate.mockResolvedValue({
      empty: false,
      externalJobId: "fal-job-123",
      ok: true,
      providerRequestId,
    });
    mocks.manifest.mockResolvedValue({
      modelKey: "fal-ai/nano-banana-2",
      operation: "gen_image",
      payload: { targetAssetId },
      provider: "fal",
    });
    mocks.record.mockResolvedValue({ disposition: "accepted" });
  });

  it("records one exact completed image through the provider inbox", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          images: [
            {
              content_type: "image/png",
              height: 1792,
              url: "https://v3.fal.media/files/result.png",
              width: 1024,
            },
          ],
        }),
        { headers: { "content-type": "application/json" }, status: 200 },
      ),
    );
    await expect(
      recoverNextCompletedFalResult({
        environment: "production",
        falKey: "f".repeat(32),
        fetchImplementation,
      }),
    ).resolves.toEqual({
      checked: true,
      providerRequestId,
      recovered: true,
    });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        providerEventId: "poll:fal-job-123",
        providerRequestId,
        webhook: expect.objectContaining({
          outputs: [expect.objectContaining({ targetAssetId })],
          status: "OK",
        }),
      }),
    );
  });

  it("leaves an unfinished queue result for the next bounded poll", async () => {
    await expect(
      recoverNextCompletedFalResult({
        environment: "production",
        falKey: "f".repeat(32),
        fetchImplementation: vi
          .fn()
          .mockResolvedValue(new Response("pending", { status: 422 })),
      }),
    ).resolves.toEqual({
      checked: true,
      providerRequestId,
      recovered: false,
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

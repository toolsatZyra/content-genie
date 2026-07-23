import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  candidate: vi.fn(),
  fail: vi.fn(),
  manifest: vi.fn(),
  record: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/server/provider-broker-ledger", () => ({
  failFalAuthenticatedPollCandidate: mocks.fail,
  getNextFalAuthenticatedPollCandidate: mocks.candidate,
  getProviderDispatchManifest: mocks.manifest,
  recordFalSignedWebhook: mocks.record,
  releaseFalAuthenticatedPollCredentialClaim: mocks.release,
}));

import { recoverNextCompletedFalResult } from "./fal-result-recovery";

const providerRequestId = "30000000-0000-4000-8000-000000000004";
const targetAssetId = "30000000-0000-4000-8000-000000000006";

function uint32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)) {
  const payload = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([uint32(data.length), payload, uint32(crc32(payload))]);
}

function providerPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1024, 0);
  header.writeUInt32BE(1792, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.alloc(1_024, 1)),
    pngChunk("IEND"),
  ]);
}

describe("FAL authenticated result recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.candidate.mockResolvedValue({
      empty: false,
      externalJobId: "fal-job-123",
      ok: true,
      pollAttemptCount: 1,
      providerRequestId,
    });
    mocks.manifest.mockResolvedValue({
      modelKey: "fal-ai/nano-banana-2",
      operation: "gen_image",
      payload: { targetAssetId },
      provider: "fal",
    });
    mocks.record.mockResolvedValue({ disposition: "accepted" });
    mocks.fail.mockResolvedValue(true);
    mocks.release.mockResolvedValue(true);
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
        {
          headers: {
            "content-encoding": "br",
            "content-length": "11",
            "content-type": "application/json",
          },
          status: 200,
        },
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
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://queue.fal.run/fal-ai/nano-banana-2/requests/fal-job-123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("falls back to the explicit response URL for queue variants that reject the direct URL", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response("method not allowed", { status: 405 }))
      .mockResolvedValueOnce(
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
          { status: 200 },
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
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      1,
      "https://queue.fal.run/fal-ai/nano-banana-2/requests/fal-job-123",
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://queue.fal.run/fal-ai/nano-banana-2/requests/fal-job-123/response",
      expect.objectContaining({ method: "GET" }),
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

  it("terminalizes one permanently missing result after the bounded poll budget", async () => {
    mocks.candidate.mockResolvedValue({
      empty: false,
      externalJobId: "fal-job-123",
      ok: true,
      pollAttemptCount: 5,
      providerRequestId,
    });
    await expect(
      recoverNextCompletedFalResult({
        environment: "production",
        falKey: "f".repeat(32),
        fetchImplementation: vi
          .fn()
          .mockResolvedValue(new Response("missing", { status: 404 })),
      }),
    ).resolves.toEqual({
      checked: true,
      providerRequestId,
      recovered: false,
    });
    expect(mocks.fail).toHaveBeenCalledWith({
      providerRequestId,
      safeErrorClass: "fal.poll.result-exhausted",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("does not consume a poll claim when the recovery credential is unavailable", async () => {
    await expect(
      recoverNextCompletedFalResult({
        environment: "production",
        falKey: "",
        fetchImplementation: vi.fn(),
      }),
    ).rejects.toThrow("credential is unavailable");
    expect(mocks.candidate).not.toHaveBeenCalled();
  });

  it("terminalizes malformed successful output after the bounded poll budget", async () => {
    mocks.candidate.mockResolvedValue({
      empty: false,
      externalJobId: "fal-job-123",
      ok: true,
      pollAttemptCount: 5,
      providerRequestId,
    });
    await expect(
      recoverNextCompletedFalResult({
        environment: "production",
        falKey: "f".repeat(32),
        fetchImplementation: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ images: [] }), {
            status: 200,
          }),
        ),
      }),
    ).resolves.toEqual({
      checked: true,
      providerRequestId,
      recovered: false,
    });
    expect(mocks.fail).toHaveBeenCalledWith({
      providerRequestId,
      safeErrorClass: "fal.poll.output-invalid",
    });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    "preserves the remote job when the polling credential receives HTTP %s",
    async (status) => {
      mocks.candidate.mockResolvedValue({
        empty: false,
        externalJobId: "fal-job-123",
        ok: true,
        pollAttemptCount: 5,
        providerRequestId,
      });
      await expect(
        recoverNextCompletedFalResult({
          environment: "production",
          falKey: "f".repeat(32),
          fetchImplementation: vi
            .fn()
            .mockResolvedValue(new Response("credential rejected", { status })),
        }),
      ).rejects.toThrow(`credential was rejected with HTTP ${status}`);
      expect(mocks.fail).not.toHaveBeenCalled();
      expect(mocks.record).not.toHaveBeenCalled();
      expect(mocks.release).toHaveBeenCalledWith({
        expectedPollAttemptCount: 5,
        providerRequestId,
      });
    },
  );

  it("derives dimensions from validated provider bytes when FAL omits them", async () => {
    const image = providerPng();
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            images: [
              {
                content_type: "image/png",
                height: null,
                url: "https://v3.fal.media/files/result.png",
                width: null,
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(image, {
          headers: { "content-length": String(image.length) },
          status: 200,
        }),
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
        webhook: expect.objectContaining({
          outputs: [expect.objectContaining({ height: 1792, width: 1024 })],
        }),
      }),
    );
  });
});

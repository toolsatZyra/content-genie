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

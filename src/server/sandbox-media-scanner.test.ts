import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: mocks.create },
}));

import { launchMediaLimits } from "@/security/media-ingest";

import {
  SandboxMediaScannerError,
  scanAndReencodeWorldImage,
} from "./sandbox-media-scanner";

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

function chunk(type: string, data = Buffer.alloc(0)) {
  const payload = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([uint32(data.length), payload, uint32(crc32(payload))]);
}

function containerPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(320, 0);
  header.writeUInt32BE(320, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", Buffer.alloc(20, 1)),
    chunk("IEND"),
  ]);
}

async function safeClass(input: Parameters<typeof scanAndReencodeWorldImage>[0]) {
  try {
    await scanAndReencodeWorldImage(input);
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxMediaScannerError);
    return (error as SandboxMediaScannerError).safeClass;
  }
  throw new Error("Expected the scanner to reject the fixture.");
}

describe("sandbox media scanner input envelope", () => {
  beforeEach(() => vi.resetAllMocks());

  it("rejects malformed and polyglot containers before sandbox creation", async () => {
    const png = containerPng();
    const corrupt = Buffer.from(png);
    corrupt[corrupt.length - 5] = corrupt[corrupt.length - 5]! ^ 1;
    await expect(
      safeClass({ bytes: corrupt, declaredMime: "image/png" }),
    ).resolves.toBe("media.container_malformed");
    await expect(
      safeClass({
        bytes: Buffer.concat([png, Buffer.from("PK\u0003\u0004attachment")]),
        declaredMime: "image/png",
      }),
    ).resolves.toBe("media.container_trailing_data");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects wrong-MIME and oversized provider media before sandbox creation", async () => {
    await expect(
      safeClass({ bytes: containerPng(), declaredMime: "image/jpeg" }),
    ).resolves.toBe("media.magic_mismatch");
    const oversized = Buffer.alloc(launchMediaLimits.maximumImageBytes + 1);
    oversized.set([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(
      safeClass({ bytes: oversized, declaredMime: "image/png" }),
    ).resolves.toBe("media.magic_mismatch");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

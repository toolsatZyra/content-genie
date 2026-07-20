import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { inspectStillImageContainer } from "@/security/still-image-container";
import { scanAndReencodeWorldImage } from "@/server/sandbox-media-scanner";

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

function metadataBearingPng() {
  const width = 400;
  const height = 400;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);

  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 3;
      rows[pixel] = x % 256;
      rows[pixel + 1] = y % 256;
      rows[pixel + 2] = (x + y) % 256;
    }
  }
  const text = Buffer.from(
    "Comment\u0000GPSLatitude=28.6139;GPSLongitude=77.2090;private-comment",
    "latin1",
  );
  const internationalText = Buffer.from(
    "XML:com.adobe.xmp\u0000\u0000\u0000\u0000\u0000<xmp>private-attachment</xmp>",
    "utf8",
  );
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("tEXt", text),
    chunk("iTXt", internationalText),
    chunk("aaAa", Buffer.from("private-attachment-payload", "utf8")),
    chunk("IDAT", deflateSync(rows, { level: 6 })),
    chunk("IEND"),
  ]);
}

function pngChunkTypes(bytes: Buffer) {
  const types: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    types.push(type);
    offset += 12 + length;
    if (type === "IEND") {
      expect(offset).toBe(bytes.length);
      return types;
    }
  }
  throw new Error("Sanitized PNG had no exact IEND boundary.");
}

const liveDescribe =
  process.env.RUN_LIVE_MEDIA_SCANNER === "1" ? describe : describe.skip;

liveDescribe("live isolated media scanner corpus", () => {
  it("re-encodes a metadata-bearing PNG without GPS, comments, or attachments", async () => {
    const source = metadataBearingPng();
    expect(inspectStillImageContainer(source, "image/png")).toEqual({
      status: "valid",
    });
    expect(source.toString("latin1")).toContain("GPSLatitude");
    expect(source.toString("utf8")).toContain("private-attachment");

    const result = await scanAndReencodeWorldImage({
      bytes: source,
      declaredMime: "image/png",
    });

    expect(result.magicMime).toBe("image/png");
    expect(result.width).toBe(400);
    expect(result.height).toBe(400);
    expect(result.scanEngine).toBe("ClamAV.ImageMagick");
    expect(result.scanVersion).toMatch(/^[a-f0-9]{32}$/u);
    expect(result.outputSha256).toBe(
      createHash("sha256").update(result.outputBytes).digest("hex"),
    );
    expect(result.outputSha256).not.toBe(
      createHash("sha256").update(source).digest("hex"),
    );
    expect(inspectStillImageContainer(result.outputBytes, "image/png")).toEqual({
      status: "valid",
    });
    expect(pngChunkTypes(result.outputBytes)).not.toEqual(
      expect.arrayContaining(["tEXt", "zTXt", "iTXt", "eXIf", "aaAa"]),
    );
    const outputText = result.outputBytes.toString("latin1");
    expect(outputText).not.toContain("GPSLatitude");
    expect(outputText).not.toContain("private-comment");
    expect(outputText).not.toContain("private-attachment");
  }, 360_000);
});

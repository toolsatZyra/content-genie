import { describe, expect, it } from "vitest";

import {
  inspectStillImageContainer,
  inspectStillImageDimensions,
} from "./still-image-container";

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

function minimalPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(320, 0);
  header.writeUInt32BE(320, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.alloc(20, 1)),
    pngChunk("IEND"),
  ]);
}

describe("still image container envelope", () => {
  it("accepts an exact PNG envelope", () => {
    expect(inspectStillImageContainer(minimalPng(), "image/png")).toEqual({
      status: "valid",
    });
    expect(inspectStillImageDimensions(minimalPng(), "image/png")).toEqual({
      height: 320,
      width: 320,
    });
  });

  it("rejects appended polyglot data and corrupt PNG CRCs", () => {
    const png = minimalPng();
    expect(
      inspectStillImageContainer(
        Buffer.concat([png, Buffer.from("PK\u0003\u0004attachment")]),
        "image/png",
      ),
    ).toEqual({ status: "trailing_data" });
    const corrupt = Buffer.from(png);
    corrupt[corrupt.length - 5] = corrupt[corrupt.length - 5]! ^ 1;
    expect(inspectStillImageContainer(corrupt, "image/png")).toEqual({
      status: "malformed",
    });
  });

  it("requires exact JPEG and RIFF/WebP termination", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(60),
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(inspectStillImageContainer(jpeg, "image/jpeg")).toEqual({
      status: "valid",
    });
    expect(
      inspectStillImageContainer(
        Buffer.concat([jpeg, Buffer.from("MZ")]),
        "image/jpeg",
      ),
    ).toEqual({ status: "trailing_data" });

    const webp = Buffer.alloc(32);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(24, 4);
    webp.write("WEBPVP8 ", 8, "ascii");
    webp.writeUInt32LE(12, 16);
    expect(inspectStillImageContainer(webp, "image/webp")).toEqual({
      status: "valid",
    });
    expect(
      inspectStillImageContainer(
        Buffer.concat([webp, Buffer.from("PK")]),
        "image/webp",
      ),
    ).toEqual({ status: "trailing_data" });
  });

  it("derives JPEG and WebP dimensions only from valid image headers", () => {
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x80, 0x01, 0x68]),
      Buffer.alloc(55),
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(inspectStillImageDimensions(jpeg, "image/jpeg")).toEqual({
      height: 640,
      width: 360,
    });

    const webp = Buffer.alloc(48);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(40, 4);
    webp.write("WEBPVP8X", 8, "ascii");
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(359, 24, 3);
    webp.writeUIntLE(639, 27, 3);
    webp.write("VP8 ", 30, "ascii");
    webp.writeUInt32LE(10, 34);
    expect(inspectStillImageDimensions(webp, "image/webp")).toEqual({
      height: 640,
      width: 360,
    });
  });
});

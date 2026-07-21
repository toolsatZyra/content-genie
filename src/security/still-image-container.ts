export type StillImageMime = "image/jpeg" | "image/png" | "image/webp";

export type StillImageContainerInspection =
  Readonly<{ status: "valid" }> | Readonly<{ status: "malformed" | "trailing_data" }>;

export type StillImageDimensions = Readonly<{ height: number; width: number }>;

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

function uint32Be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function uint32Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x10000 +
    bytes[offset + 3]! * 0x1000000
  );
}

function uint16Be(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

function uint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100;
}

function uint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100 + bytes[offset + 2]! * 0x10000;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = "";
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index]!);
  }
  return value;
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): StillImageContainerInspection {
  if (
    bytes.length < 57 ||
    !pngSignature.every((value, index) => bytes[index] === value)
  ) {
    return { status: "malformed" };
  }

  let offset = pngSignature.length;
  let chunkCount = 0;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= bytes.length && chunkCount < 10_000) {
    const length = uint32Be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const end = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/u.test(type) || end > bytes.length) {
      return { status: "malformed" };
    }
    const expectedCrc = uint32Be(bytes, offset + 8 + length);
    if (crc32(bytes, offset + 4, offset + 8 + length) !== expectedCrc) {
      return { status: "malformed" };
    }
    if (chunkCount === 0) {
      if (type !== "IHDR" || length !== 13) return { status: "malformed" };
      sawHeader = true;
    } else if (type === "IHDR") {
      return { status: "malformed" };
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || !sawHeader || !sawImageData) {
        return { status: "malformed" };
      }
      return { status: end === bytes.length ? "valid" : "trailing_data" };
    }
    offset = end;
    chunkCount += 1;
  }
  return { status: "malformed" };
}

function inspectJpeg(bytes: Uint8Array): StillImageContainerInspection {
  if (
    bytes.length < 64 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    const lastEoi = bytes.findLastIndex(
      (value, index) => index > 0 && bytes[index - 1] === 0xff && value === 0xd9,
    );
    return { status: lastEoi >= 0 ? "trailing_data" : "malformed" };
  }
  return { status: "valid" };
}

function inspectWebp(bytes: Uint8Array): StillImageContainerInspection {
  if (
    bytes.length < 32 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP"
  ) {
    return { status: "malformed" };
  }
  const declaredLength = uint32Le(bytes, 4) + 8;
  if (declaredLength !== bytes.length) {
    return { status: declaredLength < bytes.length ? "trailing_data" : "malformed" };
  }
  let offset = 12;
  let chunks = 0;
  let sawImagePayload = false;
  while (offset + 8 <= bytes.length && chunks < 10_000) {
    const type = ascii(bytes, offset, 4);
    const length = uint32Le(bytes, offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (!/^[ -~]{4}$/u.test(type) || end > bytes.length) {
      return { status: "malformed" };
    }
    if (["VP8 ", "VP8L", "ANMF"].includes(type)) sawImagePayload = true;
    offset = end;
    chunks += 1;
  }
  return {
    status: offset === bytes.length && sawImagePayload ? "valid" : "malformed",
  };
}

export function inspectStillImageContainer(
  bytes: Uint8Array,
  mime: StillImageMime,
): StillImageContainerInspection {
  if (mime === "image/png") return inspectPng(bytes);
  if (mime === "image/jpeg") return inspectJpeg(bytes);
  return inspectWebp(bytes);
}

function validDimensions(width: number, height: number): StillImageDimensions | null {
  return Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0
    ? Object.freeze({ height, width })
    : null;
}

function pngDimensions(bytes: Uint8Array): StillImageDimensions | null {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== "IHDR") return null;
  return validDimensions(uint32Be(bytes, 16), uint32Be(bytes, 20));
}

function jpegDimensions(bytes: Uint8Array): StillImageDimensions | null {
  const startOfFrame = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;
  while (offset + 4 <= bytes.length - 2) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = uint16Be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (startOfFrame.has(marker)) {
      if (segmentLength < 7) return null;
      return validDimensions(uint16Be(bytes, offset + 5), uint16Be(bytes, offset + 3));
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): StillImageDimensions | null {
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = uint32Le(bytes, offset + 4);
    const data = offset + 8;
    const end = data + length;
    if (end > bytes.length) return null;
    if (type === "VP8X" && length >= 10) {
      return validDimensions(
        uint24Le(bytes, data + 4) + 1,
        uint24Le(bytes, data + 7) + 1,
      );
    }
    if (type === "VP8L" && length >= 5 && bytes[data] === 0x2f) {
      const width = 1 + (bytes[data + 1]! | ((bytes[data + 2]! & 0x3f) << 8));
      const height =
        1 +
        ((bytes[data + 2]! >> 6) |
          (bytes[data + 3]! << 2) |
          ((bytes[data + 4]! & 0x0f) << 10));
      return validDimensions(width, height);
    }
    if (
      type === "VP8 " &&
      length >= 10 &&
      bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 &&
      bytes[data + 5] === 0x2a
    ) {
      return validDimensions(
        uint16Le(bytes, data + 6) & 0x3fff,
        uint16Le(bytes, data + 8) & 0x3fff,
      );
    }
    offset = end + (length % 2);
  }
  return null;
}

export function inspectStillImageDimensions(
  bytes: Uint8Array,
  mime: StillImageMime,
): StillImageDimensions | null {
  if (inspectStillImageContainer(bytes, mime).status !== "valid") return null;
  if (mime === "image/png") return pngDimensions(bytes);
  if (mime === "image/jpeg") return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

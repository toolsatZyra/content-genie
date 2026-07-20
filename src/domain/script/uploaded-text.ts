import { createHash } from "node:crypto";

import { MAX_UPLOADED_SCRIPT_SOURCE_BYTES } from "./limits";

export const UPLOADED_SCRIPT_DECODER_PROFILE = "genie-uploaded-script-decoder.v1";

export type UploadedScriptEncoding = "utf-16be" | "utf-16le" | "utf-8";

export type UploadedScriptErrorCode =
  | "SCRIPT_UPLOAD_EMPTY"
  | "SCRIPT_UPLOAD_INVALID_BASE64"
  | "SCRIPT_UPLOAD_MALFORMED_TEXT"
  | "SCRIPT_UPLOAD_TOO_LARGE";

export class UploadedScriptError extends Error {
  override readonly name = "UploadedScriptError";

  constructor(
    readonly code: UploadedScriptErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface UploadedScriptEncodingEvidence {
  readonly bom: "none" | "utf-16be" | "utf-16le" | "utf-8";
  readonly byteLength: number;
  readonly decoderProfile: typeof UPLOADED_SCRIPT_DECODER_PROFILE;
  readonly encoding: UploadedScriptEncoding;
  readonly originalSha256: string;
}

export interface DecodedUploadedScript {
  readonly encodingEvidence: UploadedScriptEncodingEvidence;
  readonly originalBytes: Uint8Array;
  readonly text: string;
}

function strictBase64(value: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new UploadedScriptError(
      "SCRIPT_UPLOAD_INVALID_BASE64",
      "The uploaded script bytes must use canonical base64.",
    );
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    throw new UploadedScriptError(
      "SCRIPT_UPLOAD_INVALID_BASE64",
      "The uploaded script bytes must use canonical base64.",
    );
  }
  return Uint8Array.from(decoded);
}

function decode(
  bytes: Uint8Array,
  encoding: UploadedScriptEncoding,
  offset: number,
): string {
  try {
    return new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(offset),
    );
  } catch {
    throw new UploadedScriptError(
      "SCRIPT_UPLOAD_MALFORMED_TEXT",
      `The uploaded script is not well-formed ${encoding.toUpperCase()} text.`,
    );
  }
}

export function decodeUploadedScriptBase64(value: string): DecodedUploadedScript {
  const originalBytes = strictBase64(value);
  if (originalBytes.byteLength === 0) {
    throw new UploadedScriptError(
      "SCRIPT_UPLOAD_EMPTY",
      "The uploaded script is empty.",
    );
  }
  if (originalBytes.byteLength > MAX_UPLOADED_SCRIPT_SOURCE_BYTES) {
    throw new UploadedScriptError(
      "SCRIPT_UPLOAD_TOO_LARGE",
      `The uploaded script exceeds ${MAX_UPLOADED_SCRIPT_SOURCE_BYTES} source bytes.`,
    );
  }

  let bom: UploadedScriptEncodingEvidence["bom"] = "none";
  let encoding: UploadedScriptEncoding = "utf-8";
  let offset = 0;
  if (
    originalBytes[0] === 0xef &&
    originalBytes[1] === 0xbb &&
    originalBytes[2] === 0xbf
  ) {
    bom = "utf-8";
    offset = 3;
  } else if (originalBytes[0] === 0xff && originalBytes[1] === 0xfe) {
    bom = "utf-16le";
    encoding = "utf-16le";
    offset = 2;
  } else if (originalBytes[0] === 0xfe && originalBytes[1] === 0xff) {
    bom = "utf-16be";
    encoding = "utf-16be";
    offset = 2;
  }
  if (encoding !== "utf-8" && (originalBytes.byteLength - offset) % 2 !== 0) {
    throw new UploadedScriptError(
      "SCRIPT_UPLOAD_MALFORMED_TEXT",
      `The uploaded script is not well-formed ${encoding.toUpperCase()} text.`,
    );
  }

  return {
    encodingEvidence: {
      bom,
      byteLength: originalBytes.byteLength,
      decoderProfile: UPLOADED_SCRIPT_DECODER_PROFILE,
      encoding,
      originalSha256: createHash("sha256").update(originalBytes).digest("hex"),
    },
    originalBytes,
    text: decode(originalBytes, encoding, offset),
  };
}

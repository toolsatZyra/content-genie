import { describe, expect, it } from "vitest";

import { MAX_UPLOADED_SCRIPT_SOURCE_BYTES } from "./limits";
import { decodeUploadedScriptBase64 } from "./uploaded-text";

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("uploaded script decoding", () => {
  it("preserves exact UTF-8 source bytes while removing only the BOM from text", () => {
    const source = Uint8Array.from([
      0xef,
      0xbb,
      0xbf,
      ...Buffer.from("  \u0915\u0925\u093e\r\n"),
    ]);
    const decoded = decodeUploadedScriptBase64(base64(source));

    expect(decoded.text).toBe("  \u0915\u0925\u093e\r\n");
    expect(decoded.originalBytes).toEqual(source);
    expect(decoded.encodingEvidence).toMatchObject({
      bom: "utf-8",
      byteLength: source.byteLength,
      decoderProfile: "genie-uploaded-script-decoder.v1",
      encoding: "utf-8",
      originalSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it.each([
    {
      bom: [0xff, 0xfe],
      bytes: [0x15, 0x09, 0x25, 0x09],
      encoding: "utf-16le",
    },
    {
      bom: [0xfe, 0xff],
      bytes: [0x09, 0x15, 0x09, 0x25],
      encoding: "utf-16be",
    },
  ] as const)(
    "decodes BOM-marked $encoding without byte loss",
    ({ bom, bytes, encoding }) => {
      const source = Uint8Array.from([...bom, ...bytes]);
      const decoded = decodeUploadedScriptBase64(base64(source));
      expect(decoded.text).toBe("\u0915\u0925");
      expect(decoded.originalBytes).toEqual(source);
      expect(decoded.encodingEvidence).toMatchObject({ bom: encoding, encoding });
    },
  );

  it("accepts BOM-less UTF-8 and rejects malformed or ambiguous source data", () => {
    expect(
      decodeUploadedScriptBase64(base64(Buffer.from("\u0915\u0925\u093e"))).text,
    ).toBe("\u0915\u0925\u093e");
    expect(() => decodeUploadedScriptBase64("not base64")).toThrow("canonical base64");
    expect(() =>
      decodeUploadedScriptBase64(base64(Uint8Array.from([0xc3, 0x28]))),
    ).toThrow("well-formed UTF-8");
    expect(() =>
      decodeUploadedScriptBase64(base64(Uint8Array.from([0xff, 0xfe, 0x15]))),
    ).toThrow("well-formed UTF-16LE");
  });

  it("enforces the original-byte limit before decoding", () => {
    expect(() =>
      decodeUploadedScriptBase64(
        base64(new Uint8Array(MAX_UPLOADED_SCRIPT_SOURCE_BYTES + 1).fill(0x61)),
      ),
    ).toThrow(`exceeds ${MAX_UPLOADED_SCRIPT_SOURCE_BYTES}`);
  });
});

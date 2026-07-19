import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  SCRIPT_COORDINATE_MAP_VERSION,
  SCRIPT_GRAPHEME_PROBE_SHA256,
  SCRIPT_GRAPHEME_PROFILE,
  SCRIPT_GRAPHEME_UNICODE_VERSION,
  SCRIPT_RANGE_CONVENTION,
  ScriptIntegrityError,
  type ScriptIntegrityErrorCode,
  prepareBrowserScript,
} from "./integrity";
import {
  MAX_BROWSER_SCRIPT_UTF8_BYTES,
  MAX_SCRIPT_COORDINATE_MAP_BYTES,
} from "./limits";

function sha256(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function serializedCoordinateMapBytes(coordinateMap: unknown): number {
  return new TextEncoder().encode(JSON.stringify(coordinateMap)).byteLength;
}

const MAX_LOCAL_COORDINATE_MAP_JSON_BYTES = 1_000_000;

const exactBoundaryScripts = [
  ["identity ASCII", "a".repeat(MAX_BROWSER_SCRIPT_UTF8_BYTES)],
  ["line-ending-heavy ASCII", `a${"\r".repeat(MAX_BROWSER_SCRIPT_UTF8_BYTES - 1)}`],
  [
    "alternating normalization reasons",
    "a\r".repeat(MAX_BROWSER_SCRIPT_UTF8_BYTES / 2),
  ],
  ["JSON-escaped controls", "\u0001".repeat(MAX_BROWSER_SCRIPT_UTF8_BYTES)],
  ["quotes and backslashes", '\\"'.repeat(MAX_BROWSER_SCRIPT_UTF8_BYTES / 2)],
  [
    "decomposed NFC input",
    `${"e\u0301".repeat(Math.floor(MAX_BROWSER_SCRIPT_UTF8_BYTES / 3))}${"a".repeat(
      MAX_BROWSER_SCRIPT_UTF8_BYTES % 3,
    )}`,
  ],
  ["astral scalars", "🙂".repeat(MAX_BROWSER_SCRIPT_UTF8_BYTES / 4)],
] as const;

describe("prepareBrowserScript", () => {
  it("preserves whitespace and exact browser UTF-8 bytes", () => {
    const source = "  आरम्भ\r\nअंत  \n";
    const result = prepareBrowserScript(source);

    expect(result.rawText).toBe(source);
    expect(Buffer.from(result.rawUtf8).toString("utf8")).toBe(source);
    expect(result.rawUtf8Sha256).toBe(sha256(source));
    expect(result.processingText).toBe("  आरम्भ\nअंत  \n");
    expect(result.coordinateMap).toMatchObject({
      c: SCRIPT_RANGE_CONVENTION,
      v: SCRIPT_COORDINATE_MAP_VERSION,
    });
    expect(Object.keys(result.coordinateMap).sort()).toEqual(["c", "p", "r", "s", "v"]);
  });

  it("records many-to-one CRLF and NFC interval mappings", () => {
    const source = "A\r\ne\u0301";
    const result = prepareBrowserScript(source);

    expect(result.processingText).toBe("A\né");
    expect(result.coordinateMap.s).toEqual([
      [0, 0, 1, 0, 1],
      [1, 1, 2, 1, 2],
      [2, 2, 3, 2, 3],
    ]);
    expect(result.coordinateMap.r).toEqual([
      [0, 1, 2, 3, 4, 5],
      [0, 1, 2, 3, 4, 6],
      [1, 3, 5],
    ]);
    expect(result.coordinateMap.p).toEqual([
      [0, 1, 2, 3],
      [0, 1, 2, 4],
      [1, 2, 3],
    ]);
  });

  it("maps Devanagari, ZWJ emoji, flags, modifiers, and variation selectors", () => {
    const source = "क़ृष्ण 👨‍👩‍👧‍👦 🇮🇳 🙏🏽 ॐ️";
    const result = prepareBrowserScript(source);
    const expectedRawGraphemeScalarEnds = [3, 6, 7, 14, 15, 17, 18, 20, 21, 23];

    expect(result.rawText).toBe(source);
    expect(result.coordinateMap.r[2]).toEqual(expectedRawGraphemeScalarEnds);
    expect(result.coordinateMap.r[2].length).toBeLessThan([...source].length);
    expect(result.runtimeEvidence).toMatchObject({
      graphemeProbeSha256: SCRIPT_GRAPHEME_PROBE_SHA256,
      graphemeSegmenterProfile: SCRIPT_GRAPHEME_PROFILE,
      unicodeVersion: SCRIPT_GRAPHEME_UNICODE_VERSION,
    });
    const rawLast = result.coordinateMap.r[0].at(-1);
    expect(rawLast).toBe(source.length);
    expect(result.processingUtf8Sha256).toBe(sha256(result.processingText));
  });

  it("preserves bidi controls, BOM characters, and noncharacters as exact data", () => {
    const source = "\ufeffआरम्भ\u202eपाठ\u202c\ufdd0";
    const result = prepareBrowserScript(source);

    expect(result.rawText).toBe(source);
    expect(Buffer.from(result.rawUtf8).toString("utf8")).toBe(source);
  });

  it.each<[string, string, ScriptIntegrityErrorCode]>([
    ["lone high surrogate", "\ud800", "SCRIPT_CONTAINS_LONE_SURROGATE"],
    ["lone low surrogate", "\udc00", "SCRIPT_CONTAINS_LONE_SURROGATE"],
    ["null", "आरम्भ\u0000अंत", "SCRIPT_CONTAINS_NULL"],
    ["empty", "", "SCRIPT_EMPTY"],
    ["whitespace only", " \r\n\t", "SCRIPT_EMPTY"],
  ])("rejects %s before UTF-8 serialization", (_label, source, code) => {
    expect(() => prepareBrowserScript(source)).toThrowError(
      expect.objectContaining<Partial<ScriptIntegrityError>>({ code }),
    );
  });

  it("screens an adversarial exact-boundary corpus without treating JSON text size as PostgreSQL proof", () => {
    const serializedBytesByLabel = new Map<string, number>();
    for (const [label, source] of exactBoundaryScripts) {
      expect(Buffer.byteLength(source, "utf8"), label).toBe(
        MAX_BROWSER_SCRIPT_UTF8_BYTES,
      );
      const prepared = prepareBrowserScript(source);
      expect(prepared.rawText, label).toBe(source);
      expect(
        Buffer.from(prepared.rawUtf8).equals(Buffer.from(source, "utf8")),
        label,
      ).toBe(true);
      if (label === "alternating normalization reasons") {
        expect(prepared.coordinateMap.s).toEqual([
          [4, 0, MAX_BROWSER_SCRIPT_UTF8_BYTES, 0, MAX_BROWSER_SCRIPT_UTF8_BYTES],
        ]);
      }
      serializedBytesByLabel.set(
        label,
        serializedCoordinateMapBytes(prepared.coordinateMap),
      );
    }

    expect(serializedBytesByLabel.get("line-ending-heavy ASCII")).toBeGreaterThan(
      serializedBytesByLabel.get("identity ASCII")!,
    );
    const largestLocalJsonMap = Math.max(...serializedBytesByLabel.values());
    expect(largestLocalJsonMap).toBeLessThanOrEqual(
      MAX_LOCAL_COORDINATE_MAP_JSON_BYTES,
    );
    expect(largestLocalJsonMap).toBeLessThanOrEqual(MAX_SCRIPT_COORDINATE_MAP_BYTES);
  });

  it("rejects the exact first byte above the browser limit without trimming it", () => {
    const source = "a".repeat(MAX_BROWSER_SCRIPT_UTF8_BYTES + 1);
    expect(Buffer.byteLength(source, "utf8")).toBe(MAX_BROWSER_SCRIPT_UTF8_BYTES + 1);
    expect(() => prepareBrowserScript(source)).toThrowError(
      expect.objectContaining<Partial<ScriptIntegrityError>>({
        code: "SCRIPT_TOO_LARGE",
      }),
    );
  });
});

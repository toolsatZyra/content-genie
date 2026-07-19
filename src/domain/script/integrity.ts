import { createHash } from "node:crypto";
import { graphemeSegments } from "unicode-segmenter/grapheme";

import { MAX_BROWSER_SCRIPT_UTF8_BYTES } from "./limits";

export const SCRIPT_PROCESSING_PROFILE = "genie-script-processing.v1";
export const SCRIPT_RANGE_CONVENTION = "zero-based-half-open";
export const SCRIPT_COORDINATE_MAP_VERSION = 2 as const;
export const SCRIPT_GRAPHEME_PROFILE =
  "unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47";
export const SCRIPT_GRAPHEME_UNICODE_VERSION = "17.0.0";
export const SCRIPT_GRAPHEME_PROBE_SHA256 =
  "472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096";

export type ScriptIntegrityErrorCode =
  | "SCRIPT_CONTAINS_LONE_SURROGATE"
  | "SCRIPT_CONTAINS_NULL"
  | "SCRIPT_EMPTY"
  | "SCRIPT_TOO_LARGE";

export class ScriptIntegrityError extends Error {
  override readonly name = "ScriptIntegrityError";

  constructor(
    readonly code: ScriptIntegrityErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface CoordinateRange {
  readonly byteEnd: number;
  readonly byteStart: number;
  readonly graphemeEnd: number;
  readonly graphemeStart: number;
  readonly scalarEnd: number;
  readonly scalarStart: number;
  readonly utf16End: number;
  readonly utf16Start: number;
}

export type ProcessingReason =
  "identity" | "line-ending" | "nfc" | "line-ending+nfc" | "global-normalization";

export type ProcessingReasonCode = 0 | 1 | 2 | 3 | 4;

/**
 * Compact positional index used in the persisted v2 envelope:
 * [scalar-to-UTF-16 offsets, scalar-to-UTF-8 offsets, grapheme scalar ends].
 */
export type TextCoordinateIndex = readonly [
  scalarToUtf16: readonly number[],
  scalarToUtf8: readonly number[],
  graphemeScalarEnds: readonly number[],
];

/**
 * [reason code, raw grapheme start/end, processing grapheme start/end].
 * All ranges are zero-based and half-open. Other coordinate dimensions are
 * derived from the rigorously verified indexes instead of being repeated.
 */
export type ProcessingMapSegment = readonly [
  reason: ProcessingReasonCode,
  rawGraphemeStart: number,
  rawGraphemeEnd: number,
  processingGraphemeStart: number,
  processingGraphemeEnd: number,
];

export interface ScriptCoordinateMap {
  readonly c: typeof SCRIPT_RANGE_CONVENTION;
  readonly p: TextCoordinateIndex;
  readonly r: TextCoordinateIndex;
  readonly s: readonly ProcessingMapSegment[];
  readonly v: typeof SCRIPT_COORDINATE_MAP_VERSION;
}

export interface ScriptRuntimeEvidence {
  readonly graphemeProbeSha256: string;
  readonly graphemeSegmenterProfile: string;
  readonly icuVersion: string;
  readonly nodeVersion: string;
  readonly unicodeVersion: string;
}

export interface PreparedBrowserScript {
  readonly coordinateMap: ScriptCoordinateMap;
  readonly processingProfile: typeof SCRIPT_PROCESSING_PROFILE;
  readonly processingText: string;
  readonly processingUtf8Sha256: string;
  readonly rawText: string;
  readonly rawUtf8: Uint8Array;
  readonly rawUtf8Sha256: string;
  readonly runtimeEvidence: ScriptRuntimeEvidence;
}

interface MutableCoordinateIndex {
  readonly graphemeBoundary: Map<number, number>;
  readonly result: TextCoordinateIndex;
  readonly utf16ToByte: Map<number, number>;
  readonly utf16ToScalar: Map<number, number>;
}

interface RawNormalizationPart {
  readonly processingText: string;
  readonly rawUtf16End: number;
  readonly rawUtf16Start: number;
  readonly reason: ProcessingReason;
}

const utf8 = new TextEncoder();
const MAX_DETAILED_MAPPING_SEGMENTS = 256;
const processingReasonCodes = {
  "global-normalization": 4,
  identity: 0,
  "line-ending": 1,
  "line-ending+nfc": 3,
  nfc: 2,
} as const satisfies Record<ProcessingReason, ProcessingReasonCode>;
const graphemeProbe = "क्\u200Dष|e\u0301|👩🏽‍🚀|🇮🇳|\r\n|क्षि";

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function graphemeProbeSha256(): string {
  const segments = [...graphemeSegments(graphemeProbe)].map(
    ({ index, segment }) => `${index}:${segment}`,
  );
  return digest(utf8.encode(JSON.stringify(segments)));
}

function assertPinnedGraphemeImplementation(): void {
  if (graphemeProbeSha256() !== SCRIPT_GRAPHEME_PROBE_SHA256) {
    throw new Error("Pinned Unicode grapheme implementation failed its startup probe.");
  }
}

function assertWellFormedBrowserText(text: string): void {
  if (text.length === 0) {
    throw new ScriptIntegrityError("SCRIPT_EMPTY", "The script cannot be empty.");
  }
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit === 0) {
      throw new ScriptIntegrityError(
        "SCRIPT_CONTAINS_NULL",
        "The script contains U+0000, which cannot be stored losslessly.",
      );
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ScriptIntegrityError(
          "SCRIPT_CONTAINS_LONE_SURROGATE",
          "The script contains an unpaired UTF-16 high surrogate.",
        );
      }
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new ScriptIntegrityError(
        "SCRIPT_CONTAINS_LONE_SURROGATE",
        "The script contains an unpaired UTF-16 low surrogate.",
      );
    }
  }
}

function coordinateIndex(text: string): MutableCoordinateIndex {
  const scalarToUtf16 = [0];
  const scalarToUtf8 = [0];
  const utf16ToScalar = new Map<number, number>([[0, 0]]);
  const utf16ToByte = new Map<number, number>([[0, 0]]);
  let byteOffset = 0;
  let scalarOffset = 0;
  let utf16Offset = 0;

  for (const scalar of text) {
    byteOffset += utf8.encode(scalar).byteLength;
    scalarOffset += 1;
    utf16Offset += scalar.length;
    scalarToUtf16.push(utf16Offset);
    scalarToUtf8.push(byteOffset);
    utf16ToScalar.set(utf16Offset, scalarOffset);
    utf16ToByte.set(utf16Offset, byteOffset);
  }

  const segmented = [...graphemeSegments(text)];
  const graphemeBoundary = new Map<number, number>([[0, 0]]);
  const graphemeScalarEnds = segmented.map(({ index, segment }, graphemeOffset) => {
    const end = index + segment.length;
    const scalarStart = utf16ToScalar.get(index);
    const scalarEnd = utf16ToScalar.get(end);
    const byteStart = utf16ToByte.get(index);
    const byteEnd = utf16ToByte.get(end);
    if (
      scalarStart === undefined ||
      scalarEnd === undefined ||
      byteStart === undefined ||
      byteEnd === undefined
    ) {
      throw new Error("Pinned grapheme segmenter returned a non-scalar boundary.");
    }
    graphemeBoundary.set(end, graphemeOffset + 1);
    return scalarEnd;
  });

  return {
    graphemeBoundary,
    result: [scalarToUtf16, scalarToUtf8, graphemeScalarEnds],
    utf16ToByte,
    utf16ToScalar,
  };
}

function rangeAt(
  index: MutableCoordinateIndex,
  utf16Start: number,
  utf16End: number,
): CoordinateRange | null {
  const byteStart = index.utf16ToByte.get(utf16Start);
  const byteEnd = index.utf16ToByte.get(utf16End);
  const scalarStart = index.utf16ToScalar.get(utf16Start);
  const scalarEnd = index.utf16ToScalar.get(utf16End);
  const graphemeStart = index.graphemeBoundary.get(utf16Start);
  const graphemeEnd = index.graphemeBoundary.get(utf16End);
  if (
    byteStart === undefined ||
    byteEnd === undefined ||
    scalarStart === undefined ||
    scalarEnd === undefined ||
    graphemeStart === undefined ||
    graphemeEnd === undefined
  ) {
    return null;
  }
  return {
    byteEnd,
    byteStart,
    graphemeEnd,
    graphemeStart,
    scalarEnd,
    scalarStart,
    utf16End,
    utf16Start,
  };
}

function normalizationReason(raw: string, lineNormalized: string): ProcessingReason {
  const lineChanged = raw !== lineNormalized;
  const nfcChanged = lineNormalized !== lineNormalized.normalize("NFC");
  if (lineChanged && nfcChanged) return "line-ending+nfc";
  if (lineChanged) return "line-ending";
  if (nfcChanged) return "nfc";
  return "identity";
}

function normalizeByGrapheme(text: string): readonly RawNormalizationPart[] {
  return [...graphemeSegments(text)].map(({ index, segment }) => {
    const lineNormalized = segment.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    return {
      processingText: lineNormalized.normalize("NFC"),
      rawUtf16End: index + segment.length,
      rawUtf16Start: index,
      reason: normalizationReason(segment, lineNormalized),
    };
  });
}

function wholeRange(index: MutableCoordinateIndex, text: string): CoordinateRange {
  const range = rangeAt(index, 0, text.length);
  if (!range) throw new Error("Unable to construct the whole-text coordinate range.");
  return range;
}

function compactSegment(
  reason: ProcessingReason,
  raw: CoordinateRange,
  processing: CoordinateRange,
): ProcessingMapSegment {
  return [
    processingReasonCodes[reason],
    raw.graphemeStart,
    raw.graphemeEnd,
    processing.graphemeStart,
    processing.graphemeEnd,
  ];
}

function appendCompactSegment(
  segments: ProcessingMapSegment[],
  segment: ProcessingMapSegment,
): void {
  const previous = segments.at(-1);
  if (
    previous &&
    previous[0] === segment[0] &&
    previous[2] === segment[1] &&
    previous[4] === segment[3]
  ) {
    segments[segments.length - 1] = [
      previous[0],
      previous[1],
      segment[2],
      previous[3],
      segment[4],
    ];
    return;
  }
  segments.push(segment);
}

function globalCoordinateMap(
  rawIndex: MutableCoordinateIndex,
  processingIndex: MutableCoordinateIndex,
  rawText: string,
  processingText: string,
): ScriptCoordinateMap {
  return {
    c: SCRIPT_RANGE_CONVENTION,
    p: processingIndex.result,
    r: rawIndex.result,
    s: [
      compactSegment(
        "global-normalization",
        wholeRange(rawIndex, rawText),
        wholeRange(processingIndex, processingText),
      ),
    ],
    v: SCRIPT_COORDINATE_MAP_VERSION,
  };
}

function buildCoordinateMap(
  rawText: string,
  processingText: string,
): ScriptCoordinateMap {
  const rawIndex = coordinateIndex(rawText);
  const processingIndex = coordinateIndex(processingText);
  const parts = normalizeByGrapheme(rawText);
  const joined = parts.map(({ processingText: part }) => part).join("");

  if (joined !== processingText) {
    return globalCoordinateMap(rawIndex, processingIndex, rawText, processingText);
  }

  const mapped: ProcessingMapSegment[] = [];
  let processingUtf16Start = 0;
  for (const part of parts) {
    const processingUtf16End = processingUtf16Start + part.processingText.length;
    const raw = rangeAt(rawIndex, part.rawUtf16Start, part.rawUtf16End);
    const processing = rangeAt(
      processingIndex,
      processingUtf16Start,
      processingUtf16End,
    );
    if (!raw || !processing) {
      return globalCoordinateMap(rawIndex, processingIndex, rawText, processingText);
    }
    appendCompactSegment(mapped, compactSegment(part.reason, raw, processing));
    if (mapped.length > MAX_DETAILED_MAPPING_SEGMENTS) {
      return globalCoordinateMap(rawIndex, processingIndex, rawText, processingText);
    }
    processingUtf16Start = processingUtf16End;
  }

  return {
    c: SCRIPT_RANGE_CONVENTION,
    p: processingIndex.result,
    r: rawIndex.result,
    s: mapped,
    v: SCRIPT_COORDINATE_MAP_VERSION,
  };
}

export function prepareBrowserScript(rawText: string): PreparedBrowserScript {
  assertPinnedGraphemeImplementation();
  assertWellFormedBrowserText(rawText);
  if (rawText.trim().length === 0) {
    throw new ScriptIntegrityError(
      "SCRIPT_EMPTY",
      "The script must contain at least one non-whitespace character.",
    );
  }
  const rawUtf8 = utf8.encode(rawText);
  if (rawUtf8.byteLength > MAX_BROWSER_SCRIPT_UTF8_BYTES) {
    throw new ScriptIntegrityError(
      "SCRIPT_TOO_LARGE",
      `The script exceeds ${MAX_BROWSER_SCRIPT_UTF8_BYTES} UTF-8 bytes.`,
    );
  }
  const processingText = rawText
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC");

  return {
    coordinateMap: buildCoordinateMap(rawText, processingText),
    processingProfile: SCRIPT_PROCESSING_PROFILE,
    processingText,
    processingUtf8Sha256: digest(utf8.encode(processingText)),
    rawText,
    rawUtf8,
    rawUtf8Sha256: digest(rawUtf8),
    runtimeEvidence: {
      graphemeProbeSha256: SCRIPT_GRAPHEME_PROBE_SHA256,
      graphemeSegmenterProfile: SCRIPT_GRAPHEME_PROFILE,
      icuVersion: process.versions.icu ?? "unknown",
      nodeVersion: process.versions.node,
      unicodeVersion: SCRIPT_GRAPHEME_UNICODE_VERSION,
    },
  };
}

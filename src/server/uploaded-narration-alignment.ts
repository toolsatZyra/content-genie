import "server-only";

import { createHash } from "node:crypto";

import { compareNarrationTranscript } from "@/server/narration-audio-qc";
import type { SpeechAlignment } from "@/server/provider-adapters";

const MINIMUM_DURATION_SECONDS = 60;
const MAXIMUM_DURATION_SECONDS = 120;
const MAXIMUM_SCRIPT_BYTES = 8_192;
const MAXIMUM_SCALARS = 8_192;
const MAXIMUM_WORDS = 4_096;
const MAXIMUM_WORD_BYTES = 512;
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAXIMUM_AUDIO_BYTES = 25 * 1024 * 1024;
const audibleScalarPattern = /[\p{L}\p{M}\p{N}]/u;

export type WhisperTimestampedWord = Readonly<{
  end: number;
  start: number;
  word: string;
}>;

export type WhisperVerboseJson = Readonly<{
  duration: number;
  language: "hi";
  text: string;
  words: readonly WhisperTimestampedWord[];
}>;

export type UploadedNarrationAlignment = Readonly<{
  alignmentSha256: string;
  authoritativeText: string;
  durationSeconds: number;
  evidenceSha256: string;
  language: "hi";
  providerResponseSha256: string;
  speechAlignment: SpeechAlignment;
  transcriptSha256: string;
  wordCount: number;
}>;

export type UploadedNarrationScriptAdvisory = Readonly<{
  editDistance: number;
  exactMatch: boolean;
  lengthRatio: number;
  normalizedOriginalScriptSha256: string;
  normalizedTranscriptSha256: string;
  originalScriptSha256: string;
  requiresConfirmation: boolean;
  similarity: number;
  transcriptSha256: string;
}>;

export class UploadedNarrationAlignmentError extends Error {
  override readonly name = "UploadedNarrationAlignmentError";

  constructor(
    message: string,
    readonly safeClass = "uploaded_narration.invalid_alignment",
  ) {
    super(message);
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function finiteNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new UploadedNarrationAlignmentError(`${field} is invalid.`);
  }
  return value;
}

function normalizedAudibleScalars(value: string): readonly string[] {
  return Object.freeze(
    Array.from(value.normalize("NFKC").toLocaleLowerCase("hi")).filter((scalar) =>
      audibleScalarPattern.test(scalar),
    ),
  );
}

function canonicalWhisperEvidence(value: WhisperVerboseJson): string {
  return JSON.stringify({
    duration: value.duration,
    language: value.language,
    text: value.text,
    words: value.words.map(({ end, start, word }) => ({ end, start, word })),
  });
}

function canonicalAlignment(alignment: SpeechAlignment): string {
  return JSON.stringify({
    characterEndTimesSeconds: alignment.characterEndTimesSeconds,
    characters: alignment.characters,
    characterStartTimesSeconds: alignment.characterStartTimesSeconds,
  });
}

export function parseWhisperVerboseJson(value: unknown): WhisperVerboseJson {
  if (!exactObject(value, ["duration", "language", "text", "words"])) {
    throw new UploadedNarrationAlignmentError(
      "The uploaded narration transcription response is malformed.",
    );
  }
  const record = value as Record<string, unknown>;
  const duration = finiteNumber(
    record.duration,
    "duration",
    MINIMUM_DURATION_SECONDS,
    MAXIMUM_DURATION_SECONDS,
  );
  if (typeof record.text !== "string") {
    throw new UploadedNarrationAlignmentError("text is invalid.");
  }
  const text = record.text.trim().normalize("NFC");
  const characters = Array.from(text);
  if (
    text.length < 1 ||
    utf8Length(text) > MAXIMUM_SCRIPT_BYTES ||
    characters.length > MAXIMUM_SCALARS ||
    normalizedAudibleScalars(text).length < 1
  ) {
    throw new UploadedNarrationAlignmentError("text is outside its bounds.");
  }
  const normalizedLanguage =
    typeof record.language === "string"
      ? record.language.trim().toLocaleLowerCase("en")
      : "";
  if (normalizedLanguage !== "hi" && normalizedLanguage !== "hindi") {
    throw new UploadedNarrationAlignmentError("language is not Hindi.");
  }
  if (
    !Array.isArray(record.words) ||
    record.words.length < 1 ||
    record.words.length > MAXIMUM_WORDS
  ) {
    throw new UploadedNarrationAlignmentError("words are outside their bounds.");
  }

  let previousEnd = 0;
  const words = record.words.map((candidate, index): WhisperTimestampedWord => {
    if (!exactObject(candidate, ["end", "start", "word"])) {
      throw new UploadedNarrationAlignmentError(`words[${index}] is malformed.`);
    }
    const wordRecord = candidate as Record<string, unknown>;
    if (
      typeof wordRecord.word !== "string" ||
      wordRecord.word.trim().length < 1 ||
      utf8Length(wordRecord.word) > MAXIMUM_WORD_BYTES ||
      normalizedAudibleScalars(wordRecord.word).length < 1
    ) {
      throw new UploadedNarrationAlignmentError(`words[${index}].word is invalid.`);
    }
    const start = finiteNumber(wordRecord.start, `words[${index}].start`, 0, duration);
    const end = finiteNumber(wordRecord.end, `words[${index}].end`, 0, duration);
    if (end <= start || start < previousEnd) {
      throw new UploadedNarrationAlignmentError(
        `words[${index}] timestamps are not positive and monotonic.`,
      );
    }
    previousEnd = end;
    return Object.freeze({ end, start, word: wordRecord.word });
  });

  return Object.freeze({
    duration,
    language: "hi" as const,
    text,
    words: Object.freeze(words),
  });
}

function compileSpeechAlignment(parsed: WhisperVerboseJson): SpeechAlignment {
  const characters = Array.from(parsed.text);
  const transcriptAudible = normalizedAudibleScalars(parsed.text);
  const timedAudible: Array<Readonly<{ end: number; scalar: string; start: number }>> =
    [];

  for (const word of parsed.words) {
    const audible = normalizedAudibleScalars(word.word);
    const step = (word.end - word.start) / audible.length;
    for (let index = 0; index < audible.length; index += 1) {
      timedAudible.push(
        Object.freeze({
          end:
            index === audible.length - 1 ? word.end : word.start + step * (index + 1),
          scalar: audible[index]!,
          start: index === 0 ? word.start : word.start + step * index,
        }),
      );
    }
  }
  if (
    timedAudible.length !== transcriptAudible.length ||
    timedAudible.some((timed, index) => timed.scalar !== transcriptAudible[index])
  ) {
    throw new UploadedNarrationAlignmentError(
      "Word timestamps do not reproduce the authoritative transcription.",
      "uploaded_narration.timestamp_text_mismatch",
    );
  }

  const starts: number[] = [];
  const ends: number[] = [];
  let audibleIndex = 0;
  let previousBoundary = timedAudible[0]!.start;
  for (const character of characters) {
    const normalizedCharacter = normalizedAudibleScalars(character);
    if (normalizedCharacter.length === 0) {
      starts.push(previousBoundary);
      ends.push(previousBoundary);
      continue;
    }
    const first = timedAudible[audibleIndex];
    const last = timedAudible[audibleIndex + normalizedCharacter.length - 1];
    if (!first || !last) {
      throw new UploadedNarrationAlignmentError(
        "The timestamp map ended before the authoritative transcription.",
      );
    }
    const expected = normalizedCharacter.join("");
    const actual = timedAudible
      .slice(audibleIndex, audibleIndex + normalizedCharacter.length)
      .map(({ scalar }) => scalar)
      .join("");
    if (
      expected !== actual ||
      first.start < previousBoundary ||
      last.end <= first.start
    ) {
      throw new UploadedNarrationAlignmentError(
        "A spoken transcription scalar has an invalid timestamp window.",
      );
    }
    starts.push(first.start);
    ends.push(last.end);
    previousBoundary = last.end;
    audibleIndex += normalizedCharacter.length;
  }
  if (audibleIndex !== timedAudible.length) {
    throw new UploadedNarrationAlignmentError(
      "The timestamp map exceeds the authoritative transcription.",
    );
  }

  return Object.freeze({
    characterEndTimesSeconds: Object.freeze(ends),
    characters: Object.freeze(characters),
    characterStartTimesSeconds: Object.freeze(starts),
  });
}

export function compileUploadedNarrationAlignment(
  value: unknown,
): UploadedNarrationAlignment {
  const parsed = parseWhisperVerboseJson(value);
  const speechAlignment = compileSpeechAlignment(parsed);
  const providerResponseSha256 = sha256(canonicalWhisperEvidence(parsed));
  const alignmentSha256 = sha256(canonicalAlignment(speechAlignment));
  const transcriptSha256 = sha256(parsed.text);
  const evidenceSha256 = sha256(
    JSON.stringify({
      alignmentSha256,
      durationSeconds: parsed.duration,
      language: parsed.language,
      providerResponseSha256,
      transcriptSha256,
      wordCount: parsed.words.length,
    }),
  );
  return Object.freeze({
    alignmentSha256,
    authoritativeText: parsed.text,
    durationSeconds: parsed.duration,
    evidenceSha256,
    language: parsed.language,
    providerResponseSha256,
    speechAlignment,
    transcriptSha256,
    wordCount: parsed.words.length,
  });
}

export function compareUploadedNarrationToOriginalScript(
  originalScript: string,
  authoritativeTranscript: string,
): UploadedNarrationScriptAdvisory {
  if (
    typeof originalScript !== "string" ||
    originalScript.length < 1 ||
    utf8Length(originalScript) > MAXIMUM_SCRIPT_BYTES
  ) {
    throw new UploadedNarrationAlignmentError("The original script is invalid.");
  }
  const transcript = authoritativeTranscript.trim().normalize("NFC");
  if (transcript.length < 1 || utf8Length(transcript) > MAXIMUM_SCRIPT_BYTES) {
    throw new UploadedNarrationAlignmentError(
      "The authoritative transcription is invalid.",
    );
  }
  const comparison = compareNarrationTranscript(originalScript, transcript);
  const originalScriptSha256 = sha256(originalScript);
  const transcriptSha256 = sha256(transcript);
  const exactMatch = originalScriptSha256 === transcriptSha256;
  return Object.freeze({
    editDistance: comparison.editDistance,
    exactMatch,
    lengthRatio: comparison.lengthRatio,
    normalizedOriginalScriptSha256: comparison.normalizedExpectedSha256,
    normalizedTranscriptSha256: comparison.normalizedTranscriptSha256,
    originalScriptSha256,
    requiresConfirmation: !exactMatch,
    similarity: comparison.similarity,
    transcriptSha256,
  });
}

function validateSanitizedMp3(bytes: Buffer): void {
  const frameHeader =
    bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
  const id3Header =
    bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3";
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 64 ||
    bytes.length > MAXIMUM_AUDIO_BYTES ||
    (!frameHeader && !id3Header)
  ) {
    throw new UploadedNarrationAlignmentError(
      "The sanitized uploaded narration is not a bounded MP3.",
      "uploaded_narration.invalid_audio",
    );
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (
      !Number.isSafeInteger(length) ||
      length < 1 ||
      length > MAXIMUM_RESPONSE_BYTES
    ) {
      throw new UploadedNarrationAlignmentError(
        "The transcription response length is invalid.",
      );
    }
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length < 1 ||
    bytes.length > MAXIMUM_RESPONSE_BYTES ||
    (declared !== null && bytes.length !== Number(declared))
  ) {
    throw new UploadedNarrationAlignmentError(
      "The transcription response is outside its byte contract.",
    );
  }
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new UploadedNarrationAlignmentError(
      "The transcription response is not valid JSON.",
    );
  }
}

export async function transcribeSanitizedUploadedNarrationMp3(
  sanitizedMp3Bytes: Buffer,
  options: Readonly<{
    apiKey?: string;
    fetchImplementation?: typeof fetch;
  }> = {},
): Promise<UploadedNarrationAlignment> {
  validateSanitizedMp3(sanitizedMp3Bytes);
  const apiKey = (options.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
  if (apiKey.length < 20) {
    throw new UploadedNarrationAlignmentError(
      "Uploaded narration transcription is unavailable.",
      "uploaded_narration.provider_unavailable",
    );
  }
  const form = new FormData();
  form.set(
    "file",
    new Blob([Uint8Array.from(sanitizedMp3Bytes)], { type: "audio/mpeg" }),
    "uploaded-narration.mp3",
  );
  form.set("model", "whisper-1");
  form.set("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.set("language", "hi");
  const response = await (options.fetchImplementation ?? fetch)(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      body: form,
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(180_000),
    },
  );
  if (!response.ok) {
    throw new UploadedNarrationAlignmentError(
      `Uploaded narration transcription failed with ${response.status}.`,
      "uploaded_narration.provider_rejected",
    );
  }
  return compileUploadedNarrationAlignment(await readBoundedJson(response));
}

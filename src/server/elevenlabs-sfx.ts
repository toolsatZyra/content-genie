import "server-only";

import { createHash } from "node:crypto";

import { postgresJsonbText } from "@/server/world-anchor-provider";

export const ELEVENLABS_SFX_MODEL_ID = "eleven_text_to_sound_v2";
export const ELEVENLABS_SFX_OUTPUT_FORMAT = "mp3_44100_128";
export const ELEVENLABS_SFX_PROMPT_INFLUENCE = 0.3;
export const ELEVENLABS_SFX_MAX_PROMPT_CHARACTERS = 450;
export const ELEVENLABS_SFX_MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const ELEVENLABS_SFX_ENDPOINT =
  "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128";

const minimumDurationSeconds = 0.5;
const maximumDurationSeconds = 30;
const minimumAudioBytes = 64;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const unsafeAcousticDescription =
  /\b(?:chant(?:ing)?|dialogue|lyrics?|mantra|music|narrat(?:ion|or)|sing(?:er|ing)?|song|speech|spoken|vocal|voice)\b/iu;
const multiEffectSequence =
  /(?:\b(?:and\s+then|after\s+that|followed\s+by|subsequently|then)\b|(?:->|→))/iu;
const narrationSafetySuffix =
  "Clean cinematic one-shot Foley/SFX only. No speech, dialogue, narration, chant, mantra, lyrics, singing, vocals, or music.";

export type ElevenLabsSfxCueInput =
  | Readonly<{
      acousticDescription: string;
      durationMs: number;
      kind: "effect";
      shotNumber: number;
      targetAssetId: string;
    }>
  | Readonly<{
      kind: "deliberate_silence";
      shotNumber: number;
      targetAssetId: string;
    }>;

export type ElevenLabsSfxRequestBody = Readonly<{
  duration_seconds: number;
  loop: false;
  model_id: typeof ELEVENLABS_SFX_MODEL_ID;
  prompt_influence: typeof ELEVENLABS_SFX_PROMPT_INFLUENCE;
  text: string;
}>;

export type CompiledElevenLabsSfx =
  | Readonly<{
      inputSha256: string;
      kind: "silence";
      shotNumber: number;
      targetAssetId: string;
    }>
  | Readonly<{
      body: ElevenLabsSfxRequestBody;
      durationMs: number;
      endpoint: typeof ELEVENLABS_SFX_ENDPOINT;
      inputSha256: string;
      kind: "request";
      method: "POST";
      outputFormat: typeof ELEVENLABS_SFX_OUTPUT_FORMAT;
      payloadSha256: string;
      promptSha256: string;
      requestSha256: string;
      shotNumber: number;
      targetAssetId: string;
    }>;

export type ValidatedElevenLabsSfxResponse = Readonly<{
  audioSha256: string;
  byteLength: number;
  bytes: Buffer;
  characterCost: number | null;
  contentType: "audio/mpeg";
  durationMs: number;
  responseSha256: string;
}>;

export class ElevenLabsSfxError extends Error {
  override readonly name = "ElevenLabsSfxError";
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new ElevenLabsSfxError("SFX evidence contains an unsupported value.");
  }
  return serialized;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ElevenLabsSfxError(`${label} must be a positive integer.`);
  }
  return value as number;
}

function targetAssetId(value: unknown): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ElevenLabsSfxError("The SFX target asset is invalid.");
  }
  return value.toLowerCase();
}

function normalizedDescription(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new ElevenLabsSfxError("The acoustic description is invalid.");
  }
  const description = value.trim().replace(/\s+/gu, " ");
  if (
    description.length < 1 ||
    unsafeAcousticDescription.test(description) ||
    multiEffectSequence.test(description)
  ) {
    throw new ElevenLabsSfxError(
      "The acoustic description must contain one narration-safe effect.",
    );
  }
  const prompt = `${description} ${narrationSafetySuffix}`;
  if (Array.from(prompt).length > ELEVENLABS_SFX_MAX_PROMPT_CHARACTERS) {
    throw new ElevenLabsSfxError("The compiled SFX prompt is too long.");
  }
  return prompt;
}

function clampedDurationMilliseconds(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ElevenLabsSfxError("The SFX duration is invalid.");
  }
  const seconds = Math.min(
    maximumDurationSeconds,
    Math.max(minimumDurationSeconds, (value as number) / 1_000),
  );
  return Math.round(seconds * 1_000);
}

export function compileElevenLabsSfx(
  input: ElevenLabsSfxCueInput,
): CompiledElevenLabsSfx {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ElevenLabsSfxError("The SFX cue input is invalid.");
  }
  const record = input as unknown as Record<string, unknown>;
  if (record.kind === "deliberate_silence") {
    if (!exactObject(record, ["kind", "shotNumber", "targetAssetId"])) {
      throw new ElevenLabsSfxError("The deliberate-silence cue is not exact.");
    }
    const normalized = Object.freeze({
      kind: "deliberate_silence" as const,
      shotNumber: positiveInteger(record.shotNumber, "The shot number"),
      targetAssetId: targetAssetId(record.targetAssetId),
    });
    return Object.freeze({
      inputSha256: sha256(stableJson(normalized)),
      kind: "silence" as const,
      shotNumber: normalized.shotNumber,
      targetAssetId: normalized.targetAssetId,
    });
  }
  if (
    record.kind !== "effect" ||
    !exactObject(record, [
      "acousticDescription",
      "durationMs",
      "kind",
      "shotNumber",
      "targetAssetId",
    ])
  ) {
    throw new ElevenLabsSfxError("The generated-effect cue is not exact.");
  }
  const prompt = normalizedDescription(record.acousticDescription);
  const durationMs = clampedDurationMilliseconds(record.durationMs);
  const shotNumber = positiveInteger(record.shotNumber, "The shot number");
  const assetId = targetAssetId(record.targetAssetId);
  const normalizedInput = Object.freeze({
    acousticDescription: prompt.slice(0, -(narrationSafetySuffix.length + 1)),
    durationMs,
    kind: "effect" as const,
    shotNumber,
    targetAssetId: assetId,
  });
  const body = Object.freeze({
    duration_seconds: durationMs / 1_000,
    loop: false as const,
    model_id: ELEVENLABS_SFX_MODEL_ID,
    prompt_influence: ELEVENLABS_SFX_PROMPT_INFLUENCE,
    text: prompt,
  });
  const payloadSha256 = sha256(postgresJsonbText(body));
  return Object.freeze({
    body,
    durationMs,
    endpoint: ELEVENLABS_SFX_ENDPOINT,
    inputSha256: sha256(stableJson(normalizedInput)),
    kind: "request" as const,
    method: "POST" as const,
    outputFormat: ELEVENLABS_SFX_OUTPUT_FORMAT,
    payloadSha256,
    promptSha256: sha256(prompt),
    requestSha256: sha256(
      stableJson({
        endpoint: ELEVENLABS_SFX_ENDPOINT,
        method: "POST",
        payloadSha256,
      }),
    ),
    shotNumber,
    targetAssetId: assetId,
  });
}

function synchsafeInteger(bytes: Buffer, offset: number): number {
  const values = [
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  ];
  if (values.some((value) => value === undefined || ((value as number) & 0x80) !== 0)) {
    throw new ElevenLabsSfxError("The ElevenLabs MP3 ID3 header is malformed.");
  }
  return values.reduce<number>((size, value) => (size << 7) | (value as number), 0);
}

function mp3FrameOffset(bytes: Buffer): number {
  if (bytes.subarray(0, 3).toString("ascii") !== "ID3") return 0;
  if (
    bytes.length < 14 ||
    bytes[3] === 0xff ||
    bytes[4] === 0xff ||
    (bytes[5]! & 0x0f) !== 0
  ) {
    throw new ElevenLabsSfxError("The ElevenLabs MP3 ID3 header is malformed.");
  }
  const offset = 10 + synchsafeInteger(bytes, 6);
  if (offset + 4 > bytes.length) {
    throw new ElevenLabsSfxError("The ElevenLabs MP3 has no audio frame.");
  }
  return offset;
}

function assertMp3(bytes: Buffer): void {
  const offset = mp3FrameOffset(bytes);
  const first = bytes[offset]!;
  const second = bytes[offset + 1]!;
  const third = bytes[offset + 2]!;
  const version = (second >> 3) & 0x03;
  const layer = (second >> 1) & 0x03;
  const bitrate = (third >> 4) & 0x0f;
  const sampleRate = (third >> 2) & 0x03;
  if (
    first !== 0xff ||
    (second & 0xe0) !== 0xe0 ||
    version === 0x01 ||
    layer === 0 ||
    bitrate === 0 ||
    bitrate === 0x0f ||
    sampleRate === 0x03
  ) {
    throw new ElevenLabsSfxError("The ElevenLabs response is not a valid MP3.");
  }
}

function measuredMp3DurationMs(bytes: Buffer): number {
  let offset = mp3FrameOffset(bytes);
  let samples = 0;
  let sampleRate: number | null = null;
  let frames = 0;
  const mpeg1Layer3Bitrates = [
    0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
  ];
  const mpeg2Layer3Bitrates = [
    0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
  ];
  while (offset + 4 <= bytes.length) {
    const first = bytes[offset]!;
    const second = bytes[offset + 1]!;
    const third = bytes[offset + 2]!;
    if (first !== 0xff || (second & 0xe0) !== 0xe0) break;
    const versionBits = (second >> 3) & 0x03;
    const layerBits = (second >> 1) & 0x03;
    const bitrateIndex = (third >> 4) & 0x0f;
    const sampleRateIndex = (third >> 2) & 0x03;
    if (
      versionBits === 0x01 ||
      layerBits !== 0x01 ||
      bitrateIndex < 1 ||
      bitrateIndex > 14 ||
      sampleRateIndex === 0x03
    ) {
      break;
    }
    const baseRates = [44_100, 48_000, 32_000];
    const rate =
      baseRates[sampleRateIndex]! /
      (versionBits === 0x03 ? 1 : versionBits === 0x02 ? 2 : 4);
    if (sampleRate !== null && sampleRate !== rate) break;
    sampleRate = rate;
    const bitrateKbps = (
      versionBits === 0x03 ? mpeg1Layer3Bitrates : mpeg2Layer3Bitrates
    )[bitrateIndex]!;
    const padding = (third >> 1) & 0x01;
    const frameLength =
      Math.floor(((versionBits === 0x03 ? 144 : 72) * bitrateKbps * 1_000) / rate) +
      padding;
    if (frameLength < 24 || offset + frameLength > bytes.length) break;
    samples += versionBits === 0x03 ? 1_152 : 576;
    frames += 1;
    offset += frameLength;
  }
  if (frames < 1 || sampleRate === null) {
    throw new ElevenLabsSfxError("The ElevenLabs MP3 duration is invalid.");
  }
  const durationMs = Math.round((samples * 1_000) / sampleRate);
  if (durationMs < 1 || durationMs > 30_500) {
    throw new ElevenLabsSfxError("The ElevenLabs MP3 duration is invalid.");
  }
  return durationMs;
}

function characterCost(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^(?:0|[1-9][0-9]{0,6})$/u.test(normalized)) {
    throw new ElevenLabsSfxError("The ElevenLabs usage header is invalid.");
  }
  return Number(normalized);
}

export function validateElevenLabsSfxResponse(
  input: Readonly<{
    bytes: Uint8Array;
    characterCostHeader: string | null;
    contentType: string | null;
  }>,
): ValidatedElevenLabsSfxResponse {
  if (
    !exactObject(input, ["bytes", "characterCostHeader", "contentType"]) ||
    !(input.bytes instanceof Uint8Array)
  ) {
    throw new ElevenLabsSfxError("The ElevenLabs SFX response is not exact.");
  }
  const declaredContentType = input.contentType?.split(";", 1)[0]?.trim();
  if (declaredContentType !== "audio/mpeg") {
    throw new ElevenLabsSfxError(
      "The ElevenLabs SFX response has an invalid media type.",
    );
  }
  if (
    input.bytes.byteLength < minimumAudioBytes ||
    input.bytes.byteLength > ELEVENLABS_SFX_MAX_AUDIO_BYTES
  ) {
    throw new ElevenLabsSfxError(
      "The ElevenLabs SFX response violates its byte bound.",
    );
  }
  const bytes = Buffer.from(input.bytes);
  assertMp3(bytes);
  const usage = characterCost(input.characterCostHeader);
  const audioSha256 = sha256(bytes);
  const durationMs = measuredMp3DurationMs(bytes);
  return Object.freeze({
    audioSha256,
    byteLength: bytes.length,
    bytes,
    characterCost: usage,
    contentType: "audio/mpeg" as const,
    durationMs,
    responseSha256: sha256(
      stableJson({
        audioSha256,
        byteLength: bytes.length,
        characterCost: usage,
        contentType: "audio/mpeg",
        durationMs,
      }),
    ),
  });
}

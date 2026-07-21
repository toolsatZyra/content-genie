import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ELEVENLABS_SFX_ENDPOINT,
  ELEVENLABS_SFX_MAX_AUDIO_BYTES,
  ELEVENLABS_SFX_MODEL_ID,
  ELEVENLABS_SFX_OUTPUT_FORMAT,
  ELEVENLABS_SFX_PROMPT_INFLUENCE,
  compileElevenLabsSfx,
  validateElevenLabsSfxResponse,
} from "./elevenlabs-sfx";

const targetAssetId = "10000000-0000-4000-8000-000000000001";

function rawMp3(frameCount = 20): Buffer {
  const frameLength = 417;
  const bytes = Buffer.alloc(frameLength * frameCount, 0x55);
  for (let index = 0; index < frameCount; index += 1) {
    bytes.set([0xff, 0xfb, 0x90, 0x00], index * frameLength);
  }
  return bytes;
}

function id3Mp3(): Buffer {
  const frameLength = 417;
  const bytes = Buffer.alloc(10 + frameLength * 20, 0x55);
  bytes.set([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 0);
  for (let index = 0; index < 20; index += 1) {
    bytes.set([0xff, 0xfb, 0x90, 0x00], 10 + index * frameLength);
  }
  return bytes;
}

describe("ElevenLabs sound-effect compiler", () => {
  it("compiles one isolated narration-safe effect into the exact v2 request", () => {
    const compiled = compileElevenLabsSfx({
      acousticDescription:
        "Heavy bowstring release, taut fiber snap and low wooden resonance, medium distance in a vast stone hall, immediate attack with short decay.",
      durationMs: 1_275,
      kind: "effect",
      shotNumber: 7,
      targetAssetId,
    });

    expect(compiled.kind).toBe("request");
    if (compiled.kind !== "request") return;
    expect(compiled).toMatchObject({
      durationMs: 1_275,
      endpoint: ELEVENLABS_SFX_ENDPOINT,
      method: "POST",
      outputFormat: ELEVENLABS_SFX_OUTPUT_FORMAT,
      shotNumber: 7,
      targetAssetId,
    });
    expect(compiled.body).toEqual({
      duration_seconds: 1.275,
      loop: false,
      model_id: ELEVENLABS_SFX_MODEL_ID,
      prompt_influence: ELEVENLABS_SFX_PROMPT_INFLUENCE,
      text: expect.stringMatching(
        /Clean cinematic one-shot Foley\/SFX only\. No speech/u,
      ),
    });
    expect(Array.from(compiled.body.text).length).toBeLessThanOrEqual(450);
    expect(compiled.inputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(compiled.payloadSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(compiled.promptSha256).toBe(
      createHash("sha256").update(compiled.body.text).digest("hex"),
    );
    expect(compiled.requestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      compileElevenLabsSfx({
        acousticDescription:
          "Heavy bowstring release, taut fiber snap and low wooden resonance, medium distance in a vast stone hall, immediate attack with short decay.",
        durationMs: 1_275,
        kind: "effect",
        shotNumber: 7,
        targetAssetId,
      }),
    ).toEqual(compiled);
  });

  it("clamps an explicit duration to the endpoint's 0.5-30 second bounds", () => {
    const short = compileElevenLabsSfx({
      acousticDescription: "A dry cloth flick with a quick, soft decay.",
      durationMs: 100,
      kind: "effect",
      shotNumber: 1,
      targetAssetId,
    });
    const long = compileElevenLabsSfx({
      acousticDescription: "Low distant thunder with a long natural decay.",
      durationMs: 45_000,
      kind: "effect",
      shotNumber: 2,
      targetAssetId,
    });
    expect(short.kind === "request" && short.body.duration_seconds).toBe(0.5);
    expect(short.kind === "request" && short.durationMs).toBe(500);
    expect(long.kind === "request" && long.body.duration_seconds).toBe(30);
    expect(long.kind === "request" && long.durationMs).toBe(30_000);
  });

  it("turns deliberate silence into a deterministic no-request result", () => {
    const compiled = compileElevenLabsSfx({
      kind: "deliberate_silence",
      shotNumber: 3,
      targetAssetId,
    });
    expect(compiled).toEqual({
      inputSha256: compiled.inputSha256,
      kind: "silence",
      shotNumber: 3,
      targetAssetId,
    });
    expect(compiled.inputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect("body" in compiled).toBe(false);
  });

  it("rejects open, sequenced, vocal, malformed, and overlong cue inputs", () => {
    expect(() =>
      compileElevenLabsSfx({
        acousticDescription: "A footstep, then a door slam.",
        durationMs: 1_000,
        kind: "effect",
        shotNumber: 1,
        targetAssetId,
      }),
    ).toThrow(/one narration-safe effect/u);
    expect(() =>
      compileElevenLabsSfx({
        acousticDescription: "A whispered voice in the temple.",
        durationMs: 1_000,
        kind: "effect",
        shotNumber: 1,
        targetAssetId,
      }),
    ).toThrow(/one narration-safe effect/u);
    expect(() =>
      compileElevenLabsSfx({
        acousticDescription: "A".repeat(400),
        durationMs: 1_000,
        kind: "effect",
        shotNumber: 1,
        targetAssetId,
      }),
    ).toThrow(/too long/u);
    expect(() =>
      compileElevenLabsSfx({
        acousticDescription: "A clean wooden knock.",
        durationMs: 0,
        kind: "effect",
        shotNumber: 1,
        targetAssetId,
      }),
    ).toThrow(/duration/u);
    expect(() =>
      compileElevenLabsSfx({
        kind: "deliberate_silence",
        shotNumber: 1,
        targetAssetId,
        unexpected: true,
      } as never),
    ).toThrow(/not exact/u);
  });
});

describe("ElevenLabs sound-effect response validation", () => {
  it("accepts raw and ID3-prefixed MP3 audio and safely parses usage", () => {
    const raw = rawMp3();
    const validated = validateElevenLabsSfxResponse({
      bytes: raw,
      characterCostHeader: "137",
      contentType: "audio/mpeg; charset=binary",
    });
    expect(validated).toMatchObject({
      audioSha256: createHash("sha256").update(raw).digest("hex"),
      byteLength: raw.length,
      characterCost: 137,
      contentType: "audio/mpeg",
      durationMs: 522,
    });
    expect(validated.responseSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(validated.bytes).not.toBe(raw);

    expect(
      validateElevenLabsSfxResponse({
        bytes: id3Mp3(),
        characterCostHeader: null,
        contentType: "audio/mpeg",
      }).characterCost,
    ).toBeNull();
  });

  it("rejects unsafe headers, media declarations, malformed MP3, and byte abuse", () => {
    expect(() =>
      validateElevenLabsSfxResponse({
        bytes: rawMp3(),
        characterCostHeader: "1e3",
        contentType: "audio/mpeg",
      }),
    ).toThrow(/usage header/u);
    expect(() =>
      validateElevenLabsSfxResponse({
        bytes: rawMp3(),
        characterCostHeader: "12",
        contentType: "application/octet-stream",
      }),
    ).toThrow(/media type/u);
    expect(() =>
      validateElevenLabsSfxResponse({
        bytes: Buffer.alloc(128, 0),
        characterCostHeader: null,
        contentType: "audio/mpeg",
      }),
    ).toThrow(/valid MP3/u);
    expect(() =>
      validateElevenLabsSfxResponse({
        bytes: Buffer.alloc(ELEVENLABS_SFX_MAX_AUDIO_BYTES + 1, 0),
        characterCostHeader: null,
        contentType: "audio/mpeg",
      }),
    ).toThrow(/byte bound/u);
    expect(() =>
      validateElevenLabsSfxResponse({
        bytes: rawMp3(),
        characterCostHeader: null,
        contentType: "audio/mpeg",
        extra: true,
      } as never),
    ).toThrow(/not exact/u);
  });
});

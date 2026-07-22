import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { validateExistingNarrationProviderPayload } from "./narration-provider";

const sourceText = "Shiva";
const deliveryText = "SHIVA!";
const targetAssetId = "10000000-0000-4000-8000-000000000002";
const externalVoiceId = "b0oby86k6n7Uh5LZcOBR";
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function persistedPayload() {
  return {
    deliveryMap: [0, 1, 2, 3, 4, null],
    deliveryTextSha256: hash(deliveryText),
    modelId: "eleven_v3",
    outputFormat: "mp3_44100_128",
    sourceText,
    sourceTextSha256: hash(sourceText),
    targetAssetId,
    text: deliveryText,
    voiceId: externalVoiceId,
    voiceSettings: {
      similarityBoost: 0.82,
      stability: 0.5,
      style: 0,
      useSpeakerBoost: true,
    },
  };
}

const expected = { externalVoiceId, sourceText, targetAssetId };

describe("persisted ElevenLabs V3 narration delivery", () => {
  it("reuses only the exact pinned V3 settings", () => {
    expect(
      validateExistingNarrationProviderPayload(persistedPayload(), expected),
    ).toMatchObject({
      modelId: "eleven_v3",
      voiceSettings: {
        similarityBoost: 0.82,
        stability: 0.5,
        style: 0,
        useSpeakerBoost: true,
      },
    });
  });

  it.each([
    ["similarityBoost", 0.8],
    ["stability", 0.49],
    ["style", 0.01],
    ["useSpeakerBoost", false],
  ] as const)("rejects replay when %s drifts", (key, value) => {
    const payload = persistedPayload();
    payload.voiceSettings = { ...payload.voiceSettings, [key]: value };
    expect(() => validateExistingNarrationProviderPayload(payload, expected)).toThrow(
      /conflicts/u,
    );
  });

  it("rejects missing or extra nested voice-setting fields", () => {
    const missing = persistedPayload();
    const withoutStyle = {
      similarityBoost: missing.voiceSettings.similarityBoost,
      stability: missing.voiceSettings.stability,
      useSpeakerBoost: missing.voiceSettings.useSpeakerBoost,
    };
    expect(() =>
      validateExistingNarrationProviderPayload(
        { ...missing, voiceSettings: withoutStyle },
        expected,
      ),
    ).toThrow(/conflicts/u);

    const extra = persistedPayload();
    expect(() =>
      validateExistingNarrationProviderPayload(
        {
          ...extra,
          voiceSettings: { ...extra.voiceSettings, experimentalPacing: true },
        },
        expected,
      ),
    ).toThrow(/conflicts/u);
  });
});

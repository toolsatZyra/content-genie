import { describe, expect, it } from "vitest";

import {
  AudioIdentityPreflightError,
  materializePronunciationEntries,
} from "./audio-identity-preflight";

const sourceId = "11111111-1111-4111-8111-111111111111";
const packetId = "22222222-2222-4222-8222-222222222222";
const hash = "a".repeat(64);

function output(overrides: Record<string, unknown> = {}) {
  return {
    entries: [
      {
        devanagari: "श्री कृष्ण",
        entryKind: "name",
        exactText: "श्री कृष्ण",
        providerMarkup: "shree krish-na",
        sourceRecordVersionId: sourceId,
        synthesisPolicy: "synthetic_allowed",
        transliteration: "śrī kṛṣṇa",
        transliterationScheme: "IAST",
        ...overrides,
      },
    ],
    schemaVersion: "genie.pronunciation-director.v1",
  };
}

describe("audio identity pronunciation materialization", () => {
  it("derives Unicode-scalar positions from the immutable text and pins evidence", () => {
    const entries = materializePronunciationEntries({
      directorOutput: output(),
      modelRequestHash: hash,
      processingText: "🪷 आज श्री कृष्ण ने अर्जुन को बताया।",
      scriptSha256: hash,
      sourceReviewPacketId: packetId,
      sourceVersionIds: [sourceId],
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      endScalar: 15,
      exactText: "श्री कृष्ण",
      humanRecordingAssetVersionId: null,
      startScalar: 5,
      verificationStatus: "verified",
    });
    expect(entries[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects words absent from the locked script and model-proposed source IDs", () => {
    expect(() =>
      materializePronunciationEntries({
        directorOutput: output({ exactText: "शिव" }),
        modelRequestHash: hash,
        processingText: "श्री कृष्ण",
        scriptSha256: hash,
        sourceReviewPacketId: packetId,
        sourceVersionIds: [sourceId],
      }),
    ).toThrow("absent from locked text");
    expect(() =>
      materializePronunciationEntries({
        directorOutput: output({
          sourceRecordVersionId: "33333333-3333-4333-8333-333333333333",
        }),
        modelRequestHash: hash,
        processingText: "श्री कृष्ण",
        scriptSha256: hash,
        sourceReviewPacketId: packetId,
        sourceVersionIds: [sourceId],
      }),
    ).toThrow("unscoped source");
  });

  it("fails closed when sacred audio has no confirmed human-recording asset", () => {
    try {
      materializePronunciationEntries({
        directorOutput: output({
          devanagari: "ॐ ह्रीं",
          entryKind: "bija_mantra",
          exactText: "ॐ ह्रीं",
          providerMarkup: null,
          synthesisPolicy: "human_recording_only",
          transliteration: "oṃ hrīṃ",
        }),
        modelRequestHash: hash,
        processingText: "ॐ ह्रीं",
        scriptSha256: hash,
        sourceReviewPacketId: packetId,
        sourceVersionIds: [sourceId],
      });
      throw new Error("expected sacred-audio rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AudioIdentityPreflightError);
      expect((error as AudioIdentityPreflightError).code).toBe(
        "HUMAN_SACRED_AUDIO_REQUIRED",
      );
    }
  });

  it("binds sacred pronunciation evidence to confirmed owner-uploaded narration", () => {
    const humanRecordingAssetVersionId = "44444444-4444-4444-8444-444444444444";
    const entries = materializePronunciationEntries({
      directorOutput: output({
        devanagari: "à¥ à¤¹à¥à¤°à¥€à¤‚",
        entryKind: "bija_mantra",
        exactText: "à¥ à¤¹à¥à¤°à¥€à¤‚",
        providerMarkup: null,
        synthesisPolicy: "human_recording_only",
        transliteration: "oá¹ƒ hrÄ«á¹ƒ",
      }),
      humanRecordingAssetVersionId,
      modelRequestHash: hash,
      processingText: "à¥ à¤¹à¥à¤°à¥€à¤‚",
      scriptSha256: hash,
      sourceReviewPacketId: packetId,
      sourceVersionIds: [sourceId],
    });

    expect(entries[0]?.humanRecordingAssetVersionId).toBe(humanRecordingAssetVersionId);
  });
});

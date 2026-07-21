import { describe, expect, it } from "vitest";

import { materializeNarrationDelivery } from "@/server/narration-delivery";

const output = (annotations: readonly Record<string, unknown>[]) => ({
  annotations,
  schemaVersion: "genie.elevenlabs-v3-delivery.v1",
});

describe("ElevenLabs V3 narration delivery", () => {
  it("adds delivery controls while preserving every source scalar in order", () => {
    const delivery = materializeNarrationDelivery({
      directorOutput: output([
        {
          emphasizeEnglish: false,
          endScalar: 4,
          pauseAfter: "ellipsis",
          startScalar: 0,
          tagBefore: "[curious]",
        },
      ]),
      modelRequestHash: "a".repeat(64),
      sourceText: "कौन था वह",
    });
    expect(delivery.deliveryText).toBe("[curious] कौन ...था वह");
    expect(delivery.deliveryMap.filter((value) => value !== null)).toEqual(
      Array.from({ length: Array.from("कौन था वह").length }, (_, index) => index),
    );
  });

  it("uppercases only the selected English span", () => {
    const delivery = materializeNarrationDelivery({
      directorOutput: output([
        {
          emphasizeEnglish: true,
          endScalar: 13,
          pauseAfter: "exclamation",
          startScalar: 8,
          tagBefore: null,
        },
      ]),
      modelRequestHash: "b".repeat(64),
      sourceText: "This is magic",
    });
    expect(delivery.deliveryText).toBe("This is MAGIC!");
  });

  it("rejects non-English CAPS, overlapping spans, and duplicate punctuation", () => {
    expect(() =>
      materializeNarrationDelivery({
        directorOutput: output([
          {
            emphasizeEnglish: true,
            endScalar: 4,
            pauseAfter: "none",
            startScalar: 0,
            tagBefore: null,
          },
        ]),
        modelRequestHash: "c".repeat(64),
        sourceText: "राम आए",
      }),
    ).toThrow(/English-language/u);
    expect(() =>
      materializeNarrationDelivery({
        directorOutput: output([
          {
            emphasizeEnglish: false,
            endScalar: 4,
            pauseAfter: "none",
            startScalar: 0,
            tagBefore: null,
          },
          {
            emphasizeEnglish: false,
            endScalar: 6,
            pauseAfter: "none",
            startScalar: 3,
            tagBefore: null,
          },
        ]),
        modelRequestHash: "d".repeat(64),
        sourceText: "abcdef",
      }),
    ).toThrow(/overlap/u);
    expect(() =>
      materializeNarrationDelivery({
        directorOutput: output([
          {
            emphasizeEnglish: false,
            endScalar: 4,
            pauseAfter: "ellipsis",
            startScalar: 0,
            tagBefore: null,
          },
        ]),
        modelRequestHash: "e".repeat(64),
        sourceText: "कौन?",
      }),
    ).toThrow(/duplicate/u);
  });

  it("accepts an empty annotation plan and never emits thoughtful", () => {
    const sourceText = "एक पवित्र कथा।";
    const delivery = materializeNarrationDelivery({
      directorOutput: output([]),
      modelRequestHash: "f".repeat(64),
      sourceText,
    });
    expect(delivery.deliveryText).toBe(sourceText);
    expect(delivery.deliveryText).not.toMatch(/\[thoughtful\]/iu);
  });
});

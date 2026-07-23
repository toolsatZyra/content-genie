import { describe, expect, it } from "vitest";

import {
  GENIE_LAUNCH_PROFILE,
  GENIE_LAUNCH_PERFORMANCE_PROFILE,
  NARRATION_DURATION_PROFILE,
  durationNeedsAcknowledgement,
  estimateNarrationDuration,
  estimateNarrationDurationSeconds,
} from "./launch-profile";

describe("the Genie launch profile", () => {
  it("is Hindi narration-only vertical video with lip-sync inapplicable", () => {
    expect(GENIE_LAUNCH_PROFILE).toEqual(
      expect.objectContaining({
        aspectRatio: "9:16",
        dialogueEnabled: false,
        language: "hi-IN",
        lipSyncApplicability: "not_applicable",
        narrationMode: "background_narration",
        performanceProfileId: "genie-launch-hindi-delhi-sanskrit-performance.v1",
      }),
    );
  });

  it("locks the versioned launch performance direction without a human picker", () => {
    expect(GENIE_LAUNCH_PERFORMANCE_PROFILE).toEqual({
      accent: "Delhi",
      configurationPolicy: "system_locked",
      hindiDelivery: "conversational_expressive",
      id: "genie-launch-hindi-delhi-sanskrit-performance.v1",
      language: "hi-IN",
      sanskritFluency: "required",
      userSelectable: false,
      version: 1,
    });
  });

  it.each([
    [59.999, true],
    [60, false],
    [120, false],
    [120.001, true],
    [Number.NaN, true],
  ])("handles duration estimate %s", (seconds, expected) => {
    expect(durationNeedsAcknowledgement(seconds)).toBe(expected);
  });

  it("estimates rather than changing the supplied Hindi words", () => {
    const source = "शिव ने नेत्र खोले। कैलाश पर प्रभात हुआ।";
    expect(estimateNarrationDurationSeconds(source)).toBeCloseTo(
      (8 * 60) / 125 + 2 * NARRATION_DURATION_PROFILE.sentencePauseSeconds,
    );
    expect(source).toBe("शिव ने नेत्र खोले। कैलाश पर प्रभात हुआ।");
  });

  it("uses a versioned Hindi expressive profile with punctuation and breath timing", () => {
    const plain = Array.from({ length: 120 }, () => "शिव").join(" ");
    const punctuated = `${plain}।\nकथा?`;

    expect(estimateNarrationDuration(plain)).toEqual({
      clauseMarks: 0,
      estimatedSeconds: 59.52,
      lineBreaks: 0,
      performanceBreaths: 6,
      profileId: "genie-hindi-conversational-expressive-duration.v2",
      sentenceMarks: 0,
      words: 120,
    });
    expect(durationNeedsAcknowledgement(estimateNarrationDurationSeconds(plain))).toBe(
      true,
    );
    const directed = estimateNarrationDuration(punctuated);
    expect(directed.words).toBe(121);
    expect(directed.sentenceMarks).toBe(2);
    expect(directed.lineBreaks).toBe(1);
    expect(directed.performanceBreaths).toBe(6);
    expect(directed.estimatedSeconds).toBe(61.09);
    expect(durationNeedsAcknowledgement(directed.estimatedSeconds)).toBe(false);
  });
});

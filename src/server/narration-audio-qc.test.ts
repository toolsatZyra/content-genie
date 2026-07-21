import { describe, expect, it } from "vitest";

import {
  compareNarrationTranscript,
  normalizeHindiTranscript,
  parseNarrationJudgeEvidence,
} from "@/server/narration-audio-qc";

describe("independent narration audio QC", () => {
  it("normalizes presentation differences without deleting Devanagari marks", () => {
    expect(normalizeHindiTranscript("  भगवान शिव—करुणामय हैं। ")).toBe(
      "भगवानशिवकरुणामयहैं",
    );
  });

  it("passes an exact ASR rendering and rejects omitted narration", () => {
    const exact = "भगवान शिव ने शांत स्वर में भक्त को साहस और करुणा का मार्ग दिखाया।";
    expect(compareNarrationTranscript(exact, exact)).toMatchObject({
      editDistance: 0,
      lengthRatio: 1,
      passed: true,
      similarity: 1,
    });
    expect(
      compareNarrationTranscript(
        `${exact} फिर उन्होंने सत्य की रक्षा का संकल्प समझाया।`,
        exact,
      ).passed,
    ).toBe(false);
  });

  it("accepts bounded Hindi ASR spelling variants without accepting omissions", () => {
    const expected =
      "राजा जनक ने भगवान शिव का विशाल धनुष सामने रख कर घोषणा की। ऋषि विश्वामित्र ने राम की ओर देखा। धनुष दो टुकड़ों में टूट गया।";
    const commonAsrRendering =
      "राजा जनक ने भगवान शिव का विशाल धनुश सामने रख कर घोशना की। ऋषि विश्वामित्र ने राम की ओर देखा। धनुश दो टुकडों में टूट गया।";

    expect(compareNarrationTranscript(expected, commonAsrRendering).passed).toBe(true);
    expect(compareNarrationTranscript(expected, "राजा जनक ने घोषणा की।").passed).toBe(
      false,
    );
  });

  it("accepts only the exact bounded judge contract", () => {
    const evidence = {
      delhiAccentPass: true,
      expressiveHindiPass: true,
      glitchFreePass: true,
      intelligibilityPass: true,
      pronunciationConcerns: [],
      requestedGenderPass: true,
      safeSummary: "Natural, expressive Hindi with clean Sanskrit pronunciation.",
      schemaVersion: "genie.narration-audio-judge.v1",
    } as const;
    expect(parseNarrationJudgeEvidence(evidence)).toEqual(evidence);
    expect(() =>
      parseNarrationJudgeEvidence({ ...evidence, unrequestedScore: 99 }),
    ).toThrow("malformed object");
    expect(() =>
      parseNarrationJudgeEvidence({
        ...evidence,
        pronunciationConcerns: [{ term: "शिव" }],
      }),
    ).toThrow("invalid evidence");
  });
});

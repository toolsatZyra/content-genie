import { describe, expect, it } from "vitest";

import type { NarratorGender } from "./voice-registry";
import {
  DEFAULT_NARRATOR_GENDER,
  VOICE_VERSIONS,
  findVoiceByVersionId,
  parseNarratorGender,
  voiceForGender,
} from "./voice-registry";

describe("the pinned narrator registry", () => {
  it("defaults to the pinned male descriptor without provider credentials", () => {
    expect(DEFAULT_NARRATOR_GENDER).toBe("male");
    expect(voiceForGender(DEFAULT_NARRATOR_GENDER)).toMatchObject({
      availabilityStatus: "pending_authenticated_canary",
      gender: "male",
    });
    expect(voiceForGender("male")).not.toHaveProperty("externalVoiceId");
  });

  it("pins the exact female version descriptor", () => {
    expect(voiceForGender("female")).toMatchObject({
      gender: "female",
      versionId: "bb2db360-9e44-5e17-95d3-a1e38ef21fa7",
    });
  });

  it("does not expose a fallback voice", () => {
    expect(VOICE_VERSIONS).toHaveLength(2);
    expect(
      new Set(VOICE_VERSIONS.map(({ performanceProfileId }) => performanceProfileId)),
    ).toEqual(new Set(["genie-launch-hindi-delhi-sanskrit-performance.v1"]));
    expect(() => parseNarratorGender("neutral")).toThrow(
      "Narrator gender must be male or female.",
    );
  });

  it("resolves only the database UUID pin", () => {
    const female = voiceForGender("female");
    expect(findVoiceByVersionId(female.versionId)).toBe(female);
    expect(findVoiceByVersionId(female.id)).toBeUndefined();
  });
  it("parses both supported narrator genders without coercion", () => {
    expect(parseNarratorGender("male")).toBe("male");
    expect(parseNarratorGender("female")).toBe("female");
  });

  it("fails closed if a typed caller violates the narrator union at runtime", () => {
    expect(() => voiceForGender("neutral" as NarratorGender)).toThrow(
      "The selected narrator voice is unavailable.",
    );
  });
});

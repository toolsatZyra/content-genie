import { describe, expect, it } from "vitest";

import {
  authoritativeNarrationSourceIsConfirmed,
  configurationConfirmationGate,
  creationAccessForEpisode,
  lookAvailabilityCanBeSelected,
  projectCreativeChoiceConfirmation,
} from "./creation";

describe("creation lifecycle access", () => {
  it.each(["draft", "world_setup"] as const)("keeps %s editable", (workflowState) => {
    expect(creationAccessForEpisode(workflowState)).toBe("editable");
  });

  it.each(["canceled", "abandoned"] as const)("closes %s Episodes", (workflowState) => {
    expect(creationAccessForEpisode(workflowState)).toBe("closed");
  });

  it.each([
    "ready_to_produce",
    "producing",
    "paused",
    "retrying",
    "delayed",
    "blocked",
    "pending_qualified_review",
    "awaiting_final_review",
    "approved",
    "delivered",
    "release_blocked",
  ] as const)("makes %s setup read-only", (workflowState) => {
    expect(creationAccessForEpisode(workflowState)).toBe("read-only");
  });
});

describe("creation choice confirmation", () => {
  it("accepts only the confirmation authority for the selected narration source", () => {
    const humanId = "10000000-0000-4000-8000-000000000001";
    const confirmedAt = "2026-07-22T10:00:00.000Z";

    expect(
      authoritativeNarrationSourceIsConfirmed({
        narrationSourceConfirmedAt: confirmedAt,
        narrationSourceConfirmedBy: humanId,
        narrationSourceKind: "uploaded_audio",
        selectedNarrationUploadVersionId: "10000000-0000-4000-8000-000000000002",
        voiceConfirmedAt: null,
        voiceConfirmedBy: null,
      }),
    ).toBe(true);
    expect(
      authoritativeNarrationSourceIsConfirmed({
        narrationSourceConfirmedAt: confirmedAt,
        narrationSourceConfirmedBy: humanId,
        narrationSourceKind: "uploaded_audio",
        selectedNarrationUploadVersionId: null,
        voiceConfirmedAt: confirmedAt,
        voiceConfirmedBy: humanId,
      }),
    ).toBe(false);
    expect(
      authoritativeNarrationSourceIsConfirmed({
        narrationSourceConfirmedAt: null,
        narrationSourceConfirmedBy: null,
        narrationSourceKind: "elevenlabs_v3",
        selectedNarrationUploadVersionId: null,
        voiceConfirmedAt: confirmedAt,
        voiceConfirmedBy: humanId,
      }),
    ).toBe(true);
  });

  it("distinguishes untouched system defaults from explicit human confirmation", () => {
    expect(projectCreativeChoiceConfirmation(null, null)).toEqual({
      confirmedAt: null,
      confirmedBy: null,
      origin: "system_default",
    });
    expect(
      projectCreativeChoiceConfirmation(
        "2026-07-19T10:00:00.000Z",
        "10000000-0000-4000-8000-000000000001",
      ),
    ).toEqual({
      confirmedAt: "2026-07-19T10:00:00.000Z",
      confirmedBy: "10000000-0000-4000-8000-000000000001",
      origin: "human_confirmed",
    });
  });

  it("blocks progression until both defaulted choices have human confirmation", () => {
    const systemDefault = projectCreativeChoiceConfirmation(null, null);
    const humanConfirmed = projectCreativeChoiceConfirmation(
      "2026-07-19T10:00:00.000Z",
      "10000000-0000-4000-8000-000000000001",
    );

    expect(
      configurationConfirmationGate({
        lookConfirmation: systemDefault,
        narrationSourceConfirmation: systemDefault,
        narrationSourceKind: "elevenlabs_v3",
        voiceConfirmation: humanConfirmed,
      }),
    ).toEqual({
      blockers: ["look_human_confirmation_required"],
      canProgress: false,
    });
    expect(
      configurationConfirmationGate({
        lookConfirmation: humanConfirmed,
        narrationSourceConfirmation: systemDefault,
        narrationSourceKind: "elevenlabs_v3",
        voiceConfirmation: humanConfirmed,
      }),
    ).toEqual({ blockers: [], canProgress: true });
  });

  it("uses explicit source confirmation instead of voice confirmation for uploaded narration", () => {
    const systemDefault = projectCreativeChoiceConfirmation(null, null);
    const humanConfirmed = projectCreativeChoiceConfirmation(
      "2026-07-19T10:00:00.000Z",
      "10000000-0000-4000-8000-000000000001",
    );

    expect(
      configurationConfirmationGate({
        lookConfirmation: humanConfirmed,
        narrationSourceConfirmation: systemDefault,
        narrationSourceKind: "uploaded_audio",
        voiceConfirmation: systemDefault,
      }),
    ).toEqual({
      blockers: ["narration_source_confirmation_required"],
      canProgress: false,
    });
    expect(
      configurationConfirmationGate({
        lookConfirmation: humanConfirmed,
        narrationSourceConfirmation: humanConfirmed,
        narrationSourceKind: "uploaded_audio",
        voiceConfirmation: systemDefault,
      }),
    ).toEqual({ blockers: [], canProgress: true });
  });
});

describe("look availability", () => {
  it.each([
    ["active", true],
    ["unavailable", false],
    ["withdrawn", false],
    [undefined, false],
  ] as const)("makes %s selectable: %s", (status, expected) => {
    expect(lookAvailabilityCanBeSelected(status)).toBe(expected);
  });
});

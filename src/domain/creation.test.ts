import { describe, expect, it } from "vitest";

import {
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
        voiceConfirmation: humanConfirmed,
      }),
    ).toEqual({
      blockers: ["look_human_confirmation_required"],
      canProgress: false,
    });
    expect(
      configurationConfirmationGate({
        lookConfirmation: humanConfirmed,
        voiceConfirmation: humanConfirmed,
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

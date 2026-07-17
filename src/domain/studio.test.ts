import { describe, expect, it } from "vitest";

import {
  episodeStatePresentation,
  episodeWorkflowStates,
  parseEpisodeWorkflowState,
  roleRank,
} from "@/domain/studio";

describe("studio roles", () => {
  it("orders member, reviewer and admin authority", () => {
    expect(roleRank("member")).toBeLessThan(roleRank("reviewer"));
    expect(roleRank("reviewer")).toBeLessThan(roleRank("admin"));
  });
});

describe("episode workflow presentation", () => {
  it.each([
    ["draft", "Draft", null],
    ["world_setup", "World design", null],
    ["ready_to_produce", "Ready to produce", null],
    ["producing", "Creating", "creating"],
    ["paused", "Paused", null],
    ["retrying", "Retrying", "creating"],
    ["delayed", "Delayed", null],
    ["blocked", "Blocked", "attention"],
    ["pending_qualified_review", "Qualified review", "attention"],
    ["awaiting_final_review", "Final review", "attention"],
    ["approved", "Approved", "ready"],
    ["delivered", "Delivered", "ready"],
    ["canceled", "Canceled", null],
    ["abandoned", "Abandoned", null],
    ["release_blocked", "Release blocked", "attention"],
  ] as const)("presents %s truthfully", (state, label, summaryBucket) => {
    expect(episodeStatePresentation(state)).toMatchObject({ label, summaryBucket });
  });

  it("covers every database workflow state exactly once", () => {
    expect(episodeWorkflowStates).toHaveLength(15);
    expect(new Set(episodeWorkflowStates).size).toBe(episodeWorkflowStates.length);
    for (const state of episodeWorkflowStates) {
      expect(episodeStatePresentation(state).label).toBeTruthy();
    }
  });

  it("fails closed to draft for unknown database values", () => {
    expect(parseEpisodeWorkflowState("not_a_state")).toBe("draft");
    expect(parseEpisodeWorkflowState(null)).toBe("draft");
  });
});

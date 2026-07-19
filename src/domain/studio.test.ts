import { describe, expect, it } from "vitest";

import {
  episodeStatePresentation,
  episodeWorkflowStates,
  canArchiveSeries,
  canCreateEpisodeInSeries,
  episodeCreationBlocker,
  parseEpisodeWorkflowState,
  parseSeriesLifecycleState,
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

  it("fails closed to unavailable for unknown database values", () => {
    expect(parseEpisodeWorkflowState("future_autonomous_state")).toBe("unavailable");
    expect(parseEpisodeWorkflowState(null)).toBe("unavailable");
    expect(episodeStatePresentation("unavailable")).toMatchObject({
      label: "Unavailable",
      summaryBucket: null,
      tone: "attention",
    });
  });
});

describe("Series lifecycle and release gates", () => {
  const baseSeries = {
    activeRelease: { kind: "unreleased" as const },
    aggregateVersion: 1,
    description: "",
    id: "10000000-0000-4000-8000-000000000003",
    state: "active" as const,
    title: "Series",
    updatedAt: "2026-07-19T00:00:00.000Z",
  };

  it("preserves only authoritative Series lifecycle values", () => {
    expect(parseSeriesLifecycleState("active")).toBe("active");
    expect(parseSeriesLifecycleState("archived")).toBe("archived");
    expect(parseSeriesLifecycleState("future_restoring")).toBe("unavailable");
    expect(parseSeriesLifecycleState({})).toBe("unavailable");
  });

  it("blocks creation and archival for partial or unavailable projections", () => {
    const legacySeries = {
      aggregateVersion: baseSeries.aggregateVersion,
      description: baseSeries.description,
      id: baseSeries.id,
      state: baseSeries.state,
      title: baseSeries.title,
      updatedAt: baseSeries.updatedAt,
    };
    expect(canCreateEpisodeInSeries(baseSeries)).toBe(true);
    expect(canArchiveSeries(baseSeries)).toBe(true);
    expect(canCreateEpisodeInSeries(legacySeries)).toBe(false);
    expect(canArchiveSeries(legacySeries)).toBe(false);
    expect(canCreateEpisodeInSeries({ ...baseSeries, state: "unavailable" })).toBe(
      false,
    );
    expect(canArchiveSeries({ ...baseSeries, state: "unavailable" })).toBe(false);
    expect(
      canArchiveSeries({
        ...baseSeries,
        activeRelease: { kind: "unavailable", reason: "release", releaseId: null },
      }),
    ).toBe(false);
  });

  it("allows only an active release with an available look pin", () => {
    const release = {
      continuity: {
        id: "10000000-0000-4000-8000-00000000000c",
        versionNumber: 3,
      },
      id: "10000000-0000-4000-8000-00000000000b",
      kind: "released" as const,
      look: {
        availabilityStatus: "active" as const,
        id: "10000000-0000-4000-8000-00000000000d",
        key: "divine-realism",
        name: "Divine Realism",
      },
      releaseNumber: 2,
      status: "active" as const,
      voice: {
        availabilityStatus: "verified" as const,
        gender: "male" as const,
        id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
        key: "elevenlabs-male-hindi-devotional-v1",
      },
    };
    expect(canCreateEpisodeInSeries({ ...baseSeries, activeRelease: release })).toBe(
      true,
    );
    expect(
      canCreateEpisodeInSeries({
        ...baseSeries,
        activeRelease: { ...release, status: "withdrawn" },
      }),
    ).toBe(false);
    expect(
      canCreateEpisodeInSeries({
        ...baseSeries,
        activeRelease: {
          ...release,
          voice: { ...release.voice, availabilityStatus: "withdrawn" },
        },
      }),
    ).toBe(false);
    expect(
      canCreateEpisodeInSeries({
        ...baseSeries,
        activeRelease: {
          ...release,
          look: { ...release.look, availabilityStatus: "withdrawn" },
        },
      }),
    ).toBe(false);
  });

  it("names the exact active-Series release or look blocker", () => {
    const release = {
      continuity: null,
      id: "10000000-0000-4000-8000-00000000000b",
      kind: "released" as const,
      look: {
        availabilityStatus: "active" as const,
        id: "10000000-0000-4000-8000-00000000000d",
        key: "divine-realism",
        name: "Divine Realism",
      },
      releaseNumber: 2,
      status: "active" as const,
      voice: {
        availabilityStatus: "verified" as const,
        gender: "male" as const,
        id: "ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f",
        key: "elevenlabs-male-hindi-devotional-v1",
      },
    };

    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: { ...release, status: "superseded" },
      }),
    ).toBe("Series Release superseded");
    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: { ...release, status: "withdrawn" },
      }),
    ).toBe("Series Release withdrawn");
    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: {
          ...release,
          look: { ...release.look, availabilityStatus: "withdrawn" },
        },
      }),
    ).toBe("Pinned look withdrawn");
    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: {
          ...release,
          voice: { ...release.voice, availabilityStatus: "withdrawn" },
        },
      }),
    ).toBe("Pinned voice withdrawn");
    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: {
          kind: "unavailable",
          reason: "look",
          releaseId: release.id,
        },
      }),
    ).toBe("Pinned look unavailable");
    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: {
          kind: "unavailable",
          reason: "voice",
          releaseId: release.id,
        },
      }),
    ).toBe("Pinned voice unavailable");
    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: {
          kind: "unavailable",
          reason: "continuity",
          releaseId: release.id,
        },
      }),
    ).toBe("Pinned continuity unavailable");
    expect(
      episodeCreationBlocker({
        ...baseSeries,
        activeRelease: {
          kind: "unavailable",
          reason: "release",
          releaseId: release.id,
        },
      }),
    ).toBe("Series Release unavailable");
  });
});

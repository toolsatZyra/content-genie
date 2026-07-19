import { describe, expect, it } from "vitest";

import { episodeWorkflowStates } from "@/domain/studio";
import {
  deterministicEmptyStudioProjection,
  deterministicStateMatrixProjection,
  deterministicStudioProjection,
  deterministicUnavailableStudioProjection,
} from "@/test/fakes/studio";

describe("deterministic studio projection", () => {
  it("provides a stable workspace with concurrent Episode states", () => {
    const projection = deterministicStudioProjection();
    expect(projection.workspace.name).toBe("Zyra Internal");
    expect(projection.episodes).toHaveLength(2);
    expect(projection.episodes.map(({ workflowState }) => workflowState)).toEqual([
      "world_setup",
      "pending_qualified_review",
    ]);
    expect(projection.series[0]?.activeRelease).toMatchObject({
      kind: "released",
      releaseNumber: 2,
      status: "active",
      continuity: { versionNumber: 3 },
      look: { availabilityStatus: "active", key: "divine-realism" },
      voice: {
        availabilityStatus: "verified",
        gender: "male",
        key: "elevenlabs-male-hindi-devotional-v1",
      },
    });
    expect(projection.series[1]?.activeRelease).toEqual({ kind: "unreleased" });
  });

  it("renders every canonical state in the responsive acceptance matrix", () => {
    const projection = deterministicStateMatrixProjection();
    expect(projection.episodes.map(({ workflowState }) => workflowState)).toEqual(
      episodeWorkflowStates,
    );
    expect(
      projection.episodes.find(({ workflowState }) => workflowState === "producing"),
    ).toMatchObject({ title: "Resumed production" });
    expect(
      projection.episodes.find(({ workflowState }) => workflowState === "approved"),
    ).toMatchObject({ title: "Happy path approved" });
  });

  it("provides a truly empty first-frame state", () => {
    const projection = deterministicEmptyStudioProjection();
    expect(projection).toMatchObject({
      activities: [],
      episodes: [],
      notifications: [],
      series: [],
      work: [],
    });
  });

  it("provides explicit unavailable lifecycle and malformed-release states", () => {
    const projection = deterministicUnavailableStudioProjection();
    expect(projection.episodes[0]?.workflowState).toBe("unavailable");
    expect(projection.series[0]?.state).toBe("unavailable");
    expect(projection.series[1]?.activeRelease).toEqual({
      kind: "unavailable",
      reason: "release",
      releaseId: "10000000-0000-4000-8000-0000000000ff",
    });
  });
});

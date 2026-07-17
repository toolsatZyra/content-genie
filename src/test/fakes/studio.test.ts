import { describe, expect, it } from "vitest";

import { episodeWorkflowStates } from "@/domain/studio";
import {
  deterministicEmptyStudioProjection,
  deterministicStateMatrixProjection,
  deterministicStudioProjection,
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
});

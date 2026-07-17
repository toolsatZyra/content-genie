import { describe, expect, it } from "vitest";

import { deterministicStudioProjection } from "@/test/fakes/studio";

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
});

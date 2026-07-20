import { describe, expect, it } from "vitest";

import { selectProductionReferences } from "./production-reference-selection";

describe("production reference selection", () => {
  it("uses the Director's researched photograph for the exact shot", () => {
    const selected = selectProductionReferences(
      [
        {
          asset_version_id: "research-photo-2",
          reference_kind: "real_world",
          shot_number: 1,
        },
        {
          asset_version_id: "character-1",
          reference_kind: "character",
          shot_number: 1,
        },
        {
          asset_version_id: "location-1",
          reference_kind: "location_master",
          shot_number: 1,
        },
      ],
      [{ realWorldReferenceAssetVersionId: "research-photo-2", shotNumber: 1 }],
    );
    expect(selected.get(1)).toBe("research-photo-2");
  });

  it("retains the first approved edge when no public photograph is required", () => {
    const selected = selectProductionReferences(
      [
        {
          asset_version_id: "character-1",
          reference_kind: "character",
          shot_number: 1,
        },
        {
          asset_version_id: "location-1",
          reference_kind: "location_master",
          shot_number: 1,
        },
      ],
      [{ realWorldReferenceAssetVersionId: null, shotNumber: 1 }],
    );
    expect(selected.get(1)).toBe("character-1");
  });

  it("rejects divergence between the EDD and executable graph", () => {
    expect(() =>
      selectProductionReferences(
        [
          {
            asset_version_id: "research-photo-1",
            reference_kind: "real_world",
            shot_number: 1,
          },
        ],
        [{ realWorldReferenceAssetVersionId: "research-photo-2", shotNumber: 1 }],
      ),
    ).toThrow("do not match");
  });
});

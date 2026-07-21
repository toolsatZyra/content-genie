import { describe, expect, it } from "vitest";

import { buildAnchorDerivedIdentityPack } from "@/server/world-reference-pack";

describe("anchor-derived character identity pack", () => {
  it("keeps the clean promoted anchor authoritative and derives bounded inspection crops", () => {
    const result = buildAnchorDerivedIdentityPack({
      anchor_asset_version_id: "b1850000-0000-4000-8000-000000000001",
      id: "b1860000-0000-4000-8000-000000000001",
      identity_manifest_hash: "a".repeat(64),
      prompt_sha256: "b".repeat(64),
    });

    expect(result.cropManifest.identityPolicy).toMatchObject({
      compositeSheetIsRenderAnchor: false,
      primaryRenderAnchorAssetVersionId: "b1850000-0000-4000-8000-000000000001",
    });
    expect(result.cropManifest.cells).toHaveLength(3);
    expect(
      result.cropManifest.cells.every(({ crop }) =>
        Object.values(crop).every((value) => value >= 0 && value <= 1),
      ),
    ).toBe(true);
    expect(result.cropManifestHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.qcEvidenceHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

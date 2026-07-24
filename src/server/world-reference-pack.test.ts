import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const callOrder: string[] = [];
  const rpc = vi.fn(async () => {
    callOrder.push("reconcile");
    return { data: { ok: true }, error: null };
  });
  const from = vi.fn((table: string) => {
    callOrder.push(`from:${table}`);
    const result = Promise.resolve({ data: [], error: null });
    const query = {
      eq: vi.fn(() => query),
      select: vi.fn(() => query),
      then: result.then.bind(result),
    };
    return query;
  });
  const client = { from, rpc };
  return {
    callOrder,
    client: vi.fn(() => client),
    from,
    rpc,
  };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.client,
}));

import {
  buildAnchorDerivedIdentityPack,
  ensureWorldReferencePack,
} from "@/server/world-reference-pack";

beforeEach(() => {
  mocks.callOrder.length = 0;
  mocks.client.mockClear();
  mocks.from.mockClear();
  mocks.rpc.mockClear();
});

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

describe("World reference-pack reconciliation", () => {
  it("retires stale selections before deciding whether all current anchors are accepted", async () => {
    await expect(
      ensureWorldReferencePack({
        configurationCandidateId: "b1600000-0000-4000-8000-000000000001",
        workspaceId: "b1100000-0000-4000-8000-000000000001",
      }),
    ).resolves.toEqual({ packId: null, ready: false, replayed: false });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_reconcile_current_world_selections",
      {
        p_configuration_candidate_id: "b1600000-0000-4000-8000-000000000001",
        p_workspace_id: "b1100000-0000-4000-8000-000000000001",
      },
    );
    expect(mocks.callOrder.slice(0, 3)).toEqual([
      "reconcile",
      "from:character_selections",
      "from:location_selections",
    ]);
  });
});

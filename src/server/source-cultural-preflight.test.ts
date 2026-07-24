import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.client,
}));

import {
  buildQualifiedReviewFindings,
  chooseCulturalCatalogSource,
  ensureP209CulturalClaimBundle,
  SourceCulturalPreflightError,
} from "./source-cultural-preflight";

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.client.mockReset();
  mocks.client.mockReturnValue({ rpc: mocks.rpc });
});

describe("qualified source and cultural preflight", () => {
  it.each([
    ["rama", "श्री राम", "वनवास की कथा", "ramayana.pg24869"],
    ["krishna", "कृष्ण", "अर्जुन के सामने", "mahabharata.pg15474"],
    ["mahadeva", "महादेव", "शिव ने नेत्र खोला", "shiva-purana.reference"],
    ["mahakali", "महाकाली", "देवी का रूप", "devi-mahatmyam.wikisource"],
    ["narayana", "नारायण", "विष्णु का अवतार", "vishnu-purana.reference"],
  ])(
    "selects the bounded source family for %s",
    (canonicalKey, displayName, script, expectedKey) => {
      expect(chooseCulturalCatalogSource(canonicalKey, displayName, script).key).toBe(
        expectedKey,
      );
    },
  );

  it("prioritizes the character identity over other names elsewhere in a mixed-form script", () => {
    expect(
      chooseCulturalCatalogSource(
        "mahadeva",
        "महादेव",
        "राम ने शिव के सामने प्रणाम किया।",
      ).key,
    ).toBe("shiva-purana.reference");
  });

  it("never lets machine findings self-approve a non-overridable rule", () => {
    const rules = [
      {
        code: "GCP-ATTR-001",
        contentClass: "deity_form",
        defaultVerdict: "production_blocked",
        id: "10000000-0000-4000-8000-000000000001",
        nonOverridable: true,
        ruleText: "Identity-defining deity attributes require exact evidence.",
      },
    ] as const;
    const first = buildQualifiedReviewFindings(rules, "a".repeat(64));
    const replay = buildQualifiedReviewFindings(rules, "a".repeat(64));

    expect(first).toEqual(replay);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      policyRuleId: rules[0].id,
      subjectKind: "general",
      verdict: "qualified_review_required",
    });
    expect(first[0]?.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("materializes the required P2-09 sidecar before qualified review", async () => {
    mocks.rpc.mockResolvedValue({
      data: { bundleId: "10000000-0000-4000-8000-000000000003", ok: true },
      error: null,
    });

    await expect(
      ensureP209CulturalClaimBundle(
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ),
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_ensure_p2_09_cultural_claim_bundle",
      {
        p_source_review_packet_id: "10000000-0000-4000-8000-000000000002",
        p_workspace_id: "10000000-0000-4000-8000-000000000001",
      },
    );
  });

  it("keeps Preflight closed when the P2-09 sidecar cannot be finalized", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "40001" },
    });

    await expect(
      ensureP209CulturalClaimBundle(
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ),
    ).rejects.toBeInstanceOf(SourceCulturalPreflightError);
  });
});

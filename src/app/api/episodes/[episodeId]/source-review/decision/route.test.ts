import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/config/server-env", () => ({
  getServerEnvironment: () => ({ public: { appUrl: "https://genie.example" } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["eq", "select"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = mocks.maybeSingle;
    return {
      auth: { getUser: mocks.getUser },
      from: () => builder,
      rpc: mocks.rpc,
    };
  },
}));

import { POST } from "./route";

const episodeId = "20000000-0000-4000-8000-000000000011";
const packetId = "20000000-0000-4000-8000-000000000012";
const workspaceId = "20000000-0000-4000-8000-000000000013";
const competencyVersionId = "20000000-0000-4000-8000-000000000014";
const competencyScopeHash = "a".repeat(64);

function request(
  body: unknown = {
    competencyScopeHash,
    competencyVersionId,
    decision: "approve",
    episodeId,
    expectedStatusVersion: 1,
    packetId,
    rationale: "Reviewed exact form, source scope, rights, and dignity rules.",
    workspaceId,
  },
) {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/source-review/decision`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "source-decision-0001",
      },
      method: "POST",
    },
  );
}

describe("qualified source review decision route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "20000000-0000-4000-8000-000000000015" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        episode_configuration_candidates: { episode_id: episodeId },
        source_review_packet_id: packetId,
      },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: { ok: true, sourceReviewPacketId: packetId, status: "approved" },
      error: null,
    });
  });

  it("binds the decision to competency, scope hash, exact status version, and rationale", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_submit_source_review",
      expect.objectContaining({
        p_competency_scope_hash: competencyScopeHash,
        p_competency_version_id: competencyVersionId,
        p_decision: "approve",
        p_expected_status_version: 1,
        p_source_review_packet_id: packetId,
        p_workspace_id: workspaceId,
      }),
    );
  });

  it("rejects malformed rationale and returns a safe stale-evidence conflict", async () => {
    const malformed = await POST(
      request({
        competencyScopeHash,
        competencyVersionId,
        decision: "approve",
        episodeId,
        expectedStatusVersion: 1,
        packetId,
        rationale: " ",
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(malformed.status).toBe(400);

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "private detail" },
    });
    const stale = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "SOURCE_REVIEW_REJECTED",
      ok: false,
    });
  });
});

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/config/server-env", () => ({
  getServerEnvironment: () => ({ public: { appUrl: "https://genie.example" } }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["eq", "select"]) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => ({
      data: { id: "52000000-0000-4000-8000-000000000001" },
      error: null,
    }));
    return {
      auth: { getUser: mocks.getUser },
      from: vi.fn(() => builder),
      rpc: mocks.rpc,
    };
  },
}));

import { POST } from "./route";

const episodeId = "52000000-0000-4000-8000-000000000001";
const workspaceId = "52000000-0000-4000-8000-000000000002";
const productionRunId = "52000000-0000-4000-8000-000000000003";
const masterId = "52000000-0000-4000-8000-000000000004";
const repairRequestId = "52000000-0000-4000-8000-000000000006";
const clarificationId = "52000000-0000-4000-8000-000000000007";

function request(body: Record<string, unknown>) {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/mvp-production`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
      },
      method: "POST",
    },
  );
}

describe("MVP production commands", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "52000000-0000-4000-8000-000000000005" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: { state: "queued" }, error: null });
  });

  it("starts the exact locked production run", async () => {
    const response = await POST(
      request({
        action: "start",
        productionRunId,
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("command_start_mvp_production", {
      p_production_run_id: productionRunId,
      p_workspace_id: workspaceId,
    });
  });

  it("maps an authority rejection without leaking database detail", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "private database detail" },
    });
    const response = await POST(
      request({
        action: "review",
        culturalReviewConfirmed: true,
        decision: "approve",
        expectedVersion: 1,
        feedback: "",
        finalReviewConfirmed: true,
        masterId,
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "QUALIFIED_CULTURAL_AUTHORITY_REQUIRED",
      ok: false,
    });
  });

  it("records a qualified cultural decision before the separate final decision", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: { decision: "approve" }, error: null })
      .mockResolvedValueOnce({ data: { decision: "approve" }, error: null });

    const response = await POST(
      request({
        action: "review",
        culturalReviewConfirmed: true,
        decision: "approve",
        expectedVersion: 4,
        feedback: "",
        finalReviewConfirmed: true,
        masterId,
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "command_record_mvp_master_cultural_decision",
      {
        p_decision: "approve",
        p_expected_master_version: 4,
        p_master_id: masterId,
        p_rationale:
          "Qualified reviewer confirms the exact master is culturally releasable.",
        p_workspace_id: workspaceId,
      },
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "command_review_mvp_master", {
      p_cultural_review_confirmed: true,
      p_decision: "approve",
      p_expected_version: 4,
      p_feedback: "",
      p_final_review_confirmed: true,
      p_master_id: masterId,
      p_workspace_id: workspaceId,
    });
  });

  it("rejects extra request fields before a database command", async () => {
    const response = await POST(
      request({
        action: "start",
        productionRunId,
        surprise: true,
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires actionable feedback for a repair review", async () => {
    const response = await POST(
      request({
        action: "review",
        culturalReviewConfirmed: false,
        decision: "reject",
        expectedVersion: 1,
        feedback: "   ",
        finalReviewConfirmed: false,
        masterId,
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers Monica's exact pending clarification in the same repair request", async () => {
    const response = await POST(
      request({
        action: "clarify",
        answer: "At 00:14, keep the image and make only Rama's bow movement faster.",
        clarificationId,
        expectedVersion: 7,
        repairRequestId,
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("command_answer_mvp_repair_clarification", {
      p_answer: "At 00:14, keep the image and make only Rama's bow movement faster.",
      p_clarification_id: clarificationId,
      p_expected_request_version: 7,
      p_repair_request_id: repairRequestId,
      p_workspace_id: workspaceId,
    });
  });
});

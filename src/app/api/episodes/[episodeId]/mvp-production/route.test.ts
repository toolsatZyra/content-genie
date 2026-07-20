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
      code: "WORKSPACE_AUTHORITY_REQUIRED",
      ok: false,
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
});

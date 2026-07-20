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

const episodeId = "10000000-0000-4000-8000-000000000011";
const packetId = "10000000-0000-4000-8000-000000000012";
const workspaceId = "10000000-0000-4000-8000-000000000013";

function request(body: unknown = { episodeId, packetId, workspaceId }) {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/source-review/appointment`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "source-appointment-0001",
      },
      method: "POST",
    },
  );
}

describe("cultural reviewer appointment route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000014" } },
      error: null,
    });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        episode_configuration_candidates: { episode_id: episodeId },
        id: packetId,
      },
      error: null,
    });
    mocks.rpc.mockResolvedValue({
      data: {
        competencyVersionId: "10000000-0000-4000-8000-000000000015",
        ok: true,
        status: "active",
      },
      error: null,
    });
  });

  it("records a bounded all-scope internal appointment under admin authority", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_appoint_cultural_reviewer",
      expect.objectContaining({
        p_content_classes: ["all"],
        p_languages: ["all"],
        p_regions: ["all"],
        p_traditions: ["all"],
        p_workspace_id: workspaceId,
      }),
    );
    expect(mocks.rpc.mock.calls[0]?.[1].p_appointment_evidence_hash).toMatch(
      /^[a-f0-9]{64}$/u,
    );
  });

  it("fails closed for widened bodies and admin authority denial", async () => {
    const widened = await POST(
      request({ episodeId, packetId, workspaceId, role: "admin" }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(widened.status).toBe(400);

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "aal2 required" },
    });
    const denied = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      code: "ADMIN_AUTHORITY_REQUIRED",
      ok: false,
    });
  });
});

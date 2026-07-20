import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/config/server-env", () => ({
  getServerEnvironment: () => ({ public: { appUrl: "https://genie.example" } }),
}));

function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "select"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: result, error: null }));
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    rpc: mocks.rpc,
  }),
}));

import { POST } from "./route";

const episodeId = "41000000-0000-4000-8000-000000000001";
const quoteId = "41000000-0000-4000-8000-000000000002";
const configurationCandidateId = "41000000-0000-4000-8000-000000000003";
const workspaceId = "41000000-0000-4000-8000-000000000004";
const quoteHash = "a".repeat(64);

function request(
  body: unknown = {
    episodeId,
    hardCeilingMicrousd: 45_000_000,
    quoteHash,
    quoteId,
    workspaceId,
  },
  origin = "https://genie.example",
) {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/quote-confirm`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin,
        "x-idempotency-key": "quote-confirm-test-0001",
      },
      method: "POST",
    },
  );
}

describe("exact production quote confirmation route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "41000000-0000-4000-8000-000000000005" } },
      error: null,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "production_quotes") {
        return query({
          id: quoteId,
          configuration_candidate_id: configurationCandidateId,
        });
      }
      if (table === "episode_configuration_candidates") {
        return query({ id: configurationCandidateId });
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.rpc.mockResolvedValue({
      data: "41000000-0000-4000-8000-000000000006",
      error: null,
    });
  });

  it("binds AAL2 confirmation to the exact immutable quote and hard ceiling", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "command_confirm_production_quote",
      expect.objectContaining({
        p_hard_ceiling_microusd: 45_000_000,
        p_quote_hash: quoteHash,
        p_quote_id: quoteId,
        p_workspace_id: workspaceId,
      }),
    );
  });

  it("rejects an untrusted origin before authentication or quote lookup", async () => {
    const response = await POST(request(undefined, "https://attacker.example"), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("fails closed for an out-of-scope quote and for missing AAL2", async () => {
    mocks.from.mockImplementationOnce(() => query(null));
    const missing = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(missing.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "private detail" },
    });
    const aal2 = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(aal2.status).toBe(403);
    await expect(aal2.json()).resolves.toMatchObject({
      code: "AAL2_REQUIRED",
      ok: false,
    });
  });

  it("requires an exact body and never accepts a client ceiling above $50", async () => {
    const response = await POST(
      request({
        episodeId,
        hardCeilingMicrousd: 50_000_001,
        quoteHash,
        quoteId,
        workspaceId,
      }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

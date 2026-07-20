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

const episodeId = "42000000-0000-4000-8000-000000000001";
const quoteId = "42000000-0000-4000-8000-000000000002";
const configurationCandidateId = "42000000-0000-4000-8000-000000000003";
const workspaceId = "42000000-0000-4000-8000-000000000004";
const confirmationId = "42000000-0000-4000-8000-000000000005";

function request() {
  return new NextRequest(`https://genie.example/api/episodes/${episodeId}/world-lock`, {
    body: JSON.stringify({
      configurationCandidateId,
      episodeId,
      expectedConfigurationVersion: 7,
      expectedEpisodeVersion: 9,
      quoteId,
      workspaceId,
    }),
    headers: {
      "content-type": "application/json",
      origin: "https://genie.example",
      "x-idempotency-key": "world-lock-test-0001",
    },
    method: "POST",
  });
}

describe("atomic first-Episode World Lock route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "42000000-0000-4000-8000-000000000006" } },
      error: null,
    });
    mocks.from.mockImplementation((table: string) => {
      if (table === "episodes") {
        return query({
          aggregate_version: 9,
          id: episodeId,
          series: { aggregate_version: 11 },
          series_id: "42000000-0000-4000-8000-000000000007",
        });
      }
      if (table === "production_quotes") return query({ id: quoteId });
      if (table === "production_quote_confirmations") {
        return query({ id: confirmationId });
      }
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "prepare_first_episode_world_lock") {
        return Promise.resolve({
          data: { manifestHash: "a".repeat(64), requestHash: "b".repeat(64) },
          error: null,
        });
      }
      if (name === "command_lock_first_episode_world") {
        return Promise.resolve({
          data: { episodeState: "ready_to_produce", ok: true },
          error: null,
        });
      }
      if (name === "command_start_mvp_production") {
        return Promise.resolve({
          data: { state: "queued" },
          error: null,
        });
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
  });

  it("prepares exact hashes, then atomically creates release, budget and run authority", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "prepare_first_episode_world_lock",
      expect.objectContaining({
        p_configuration_candidate_id: configurationCandidateId,
        p_expected_configuration_version: 7,
        p_expected_episode_version: 9,
        p_expected_series_version: 11,
        p_production_quote_id: quoteId,
        p_quote_confirmation_id: confirmationId,
      }),
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "command_lock_first_episode_world",
      expect.objectContaining({
        p_configuration_candidate_id: configurationCandidateId,
        p_production_quote_id: quoteId,
        p_quote_confirmation_id: confirmationId,
        p_release_manifest_hash: "a".repeat(64),
        p_request_hash: "b".repeat(64),
      }),
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "command_start_mvp_production", {
      p_production_run_id: expect.any(String),
      p_workspace_id: workspaceId,
    });
  });

  it("does not mint authority without the exact quote confirmation", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "episodes") {
        return query({
          aggregate_version: 9,
          id: episodeId,
          series: { aggregate_version: 11 },
          series_id: "42000000-0000-4000-8000-000000000007",
        });
      }
      if (table === "production_quotes") return query({ id: quoteId });
      if (table === "production_quote_confirmations") return query(null);
      throw new Error(`Unexpected table ${table}`);
    });
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed when preparation loses workspace authority or an aggregate pin changes", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "private detail" },
    });
    const aal2 = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(aal2.status).toBe(403);
    await expect(aal2.json()).resolves.toMatchObject({
      code: "WORKSPACE_AUTHORITY_REQUIRED",
    });

    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "private detail" },
    });
    const stale = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: "WORLD_LOCK_STALE" });
  });
});

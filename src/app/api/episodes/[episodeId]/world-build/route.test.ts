import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  adminSingle: vi.fn(),
  advance: vi.fn(),
  beginProgress: vi.fn(),
  getUser: vi.fn(),
  scopeMaybeSingle: vi.fn(),
  userRpc: vi.fn(),
}));
vi.mock("@/server/mvp-preflight-runner", () => ({
  advanceNextMvpPreflight: mocks.advance,
}));
vi.mock("@/server/world-build-progress", () => ({
  beginWorldBuildProgress: mocks.beginProgress,
}));
vi.mock("@/config/server-env", () => ({
  getServerEnvironment: () => ({
    enableProviderSpend: true,
    public: { appUrl: "https://genie.example" },
  }),
}));

function query(single: () => unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["eq", "select"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = mocks.scopeMaybeSingle;
  builder.single = single;
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: () => query(mocks.adminSingle),
    rpc: mocks.userRpc,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({
    from: () => query(mocks.adminSingle),
    rpc: mocks.adminRpc,
  }),
}));

import { maxDuration, POST } from "./route";

const episodeId = "10000000-0000-4000-8000-000000000011";
const workspaceId = "10000000-0000-4000-8000-000000000012";
const configurationCandidateId = "10000000-0000-4000-8000-000000000013";
const scriptRevisionId = "10000000-0000-4000-8000-000000000014";
const preflightRunId = "10000000-0000-4000-8000-000000000015";

function request(
  body: unknown = { configurationCandidateId, episodeId, workspaceId },
  headers: Record<string, string> = {},
) {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/world-build`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "world-build-test-0001",
        ...headers,
      },
      method: "POST",
    },
  );
}

describe("world-build dispatch route", () => {
  it("keeps the immediate autonomous worker inside the durable route budget", () => {
    expect(maxDuration).toBe(800);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000016" } },
      error: null,
    });
    mocks.scopeMaybeSingle.mockResolvedValue({
      data: {
        aggregate_version: 7,
        id: configurationCandidateId,
        look_confirmed_at: "2026-07-19T00:00:00Z",
        narration_source_confirmed_at: null,
        narration_source_confirmed_by: null,
        narration_source_kind: "elevenlabs_v3",
        selected_narration_upload_version_id: null,
        script_revision_id: scriptRevisionId,
        state: "world_design",
        voice_confirmed_at: "2026-07-19T00:00:00Z",
        voice_confirmed_by: "10000000-0000-4000-8000-000000000016",
      },
      error: null,
    });
    mocks.advance.mockResolvedValue({ advanced: false });
    mocks.beginProgress.mockResolvedValue(undefined);
    mocks.userRpc.mockResolvedValue({
      data: {
        hardCeilingMinor: 500,
        intentId: "10000000-0000-4000-8000-000000000017",
        ok: true,
      },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({
        data: {
          aggregateVersion: 1,
          ok: true,
          preflightRunId,
          state: "created",
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { ok: true, state: "queued" }, error: null });
    mocks.adminSingle.mockResolvedValue({
      data: { aggregate_version: 1, id: preflightRunId, state: "created" },
      error: null,
    });
  });

  it("creates one exact-script run and queues it for bounded MVP dispatch", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(202);
    expect(mocks.userRpc).toHaveBeenCalledWith(
      "command_authorize_world_build_intent",
      expect.objectContaining({
        p_configuration_candidate_id: configurationCandidateId,
        p_expected_configuration_version: 7,
        p_hard_ceiling_minor: 500,
      }),
    );
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      1,
      "command_create_preflight_run",
      expect.objectContaining({
        p_configuration_candidate_id: configurationCandidateId,
        p_episode_id: episodeId,
        p_kind: "world_anchor",
        p_requires_micro_authority: false,
        p_script_revision_id: scriptRevisionId,
        p_workspace_id: workspaceId,
      }),
    );
    expect(mocks.adminRpc).toHaveBeenNthCalledWith(
      2,
      "command_transition_preflight_run",
      expect.objectContaining({
        p_command: "enqueue",
        p_expected_version: 1,
        p_preflight_run_id: preflightRunId,
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      result: { preflightRunId, state: "queued", triggerRunId: null },
    });
  });

  it("rejects an untrusted origin before reading actor or scope", async () => {
    const response = await POST(
      request(undefined, { origin: "https://attacker.example" }),
      { params: Promise.resolve({ episodeId }) },
    );
    expect(response.status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("does not create authority without an authenticated user and confirmed pins", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const unauthenticated = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(unauthenticated.status).toBe(401);

    mocks.getUser.mockResolvedValueOnce({
      data: { user: { id: "10000000-0000-4000-8000-000000000016" } },
      error: null,
    });
    mocks.scopeMaybeSingle.mockResolvedValueOnce({
      data: {
        aggregate_version: 7,
        id: configurationCandidateId,
        look_confirmed_at: null,
        narration_source_confirmed_at: null,
        narration_source_confirmed_by: null,
        narration_source_kind: "elevenlabs_v3",
        selected_narration_upload_version_id: null,
        script_revision_id: scriptRevisionId,
        state: "world_design",
        voice_confirmed_at: "2026-07-19T00:00:00Z",
        voice_confirmed_by: "10000000-0000-4000-8000-000000000016",
      },
      error: null,
    });
    const unconfirmed = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(unconfirmed.status).toBe(403);
  });

  it("accepts confirmed uploaded narration without generated-voice confirmation", async () => {
    mocks.scopeMaybeSingle.mockResolvedValueOnce({
      data: {
        aggregate_version: 7,
        id: configurationCandidateId,
        look_confirmed_at: "2026-07-19T00:00:00Z",
        narration_source_confirmed_at: "2026-07-22T10:00:00Z",
        narration_source_confirmed_by: "10000000-0000-4000-8000-000000000016",
        narration_source_kind: "uploaded_audio",
        script_revision_id: scriptRevisionId,
        selected_narration_upload_version_id: "10000000-0000-4000-8000-000000000018",
        state: "world_design",
        voice_confirmed_at: null,
        voice_confirmed_by: null,
      },
      error: null,
    });

    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });

    expect(response.status).toBe(202);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "command_create_preflight_run",
      expect.objectContaining({ p_script_revision_id: scriptRevisionId }),
    );
  });

  it("fails closed when the bounded World authority is denied", async () => {
    mocks.userRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "42501", message: "aal2 required" },
    });
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "WORLD_AUTHORITY_DENIED",
      ok: false,
    });
    expect(mocks.adminRpc).not.toHaveBeenCalled();
  });

  it("reconciles an already queued run without another dispatch dependency", async () => {
    mocks.adminSingle.mockResolvedValueOnce({
      data: { aggregate_version: 2, id: preflightRunId, state: "queued" },
      error: null,
    });
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { preflightRunId, state: "queued", triggerRunId: null },
    });
  });
});

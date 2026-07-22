import { createHash } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  adminRpc: vi.fn(),
  authenticatedRpc: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

const query = {
  eq: vi.fn(() => query),
  maybeSingle: mocks.maybeSingle,
  select: vi.fn(() => query),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.adminRpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    from: vi.fn(() => query),
    rpc: mocks.authenticatedRpc,
  }),
}));

import { POST } from "./route";

const episodeId = "10000000-0000-4000-8000-000000000110";
const workspaceId = "10000000-0000-4000-8000-000000000101";
const configurationCandidateId = "10000000-0000-4000-8000-000000000120";
const uploadVersionId = "10000000-0000-4000-8000-000000000121";
const userId = "10000000-0000-4000-8000-000000000102";
const attestationId = "10000000-0000-4000-8000-000000000103";
const transcript = "शिव कथा";

function request() {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/narration-upload/${uploadVersionId}/confirm`,
    {
      body: JSON.stringify({
        configurationCandidateId,
        expectedConfigurationVersion: 4,
        workspaceId,
      }),
      headers: {
        "content-type": "application/json",
        origin: "https://genie.example",
        "x-idempotency-key": "narration-confirm-test-0001",
      },
      method: "POST",
    },
  );
}

describe("owner narration confirmation route", () => {
  beforeEach(() => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(attestationId);
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mocks.maybeSingle.mockResolvedValue({
      data: {
        state: "verified",
        state_version: 2,
        transcription_sha256: createHash("sha256")
          .update(transcript, "utf8")
          .digest("hex"),
        transcription_text: transcript,
      },
      error: null,
    });
    mocks.adminRpc
      .mockResolvedValueOnce({ data: attestationId, error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.authenticatedRpc.mockResolvedValue({
      data: {
        configurationVersion: 5,
        episodeVersion: 5,
        ok: true,
        scriptRevisionId: "10000000-0000-4000-8000-000000000130",
      },
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    query.eq.mockClear();
    query.select.mockClear();
  });

  it("attests and confirms the transcribed audio as the next immutable source", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId, uploadVersionId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "attest_script_coordinate_map",
      expect.objectContaining({
        p_actor_user_id: userId,
        p_episode_id: episodeId,
        p_raw_utf8_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        p_workspace_id: workspaceId,
      }),
    );
    expect(mocks.authenticatedRpc).toHaveBeenCalledWith(
      "command_confirm_episode_narration_upload",
      expect.objectContaining({
        p_duration_acknowledged: true,
        p_expected_upload_state_version: 2,
        p_raw_text: transcript,
        p_upload_version_id: uploadVersionId,
      }),
    );
  });

  it("does not create authority unless the upload is verified", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        state: "prepared",
        state_version: 1,
        transcription_sha256: null,
        transcription_text: null,
      },
      error: null,
    });
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId, uploadVersionId }),
    });
    expect(response.status).toBe(409);
    expect(mocks.adminRpc).not.toHaveBeenCalled();
    expect(mocks.authenticatedRpc).not.toHaveBeenCalled();
  });
});

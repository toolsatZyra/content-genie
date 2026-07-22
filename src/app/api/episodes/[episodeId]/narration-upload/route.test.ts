import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticatedRpc: vi.fn(),
  getUser: vi.fn(),
  processNarrationUpload: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    rpc: mocks.authenticatedRpc,
  }),
}));
vi.mock("@/server/narration-upload-processor", () => ({
  NarrationUploadProcessingError: class NarrationUploadProcessingError extends Error {
    constructor(
      message: string,
      readonly safeClass: string,
      readonly retryable: boolean,
    ) {
      super(message);
    }
  },
  parseNarrationUploadPreparation: (value: unknown) => value,
  processNarrationUpload: mocks.processNarrationUpload,
}));

import { POST } from "./route";

const episodeId = "10000000-0000-4000-8000-000000000110";
const workspaceId = "10000000-0000-4000-8000-000000000101";
const configurationCandidateId = "10000000-0000-4000-8000-000000000120";
const uploadVersionId = "10000000-0000-4000-8000-000000000121";

function mp3Bytes(): Uint8Array {
  const bytes = new Uint8Array(1_200);
  bytes.set(new TextEncoder().encode("ID3"), 0);
  return bytes;
}

function request(): NextRequest {
  return new NextRequest(
    `https://genie.example/api/episodes/${episodeId}/narration-upload`,
    {
      body: Buffer.from(mp3Bytes()),
      headers: {
        "content-type": "audio/mpeg",
        origin: "https://genie.example",
        "x-genie-configuration-candidate-id": configurationCandidateId,
        "x-genie-display-filename": encodeURIComponent("मेरी कथा.mp3"),
        "x-genie-expected-configuration-version": "4",
        "x-genie-workspace-id": workspaceId,
        "x-idempotency-key": "narration-upload-test-0001",
      },
      method: "POST",
    },
  );
}

describe("owner narration upload route", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "10000000-0000-4000-8000-000000000102" } },
      error: null,
    });
    mocks.authenticatedRpc.mockResolvedValue({
      data: {
        ok: true,
        quarantineAssetVersionId: "10000000-0000-4000-8000-000000000122",
        stableAssetId: "10000000-0000-4000-8000-000000000123",
        state: "prepared",
        stateVersion: 1,
        uploadVersionId,
        versionNumber: 1,
      },
      error: null,
    });
    mocks.processNarrationUpload.mockResolvedValue({
      assetVersionId: "10000000-0000-4000-8000-000000000124",
      comparisonEvidence: { exactMatch: false },
      durationMs: 91_000,
      originalFilename: "मेरी कथा.mp3",
      signedUrl: "https://signed.example/audio",
      state: "verified",
      transcriptionText: "शिव कथा",
      uploadVersionId,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("prepares and processes the exact authenticated audio bytes", async () => {
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(mocks.authenticatedRpc).toHaveBeenCalledWith(
      "command_prepare_episode_narration_upload",
      expect.objectContaining({
        p_configuration_candidate_id: configurationCandidateId,
        p_declared_mime: "audio/mpeg",
        p_episode_id: episodeId,
        p_workspace_id: workspaceId,
      }),
    );
    expect(mocks.processNarrationUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        declaredMime: "audio/mpeg",
        workspaceId,
      }),
    );
  });

  it("authenticates before reading and processing uploaded media", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(request(), {
      params: Promise.resolve({ episodeId }),
    });
    expect(response.status).toBe(401);
    expect(mocks.authenticatedRpc).not.toHaveBeenCalled();
    expect(mocks.processNarrationUpload).not.toHaveBeenCalled();
  });
});

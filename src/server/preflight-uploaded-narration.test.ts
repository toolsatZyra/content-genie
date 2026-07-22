import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAudio: vi.fn(),
  getExecutionInput: vi.fn(),
  getConfirmedUploadedNarrationAssetVersionId: vi.fn(),
  getNarrationSourceKind: vi.fn(),
  getSelection: vi.fn(),
  prepareProvider: vi.fn(),
  prepareUploadedClock: vi.fn(),
  recordOutput: vi.fn(),
}));

vi.mock("@/server/audio-identity-preflight", () => ({
  ensurePreflightAudioIdentities: mocks.ensureAudio,
}));
vi.mock("@/server/narration-provider", () => ({
  prepareNarrationProviderDispatches: mocks.prepareProvider,
}));
vi.mock("@/server/uploaded-narration-clock", () => ({
  UploadedNarrationClockError: class UploadedNarrationClockError extends Error {
    constructor(
      message: string,
      readonly safeClass: string,
      readonly retryable: boolean,
    ) {
      super(message);
    }
  },
  getConfirmedUploadedNarrationAssetVersionId:
    mocks.getConfirmedUploadedNarrationAssetVersionId,
  getNarrationSourceKind: mocks.getNarrationSourceKind,
  prepareUploadedNarrationMasterClock: mocks.prepareUploadedClock,
}));
vi.mock("@/server/preflight-control-ledger", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/preflight-control-ledger")
  >("@/server/preflight-control-ledger");
  return {
    ...actual,
    getPreflightControlExecutionInput: mocks.getExecutionInput,
    getVerifiedPreflightAudioIdentitySelection: mocks.getSelection,
    recordPreflightControlOutput: mocks.recordOutput,
  };
});

import { executePreflightControl } from "@/server/preflight-control-executor";

const envelope = Object.freeze({
  authorityEpoch: 1,
  capabilityGrantId: null,
  fencingToken: 2,
  inputManifestId: "10000000-0000-4000-8000-000000000001",
  inputManifestSha256: "a".repeat(64),
  preflightRunId: "10000000-0000-4000-8000-000000000002",
  schemaVersion: "genie.preflight-task.v1" as const,
  stageAttemptId: "10000000-0000-4000-8000-000000000003",
  stageRunId: "10000000-0000-4000-8000-000000000004",
  workspaceId: "10000000-0000-4000-8000-000000000005",
});

describe("uploaded narration preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExecutionInput.mockResolvedValue({
      configurationCandidateId: "20000000-0000-4000-8000-000000000001",
      episodeId: "20000000-0000-4000-8000-000000000002",
      kind: "narration_clock",
      lockedLookBlockSha256: "b".repeat(64),
      lookKey: "glowing-divine-realism",
      lookVersionId: "20000000-0000-4000-8000-000000000003",
      narratorGender: "male",
      policyVersionId: "20000000-0000-4000-8000-000000000004",
      preflightRunId: envelope.preflightRunId,
      processingScalarCount: 4,
      processingText: "कथा",
      processingTextSha256: "c".repeat(64),
      rawScript: "कथा",
      rawScriptSha256: "c".repeat(64),
      scriptRevisionId: "20000000-0000-4000-8000-000000000005",
      voiceVersionId: "20000000-0000-4000-8000-000000000006",
      workspaceId: envelope.workspaceId,
    });
    mocks.ensureAudio.mockResolvedValue({
      replayed: false,
      selectionId: "30000000-0000-4000-8000-000000000001",
    });
    mocks.getSelection.mockResolvedValue("30000000-0000-4000-8000-000000000001");
    mocks.getNarrationSourceKind.mockResolvedValue("uploaded_audio");
    mocks.getConfirmedUploadedNarrationAssetVersionId.mockResolvedValue(
      "30000000-0000-4000-8000-000000000005",
    );
    mocks.prepareUploadedClock.mockResolvedValue({
      durationMs: 91_000,
      masterClockVersionId: "30000000-0000-4000-8000-000000000002",
      narrationAssetVersionId: "30000000-0000-4000-8000-000000000003",
      narrationUploadVersionId: "30000000-0000-4000-8000-000000000004",
      segmentCount: 12,
    });
    mocks.recordOutput.mockResolvedValue({
      ok: true,
      stageAttemptId: envelope.stageAttemptId,
      stageRunId: envelope.stageRunId,
      state: "succeeded",
    });
  });

  it("publishes the uploaded master clock without dispatching ElevenLabs", async () => {
    const result = await executePreflightControl({
      envelope,
      taskId: "task-1",
      triggerRunId: "trigger-1",
    });

    expect(result.pendingExternal).toBe(false);
    expect(result.providerDispatches).toEqual([]);
    expect(mocks.prepareProvider).not.toHaveBeenCalled();
    expect(mocks.ensureAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        humanRecordingAssetVersionId: "30000000-0000-4000-8000-000000000005",
      }),
    );
    expect(mocks.prepareUploadedClock).toHaveBeenCalledWith(
      expect.objectContaining({
        audioIdentitySelectionId: "30000000-0000-4000-8000-000000000001",
      }),
    );
    expect(mocks.recordOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({
          narrationSourceKind: "uploaded_audio",
          schemaVersion: "genie.uploaded-narration-clock.v1",
        }),
      }),
    );
  });

  it("retains the ElevenLabs dispatch path for generated narration", async () => {
    mocks.getNarrationSourceKind.mockResolvedValue("elevenlabs_v3");
    mocks.prepareProvider.mockResolvedValue([
      { operation: "gen_speech", providerRequestId: "request-1" },
    ]);

    const result = await executePreflightControl({
      envelope,
      taskId: "task-1",
      triggerRunId: "trigger-1",
    });

    expect(result.pendingExternal).toBe(true);
    expect(result.providerDispatches).toHaveLength(1);
    expect(mocks.prepareProvider).toHaveBeenCalledOnce();
    expect(mocks.getConfirmedUploadedNarrationAssetVersionId).not.toHaveBeenCalled();
    expect(mocks.ensureAudio).toHaveBeenCalledWith(
      expect.objectContaining({ humanRecordingAssetVersionId: null }),
    );
    expect(mocks.prepareUploadedClock).not.toHaveBeenCalled();
  });
});

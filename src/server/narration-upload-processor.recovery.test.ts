import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  compare: vi.fn(),
  createAdmin: vi.fn(),
  rpc: vi.fn(),
  scan: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: mocks.createAdmin,
}));
vi.mock("@/server/sandbox-media-scanner", () => ({
  SandboxMediaScannerError: class SandboxMediaScannerError extends Error {},
  scanAndReencodeNarrationAudio: mocks.scan,
}));
vi.mock("@/server/uploaded-narration-alignment", () => ({
  UploadedNarrationAlignmentError: class UploadedNarrationAlignmentError extends Error {},
  compareUploadedNarrationToOriginalScript: mocks.compare,
  transcribeSanitizedUploadedNarrationMp3: mocks.transcribe,
}));

import {
  deterministicNarrationUploadUuid,
  processNarrationUpload,
} from "@/server/narration-upload-processor";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const stableAssetId = "10000000-0000-4000-8000-000000000002";
const quarantineAssetVersionId = "10000000-0000-4000-8000-000000000003";
const uploadVersionId = "10000000-0000-4000-8000-000000000004";
const policyVersionId = "10000000-0000-4000-8000-000000000005";
const originalScriptRevisionId = "10000000-0000-4000-8000-000000000006";
const sourceBytes = Buffer.from("owner-audio-source");
const sanitizedBytes = Buffer.from("sanitized-owner-audio");
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const assetVersionId = deterministicNarrationUploadUuid(
  uploadVersionId,
  "asset-version",
);
const attestationId = deterministicNarrationUploadUuid(uploadVersionId, "attestation");

const preparedRow = {
  alignment_hash: null,
  display_filename: "owner.wav",
  duration_ms: null,
  original_script_revision_id: originalScriptRevisionId,
  promoted_asset_version_id: null,
  script_comparison_json: null,
  state: "prepared",
  transcription_text: null,
};
const verifiedRow = {
  ...preparedRow,
  alignment_hash: "a".repeat(64),
  duration_ms: 81_000,
  promoted_asset_version_id: assetVersionId,
  script_comparison_json: { matchesOriginalScript: false },
  state: "verified",
  transcription_text: "Spoken owner narration.",
};

function processingState(
  retainedAttestationId: string | null,
): Record<string, unknown> {
  return {
    attestationId: retainedAttestationId,
    attestationPolicyVersionId: retainedAttestationId ? policyVersionId : null,
    promotedAssetVersionId: null,
    state: "prepared",
    stateVersion: 1,
    uploadVersionId,
  };
}

function makeClient(uploadResults: Array<{ data: unknown; error: unknown }>) {
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const storage = vi.fn((bucket: string) => ({
    createSignedUrl: vi.fn(async () => ({
      data: { signedUrl: "https://signed.example/owner.mp3" },
      error: null,
    })),
    download: vi.fn(),
    info: vi.fn(async () => ({
      data: { id: `${bucket}-object-id`, version: `${bucket}-version` },
      error: null,
    })),
    remove,
    upload: vi.fn(async () => ({
      data: { id: `${bucket}-object-id` },
      error: null,
    })),
  }));
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["eq", "select"]) {
      builder[method] = vi.fn(() => builder);
    }
    builder.single = vi.fn(async () => {
      if (table === "episode_narration_upload_versions") {
        const result = uploadResults.shift();
        if (!result) throw new Error("Missing upload-row fixture");
        return result;
      }
      if (table === "script_revisions") {
        return { data: { raw_text: "Earlier script." }, error: null };
      }
      if (table === "asset_versions") {
        return {
          data: {
            bucket_id: "workspace-media",
            media_mime: "audio/mpeg",
            object_name: `${workspaceId}/narration/${stableAssetId}/${assetVersionId}/source`,
          },
          error: null,
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    return builder;
  });
  const client = { from, rpc: mocks.rpc, storage: { from: storage } };
  return { client, remove };
}

const input = {
  bytes: sourceBytes,
  declaredMime: "audio/wav" as const,
  preparation: {
    quarantineAssetVersionId,
    stableAssetId,
    state: "prepared" as const,
    stateVersion: 1,
    uploadVersionId,
    versionNumber: 1,
  },
  requestHash: "b".repeat(64),
  sourceSha256: sha256(sourceBytes),
  workspaceId,
};

describe("narration upload interrupted retry recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.scan.mockResolvedValue({
      audibleSeamsDetected: false,
      clippingDetected: false,
      corruptFramesDetected: false,
      decompressedBytes: 50_000,
      durationMs: 81_000,
      outputBytes: sanitizedBytes,
      outputSha256: sha256(sanitizedBytes),
      probeSha256: "c".repeat(64),
      scanEngine: "fixture-scanner",
      scanVersion: "fixture-v1",
      timeScale: 1,
      unintendedSilenceDetected: false,
    });
    mocks.transcribe.mockResolvedValue({
      alignmentSha256: "d".repeat(64),
      authoritativeText: "Spoken owner narration.",
      durationSeconds: 81,
      evidenceSha256: "e".repeat(64),
      language: "hi",
      providerResponseSha256: "f".repeat(64),
      speechAlignment: {
        characterEndTimesSeconds: [0.2],
        characters: ["S"],
        characterStartTimesSeconds: [0],
      },
      transcriptSha256: createHash("sha256")
        .update("Spoken owner narration.")
        .digest("hex"),
      wordCount: 3,
    });
    mocks.compare.mockReturnValue({ matchesOriginalScript: false });
  });

  it("reuses the retained attestation ID after the first response is lost", async () => {
    const { client, remove } = makeClient([
      { data: preparedRow, error: null },
      { data: preparedRow, error: null },
      { data: preparedRow, error: null },
      { data: preparedRow, error: null },
      { data: verifiedRow, error: null },
    ]);
    mocks.createAdmin.mockReturnValue(client);
    const attestationCalls: Array<Record<string, unknown>> = [];
    let processingStateCall = 0;
    let attestationCall = 0;
    mocks.rpc.mockImplementation(
      async (name: string, parameters: Record<string, unknown>) => {
        if (name === "get_episode_narration_upload_processing_state") {
          processingStateCall += 1;
          return {
            data: processingState(processingStateCall === 1 ? null : attestationId),
            error: null,
          };
        }
        if (name === "get_active_narration_upload_ingest_policy") {
          return {
            data: { id: policyVersionId, policy: {}, policyHash: "1".repeat(64) },
            error: null,
          };
        }
        if (name === "command_attest_episode_narration_upload") {
          attestationCalls.push(parameters);
          attestationCall += 1;
          return attestationCall === 1
            ? { data: null, error: { message: "response lost" } }
            : { data: attestationId, error: null };
        }
        if (name === "command_promote_episode_narration_upload") {
          return { data: { assetVersionId }, error: null };
        }
        return { data: {}, error: null };
      },
    );

    await expect(processNarrationUpload(input)).rejects.toMatchObject({
      retryable: true,
      safeClass: "narration_upload.ledger_rejected",
    });
    await expect(processNarrationUpload(input)).resolves.toMatchObject({
      assetVersionId,
      state: "verified",
    });

    expect(attestationCalls).toHaveLength(2);
    expect(attestationCalls.map((call) => call.p_attestation_id)).toEqual([
      attestationId,
      attestationId,
    ]);
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === "get_active_narration_upload_ingest_policy",
      ),
    ).toHaveLength(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("retains the final object when post-promotion projection or signing fails", async () => {
    const transient = { message: "query unavailable" };
    const { client, remove } = makeClient([
      { data: preparedRow, error: null },
      { data: preparedRow, error: null },
      { data: null, error: transient },
      { data: verifiedRow, error: null },
    ]);
    mocks.createAdmin.mockReturnValue(client);
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "get_episode_narration_upload_processing_state") {
        return { data: processingState(null), error: null };
      }
      if (name === "get_active_narration_upload_ingest_policy") {
        return {
          data: { id: policyVersionId, policy: {}, policyHash: "1".repeat(64) },
          error: null,
        };
      }
      if (name === "command_attest_episode_narration_upload") {
        return { data: attestationId, error: null };
      }
      if (name === "command_promote_episode_narration_upload") {
        return { data: { assetVersionId }, error: null };
      }
      return { data: {}, error: null };
    });

    await expect(processNarrationUpload(input)).rejects.toMatchObject({
      retryable: true,
      safeClass: "narration_upload.evidence_unavailable",
    });
    expect(remove).not.toHaveBeenCalled();

    await expect(processNarrationUpload(input)).resolves.toMatchObject({
      assetVersionId,
      signedUrl: "https://signed.example/owner.mp3",
    });
    expect(mocks.scan).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });
});

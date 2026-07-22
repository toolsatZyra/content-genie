import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  deterministicNarrationUploadUuid,
  NarrationUploadProcessingError,
  parseNarrationUploadPreparation,
  parseNarrationUploadProcessingState,
} from "@/server/narration-upload-processor";
import { postgresJsonbText } from "@/server/world-anchor-provider";

const preparation = {
  ok: true,
  quarantineAssetVersionId: "10000000-0000-4000-8000-000000000001",
  stableAssetId: "10000000-0000-4000-8000-000000000002",
  state: "prepared",
  stateVersion: 1,
  uploadVersionId: "10000000-0000-4000-8000-000000000003",
  versionNumber: 1,
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("narration upload processing authority", () => {
  it("accepts the exact prepared authority envelope", () => {
    expect(parseNarrationUploadPreparation(preparation)).toEqual(
      expect.objectContaining({ state: "prepared", stateVersion: 1 }),
    );
  });

  it("rejects missing, additional, and invalid state evidence", () => {
    const { versionNumber: _missing, ...missing } = preparation;
    void _missing;
    expect(() => parseNarrationUploadPreparation(missing)).toThrow(
      NarrationUploadProcessingError,
    );
    expect(() =>
      parseNarrationUploadPreparation({ ...preparation, hidden: true }),
    ).toThrow(NarrationUploadProcessingError);
    expect(() =>
      parseNarrationUploadPreparation({ ...preparation, state: "complete" }),
    ).toThrow(NarrationUploadProcessingError);
  });

  it("derives stable, purpose-separated UUIDs for retry authority", () => {
    const attestation = deterministicNarrationUploadUuid(
      preparation.uploadVersionId,
      "attestation",
    );
    expect(attestation).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(
      deterministicNarrationUploadUuid(preparation.uploadVersionId, "attestation"),
    ).toBe(attestation);
    expect(
      deterministicNarrationUploadUuid(preparation.uploadVersionId, "asset-version"),
    ).not.toBe(attestation);
  });

  it("accepts only a complete, internally bound retained attestation", () => {
    const alignmentJson = { characters: ["S"] };
    const scriptComparisonJson = { matchesOriginalScript: false };
    const qualityEvidence = { schemaVersion: "quality.v1" };
    const transcriptionText = "Spoken owner narration.";
    const state = {
      attestation: {
        alignmentHash: hash(postgresJsonbText(alignmentJson)),
        alignmentJson,
        decompressedBytes: 50_000,
        durationMs: 81_000,
        id: "10000000-0000-4000-8000-000000000004",
        policyVersionId: "10000000-0000-4000-8000-000000000005",
        probeSha256: "1".repeat(64),
        quarantineAssetVersionId: "10000000-0000-4000-8000-000000000006",
        qualityEvidence,
        qualityEvidenceHash: hash(postgresJsonbText(qualityEvidence)),
        sanitizedByteLength: 20_000,
        sanitizedMime: "audio/mpeg",
        sanitizedSha256: "2".repeat(64),
        scanEngine: "ClamAV.FFmpeg",
        scanVersion: "scanner-v1",
        scriptComparisonHash: hash(postgresJsonbText(scriptComparisonJson)),
        scriptComparisonJson,
        sourceByteLength: 21_000,
        sourceMime: "audio/wav",
        sourceSha256: "3".repeat(64),
        transcriptionSha256: hash(transcriptionText),
        transcriptionText,
      },
      promotedAssetVersionId: null,
      state: "prepared",
      stateVersion: 1,
      uploadVersionId: preparation.uploadVersionId,
    };
    expect(parseNarrationUploadProcessingState(state)).toEqual(state);
    expect(() =>
      parseNarrationUploadProcessingState({
        ...state,
        attestation: {
          ...state.attestation,
          transcriptionText: "Different transcription.",
        },
      }),
    ).toThrow(NarrationUploadProcessingError);
  });
});

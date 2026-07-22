import { describe, expect, it } from "vitest";

import {
  deterministicNarrationUploadUuid,
  NarrationUploadProcessingError,
  parseNarrationUploadPreparation,
  parseNarrationUploadProcessingState,
} from "@/server/narration-upload-processor";

const preparation = {
  ok: true,
  quarantineAssetVersionId: "10000000-0000-4000-8000-000000000001",
  stableAssetId: "10000000-0000-4000-8000-000000000002",
  state: "prepared",
  stateVersion: 1,
  uploadVersionId: "10000000-0000-4000-8000-000000000003",
  versionNumber: 1,
};

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

  it("accepts only a paired retained attestation and policy identity", () => {
    const state = {
      attestationId: "10000000-0000-4000-8000-000000000004",
      attestationPolicyVersionId: "10000000-0000-4000-8000-000000000005",
      promotedAssetVersionId: null,
      state: "prepared",
      stateVersion: 1,
      uploadVersionId: preparation.uploadVersionId,
    };
    expect(parseNarrationUploadProcessingState(state)).toEqual(state);
    expect(() =>
      parseNarrationUploadProcessingState({
        ...state,
        attestationPolicyVersionId: null,
      }),
    ).toThrow(NarrationUploadProcessingError);
  });
});

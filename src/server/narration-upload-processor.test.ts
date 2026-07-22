import { describe, expect, it } from "vitest";

import {
  NarrationUploadProcessingError,
  parseNarrationUploadPreparation,
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
});

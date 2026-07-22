import { describe, expect, it } from "vitest";

import {
  hashNarrationConfirmationRequest,
  hashNarrationUploadRequest,
  NarrationUploadContractError,
  parseNarrationUploadConfirmation,
  parseNarrationUploadHeaders,
} from "@/domain/narration/narration-upload";

const episodeId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const configurationCandidateId = "33333333-3333-4333-8333-333333333333";

function uploadHeaders() {
  return new Headers({
    "x-genie-configuration-candidate-id": configurationCandidateId,
    "x-genie-display-filename": encodeURIComponent("मेरी कथा.wav"),
    "x-genie-expected-configuration-version": "7",
    "x-genie-workspace-id": workspaceId,
  });
}

describe("owner narration upload contract", () => {
  it("parses the bounded upload authority headers", () => {
    expect(parseNarrationUploadHeaders(uploadHeaders(), episodeId)).toEqual({
      configurationCandidateId,
      displayFilename: "मेरी कथा.wav",
      episodeId,
      expectedConfigurationVersion: 7,
      workspaceId,
    });
  });

  it("rejects invalid filenames and configuration versions", () => {
    const headers = uploadHeaders();
    headers.set("x-genie-display-filename", encodeURIComponent("bad\nfile.wav"));
    expect(() => parseNarrationUploadHeaders(headers, episodeId)).toThrow(
      NarrationUploadContractError,
    );
    headers.set("x-genie-display-filename", "narration.wav");
    headers.set("x-genie-expected-configuration-version", "0");
    expect(() => parseNarrationUploadHeaders(headers, episodeId)).toThrow(
      "must be positive",
    );
  });

  it("parses only the exact confirmation body", () => {
    const input = {
      configurationCandidateId,
      expectedConfigurationVersion: 7,
      workspaceId,
    };
    expect(parseNarrationUploadConfirmation(input)).toEqual(input);
    expect(() =>
      parseNarrationUploadConfirmation({ ...input, silentlyOverride: true }),
    ).toThrow(NarrationUploadContractError);
  });

  it("binds upload bytes and confirmation authority into stable request hashes", () => {
    const metadata = parseNarrationUploadHeaders(uploadHeaders(), episodeId);
    const first = hashNarrationUploadRequest({
      byteLength: 100,
      contentSha256: "a".repeat(64),
      declaredMime: "audio/wav",
      idempotencyKey: "upload-attempt-0001",
      metadata,
    });
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(
      hashNarrationUploadRequest({
        byteLength: 101,
        contentSha256: "a".repeat(64),
        declaredMime: "audio/wav",
        idempotencyKey: "upload-attempt-0001",
        metadata,
      }),
    ).not.toBe(first);

    const confirmation = parseNarrationUploadConfirmation({
      configurationCandidateId,
      expectedConfigurationVersion: 7,
      workspaceId,
    });
    expect(
      hashNarrationConfirmationRequest({
        confirmation,
        episodeId,
        idempotencyKey: "confirmation-0001",
        transcriptSha256: "b".repeat(64),
        uploadStateVersion: 2,
        uploadVersionId: "44444444-4444-4444-8444-444444444444",
      }),
    ).toMatch(/^[a-f0-9]{64}$/u);
  });
});

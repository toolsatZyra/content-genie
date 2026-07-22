import { createHash } from "node:crypto";

import {
  assertExactPayloadKeys,
  canonicalJson,
  integerValue,
  uuidValue,
} from "@/security/command-envelope";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type NarrationUploadMime = "audio/mpeg" | "audio/wav";

export type NarrationUploadInput = Readonly<{
  configurationCandidateId: string;
  displayFilename: string;
  episodeId: string;
  expectedConfigurationVersion: number;
  workspaceId: string;
}>;

export type NarrationUploadConfirmation = Readonly<{
  configurationCandidateId: string;
  expectedConfigurationVersion: number;
  workspaceId: string;
}>;

export class NarrationUploadContractError extends Error {
  override readonly name = "NarrationUploadContractError";
}

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name)?.trim() ?? "";
  if (!value) throw new NarrationUploadContractError(`${name} is required.`);
  return value;
}

function uuidHeader(headers: Headers, name: string): string {
  const value = requiredHeader(headers, name);
  if (!uuidPattern.test(value)) {
    throw new NarrationUploadContractError(`${name} must be a UUID.`);
  }
  return value.toLowerCase();
}

function positiveIntegerHeader(headers: Headers, name: string): number {
  const value = requiredHeader(headers, name);
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new NarrationUploadContractError(`${name} must be positive.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new NarrationUploadContractError(`${name} is too large.`);
  }
  return parsed;
}

function parseDisplayFilename(headers: Headers): string {
  let value: string;
  try {
    value = decodeURIComponent(requiredHeader(headers, "x-genie-display-filename"));
  } catch {
    throw new NarrationUploadContractError("Upload filename encoding is invalid.");
  }
  if (value.length < 1 || value.length > 255 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new NarrationUploadContractError("Upload filename is invalid.");
  }
  return value;
}

export function parseNarrationUploadHeaders(
  headers: Headers,
  episodeId: string,
): NarrationUploadInput {
  if (!uuidPattern.test(episodeId)) {
    throw new NarrationUploadContractError("Episode ID must be a UUID.");
  }
  return Object.freeze({
    configurationCandidateId: uuidHeader(headers, "x-genie-configuration-candidate-id"),
    displayFilename: parseDisplayFilename(headers),
    episodeId: episodeId.toLowerCase(),
    expectedConfigurationVersion: positiveIntegerHeader(
      headers,
      "x-genie-expected-configuration-version",
    ),
    workspaceId: uuidHeader(headers, "x-genie-workspace-id"),
  });
}

export function parseNarrationUploadConfirmation(
  value: unknown,
): NarrationUploadConfirmation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NarrationUploadContractError("Confirmation body must be an object.");
  }
  const payload = value as Record<string, unknown>;
  try {
    assertExactPayloadKeys(payload, [
      "configurationCandidateId",
      "expectedConfigurationVersion",
      "workspaceId",
    ]);
    return Object.freeze({
      configurationCandidateId: uuidValue(payload, "configurationCandidateId"),
      expectedConfigurationVersion: integerValue(
        payload,
        "expectedConfigurationVersion",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      workspaceId: uuidValue(payload, "workspaceId"),
    });
  } catch (error) {
    throw new NarrationUploadContractError(
      error instanceof Error ? error.message : "Confirmation body is invalid.",
    );
  }
}

export function hashNarrationUploadRequest(input: {
  byteLength: number;
  contentSha256: string;
  declaredMime: NarrationUploadMime;
  idempotencyKey: string;
  metadata: NarrationUploadInput;
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        ...input,
        schemaVersion: "genie.owner-narration-upload-request.v1",
      }),
      "utf8",
    )
    .digest("hex");
}

export function hashNarrationConfirmationRequest(input: {
  confirmation: NarrationUploadConfirmation;
  episodeId: string;
  idempotencyKey: string;
  transcriptSha256: string;
  uploadStateVersion: number;
  uploadVersionId: string;
}): string {
  if (!uuidPattern.test(input.episodeId) || !uuidPattern.test(input.uploadVersionId)) {
    throw new NarrationUploadContractError("Narration confirmation IDs are invalid.");
  }
  if (
    !/^[a-f0-9]{64}$/u.test(input.transcriptSha256) ||
    !Number.isSafeInteger(input.uploadStateVersion) ||
    input.uploadStateVersion < 1
  ) {
    throw new NarrationUploadContractError(
      "Narration confirmation evidence is invalid.",
    );
  }
  return createHash("sha256")
    .update(
      canonicalJson({
        ...input,
        schemaVersion: "genie.owner-narration-confirmation-request.v1",
      }),
      "utf8",
    )
    .digest("hex");
}

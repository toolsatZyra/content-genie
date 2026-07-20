import { createHash } from "node:crypto";

import { canonicalJson } from "@/security/command-envelope";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type WorldUploadInput = Readonly<{
  candidateVersionId: string;
  configurationCandidateId: string;
  displayFilename: string;
  entityId: string;
  entityKind: "character" | "location";
  episodeId: string;
  expectedSelectionVersion: number;
  workspaceId: string;
}>;

export class WorldUploadContractError extends Error {
  override readonly name = "WorldUploadContractError";
}

function requiredHeader(headers: Headers, name: string): string {
  const value = headers.get(name)?.trim() ?? "";
  if (!value) throw new WorldUploadContractError(`${name} is required.`);
  return value;
}

function uuidHeader(headers: Headers, name: string): string {
  const value = requiredHeader(headers, name);
  if (!uuidPattern.test(value)) {
    throw new WorldUploadContractError(`${name} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function parseWorldUploadHeaders(
  headers: Headers,
  episodeId: string,
): WorldUploadInput {
  if (!uuidPattern.test(episodeId)) {
    throw new WorldUploadContractError("Episode ID must be a UUID.");
  }
  const entityKind = requiredHeader(headers, "x-genie-entity-kind");
  if (entityKind !== "character" && entityKind !== "location") {
    throw new WorldUploadContractError("World entity kind is unsupported.");
  }
  const versionText = requiredHeader(headers, "x-genie-selection-version");
  if (!/^[1-9][0-9]*$/u.test(versionText)) {
    throw new WorldUploadContractError("Selection version must be positive.");
  }
  const expectedSelectionVersion = Number(versionText);
  if (!Number.isSafeInteger(expectedSelectionVersion)) {
    throw new WorldUploadContractError("Selection version is too large.");
  }
  let displayFilename: string;
  try {
    displayFilename = decodeURIComponent(
      requiredHeader(headers, "x-genie-upload-name"),
    );
  } catch {
    throw new WorldUploadContractError("Upload filename encoding is invalid.");
  }
  if (
    displayFilename.length < 1 ||
    displayFilename.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(displayFilename)
  ) {
    throw new WorldUploadContractError("Upload filename is invalid.");
  }
  return Object.freeze({
    candidateVersionId: uuidHeader(headers, "x-genie-candidate-version-id"),
    configurationCandidateId: uuidHeader(headers, "x-genie-configuration-id"),
    displayFilename,
    entityId: uuidHeader(headers, "x-genie-entity-id"),
    entityKind,
    episodeId: episodeId.toLowerCase(),
    expectedSelectionVersion,
    workspaceId: uuidHeader(headers, "x-genie-workspace-id"),
  });
}

export function hashWorldUploadRequest(input: {
  byteLength: number;
  contentSha256: string;
  declaredMime: string;
  metadata: WorldUploadInput;
}): string {
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("hex");
}

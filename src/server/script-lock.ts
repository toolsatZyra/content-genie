import "server-only";

import { createHash } from "node:crypto";

import { ScriptIntegrityError, prepareBrowserScript } from "@/domain/script/integrity";
import {
  CommandValidationError,
  assertExactPayloadKeys,
  integerValue,
  newCommandIdentity,
  uuidValue,
} from "@/security/command-envelope";

export interface ScriptLockRequest {
  readonly durationAcknowledged: boolean;
  readonly episodeId: string;
  readonly expectedEpisodeVersion: number;
  readonly rawText: string;
  readonly workspaceId: string;
}

export interface PreparedScriptLockCommand {
  readonly parameters: Record<string, unknown>;
  readonly requestHash: string;
}

const RETRYABLE_SQLSTATE_CLASSES = new Set(["08", "53", "57", "58", "XX"]);
const RETRYABLE_SQLSTATES = new Set(["40003", "55P03", "57014"]);

export function mutationRpcFailureStatus(error: unknown): 400 | 409 | 503 {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
  if (code === "40001") return 409;
  if (
    typeof code === "string" &&
    /^[0-9A-Z]{5}$/.test(code) &&
    !RETRYABLE_SQLSTATE_CLASSES.has(code.slice(0, 2)) &&
    !RETRYABLE_SQLSTATES.has(code)
  ) {
    return 400;
  }
  return 503;
}

export function parseScriptLockRequest(value: unknown): ScriptLockRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandValidationError("Script lock body must be an object.");
  }
  const payload = value as Record<string, unknown>;
  assertExactPayloadKeys(payload, [
    "durationAcknowledged",
    "episodeId",
    "expectedEpisodeVersion",
    "rawText",
    "workspaceId",
  ]);
  if (typeof payload.rawText !== "string") {
    throw new CommandValidationError("rawText must be an exact string.");
  }
  if (typeof payload.durationAcknowledged !== "boolean") {
    throw new CommandValidationError("durationAcknowledged must be boolean.");
  }
  return {
    durationAcknowledged: payload.durationAcknowledged,
    episodeId: uuidValue(payload, "episodeId"),
    expectedEpisodeVersion: integerValue(
      payload,
      "expectedEpisodeVersion",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    rawText: payload.rawText,
    workspaceId: uuidValue(payload, "workspaceId"),
  };
}

function hashScriptLockRequest(
  request: ScriptLockRequest,
  rawUtf8: Uint8Array,
  idempotencyKey: string,
): string {
  const hash = createHash("sha256");
  for (const value of [
    "genie-script-lock.v1",
    request.workspaceId,
    request.episodeId,
    String(request.expectedEpisodeVersion),
    request.durationAcknowledged ? "acknowledged" : "not-acknowledged",
    idempotencyKey,
  ]) {
    hash.update(value, "utf8");
    hash.update("\0", "utf8");
  }
  hash.update(rawUtf8);
  return hash.digest("hex");
}

export function prepareScriptLockCommand(
  request: ScriptLockRequest,
  idempotencyKey: string,
): PreparedScriptLockCommand {
  const prepared = prepareBrowserScript(request.rawText);
  const identity = newCommandIdentity();
  const requestHash = hashScriptLockRequest(request, prepared.rawUtf8, idempotencyKey);
  return {
    parameters: {
      p_command_id: identity.commandId,
      p_coordinate_map: prepared.coordinateMap,
      p_correlation_id: identity.correlationId,
      p_duration_acknowledged: request.durationAcknowledged,
      p_episode_id: request.episodeId,
      p_expected_episode_version: request.expectedEpisodeVersion,
      p_idempotency_key: idempotencyKey,
      p_processing_grapheme_count: prepared.coordinateMap.p[2].length,
      p_processing_profile: prepared.processingProfile,
      p_processing_scalar_count: prepared.coordinateMap.p[0].length - 1,
      p_processing_text: prepared.processingText,
      p_processing_utf16_code_units: prepared.processingText.length,
      p_processing_utf8_sha256: prepared.processingUtf8Sha256,
      p_raw_grapheme_count: prepared.coordinateMap.r[2].length,
      p_raw_scalar_count: prepared.coordinateMap.r[0].length - 1,
      p_raw_text: prepared.rawText,
      p_raw_utf16_code_units: prepared.rawText.length,
      p_raw_utf8: `\\x${Buffer.from(prepared.rawUtf8).toString("hex")}`,
      p_raw_utf8_sha256: prepared.rawUtf8Sha256,
      p_request_hash: requestHash,
      p_runtime_evidence: prepared.runtimeEvidence,
      p_workspace_id: request.workspaceId,
    },
    requestHash,
  };
}

export { ScriptIntegrityError };

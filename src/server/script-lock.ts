import "server-only";

import { createHash } from "node:crypto";

import { ScriptIntegrityError, prepareBrowserScript } from "@/domain/script/integrity";
import {
  UploadedScriptError,
  decodeUploadedScriptBase64,
} from "@/domain/script/uploaded-text";
import {
  CommandValidationError,
  assertExactPayloadKeys,
  integerValue,
  newCommandIdentity,
  uuidValue,
} from "@/security/command-envelope";

interface ScriptLockRequestBase {
  readonly durationAcknowledged: boolean;
  readonly episodeId: string;
  readonly expectedEpisodeVersion: number;
  readonly workspaceId: string;
}

export interface BrowserScriptLockRequest extends ScriptLockRequestBase {
  readonly rawText: string;
  readonly sourceKind: "browser_text";
}

export interface UploadedScriptLockRequest extends ScriptLockRequestBase {
  readonly originalBytesBase64: string;
  readonly sourceKind: "uploaded_text";
}

export type ScriptLockRequest = BrowserScriptLockRequest | UploadedScriptLockRequest;

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
  const sourceKind = payload.sourceKind ?? "browser_text";
  if (sourceKind !== "browser_text" && sourceKind !== "uploaded_text") {
    throw new CommandValidationError(
      "sourceKind must identify a supported script source.",
    );
  }
  assertExactPayloadKeys(
    payload,
    sourceKind === "uploaded_text"
      ? [
          "durationAcknowledged",
          "episodeId",
          "expectedEpisodeVersion",
          "originalBytesBase64",
          "sourceKind",
          "workspaceId",
        ]
      : [
          "durationAcknowledged",
          "episodeId",
          "expectedEpisodeVersion",
          "rawText",
          "workspaceId",
        ],
  );
  if (typeof payload.durationAcknowledged !== "boolean") {
    throw new CommandValidationError("durationAcknowledged must be boolean.");
  }
  const common = {
    durationAcknowledged: payload.durationAcknowledged,
    episodeId: uuidValue(payload, "episodeId"),
    expectedEpisodeVersion: integerValue(
      payload,
      "expectedEpisodeVersion",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    workspaceId: uuidValue(payload, "workspaceId"),
  };
  if (sourceKind === "uploaded_text") {
    if (typeof payload.originalBytesBase64 !== "string") {
      throw new CommandValidationError("originalBytesBase64 must be an exact string.");
    }
    return { ...common, originalBytesBase64: payload.originalBytesBase64, sourceKind };
  }
  if (typeof payload.rawText !== "string") {
    throw new CommandValidationError("rawText must be an exact string.");
  }
  return { ...common, rawText: payload.rawText, sourceKind };
}

function hashScriptLockRequest(
  request: ScriptLockRequest,
  rawUtf8: Uint8Array,
  originalSourceBytes: Uint8Array | null,
  idempotencyKey: string,
): string {
  const hash = createHash("sha256");
  for (const value of [
    "genie-script-lock.v1",
    request.workspaceId,
    request.episodeId,
    String(request.expectedEpisodeVersion),
    request.durationAcknowledged ? "acknowledged" : "not-acknowledged",
    request.sourceKind,
    idempotencyKey,
  ]) {
    hash.update(value, "utf8");
    hash.update("\0", "utf8");
  }
  hash.update(rawUtf8);
  hash.update("\0", "utf8");
  if (originalSourceBytes) hash.update(originalSourceBytes);
  return hash.digest("hex");
}

export function prepareScriptLockCommand(
  request: ScriptLockRequest,
  idempotencyKey: string,
): PreparedScriptLockCommand {
  const uploaded =
    request.sourceKind === "uploaded_text"
      ? decodeUploadedScriptBase64(request.originalBytesBase64)
      : null;
  const prepared = prepareBrowserScript(
    request.sourceKind === "uploaded_text" ? uploaded!.text : request.rawText,
  );
  const identity = newCommandIdentity();
  const requestHash = hashScriptLockRequest(
    request,
    prepared.rawUtf8,
    uploaded?.originalBytes ?? null,
    idempotencyKey,
  );
  return {
    parameters: {
      p_command_id: identity.commandId,
      p_coordinate_map: prepared.coordinateMap,
      p_correlation_id: identity.correlationId,
      p_duration_acknowledged: request.durationAcknowledged,
      p_episode_id: request.episodeId,
      p_expected_episode_version: request.expectedEpisodeVersion,
      p_idempotency_key: idempotencyKey,
      p_original_source_bytes: uploaded
        ? `\\x${Buffer.from(uploaded.originalBytes).toString("hex")}`
        : null,
      p_original_source_sha256: uploaded?.encodingEvidence.originalSha256 ?? null,
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
      p_source_encoding_evidence:
        uploaded?.encodingEvidence ?? ({ kind: "browser-utf16" } as const),
      p_source_kind: request.sourceKind,
      p_workspace_id: request.workspaceId,
    },
    requestHash,
  };
}

export { ScriptIntegrityError, UploadedScriptError };

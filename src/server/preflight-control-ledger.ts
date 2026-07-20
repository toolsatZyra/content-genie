import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { PreflightControlRequest } from "@/domain/preflight/control-broker-contract";
import {
  parseWorldExtraction,
  type WorldExtraction,
} from "@/domain/agent/world-extraction";
import type { PreflightTaskEnvelope } from "../../trigger/preflight-contract";
import { PREFLIGHT_TASK_SCHEMA_VERSION } from "../../trigger/preflight-contract";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export class PreflightControlLedgerError extends Error {
  override readonly name = "PreflightControlLedgerError";

  constructor(
    message: string,
    readonly conflict = false,
  ) {
    super(message);
  }
}

export type PreflightControlExecutionInput = Readonly<{
  configurationCandidateId: string;
  episodeId: string;
  kind: "narration_clock" | "plan_evaluation" | "secure_ingest" | "world_anchor";
  lockedLookBlockSha256: string;
  lookKey: string;
  lookVersionId: string;
  narratorGender: "female" | "male";
  policyVersionId: string;
  preflightRunId: string;
  processingScalarCount: number;
  processingText: string;
  processingTextSha256: string;
  rawScript: string;
  rawScriptSha256: string;
  scriptRevisionId: string;
  voiceVersionId: string;
  workspaceId: string;
}>;

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    throw new PreflightControlLedgerError(
      "Preflight control ledger rejected the operation.",
      ["23505", "40001", "54000"].includes(error.code ?? ""),
    );
  }
  return data;
}

export async function consumePreflightControlAssertion(input: {
  clientId: string;
  environment: string;
  expiresAtSeconds: number;
  issuedAtSeconds: number;
  jti: string;
  kid: string;
  request: PreflightControlRequest;
  subject: string;
  triggerProject: string;
}): Promise<void> {
  const value = await rpc("command_consume_preflight_control_assertion", {
    p_assertion_expires_at: new Date(input.expiresAtSeconds * 1_000).toISOString(),
    p_assertion_issued_at: new Date(input.issuedAtSeconds * 1_000).toISOString(),
    p_assertion_jti: input.jti,
    p_assertion_subject: input.subject,
    p_client_id: input.clientId,
    p_environment: input.environment,
    p_kid: input.kid,
    p_operation: input.request.operation,
    p_preflight_run_id: input.request.preflightRunId,
    p_stage_attempt_id: input.request.stageAttemptId,
    p_trigger_project: input.triggerProject,
  });
  if (value !== true) {
    throw new PreflightControlLedgerError("Control assertion result is malformed.");
  }
}

type DispatchResult = Readonly<{
  authorityEpoch: number;
  fencingToken: number;
  inputManifestId: string;
  inputManifestSha256: string;
  kind: "narration_clock" | "plan_evaluation" | "secure_ingest" | "world_anchor";
  leaseId: string;
  ok: true;
  preflightRunId: string;
  replayed: boolean;
  stageAttemptId: string;
  stageRunId: string;
  workspaceId: string;
}>;

export async function dispatchPreflightControl(input: {
  preflightRunId: string;
  triggerRunId: string;
}): Promise<DispatchResult & { envelope: PreflightTaskEnvelope }> {
  const value = await rpc("command_dispatch_preflight_control", {
    p_lease_owner: `trigger:${input.triggerRunId}`,
    p_lease_seconds: 900,
    p_preflight_run_id: input.preflightRunId,
    p_trigger_run_id: input.triggerRunId,
  });
  const keys = [
    "authorityEpoch",
    "fencingToken",
    "inputManifestId",
    "inputManifestSha256",
    "kind",
    "leaseId",
    "ok",
    "preflightRunId",
    "replayed",
    "stageAttemptId",
    "stageRunId",
    "workspaceId",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    record.ok !== true ||
    typeof record.replayed !== "boolean" ||
    !["narration_clock", "plan_evaluation", "secure_ingest", "world_anchor"].includes(
      String(record.kind),
    ) ||
    !Number.isSafeInteger(record.authorityEpoch) ||
    !Number.isSafeInteger(record.fencingToken) ||
    [
      "inputManifestId",
      "inputManifestSha256",
      "leaseId",
      "preflightRunId",
      "stageAttemptId",
      "stageRunId",
      "workspaceId",
    ].some((key) => typeof record[key] !== "string")
  ) {
    throw new PreflightControlLedgerError("Dispatcher result is malformed.");
  }
  const result = value as DispatchResult;
  return Object.freeze({
    ...result,
    envelope: Object.freeze({
      authorityEpoch: result.authorityEpoch,
      capabilityGrantId: null,
      fencingToken: result.fencingToken,
      inputManifestId: result.inputManifestId,
      inputManifestSha256: result.inputManifestSha256,
      preflightRunId: result.preflightRunId,
      schemaVersion: PREFLIGHT_TASK_SCHEMA_VERSION,
      stageAttemptId: result.stageAttemptId,
      stageRunId: result.stageRunId,
      workspaceId: result.workspaceId,
    }),
  });
}

export async function recordPreflightControlOutput(input: {
  envelope: PreflightTaskEnvelope;
  output: Readonly<Record<string, unknown>>;
  taskId: string;
  triggerRunId: string;
}): Promise<{ ok: true; stageAttemptId: string; stageRunId: string; state: string }> {
  const outputManifestId = randomUUID();
  const outputManifest = {
    authorityEpoch: input.envelope.authorityEpoch,
    completedBy: "credential-free-trigger-control",
    fencingToken: input.envelope.fencingToken,
    inputManifestSha256: input.envelope.inputManifestSha256,
    output: input.output,
    preflightRunId: input.envelope.preflightRunId,
    schemaVersion: "genie.preflight-output.v1",
    stageAttemptId: input.envelope.stageAttemptId,
    stageRunId: input.envelope.stageRunId,
  };
  const value = await rpc("command_record_preflight_control_output", {
    p_authority_epoch: input.envelope.authorityEpoch,
    p_fencing_token: input.envelope.fencingToken,
    p_input_manifest_hash: input.envelope.inputManifestSha256,
    p_output_manifest: outputManifest,
    p_output_manifest_id: outputManifestId,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_trigger_run_id: input.triggerRunId,
    p_trigger_task_id: input.taskId,
  });
  if (
    !exactObject(value, ["ok", "stageAttemptId", "stageRunId", "state"]) ||
    (value as Record<string, unknown>).ok !== true ||
    (value as Record<string, unknown>).state !== "succeeded"
  ) {
    throw new PreflightControlLedgerError("Control output result is malformed.");
  }
  return value as {
    ok: true;
    stageAttemptId: string;
    stageRunId: string;
    state: string;
  };
}

export async function markWorldAnchorWaitingExternal(input: {
  envelope: PreflightTaskEnvelope;
  taskId: string;
  triggerRunId: string;
}): Promise<Readonly<{ ok: true; replayed: boolean; state: "waiting_external" }>> {
  const value = await rpc("command_mark_world_anchor_waiting_external", {
    p_preflight_run_id: input.envelope.preflightRunId,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_trigger_run_id: input.triggerRunId,
    p_trigger_task_id: input.taskId,
  });
  if (
    !exactObject(value, ["ok", "replayed", "state"]) ||
    (value as Record<string, unknown>).ok !== true ||
    typeof (value as Record<string, unknown>).replayed !== "boolean" ||
    (value as Record<string, unknown>).state !== "waiting_external"
  ) {
    throw new PreflightControlLedgerError("World anchor external wait is malformed.");
  }
  return value as { ok: true; replayed: boolean; state: "waiting_external" };
}

export async function failPreflightControl(input: {
  envelope: PreflightTaskEnvelope;
  retryable: boolean;
  safeErrorClass: string;
  taskId: string;
  triggerRunId: string;
}): Promise<
  Readonly<{
    attemptState: "failed_retryable" | "failed_terminal";
    ok: true;
    preflightRunId: string;
    replayed: boolean;
    retryScheduled: boolean;
    runState: "failed" | "queued";
    stageAttemptId: string;
    stageRunId: string;
    stageState: "created" | "failed_terminal";
  }>
> {
  const value = await rpc("command_fail_preflight_control", {
    p_authority_epoch: input.envelope.authorityEpoch,
    p_fencing_token: input.envelope.fencingToken,
    p_input_manifest_hash: input.envelope.inputManifestSha256,
    p_retryable: input.retryable,
    p_safe_error_class: input.safeErrorClass,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_trigger_run_id: input.triggerRunId,
    p_trigger_task_id: input.taskId,
  });
  const keys = [
    "attemptState",
    "ok",
    "preflightRunId",
    "replayed",
    "retryScheduled",
    "runState",
    "stageAttemptId",
    "stageRunId",
    "stageState",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    record.ok !== true ||
    typeof record.replayed !== "boolean" ||
    typeof record.retryScheduled !== "boolean" ||
    !["failed_retryable", "failed_terminal"].includes(String(record.attemptState)) ||
    !["failed", "queued"].includes(String(record.runState)) ||
    !["created", "failed_terminal"].includes(String(record.stageState)) ||
    ["preflightRunId", "stageAttemptId", "stageRunId"].some(
      (key) => typeof record[key] !== "string",
    ) ||
    record.retryScheduled !== (record.runState === "queued") ||
    record.retryScheduled !== (record.stageState === "created") ||
    record.retryScheduled !== (record.attemptState === "failed_retryable")
  ) {
    throw new PreflightControlLedgerError("Control failure result is malformed.");
  }
  return value as {
    attemptState: "failed_retryable" | "failed_terminal";
    ok: true;
    preflightRunId: string;
    replayed: boolean;
    retryScheduled: boolean;
    runState: "failed" | "queued";
    stageAttemptId: string;
    stageRunId: string;
    stageState: "created" | "failed_terminal";
  };
}

export async function getPreflightControlExecutionInput(
  envelope: PreflightTaskEnvelope,
): Promise<PreflightControlExecutionInput> {
  const value = await rpc("get_preflight_control_execution_input", {
    p_authority_epoch: envelope.authorityEpoch,
    p_fencing_token: envelope.fencingToken,
    p_input_manifest_hash: envelope.inputManifestSha256,
    p_stage_attempt_id: envelope.stageAttemptId,
  });
  const keys = [
    "configurationCandidateId",
    "episodeId",
    "kind",
    "lockedLookBlockSha256",
    "lookKey",
    "lookVersionId",
    "narratorGender",
    "policyVersionId",
    "preflightRunId",
    "processingScalarCount",
    "processingText",
    "processingTextSha256",
    "rawScript",
    "rawScriptSha256",
    "scriptRevisionId",
    "voiceVersionId",
    "workspaceId",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    !["narration_clock", "plan_evaluation", "secure_ingest", "world_anchor"].includes(
      String(record.kind),
    ) ||
    !["female", "male"].includes(String(record.narratorGender)) ||
    typeof record.rawScript !== "string" ||
    record.rawScript.length < 1 ||
    record.rawScript.length > 90_000 ||
    typeof record.processingText !== "string" ||
    record.processingText.length < 1 ||
    record.processingText.length > 90_000 ||
    !Number.isSafeInteger(record.processingScalarCount) ||
    (record.processingScalarCount as number) < 1 ||
    Array.from(record.processingText).length !== record.processingScalarCount ||
    ["lockedLookBlockSha256", "processingTextSha256", "rawScriptSha256"].some(
      (key) =>
        typeof record[key] !== "string" ||
        !/^[a-f0-9]{64}$/u.test(record[key] as string),
    ) ||
    [
      "configurationCandidateId",
      "episodeId",
      "lookKey",
      "lookVersionId",
      "preflightRunId",
      "policyVersionId",
      "scriptRevisionId",
      "voiceVersionId",
      "workspaceId",
    ].some((key) => typeof record[key] !== "string")
  ) {
    throw new PreflightControlLedgerError("Preflight execution input is malformed.");
  }
  return value as PreflightControlExecutionInput;
}

export async function getVerifiedPreflightAudioIdentitySelection(
  configurationCandidateId: string,
): Promise<string> {
  const { data, error } = await createAdminSupabaseClient()
    .from("preflight_audio_identity_selections")
    .select("id")
    .eq("configuration_candidate_id", configurationCandidateId)
    .eq("state", "verified")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data || typeof data.id !== "string") {
    throw new PreflightControlLedgerError(
      "Verified narration identities are unavailable.",
      true,
    );
  }
  return data.id;
}

export async function recordWorldExtractionResult(input: {
  envelope: PreflightTaskEnvelope;
  extraction: Readonly<Record<string, unknown>>;
  lookVersionId: string;
  modelRequestHash: string;
  providerRequestId: string | null;
  providerResponseId: string;
  scriptSha256: string;
}): Promise<
  Readonly<{
    extractionHash: string;
    ok: true;
    replayed: boolean;
    resultId: string;
  }>
> {
  const resultId = randomUUID();
  const value = await rpc("command_record_world_extraction_result", {
    p_authority_epoch: input.envelope.authorityEpoch,
    p_extraction_json: input.extraction,
    p_fencing_token: input.envelope.fencingToken,
    p_input_manifest_hash: input.envelope.inputManifestSha256,
    p_look_version_id: input.lookVersionId,
    p_model_request_hash: input.modelRequestHash,
    p_provider_request_id_hash: input.providerRequestId
      ? createHash("sha256").update(input.providerRequestId).digest("hex")
      : null,
    p_provider_response_id_hash: createHash("sha256")
      .update(input.providerResponseId)
      .digest("hex"),
    p_result_id: resultId,
    p_script_sha256: input.scriptSha256,
    p_stage_attempt_id: input.envelope.stageAttemptId,
  });
  if (
    !exactObject(value, ["extractionHash", "ok", "replayed", "resultId"]) ||
    (value as Record<string, unknown>).ok !== true ||
    typeof (value as Record<string, unknown>).replayed !== "boolean" ||
    typeof (value as Record<string, unknown>).resultId !== "string" ||
    typeof (value as Record<string, unknown>).extractionHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test((value as Record<string, unknown>).extractionHash as string)
  ) {
    throw new PreflightControlLedgerError("World extraction result is malformed.");
  }
  return value as {
    extractionHash: string;
    ok: true;
    replayed: boolean;
    resultId: string;
  };
}

export async function getWorldExtractionReplayResult(
  envelope: PreflightTaskEnvelope,
): Promise<Readonly<{
  extraction: WorldExtraction;
  extractionHash: string;
  resultId: string;
}> | null> {
  const value = await rpc("get_world_extraction_replay_result", {
    p_authority_epoch: envelope.authorityEpoch,
    p_fencing_token: envelope.fencingToken,
    p_input_manifest_hash: envelope.inputManifestSha256,
    p_stage_attempt_id: envelope.stageAttemptId,
  });
  if (value === null) return null;
  if (
    !exactObject(value, ["extractionHash", "extractionJson", "resultId"]) ||
    typeof (value as Record<string, unknown>).extractionHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(
      (value as Record<string, unknown>).extractionHash as string,
    ) ||
    typeof (value as Record<string, unknown>).resultId !== "string"
  ) {
    throw new PreflightControlLedgerError("World extraction replay is malformed.");
  }
  return Object.freeze({
    extraction: parseWorldExtraction((value as Record<string, unknown>).extractionJson),
    extractionHash: (value as Record<string, unknown>).extractionHash as string,
    resultId: (value as Record<string, unknown>).resultId as string,
  });
}

export async function finalizePreflightControl(input: {
  preflightRunId: string;
  triggerRunId: string;
}): Promise<Record<string, unknown>> {
  const value = await rpc("command_finalize_preflight_control", {
    p_preflight_run_id: input.preflightRunId,
    p_trigger_run_id: input.triggerRunId,
  });
  if (
    !exactObject(value, [
      "aggregateVersion",
      "ok",
      "preflightRunId",
      "replayed",
      "state",
    ]) ||
    (value as Record<string, unknown>).ok !== true ||
    (value as Record<string, unknown>).state !== "succeeded"
  ) {
    throw new PreflightControlLedgerError("Control finalization result is malformed.");
  }
  return value as Record<string, unknown>;
}

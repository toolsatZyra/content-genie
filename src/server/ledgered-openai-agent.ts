import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  OpenAiStructuredAgentError,
  prepareOpenAiStructuredAgentRequest,
  runPreparedOpenAiStructuredAgent,
  type OpenAiStructuredAgentRequest,
  type OpenAiStructuredAgentResult,
} from "@/server/openai-structured-agent";
import { postgresJsonbText } from "@/server/world-anchor-provider";

type LedgeredAgentToolName =
  | "audio.delivery"
  | "audio.pronunciation"
  | "edd.plan"
  | "plan.evaluate"
  | "shot.plan"
  | "source.extract"
  | "story.plan";

export type LedgeredOpenAiAuthority = Readonly<{
  configurationCandidateId: string;
  episodeId: string;
  maximumFanOut: 1 | 2 | 3;
  policyVersionId: string;
  preflightRunId: string;
  scriptRevisionId: string;
  sourceSetHash: string;
  stageAttemptId: string;
  toolName: LedgeredAgentToolName;
  trustedScopeHash: string;
  workspaceId: string;
}>;

export type LedgeredOpenAiResult = OpenAiStructuredAgentResult &
  Readonly<{ toolCallId: string }>;

export class LedgeredOpenAiAgentError extends Error {
  override readonly name = "LedgeredOpenAiAgentError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function uuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  ) {
    throw new LedgeredOpenAiAgentError("Agent model-call authority was not persisted.");
  }
  return value;
}

async function rpc(name: string, parameters: Readonly<Record<string, unknown>>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    throw new LedgeredOpenAiAgentError(`Agent ledger rejected ${name}.`);
  }
  return data as unknown;
}

function safeFailureClass(error: unknown) {
  return error instanceof OpenAiStructuredAgentError ? error.kind : "unknown";
}

export async function runLedgeredOpenAiStructuredAgent(
  authority: LedgeredOpenAiAuthority,
  request: OpenAiStructuredAgentRequest,
): Promise<LedgeredOpenAiResult> {
  const prepared = prepareOpenAiStructuredAgentRequest(request);
  const toolCallId = uuid(
    await rpc("command_record_agent_model_call", {
      p_arguments_hash: prepared.requestHash,
      p_configuration_candidate_id: authority.configurationCandidateId,
      p_episode_id: authority.episodeId,
      p_maximum_depth: 1,
      p_maximum_duration_ms: prepared.maximumDurationMs,
      p_maximum_fan_out: authority.maximumFanOut,
      p_maximum_result_bytes: prepared.maximumResponseBytes,
      p_maximum_tokens: prepared.maximumTokens,
      p_model_version: prepared.model,
      p_policy_version_id: authority.policyVersionId,
      p_preflight_run_id: authority.preflightRunId,
      p_prompt_hash: prepared.promptHash,
      p_script_revision_id: authority.scriptRevisionId,
      p_source_set_hash: authority.sourceSetHash,
      p_stage_attempt_id: authority.stageAttemptId,
      p_tool_name: authority.toolName,
      p_trusted_scope_hash: authority.trustedScopeHash,
      p_workspace_id: authority.workspaceId,
    }),
  );
  let result: OpenAiStructuredAgentResult;
  try {
    result = await runPreparedOpenAiStructuredAgent(prepared);
  } catch (error) {
    try {
      await rpc("command_reject_agent_model_call", {
        p_arguments_hash: prepared.requestHash,
        p_failure_class: safeFailureClass(error),
        p_safe_failure_summary: {
          requestHash: prepared.requestHash,
          schemaName: prepared.schemaName,
        },
        p_tool_call_id: toolCallId,
      });
    } catch (ledgerError) {
      throw new LedgeredOpenAiAgentError(
        "Agent call failed and its terminal evidence could not be persisted.",
        { cause: ledgerError },
      );
    }
    throw error;
  }
  const resultHash = sha256(postgresJsonbText(result.output));
  await rpc("command_complete_agent_tool_call", {
    p_arguments_hash: prepared.requestHash,
    p_result_hash: resultHash,
    p_safe_result_summary: {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      providerRequestIdHash:
        result.responseRequestId === null ? null : sha256(result.responseRequestId),
      providerResponseIdHash: sha256(result.responseId),
      requestHash: prepared.requestHash,
      resultHash,
      schemaName: prepared.schemaName,
    },
    p_tool_call_id: toolCallId,
  });
  return Object.freeze({ ...result, toolCallId });
}

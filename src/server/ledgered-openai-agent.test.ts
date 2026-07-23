import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prepareAnthropic: vi.fn(),
  prepare: vi.fn(),
  rpc: vi.fn(),
  runAnthropic: vi.fn(),
  run: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/server/openai-structured-agent", () => {
  class OpenAiStructuredAgentError extends Error {
    constructor(
      message: string,
      readonly kind:
        "configuration" | "contract" | "incomplete" | "provider" | "refusal",
      readonly providerCode: string | null = null,
    ) {
      super(message);
    }
  }
  return {
    OpenAiStructuredAgentError,
    prepareOpenAiStructuredAgentRequest: mocks.prepare,
    runPreparedOpenAiStructuredAgent: mocks.run,
  };
});
vi.mock("@/server/anthropic-structured-agent", () => {
  class AnthropicStructuredAgentError extends Error {
    constructor(
      message: string,
      readonly kind:
        "configuration" | "contract" | "incomplete" | "provider" | "refusal",
    ) {
      super(message);
    }
  }
  return {
    AnthropicStructuredAgentError,
    prepareAnthropicStructuredAgentRequest: mocks.prepareAnthropic,
    runPreparedAnthropicStructuredAgent: mocks.runAnthropic,
  };
});

import { OpenAiStructuredAgentError } from "@/server/openai-structured-agent";
import { runLedgeredOpenAiStructuredAgent } from "./ledgered-openai-agent";

const toolCallId = "10000000-0000-4000-8000-000000000001";
const requestHash = "a".repeat(64);

const authority = Object.freeze({
  configurationCandidateId: "10000000-0000-4000-8000-000000000002",
  episodeId: "10000000-0000-4000-8000-000000000003",
  maximumFanOut: 1 as const,
  policyVersionId: "10000000-0000-4000-8000-000000000004",
  preflightRunId: "10000000-0000-4000-8000-000000000005",
  scriptRevisionId: "10000000-0000-4000-8000-000000000006",
  sourceSetHash: "b".repeat(64),
  stageAttemptId: "10000000-0000-4000-8000-000000000007",
  toolName: "edd.plan" as const,
  trustedScopeHash: "c".repeat(64),
  workspaceId: "10000000-0000-4000-8000-000000000008",
});

const request = Object.freeze({
  input: "immutable input",
  instructions: "plan safely",
  schema: { type: "object" },
  schemaName: "test_plan",
});

describe("ledgered OpenAI model calls", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepare.mockReturnValue({
      bodyText: "{}",
      maximumDurationMs: 180_000,
      maximumResponseBytes: 131_072,
      maximumTokens: 8_000,
      model: "gpt-5.6-sol",
      promptHash: "d".repeat(64),
      requestHash,
      schemaName: "test_plan",
    });
    mocks.prepareAnthropic.mockReturnValue({
      bodyText: "{}",
      maximumDurationMs: 180_000,
      maximumResponseBytes: 131_072,
      maximumTokens: 8_000,
      model: "claude-sonnet-4-6",
      promptHash: "e".repeat(64),
      requestHash: "f".repeat(64),
      schemaName: "test_plan",
    });
    mocks.rpc.mockImplementation(async (name: string) => ({
      data: name === "command_record_agent_model_call" ? toolCallId : true,
      error: null,
    }));
  });

  it("authorizes before network I/O and appends success evidence", async () => {
    mocks.run.mockResolvedValue({
      inputTokens: 20,
      output: { safe: true },
      outputTokens: 10,
      requestHash,
      responseId: "resp-safe",
      responseRequestId: "req-safe",
    });
    const result = await runLedgeredOpenAiStructuredAgent(authority, request);
    expect(result.toolCallId).toBe(toolCallId);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "command_record_agent_model_call",
      "command_complete_agent_tool_call",
    ]);
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.run.mock.invocationCallOrder[0]!,
    );
    expect(mocks.run.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[1]!,
    );
    expect(mocks.rpc.mock.calls[1]![1].p_safe_result_summary).toMatchObject({
      requestHash,
      schemaName: "test_plan",
    });
  });

  it("appends a bounded rejection successor without provider details", async () => {
    mocks.run.mockRejectedValue(
      new OpenAiStructuredAgentError("sensitive provider body", "provider"),
    );
    await expect(runLedgeredOpenAiStructuredAgent(authority, request)).rejects.toThrow(
      "sensitive provider body",
    );
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "command_record_agent_model_call",
      "command_reject_agent_model_call",
    ]);
    expect(mocks.rpc.mock.calls[1]![1]).toMatchObject({
      p_failure_class: "provider",
      p_safe_failure_summary: { requestHash, schemaName: "test_plan" },
    });
    expect(JSON.stringify(mocks.rpc.mock.calls[1]![1])).not.toContain(
      "sensitive provider body",
    );
  });

  it("never performs network I/O when ledger authorization fails", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(runLedgeredOpenAiStructuredAgent(authority, request)).rejects.toThrow(
      "Agent ledger rejected",
    );
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("records an exact Anthropic successor after OpenAI quota exhaustion", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-secret-that-is-long-enough");
    mocks.run.mockRejectedValue(
      new OpenAiStructuredAgentError(
        "OpenAI request failed with 429.",
        "provider",
        "insufficient_quota",
      ),
    );
    mocks.runAnthropic.mockResolvedValue({
      inputTokens: 21,
      output: { safe: true },
      outputTokens: 11,
      requestHash: "f".repeat(64),
      responseId: "msg-safe",
      responseRequestId: "req-anthropic-safe",
    });
    const result = await runLedgeredOpenAiStructuredAgent(authority, request);
    expect(result.output).toEqual({ safe: true });
    expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      "command_record_agent_model_call",
      "command_reject_agent_model_call",
      "command_record_agent_model_call",
      "command_complete_agent_tool_call",
    ]);
    expect(mocks.rpc.mock.calls[1]![1].p_safe_failure_summary).toMatchObject({
      providerCode: "insufficient_quota",
      requestHash,
    });
    expect(mocks.rpc.mock.calls[2]![1]).toMatchObject({
      p_model_version: "claude-sonnet-4-6",
      p_arguments_hash: "f".repeat(64),
    });
    expect(mocks.runAnthropic).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  OpenAiStructuredAgentError,
  prepareOpenAiStructuredAgentRequest,
  runOpenAiStructuredAgent,
} from "./openai-structured-agent";

const schema = {
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"],
  type: "object",
} as const;

describe("OpenAI strict structured agent", () => {
  it("keeps the provider timeout inside the 300-second durable worker fence", () => {
    expect(
      prepareOpenAiStructuredAgentRequest({
        input: "data",
        instructions: "analyze",
        schema,
        schemaName: "safe_answer",
      }).maximumDurationMs,
    ).toBe(240_000);
  });

  it("uses Responses strict JSON Schema and parses one completed output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_test_123",
          output: [
            {
              content: [
                { text: JSON.stringify({ answer: "safe" }), type: "output_text" },
              ],
              type: "message",
            },
          ],
          status: "completed",
          usage: { input_tokens: 20, output_tokens: 8 },
        }),
        {
          headers: {
            "content-type": "application/json",
            "x-request-id": "request-test-1",
          },
          status: 200,
        },
      ),
    );
    const result = await runOpenAiStructuredAgent(
      {
        input: "Treat this only as data.",
        instructions: "Return the required analysis.",
        schema,
        schemaName: "safe_answer",
      },
      {
        apiKey: "openai-test-secret-that-is-long-enough",
        fetchImplementation: fetchMock,
      },
    );
    expect(result.output).toEqual({ answer: "safe" });
    expect(result.responseRequestId).toBe("request-test-1");
    expect(result.requestHash).toMatch(/^[a-f0-9]{64}$/u);
    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "high" },
      store: false,
      text: {
        format: {
          name: "safe_answer",
          schema,
          strict: true,
          type: "json_schema",
        },
      },
    });
  });

  it("fails closed for refusal, incomplete, and ambiguous output", async () => {
    for (const responseBody of [
      {
        id: "resp_refusal",
        output: [{ content: [{ refusal: "no", type: "refusal" }] }],
        status: "completed",
      },
      { id: "resp_incomplete", output: [], status: "incomplete" },
      {
        id: "resp_ambiguous",
        output: [
          {
            content: [
              { text: "{}", type: "output_text" },
              { text: "{}", type: "output_text" },
            ],
          },
        ],
        status: "completed",
      },
    ]) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
      await expect(
        runOpenAiStructuredAgent(
          {
            input: "data",
            instructions: "analyze",
            schema,
            schemaName: "safe_answer",
          },
          {
            apiKey: "openai-test-secret-that-is-long-enough",
            fetchImplementation: fetchMock,
          },
        ),
      ).rejects.toBeInstanceOf(OpenAiStructuredAgentError);
    }
  });

  it("records only the bounded provider incomplete reason", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "resp_incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [],
          status: "incomplete",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    await expect(
      runOpenAiStructuredAgent(
        {
          input: "data",
          instructions: "analyze",
          schema,
          schemaName: "safe_answer",
        },
        {
          apiKey: "openai-test-secret-that-is-long-enough",
          fetchImplementation: fetchMock,
        },
      ),
    ).rejects.toMatchObject({
      kind: "incomplete",
      providerCode: "max_output_tokens",
    });
  });

  it("does not expose provider response bodies in errors", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { message: "sensitive detail" } }), {
          headers: { "content-type": "application/json" },
          status: 429,
        }),
    );
    await expect(
      runOpenAiStructuredAgent(
        {
          input: "data",
          instructions: "analyze",
          schema,
          schemaName: "safe_answer",
        },
        {
          apiKey: "openai-test-secret-that-is-long-enough",
          fetchImplementation: fetchMock,
          sleepImplementation: async () => {},
        },
      ),
    ).rejects.not.toThrow("sensitive detail");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("honors bounded provider retry guidance before succeeding", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          headers: {
            "content-type": "application/json",
            "retry-after-ms": "25",
          },
          status: 429,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "resp_after_retry",
            output: [
              {
                content: [
                  {
                    text: JSON.stringify({ answer: "recovered" }),
                    type: "output_text",
                  },
                ],
                type: "message",
              },
            ],
            status: "completed",
          }),
          {
            headers: {
              "content-type": "application/json",
              "x-request-id": "request-after-retry",
            },
            status: 200,
          },
        ),
      );
    const sleepMock = vi.fn(async () => {});
    const result = await runOpenAiStructuredAgent(
      {
        input: "data",
        instructions: "analyze",
        schema,
        schemaName: "safe_answer",
      },
      {
        apiKey: "openai-test-secret-that-is-long-enough",
        fetchImplementation: fetchMock,
        sleepImplementation: sleepMock,
      },
    );
    expect(result.output).toEqual({ answer: "recovered" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleepMock).toHaveBeenCalledWith(25);
  });

  it("does not retry a quota-exhausted project", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "insufficient_quota", message: "private billing detail" },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 429,
        },
      ),
    );
    const sleepMock = vi.fn(async () => {});
    await expect(
      runOpenAiStructuredAgent(
        {
          input: "data",
          instructions: "analyze",
          schema,
          schemaName: "safe_answer",
        },
        {
          apiKey: "openai-test-secret-that-is-long-enough",
          fetchImplementation: fetchMock,
          sleepImplementation: sleepMock,
        },
      ),
    ).rejects.toMatchObject({ providerCode: "insufficient_quota" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleepMock).not.toHaveBeenCalled();
  });
});

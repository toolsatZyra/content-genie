import { describe, expect, it, vi } from "vitest";

import {
  AnthropicStructuredAgentError,
  normalizeAnthropicStructuredSchema,
  prepareAnthropicStructuredAgentRequest,
  runPreparedAnthropicStructuredAgent,
} from "./anthropic-structured-agent";

const schema = {
  additionalProperties: false,
  properties: { answer: { type: "string" } },
  required: ["answer"],
  type: "object",
} as const;

describe("Anthropic strict structured fallback", () => {
  it("moves unsupported constraints into descriptions for provider compilation", () => {
    const original = {
      additionalProperties: false,
      properties: {
        answers: {
          items: {
            maxLength: 200,
            minLength: 1,
            pattern: "^[a-z]+$",
            type: "string",
          },
          maxItems: 4,
          minItems: 1,
          type: "array",
        },
      },
      required: ["answers"],
      type: "object",
    } as const;
    const normalized = normalizeAnthropicStructuredSchema(original);
    expect(normalized).toEqual({
      additionalProperties: false,
      properties: {
        answers: {
          description: "Application validation: maxItems=4, minItems=1.",
          items: {
            description: "Application validation: maxLength=200, minLength=1.",
            pattern: "^[a-z]+$",
            type: "string",
          },
          type: "array",
        },
      },
      required: ["answers"],
      type: "object",
    });
    expect(original.properties.answers.maxItems).toBe(4);
  });

  it("uses a constrained string envelope when an application schema is too complex", async () => {
    const largeSchema = {
      additionalProperties: false,
      properties: Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [
          `field${index}`,
          { maxLength: 200, minLength: 1, type: "string" },
        ]),
      ),
      required: Array.from({ length: 80 }, (_, index) => `field${index}`),
      type: "object",
    } as const;
    const prepared = prepareAnthropicStructuredAgentRequest({
      input: "Treat this only as data.",
      instructions: "Return the required analysis.",
      schema: largeSchema,
      schemaName: "large_safe_answer",
    });
    expect(prepared.usesStringEnvelope).toBe(true);
    const body = JSON.parse(prepared.bodyText) as {
      output_config: { format: { schema: unknown } };
      system: string;
    };
    expect(body.output_config.format.schema).toEqual({
      additionalProperties: false,
      properties: {
        payload: {
          description:
            "A JSON-serialized value that satisfies the application schema in the system instructions.",
          type: "string",
        },
      },
      required: ["payload"],
      type: "object",
    });
    expect(body.system).toContain("APPLICATION_SCHEMA_JSON=");

    const output = { field0: "safe" };
    const result = await runPreparedAnthropicStructuredAgent(prepared, {
      apiKey: "anthropic-test-secret-that-is-long-enough",
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({ payload: JSON.stringify(output) }),
                type: "text",
              },
            ],
            id: "msg_large_test_123",
            stop_reason: "end_turn",
            type: "message",
            usage: { input_tokens: 20, output_tokens: 8 },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      ),
    });
    expect(result.output).toEqual(output);
  });

  it("uses a constrained JSON Schema envelope and parses one completed output", async () => {
    const prepared = prepareAnthropicStructuredAgentRequest({
      input: "Treat this only as data.",
      instructions: "Return the required analysis.",
      schema,
      schemaName: "safe_answer",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            {
              text: JSON.stringify({ answer: "safe" }),
              type: "text",
            },
          ],
          id: "msg_test_123",
          stop_reason: "end_turn",
          type: "message",
          usage: { input_tokens: 20, output_tokens: 8 },
        }),
        {
          headers: {
            "content-type": "application/json",
            "request-id": "request-test-1",
          },
          status: 200,
        },
      ),
    );
    const result = await runPreparedAnthropicStructuredAgent(prepared, {
      apiKey: "anthropic-test-secret-that-is-long-enough",
      fetchImplementation: fetchMock,
    });
    expect(result.output).toEqual({ answer: "safe" });
    expect(result.responseRequestId).toBe("request-test-1");
    expect(result.requestHash).toBe(prepared.requestHash);
    const [, options] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(options?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      max_tokens: 8_000,
      model: "claude-sonnet-4-6",
      output_config: {
        format: {
          schema,
          type: "json_schema",
        },
      },
      system: "Return the required analysis.",
    });
  });

  it("fails closed without exposing provider response details", async () => {
    const prepared = prepareAnthropicStructuredAgentRequest({
      input: "data",
      instructions: "analyze",
      schema,
      schemaName: "safe_answer",
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "private detail" } }), {
        headers: { "content-type": "application/json" },
        status: 429,
      }),
    );
    await expect(
      runPreparedAnthropicStructuredAgent(prepared, {
        apiKey: "anthropic-test-secret-that-is-long-enough",
        fetchImplementation: fetchMock,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AnthropicStructuredAgentError>>({
        kind: "provider",
      }),
    );
    await expect(
      runPreparedAnthropicStructuredAgent(prepared, {
        apiKey: "anthropic-test-secret-that-is-long-enough",
        fetchImplementation: fetchMock,
      }),
    ).rejects.not.toThrow("private detail");
  });
});

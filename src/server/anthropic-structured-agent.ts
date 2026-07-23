import "server-only";

import { createHash } from "node:crypto";

import type {
  OpenAiStructuredAgentRequest,
  OpenAiStructuredAgentResult,
} from "@/server/openai-structured-agent";

export type PreparedAnthropicStructuredAgentRequest = Readonly<{
  bodyText: string;
  maximumDurationMs: 180_000;
  maximumResponseBytes: 131_072;
  maximumTokens: number;
  model: "claude-sonnet-4-6";
  promptHash: string;
  requestHash: string;
  schemaName: string;
  usesStringEnvelope: boolean;
}>;

export class AnthropicStructuredAgentError extends Error {
  override readonly name = "AnthropicStructuredAgentError";

  constructor(
    message: string,
    readonly kind: "configuration" | "contract" | "incomplete" | "provider" | "refusal",
  ) {
    super(message);
  }
}

const unsupportedSchemaConstraints = new Set([
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maxContains",
  "maxItems",
  "maxLength",
  "maxProperties",
  "maximum",
  "minContains",
  "minItems",
  "minLength",
  "minProperties",
  "minimum",
  "multipleOf",
  "uniqueItems",
]);

function constraintDescription(constraints: readonly [string, unknown][]): string {
  return constraints
    .map(([keyword, value]) => `${keyword}=${JSON.stringify(value)}`)
    .join(", ");
}

export function normalizeAnthropicStructuredSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeAnthropicStructuredSchema(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const source = value as Readonly<Record<string, unknown>>;
  const constraints = Object.entries(source).filter(([keyword]) =>
    unsupportedSchemaConstraints.has(keyword),
  );
  const normalized = Object.fromEntries(
    Object.entries(source)
      .filter(([keyword]) => !unsupportedSchemaConstraints.has(keyword))
      .map(([keyword, item]) => [keyword, normalizeAnthropicStructuredSchema(item)]),
  );
  if (constraints.length > 0) {
    const existingDescription =
      typeof normalized.description === "string" ? normalized.description.trim() : "";
    const validationNote = `Application validation: ${constraintDescription(constraints)}.`;
    normalized.description = existingDescription
      ? `${existingDescription} ${validationNote}`
      : validationNote;
  }
  return normalized;
}

function boundedText(value: string, label: string, maximum: number): string {
  const trimmed = value.trim();
  if (!trimmed || value.length > maximum || /[\u0000]/u.test(value)) {
    throw new AnthropicStructuredAgentError(`${label} is invalid.`, "contract");
  }
  return value;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number | null {
  return Number.isSafeInteger(value) &&
    (value as number) >= minimum &&
    (value as number) <= maximum
    ? (value as number)
    : null;
}

async function boundedResponseBytes(response: Response, maximumBytes: number) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      throw new AnthropicStructuredAgentError(
        "Anthropic response length is invalid.",
        "provider",
      );
    }
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > maximumBytes ||
    (declared !== null && bytes.length !== Number(declared))
  ) {
    throw new AnthropicStructuredAgentError(
      "Anthropic response exceeded its byte contract.",
      "provider",
    );
  }
  return bytes;
}

export function prepareAnthropicStructuredAgentRequest(
  request: OpenAiStructuredAgentRequest,
): PreparedAnthropicStructuredAgentRequest {
  const instructions = boundedText(request.instructions, "Agent instructions", 24_000);
  const input = boundedText(request.input, "Agent input", 100_000);
  const schema = normalizeAnthropicStructuredSchema(request.schema);
  const applicationSchemaJson = JSON.stringify(request.schema);
  if (applicationSchemaJson.length < 2 || applicationSchemaJson.length > 64_000) {
    throw new AnthropicStructuredAgentError("Agent schema is invalid.", "contract");
  }
  const usesStringEnvelope = applicationSchemaJson.length > 4_000;
  const providerSchema = usesStringEnvelope
    ? {
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
      }
    : schema;
  const providerInstructions = usesStringEnvelope
    ? `${instructions}

The application schema is too complex for the provider grammar. Return exactly one object property named payload. Its value must be a JSON string whose decoded value satisfies APPLICATION_SCHEMA_JSON. Do not omit, rename, summarize, or wrap any application field.
APPLICATION_SCHEMA_JSON=${applicationSchemaJson}`
    : instructions;
  const maximumTokens = request.maxOutputTokens ?? 8_000;
  if (
    !Number.isSafeInteger(maximumTokens) ||
    maximumTokens < 256 ||
    maximumTokens > 16_000
  ) {
    throw new AnthropicStructuredAgentError(
      "Agent output-token limit is invalid.",
      "contract",
    );
  }
  const model = "claude-sonnet-4-6" as const;
  const bodyText = JSON.stringify({
    max_tokens: maximumTokens,
    messages: [{ content: input, role: "user" }],
    model,
    output_config: {
      format: {
        schema: providerSchema,
        type: "json_schema",
      },
    },
    system: providerInstructions,
  });
  return Object.freeze({
    bodyText,
    maximumDurationMs: 180_000 as const,
    maximumResponseBytes: 131_072 as const,
    maximumTokens,
    model,
    promptHash: createHash("sha256").update(providerInstructions).digest("hex"),
    requestHash: createHash("sha256").update(bodyText).digest("hex"),
    schemaName: request.schemaName,
    usesStringEnvelope,
  });
}

export async function runPreparedAnthropicStructuredAgent(
  prepared: PreparedAnthropicStructuredAgentRequest,
  options: Readonly<{
    apiKey?: string;
    fetchImplementation?: typeof fetch;
  }> = {},
): Promise<OpenAiStructuredAgentResult> {
  const apiKey = (options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (apiKey.length < 20) {
    throw new AnthropicStructuredAgentError(
      "Anthropic credential is unavailable.",
      "configuration",
    );
  }
  const response = await (options.fetchImplementation ?? fetch)(
    "https://api.anthropic.com/v1/messages",
    {
      body: prepared.bodyText,
      headers: {
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(prepared.maximumDurationMs),
    },
  );
  const responseRequestId = response.headers.get("request-id");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  const bytes = await boundedResponseBytes(response, prepared.maximumResponseBytes);
  if (!response.ok || contentType !== "application/json") {
    throw new AnthropicStructuredAgentError(
      `Anthropic request failed with ${response.status}.`,
      "provider",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new AnthropicStructuredAgentError(
      "Anthropic response JSON is invalid.",
      "provider",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AnthropicStructuredAgentError(
      "Anthropic response envelope is malformed.",
      "provider",
    );
  }
  const envelope = value as Record<string, unknown>;
  if (typeof envelope.id !== "string" || envelope.id.length > 200) {
    throw new AnthropicStructuredAgentError(
      "Anthropic response identity is malformed.",
      "provider",
    );
  }
  if (envelope.stop_reason === "refusal") {
    throw new AnthropicStructuredAgentError(
      "Anthropic refused the structured task.",
      "refusal",
    );
  }
  if (envelope.stop_reason !== "end_turn") {
    throw new AnthropicStructuredAgentError(
      "Anthropic response did not complete.",
      "incomplete",
    );
  }
  if (!Array.isArray(envelope.content)) {
    throw new AnthropicStructuredAgentError(
      "Anthropic response content is malformed.",
      "provider",
    );
  }
  const texts = envelope.content.flatMap((part) => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const record = part as Record<string, unknown>;
    return record.type === "text" && typeof record.text === "string"
      ? [record.text]
      : [];
  });
  if (texts.length !== 1) {
    throw new AnthropicStructuredAgentError(
      "Anthropic returned an ambiguous structured output.",
      "provider",
    );
  }
  let output: unknown;
  try {
    output = JSON.parse(texts[0]!) as unknown;
  } catch {
    throw new AnthropicStructuredAgentError(
      "Anthropic structured output is not JSON.",
      "provider",
    );
  }
  if (prepared.usesStringEnvelope) {
    const structuredEnvelope = output as Record<string, unknown> | null;
    const payload = structuredEnvelope?.payload;
    if (
      !structuredEnvelope ||
      typeof structuredEnvelope !== "object" ||
      Array.isArray(structuredEnvelope) ||
      Object.keys(structuredEnvelope).length !== 1 ||
      typeof payload !== "string"
    ) {
      throw new AnthropicStructuredAgentError(
        "Anthropic structured output envelope is malformed.",
        "provider",
      );
    }
    try {
      output = JSON.parse(payload) as unknown;
    } catch {
      throw new AnthropicStructuredAgentError(
        "Anthropic structured output payload is not JSON.",
        "provider",
      );
    }
  }
  const usage =
    envelope.usage &&
    typeof envelope.usage === "object" &&
    !Array.isArray(envelope.usage)
      ? (envelope.usage as Record<string, unknown>)
      : {};
  return Object.freeze({
    inputTokens: boundedInteger(usage.input_tokens, 0, 10_000_000),
    output,
    outputTokens: boundedInteger(usage.output_tokens, 0, 10_000_000),
    requestHash: prepared.requestHash,
    responseId: envelope.id,
    responseRequestId,
  });
}

import "server-only";

import { createHash } from "node:crypto";

const schemaNamePattern = /^[a-z][a-z0-9_]{2,63}$/u;

export type OpenAiStructuredAgentRequest = Readonly<{
  instructions: string;
  input: string;
  maximumDurationMs?: number;
  maxOutputTokens?: number;
  model?: string;
  reasoningEffort?: "high" | "low" | "medium";
  schema: Readonly<Record<string, unknown>>;
  schemaName: string;
}>;

export type OpenAiStructuredAgentResult = Readonly<{
  inputTokens: number | null;
  output: unknown;
  outputTokens: number | null;
  requestHash: string;
  responseId: string;
  responseRequestId: string | null;
}>;

export type PreparedOpenAiStructuredAgentRequest = Readonly<{
  bodyText: string;
  maximumDurationMs: number;
  maximumResponseBytes: 131_072;
  maximumTokens: number;
  model: string;
  promptHash: string;
  requestHash: string;
  schemaName: string;
}>;

export class OpenAiStructuredAgentError extends Error {
  override readonly name = "OpenAiStructuredAgentError";

  constructor(
    message: string,
    readonly kind: "configuration" | "contract" | "incomplete" | "provider" | "refusal",
  ) {
    super(message);
  }
}

function boundedText(value: string, label: string, maximum: number): string {
  const trimmed = value.trim();
  if (!trimmed || value.length > maximum || /[\u0000]/u.test(value)) {
    throw new OpenAiStructuredAgentError(`${label} is invalid.`, "contract");
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
      throw new OpenAiStructuredAgentError(
        "OpenAI response length is invalid.",
        "provider",
      );
    }
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > maximumBytes ||
    (declared !== null && bytes.length !== Number(declared))
  ) {
    throw new OpenAiStructuredAgentError(
      "OpenAI response exceeded its byte contract.",
      "provider",
    );
  }
  return bytes;
}

function collectResponseContent(response: Record<string, unknown>): {
  outputTexts: string[];
  refusals: string[];
} {
  const outputTexts: string[] = [];
  const refusals: string[] = [];
  if (!Array.isArray(response.output)) {
    throw new OpenAiStructuredAgentError(
      "OpenAI response output is malformed.",
      "provider",
    );
  }
  for (const item of response.output) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object" || Array.isArray(part)) continue;
      const record = part as Record<string, unknown>;
      if (record.type === "output_text" && typeof record.text === "string") {
        outputTexts.push(record.text);
      }
      if (record.type === "refusal" && typeof record.refusal === "string") {
        refusals.push(record.refusal);
      }
    }
  }
  return { outputTexts, refusals };
}

export function prepareOpenAiStructuredAgentRequest(
  request: OpenAiStructuredAgentRequest,
): PreparedOpenAiStructuredAgentRequest {
  if (!schemaNamePattern.test(request.schemaName)) {
    throw new OpenAiStructuredAgentError("Schema name is invalid.", "contract");
  }
  const instructions = boundedText(request.instructions, "Agent instructions", 24_000);
  const input = boundedText(request.input, "Agent input", 100_000);
  const schemaJson = JSON.stringify(request.schema);
  if (schemaJson.length < 2 || schemaJson.length > 64_000) {
    throw new OpenAiStructuredAgentError("Agent schema is invalid.", "contract");
  }
  const maxOutputTokens = request.maxOutputTokens ?? 8_000;
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 256 ||
    maxOutputTokens > 16_000
  ) {
    throw new OpenAiStructuredAgentError(
      "Agent output-token limit is invalid.",
      "contract",
    );
  }
  const maximumDurationMs = request.maximumDurationMs ?? 180_000;
  if (boundedInteger(maximumDurationMs, 30_000, 240_000) === null) {
    throw new OpenAiStructuredAgentError(
      "Agent duration limit is invalid.",
      "contract",
    );
  }
  const model = request.model ?? "gpt-5.6-sol";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{1,100}$/u.test(model)) {
    throw new OpenAiStructuredAgentError("Agent model is invalid.", "contract");
  }
  const body = {
    input,
    instructions,
    max_output_tokens: maxOutputTokens,
    model,
    reasoning: { effort: request.reasoningEffort ?? "high" },
    store: false,
    text: {
      format: {
        name: request.schemaName,
        schema: request.schema,
        strict: true,
        type: "json_schema",
      },
    },
  } as const;
  const bodyText = JSON.stringify(body);
  const requestHash = createHash("sha256").update(bodyText).digest("hex");
  return Object.freeze({
    bodyText,
    maximumDurationMs,
    maximumResponseBytes: 131_072,
    maximumTokens: maxOutputTokens,
    model,
    promptHash: createHash("sha256").update(instructions).digest("hex"),
    requestHash,
    schemaName: request.schemaName,
  });
}

export async function runPreparedOpenAiStructuredAgent(
  prepared: PreparedOpenAiStructuredAgentRequest,
  options: Readonly<{
    apiKey?: string;
    fetchImplementation?: typeof fetch;
  }> = {},
): Promise<OpenAiStructuredAgentResult> {
  const apiKey = (options.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
  if (apiKey.length < 20) {
    throw new OpenAiStructuredAgentError(
      "OpenAI credential is unavailable.",
      "configuration",
    );
  }
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const response = await fetchImplementation("https://api.openai.com/v1/responses", {
    body: prepared.bodyText,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Client-Request-Id": prepared.requestHash.slice(0, 32),
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(prepared.maximumDurationMs),
  });
  const responseRequestId = response.headers.get("x-request-id");
  const contentType = response.headers.get("content-type")?.split(";", 1)[0];
  const bytes = await boundedResponseBytes(response, prepared.maximumResponseBytes);
  if (!response.ok || contentType !== "application/json") {
    throw new OpenAiStructuredAgentError(
      `OpenAI request failed with ${response.status}.`,
      "provider",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new OpenAiStructuredAgentError(
      "OpenAI response JSON is invalid.",
      "provider",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OpenAiStructuredAgentError(
      "OpenAI response envelope is malformed.",
      "provider",
    );
  }
  const envelope = value as Record<string, unknown>;
  if (typeof envelope.id !== "string" || envelope.id.length > 200) {
    throw new OpenAiStructuredAgentError(
      "OpenAI response identity is malformed.",
      "provider",
    );
  }
  if (envelope.status !== "completed") {
    throw new OpenAiStructuredAgentError(
      "OpenAI response did not complete.",
      "incomplete",
    );
  }
  const content = collectResponseContent(envelope);
  if (content.refusals.length > 0) {
    throw new OpenAiStructuredAgentError(
      "OpenAI refused the structured task.",
      "refusal",
    );
  }
  if (content.outputTexts.length !== 1) {
    throw new OpenAiStructuredAgentError(
      "OpenAI returned an ambiguous structured output.",
      "provider",
    );
  }
  let output: unknown;
  try {
    output = JSON.parse(content.outputTexts[0]!) as unknown;
  } catch {
    throw new OpenAiStructuredAgentError(
      "OpenAI structured output is not JSON.",
      "provider",
    );
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

export async function runOpenAiStructuredAgent(
  request: OpenAiStructuredAgentRequest,
  options: Readonly<{
    apiKey?: string;
    fetchImplementation?: typeof fetch;
  }> = {},
): Promise<OpenAiStructuredAgentResult> {
  return runPreparedOpenAiStructuredAgent(
    prepareOpenAiStructuredAgentRequest(request),
    options,
  );
}

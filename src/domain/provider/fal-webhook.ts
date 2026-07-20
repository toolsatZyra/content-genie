import { createHash } from "node:crypto";

import { canonicalJson } from "@/security/command-envelope";

export const FAL_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;
export const FAL_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

const externalIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,239}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class FalWebhookError extends Error {
  override readonly name = "FalWebhookError";

  constructor(
    message: string,
    readonly authenticationFailure = false,
  ) {
    super(message);
  }
}

function header(headers: Headers, name: string, maximum: number): string {
  const value = headers.get(name)?.trim() ?? "";
  if (value.length < 1 || value.length > maximum) {
    throw new FalWebhookError(`${name} is invalid.`, true);
  }
  return value;
}

export type FalWebhookSignatureEnvelope = Readonly<{
  message: Buffer;
  requestId: string;
  signature: Buffer;
  timestamp: number;
  timestampText: string;
  userId: string;
}>;

export function parseFalWebhookSignatureEnvelope(
  headers: Headers,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): FalWebhookSignatureEnvelope {
  const requestId = header(headers, "x-fal-webhook-request-id", 240);
  const userId = header(headers, "x-fal-webhook-user-id", 240);
  const timestampText = header(headers, "x-fal-webhook-timestamp", 16);
  const signatureHex = header(headers, "x-fal-webhook-signature", 128);
  if (
    !externalIdPattern.test(requestId) ||
    !externalIdPattern.test(userId) ||
    !/^\d{10}$/u.test(timestampText) ||
    !/^[a-f0-9]{128}$/iu.test(signatureHex)
  ) {
    throw new FalWebhookError("FAL webhook signature headers are invalid.", true);
  }
  const timestamp = Number(timestampText);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > FAL_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS
  ) {
    throw new FalWebhookError("FAL webhook timestamp is stale.", true);
  }
  const rawBodySha256 = createHash("sha256").update(rawBody).digest("hex");
  return Object.freeze({
    message: Buffer.from(
      [requestId, userId, timestampText, rawBodySha256].join("\n"),
      "utf8",
    ),
    requestId,
    signature: Buffer.from(signatureHex, "hex"),
    timestamp,
    timestampText,
    userId,
  });
}

export type FalWebhookOutput = Readonly<{
  contentType: "image/jpeg" | "image/png" | "image/webp";
  height: number | null;
  ordinal: 1;
  targetAssetId: string;
  url: string;
  urlSha256: string;
  width: number | null;
}>;

export type ParsedFalWebhook = Readonly<{
  canonicalPayloadHash: string;
  externalJobId: string;
  gatewayRequestId: string;
  outputs: readonly FalWebhookOutput[];
  rawBodySha256: string;
  safeSummary: Readonly<Record<string, unknown>>;
  status: "ERROR" | "OK";
}>;

function integer(value: unknown, field: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > 32_768
  ) {
    throw new FalWebhookError(`${field} is invalid.`);
  }
  return value as number;
}

function nullableInteger(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : integer(value, field);
}

export function parseFalWebhookBody(
  rawBody: string,
  headerRequestId: string,
  targetAssetId: string,
): ParsedFalWebhook {
  if (Buffer.byteLength(rawBody, "utf8") > FAL_WEBHOOK_MAX_BODY_BYTES) {
    throw new FalWebhookError("FAL webhook body is too large.");
  }
  if (!uuidPattern.test(targetAssetId)) {
    throw new FalWebhookError("FAL webhook target asset is invalid.");
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new FalWebhookError("FAL webhook JSON is malformed.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FalWebhookError("FAL webhook body is invalid.");
  }
  const body = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "error",
    "gateway_request_id",
    "payload",
    "payload_error",
    "request_id",
    "status",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new FalWebhookError("FAL webhook body contains unexpected fields.");
  }
  if (
    typeof body.request_id !== "string" ||
    !externalIdPattern.test(body.request_id) ||
    body.request_id !== headerRequestId ||
    typeof body.gateway_request_id !== "string" ||
    !externalIdPattern.test(body.gateway_request_id) ||
    (body.status !== "OK" && body.status !== "ERROR")
  ) {
    throw new FalWebhookError("FAL webhook identity is invalid.");
  }

  const outputs: FalWebhookOutput[] = [];
  if (body.status === "OK") {
    if (
      !body.payload ||
      typeof body.payload !== "object" ||
      Array.isArray(body.payload)
    ) {
      throw new FalWebhookError("FAL webhook success payload is missing.");
    }
    const images = (body.payload as Record<string, unknown>).images;
    if (!Array.isArray(images) || images.length !== 1) {
      throw new FalWebhookError("FAL webhook image output is not exact.");
    }
    const image = images[0];
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      throw new FalWebhookError("FAL webhook image output is invalid.");
    }
    const record = image as Record<string, unknown>;
    if (
      typeof record.url !== "string" ||
      record.url.length < 12 ||
      record.url.length > 2_048 ||
      !record.url.startsWith("https://") ||
      /[\u0000-\u0020\u007f]/u.test(record.url) ||
      !["image/png", "image/jpeg", "image/webp"].includes(String(record.content_type))
    ) {
      throw new FalWebhookError("FAL webhook media output is invalid.");
    }
    outputs.push(
      Object.freeze({
        contentType: record.content_type as FalWebhookOutput["contentType"],
        height: nullableInteger(record.height, "height"),
        ordinal: 1,
        targetAssetId: targetAssetId.toLowerCase(),
        url: record.url,
        urlSha256: createHash("sha256").update(record.url).digest("hex"),
        width: nullableInteger(record.width, "width"),
      }),
    );
  } else if (body.payload !== null && body.payload !== undefined) {
    if (typeof body.payload !== "object" || Array.isArray(body.payload)) {
      throw new FalWebhookError("FAL webhook error payload is invalid.");
    }
  }

  const rawBodySha256 = createHash("sha256").update(rawBody).digest("hex");
  const safeSummary = Object.freeze({
    gatewayRequestId: body.gateway_request_id,
    hasPayload: body.payload !== null && body.payload !== undefined,
    outputCount: outputs.length,
    status: body.status,
  });
  return Object.freeze({
    canonicalPayloadHash: createHash("sha256")
      .update(
        canonicalJson({
          externalJobId: body.request_id,
          gatewayRequestId: body.gateway_request_id,
          outputs,
          status: body.status,
        }),
      )
      .digest("hex"),
    externalJobId: body.request_id,
    gatewayRequestId: body.gateway_request_id,
    outputs: Object.freeze(outputs),
    rawBodySha256,
    safeSummary,
    status: body.status,
  });
}

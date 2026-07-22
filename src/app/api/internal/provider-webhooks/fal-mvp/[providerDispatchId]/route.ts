import { NextResponse } from "next/server";

import {
  FAL_WEBHOOK_MAX_BODY_BYTES,
  FalWebhookError,
} from "@/domain/provider/fal-webhook";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import { verifyFalWebhook } from "@/server/fal-webhook-verifier";
import { reconcileMvpMediaDispatchWebhook } from "@/server/mvp-media-dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const externalIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{2,239}$/u;

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

function exactRequestId(rawBody: string, headerRequestId: string): string {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new FalWebhookError("FAL callback JSON is malformed.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FalWebhookError("FAL callback body is invalid.");
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
  if (
    Object.keys(body).some((key) => !allowedKeys.has(key)) ||
    typeof body.request_id !== "string" ||
    !externalIdPattern.test(body.request_id) ||
    body.request_id !== headerRequestId ||
    (body.status !== "OK" && body.status !== "ERROR")
  ) {
    throw new FalWebhookError("FAL callback identity is invalid.");
  }
  return body.request_id;
}

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ providerDispatchId: string }> }>,
) {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    return response({ code: "JSON_REQUIRED", ok: false }, 415);
  }
  try {
    const declaredLength = declaredRequestBodyBytes(
      request.headers,
      FAL_WEBHOOK_MAX_BODY_BYTES,
    );
    const rawBody = await readBoundedUtf8RequestBody(
      request,
      FAL_WEBHOOK_MAX_BODY_BYTES,
      declaredLength,
    );
    const verified = await verifyFalWebhook(request.headers, rawBody);
    const { providerDispatchId } = await context.params;
    if (!uuidPattern.test(providerDispatchId)) {
      throw new FalWebhookError("FAL callback route identity is invalid.");
    }
    const callbackToken = new URL(request.url).searchParams.get("token") ?? "";
    if (!/^[A-Za-z0-9_-]{43}$/u.test(callbackToken)) {
      throw new FalWebhookError("FAL callback slot binding is invalid.");
    }
    const externalRequestId = exactRequestId(rawBody, verified.requestId);
    await reconcileMvpMediaDispatchWebhook({
      callbackToken,
      externalRequestId,
      providerDispatchId: providerDispatchId.toLowerCase(),
    });
    return response({ duplicate: false, ok: true }, 202);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      return response(
        {
          code:
            error.failure === "too-large"
              ? "WEBHOOK_REQUEST_TOO_LARGE"
              : "WEBHOOK_REQUEST_INVALID",
          ok: false,
        },
        error.failure === "too-large" ? 413 : 400,
      );
    }
    if (error instanceof FalWebhookError) {
      return response(
        {
          code: error.authenticationFailure
            ? "WEBHOOK_AUTHENTICATION_FAILED"
            : "WEBHOOK_PAYLOAD_REJECTED",
          ok: false,
        },
        error.authenticationFailure ? 401 : 400,
      );
    }
    console.error("FAL MVP callback reconciliation is pending", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ code: "WEBHOOK_OUTCOME_UNKNOWN", ok: false }, 503);
  }
}

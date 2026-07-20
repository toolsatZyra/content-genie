import { NextResponse } from "next/server";

import {
  FAL_WEBHOOK_MAX_BODY_BYTES,
  FalWebhookError,
  parseFalWebhookBody,
} from "@/domain/provider/fal-webhook";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import { verifyFalWebhook } from "@/server/fal-webhook-verifier";
import {
  getFalWebhookBinding,
  ProviderBrokerLedgerError,
  recordFalSignedWebhook,
} from "@/server/provider-broker-ledger";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function response(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

export async function POST(
  request: Request,
  context: Readonly<{ params: Promise<{ providerRequestId: string }> }>,
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
    const { providerRequestId } = await context.params;
    if (!uuidPattern.test(providerRequestId)) {
      throw new FalWebhookError("FAL webhook route identity is invalid.");
    }
    const binding = await getFalWebhookBinding(providerRequestId.toLowerCase());
    const webhook = parseFalWebhookBody(
      rawBody,
      verified.requestId,
      binding.targetAssetId,
    );
    const recorded = await recordFalSignedWebhook({
      providerEventId: verified.requestId,
      providerRequestId: binding.providerRequestId,
      webhook,
    });
    return response(
      {
        disposition: recorded.disposition,
        duplicate: recorded.duplicate,
        ok: true,
      },
      202,
    );
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
    if (error instanceof ProviderBrokerLedgerError && error.conflict) {
      return response({ code: "WEBHOOK_REPLAY_CONFLICT", ok: false }, 409);
    }
    console.error("FAL webhook failed safely", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return response({ code: "WEBHOOK_OUTCOME_UNKNOWN", ok: false }, 503);
  }
}

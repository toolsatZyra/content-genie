import { NextResponse } from "next/server";

import { readCorrelationId, createCorrelationId } from "@/observability/correlation";
import { writeDiagnostic } from "@/observability/logger";
import { DiagnosticValidationError } from "@/observability/schema";
import { persistDiagnosticEvent } from "@/observability/supabase-sink";
import {
  createServerSupabaseClient,
  hasConfiguredSupabase,
} from "@/lib/supabase/server";
import {
  ClientDiagnosticIntakeError,
  DiagnosticRateLimiter,
  readBoundedDiagnosticJson,
  validateClientDiagnosticHeaders,
} from "@/observability/client-intake";

const limiter = new DiagnosticRateLimiter();

function response(
  body: Readonly<Record<string, boolean | string>>,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId =
    readCorrelationId(request.headers) ?? createCorrelationId("request");

  try {
    validateClientDiagnosticHeaders(
      request.headers,
      request.url,
      process.env.NEXT_PUBLIC_APP_URL,
    );
    if (!limiter.consume("client-diagnostics")) {
      throw new ClientDiagnosticIntakeError(
        "RATE_LIMITED",
        "Client diagnostic rate limit reached.",
      );
    }
    const body = await readBoundedDiagnosticJson(request);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body as Record<string, unknown>).event !== "app.client_error"
    ) {
      throw new DiagnosticValidationError(
        "Client intake accepts only app.client_error.",
      );
    }
    const event = await writeDiagnostic({
      ...body,
      event: "app.client_error",
      requestId,
      severity: "error",
    });
    let actorUserId: string | null = null;
    if (hasConfiguredSupabase()) {
      const client = await createServerSupabaseClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      actorUserId = user?.id ?? null;
    }
    await persistDiagnosticEvent(event, actorUserId);
    return response({ accepted: true, requestId }, 202);
  } catch (error) {
    const status =
      error instanceof ClientDiagnosticIntakeError && error.code === "RATE_LIMITED"
        ? 429
        : error instanceof DiagnosticValidationError ||
            error instanceof ClientDiagnosticIntakeError ||
            error instanceof SyntaxError
          ? 400
          : 500;
    return response(
      {
        accepted: false,
        code:
          status === 429
            ? "DIAGNOSTIC_RATE_LIMITED"
            : status === 400
              ? "INVALID_DIAGNOSTIC"
              : "DIAGNOSTIC_UNAVAILABLE",
        requestId,
      },
      status,
    );
  }
}

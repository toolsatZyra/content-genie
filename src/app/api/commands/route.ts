import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  CommandValidationError,
  MAX_COMMAND_BYTES,
  parseCommand,
  parseIdempotencyKey,
} from "@/security/command-envelope";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import { executeCommand } from "@/server/execute-command";
import { mutationRpcFailureStatus } from "@/server/script-lock";

function response(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): NextResponse {
  const result = NextResponse.json({ ...body, requestId }, { status });
  result.headers.set("cache-control", "no-store");
  result.headers.set("x-request-id", requestId);
  return result;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const environment = getServerEnvironment();
  if (
    !isTrustedMutationOrigin(
      request.headers.get("origin"),
      request.nextUrl.origin,
      environment.public.appUrl,
    )
  ) {
    return response({ code: "ORIGIN_DENIED", ok: false }, 403, requestId);
  }
  const mediaType =
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return response({ code: "JSON_REQUIRED", ok: false }, 415, requestId);
  }

  try {
    const declaredLength = declaredRequestBodyBytes(request.headers, MAX_COMMAND_BYTES);
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("x-idempotency-key"),
    );
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error,
    } = await client.auth.getUser();
    if (error || !user) {
      return response({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const raw = await readBoundedUtf8RequestBody(
      request,
      MAX_COMMAND_BYTES,
      declaredLength,
    );
    const command = parseCommand(JSON.parse(raw) as unknown);
    const result = await executeCommand(client, user, command, idempotencyKey);
    return response({ ...result, ok: true }, 200, requestId);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large") {
      return response({ code: "COMMAND_TOO_LARGE", ok: false }, 413, requestId);
    }
    if (
      error instanceof SyntaxError ||
      error instanceof CommandValidationError ||
      error instanceof BoundedRequestBodyError
    ) {
      return response(
        {
          code: "INVALID_COMMAND",
          message: error instanceof Error ? error.message : "Invalid command.",
          ok: false,
        },
        400,
        requestId,
      );
    }
    const status = mutationRpcFailureStatus(error);
    return response(
      {
        code: status === 503 ? "COMMAND_OUTCOME_UNKNOWN" : "COMMAND_REJECTED",
        message:
          status === 503
            ? "The command outcome is unknown. Retry the same request safely."
            : "The command could not be committed. Refresh and try again.",
        ok: false,
      },
      status,
      requestId,
    );
  }
}

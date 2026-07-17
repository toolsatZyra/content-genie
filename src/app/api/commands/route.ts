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
import { executeCommand } from "@/server/execute-command";

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
  if (
    !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    return response({ code: "JSON_REQUIRED", ok: false }, 415, requestId);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_COMMAND_BYTES) {
    return response({ code: "COMMAND_TOO_LARGE", ok: false }, 413, requestId);
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_COMMAND_BYTES) {
      return response({ code: "COMMAND_TOO_LARGE", ok: false }, 413, requestId);
    }
    const command = parseCommand(JSON.parse(raw) as unknown);
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
    const result = await executeCommand(client, user, command, idempotencyKey);
    return response({ ...result, ok: true }, 200, requestId);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof CommandValidationError) {
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
    return response(
      {
        code: "COMMAND_REJECTED",
        message: "The command could not be committed. Refresh and try again.",
        ok: false,
      },
      409,
      requestId,
    );
  }
}

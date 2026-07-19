import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  CommandValidationError,
  parseIdempotencyKey,
} from "@/security/command-envelope";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import {
  ScriptIntegrityError,
  mutationRpcFailureStatus,
  parseScriptLockRequest,
  prepareScriptLockCommand,
} from "@/server/script-lock";

const MAX_SCRIPT_LOCK_REQUEST_BYTES = 400 * 1024;

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

export async function POST(
  request: NextRequest,
  context: Readonly<{ params: Promise<{ episodeId: string }> }>,
): Promise<NextResponse> {
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
    const declaredLength = declaredRequestBodyBytes(
      request.headers,
      MAX_SCRIPT_LOCK_REQUEST_BYTES,
    );
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("x-idempotency-key"),
    );
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return response({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const raw = await readBoundedUtf8RequestBody(
      request,
      MAX_SCRIPT_LOCK_REQUEST_BYTES,
      declaredLength,
    );
    const input = parseScriptLockRequest(JSON.parse(raw) as unknown);
    const { episodeId } = await context.params;
    if (input.episodeId !== episodeId) {
      throw new CommandValidationError("Route and body Episode IDs differ.");
    }
    const prepared = prepareScriptLockCommand(input, idempotencyKey);
    const attestor = createAdminSupabaseClient();
    const attestationId = crypto.randomUUID();
    let attestationUnavailable = false;
    let commandResult:
      | {
          readonly data: unknown;
          readonly error: { readonly code?: string } | null;
        }
      | undefined;
    let commandThrew = false;
    let revocationFailure: unknown;
    try {
      try {
        const { data: issuedAttestationId, error: attestationError } =
          await attestor.rpc("attest_script_coordinate_map", {
            p_actor_user_id: user.id,
            p_attestation_id: attestationId,
            p_coordinate_map: prepared.parameters.p_coordinate_map,
            p_episode_id: input.episodeId,
            p_processing_utf8_sha256: prepared.parameters.p_processing_utf8_sha256,
            p_raw_utf8_sha256: prepared.parameters.p_raw_utf8_sha256,
            p_request_hash: prepared.requestHash,
            p_runtime_evidence: prepared.parameters.p_runtime_evidence,
            p_workspace_id: input.workspaceId,
          });
        attestationUnavailable =
          Boolean(attestationError) || issuedAttestationId !== attestationId;
      } catch {
        // Issuance may have committed before its response was lost. The known
        // server-generated ID is still revoked in finally below.
        attestationUnavailable = true;
      }
      if (!attestationUnavailable) {
        try {
          commandResult = await client.rpc("command_lock_episode_script", {
            ...prepared.parameters,
            p_coordinate_attestation_id: attestationId,
          });
        } catch {
          commandThrew = true;
        }
      }
    } finally {
      try {
        const { error: revocationError } = await attestor.rpc(
          "revoke_script_coordinate_attestation",
          {
            p_actor_user_id: user.id,
            p_attestation_id: attestationId,
            p_request_hash: prepared.requestHash,
          },
        );
        revocationFailure = revocationError ?? undefined;
      } catch (error) {
        revocationFailure = error;
      }
    }
    if (revocationFailure) {
      return response(
        { code: "SCRIPT_ATTESTATION_CLEANUP_FAILED", ok: false },
        503,
        requestId,
      );
    }
    if (attestationUnavailable) {
      return response(
        { code: "SCRIPT_ATTESTATION_UNAVAILABLE", ok: false },
        503,
        requestId,
      );
    }
    if (commandThrew || !commandResult) {
      return response(
        {
          code: "SCRIPT_LOCK_OUTCOME_UNKNOWN",
          message: "The script lock outcome is unknown. Retry the same request safely.",
          ok: false,
        },
        503,
        requestId,
      );
    }
    const { data, error } = commandResult;
    if (error) {
      const status = mutationRpcFailureStatus(error);
      return response(
        {
          code: status === 503 ? "SCRIPT_LOCK_OUTCOME_UNKNOWN" : "SCRIPT_LOCK_REJECTED",
          message:
            error.code === "40001"
              ? "This Episode changed in another tab. Refresh before locking."
              : status === 503
                ? "The script lock outcome is unknown. Retry the same request safely."
                : "The exact script could not be locked.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    return response({ ok: true, result: data }, 200, requestId);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large") {
      return response({ code: "SCRIPT_REQUEST_TOO_LARGE", ok: false }, 413, requestId);
    }
    if (
      error instanceof SyntaxError ||
      error instanceof CommandValidationError ||
      error instanceof ScriptIntegrityError ||
      error instanceof BoundedRequestBodyError
    ) {
      return response(
        {
          code:
            error instanceof ScriptIntegrityError ? error.code : "INVALID_SCRIPT_LOCK",
          message: error.message,
          ok: false,
        },
        400,
        requestId,
      );
    }
    return response(
      {
        code: "SCRIPT_LOCK_REJECTED",
        message: "The exact script could not be locked.",
        ok: false,
      },
      503,
      requestId,
    );
  }
}

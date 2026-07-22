import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import {
  hashNarrationConfirmationRequest,
  NarrationUploadContractError,
  parseNarrationUploadConfirmation,
} from "@/domain/narration/narration-upload";
import { prepareBrowserScript } from "@/domain/script/integrity";
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
import { mutationRpcFailureStatus } from "@/server/script-lock";

const maximumConfirmationBytes = 16 * 1024;

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function POST(
  request: NextRequest,
  context: Readonly<{
    params: Promise<{ episodeId: string; uploadVersionId: string }>;
  }>,
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
    return reply({ code: "ORIGIN_DENIED", ok: false }, 403, requestId);
  }
  const mediaType =
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType !== "application/json") {
    return reply({ code: "JSON_REQUIRED", ok: false }, 415, requestId);
  }
  try {
    const declaredLength = declaredRequestBodyBytes(
      request.headers,
      maximumConfirmationBytes,
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
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const rawBody = await readBoundedUtf8RequestBody(
      request,
      maximumConfirmationBytes,
      declaredLength,
    );
    const confirmation = parseNarrationUploadConfirmation(
      JSON.parse(rawBody) as unknown,
    );
    const { episodeId, uploadVersionId } = await context.params;
    const { data: upload, error: uploadError } = await client
      .from("episode_narration_upload_versions")
      .select("state,state_version,transcription_text,transcription_sha256")
      .eq("workspace_id", confirmation.workspaceId)
      .eq("episode_id", episodeId)
      .eq("configuration_candidate_id", confirmation.configurationCandidateId)
      .eq("id", uploadVersionId)
      .maybeSingle();
    if (uploadError || !upload) {
      return reply({ code: "NARRATION_UPLOAD_NOT_FOUND", ok: false }, 404, requestId);
    }
    if (
      upload.state !== "verified" ||
      !Number.isSafeInteger(upload.state_version) ||
      typeof upload.transcription_text !== "string" ||
      typeof upload.transcription_sha256 !== "string"
    ) {
      return reply(
        {
          code: "NARRATION_UPLOAD_NOT_CONFIRMABLE",
          message: "This narration is not waiting for confirmation.",
          ok: false,
        },
        409,
        requestId,
      );
    }
    const prepared = prepareBrowserScript(upload.transcription_text);
    if (prepared.rawUtf8Sha256 !== upload.transcription_sha256) {
      return reply(
        { code: "NARRATION_TRANSCRIPT_EVIDENCE_STALE", ok: false },
        409,
        requestId,
      );
    }
    const requestHash = hashNarrationConfirmationRequest({
      confirmation,
      episodeId,
      idempotencyKey,
      transcriptSha256: prepared.rawUtf8Sha256,
      uploadStateVersion: upload.state_version,
      uploadVersionId,
    });
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
            p_coordinate_map: prepared.coordinateMap,
            p_episode_id: episodeId,
            p_processing_utf8_sha256: prepared.processingUtf8Sha256,
            p_raw_utf8_sha256: prepared.rawUtf8Sha256,
            p_request_hash: requestHash,
            p_runtime_evidence: prepared.runtimeEvidence,
            p_workspace_id: confirmation.workspaceId,
          });
        attestationUnavailable =
          Boolean(attestationError) || issuedAttestationId !== attestationId;
      } catch {
        attestationUnavailable = true;
      }
      if (!attestationUnavailable) {
        try {
          commandResult = await client.rpc("command_confirm_episode_narration_upload", {
            p_command_id: crypto.randomUUID(),
            p_configuration_candidate_id: confirmation.configurationCandidateId,
            p_coordinate_attestation_id: attestationId,
            p_coordinate_map: prepared.coordinateMap,
            p_correlation_id: crypto.randomUUID(),
            p_duration_acknowledged: true,
            p_episode_id: episodeId,
            p_expected_configuration_version: confirmation.expectedConfigurationVersion,
            p_expected_upload_state_version: upload.state_version,
            p_idempotency_key: idempotencyKey,
            p_processing_grapheme_count: prepared.coordinateMap.p[2].length,
            p_processing_profile: prepared.processingProfile,
            p_processing_scalar_count: prepared.coordinateMap.p[0].length - 1,
            p_processing_text: prepared.processingText,
            p_processing_utf16_code_units: prepared.processingText.length,
            p_processing_utf8_sha256: prepared.processingUtf8Sha256,
            p_raw_grapheme_count: prepared.coordinateMap.r[2].length,
            p_raw_scalar_count: prepared.coordinateMap.r[0].length - 1,
            p_raw_text: prepared.rawText,
            p_raw_utf16_code_units: prepared.rawText.length,
            p_raw_utf8: `\\x${Buffer.from(prepared.rawUtf8).toString("hex")}`,
            p_raw_utf8_sha256: prepared.rawUtf8Sha256,
            p_request_hash: requestHash,
            p_runtime_evidence: prepared.runtimeEvidence,
            p_upload_version_id: uploadVersionId,
            p_workspace_id: confirmation.workspaceId,
          });
        } catch {
          commandThrew = true;
        }
      }
    } finally {
      try {
        const { error: revokeError } = await attestor.rpc(
          "revoke_script_coordinate_attestation",
          {
            p_actor_user_id: user.id,
            p_attestation_id: attestationId,
            p_request_hash: requestHash,
          },
        );
        revocationFailure = revokeError ?? undefined;
      } catch (error) {
        revocationFailure = error;
      }
    }
    if (revocationFailure) {
      return reply(
        { code: "NARRATION_CONFIRMATION_CLEANUP_FAILED", ok: false },
        503,
        requestId,
      );
    }
    if (attestationUnavailable) {
      return reply(
        { code: "NARRATION_CONFIRMATION_ATTESTATION_UNAVAILABLE", ok: false },
        503,
        requestId,
      );
    }
    if (commandThrew || !commandResult) {
      return reply(
        {
          code: "NARRATION_CONFIRMATION_OUTCOME_UNKNOWN",
          message: "Confirmation outcome is unknown. Retry the same request safely.",
          ok: false,
        },
        503,
        requestId,
      );
    }
    if (commandResult.error) {
      const status = mutationRpcFailureStatus(commandResult.error);
      return reply(
        {
          code:
            status === 409
              ? "NARRATION_CONFIRMATION_STALE"
              : status === 503
                ? "NARRATION_CONFIRMATION_OUTCOME_UNKNOWN"
                : "NARRATION_CONFIRMATION_REJECTED",
          message:
            status === 409
              ? "This Episode changed in another tab. Refresh before confirming."
              : status === 503
                ? "Confirmation outcome is unknown. Retry the same request safely."
                : "The uploaded narration could not be confirmed.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    return reply({ ok: true, result: commandResult.data }, 200, requestId);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large") {
      return reply(
        { code: "NARRATION_CONFIRMATION_TOO_LARGE", ok: false },
        413,
        requestId,
      );
    }
    if (
      error instanceof SyntaxError ||
      error instanceof NarrationUploadContractError ||
      error instanceof CommandValidationError ||
      error instanceof BoundedRequestBodyError
    ) {
      return reply(
        {
          code: "INVALID_NARRATION_CONFIRMATION",
          message: error.message,
          ok: false,
        },
        400,
        requestId,
      );
    }
    return reply(
      {
        code: "NARRATION_CONFIRMATION_UNAVAILABLE",
        message: "Narration confirmation is temporarily unavailable.",
        ok: false,
      },
      503,
      requestId,
    );
  }
}

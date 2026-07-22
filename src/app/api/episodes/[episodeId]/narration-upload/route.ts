import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import {
  hashNarrationUploadRequest,
  NarrationUploadContractError,
  type NarrationUploadMime,
  parseNarrationUploadHeaders,
} from "@/domain/narration/narration-upload";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  CommandValidationError,
  parseIdempotencyKey,
} from "@/security/command-envelope";
import { launchMediaLimits, sniffMediaMagic } from "@/security/media-ingest";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedRequestBody,
} from "@/server/bounded-request-body";
import {
  NarrationUploadProcessingError,
  parseNarrationUploadPreparation,
  processNarrationUpload,
} from "@/server/narration-upload-processor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  return NextResponse.json(
    { ...body, requestId },
    {
      headers: {
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
      status,
    },
  );
}

function narrationMime(value: string | undefined): NarrationUploadMime | null {
  if (value === "audio/mpeg") return "audio/mpeg";
  if (value === "audio/wav" || value === "audio/x-wav") return "audio/wav";
  return null;
}

export async function POST(
  request: NextRequest,
  context: Readonly<{ params: Promise<{ episodeId: string }> }>,
): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  try {
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
    const declaredMime = narrationMime(
      request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase(),
    );
    if (!declaredMime) {
      return reply(
        {
          code: "NARRATION_AUDIO_REQUIRED",
          message: "Choose an MP3 or WAV narration file.",
          ok: false,
        },
        415,
        requestId,
      );
    }
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("x-idempotency-key"),
    );
    const { episodeId } = await context.params;
    const metadata = parseNarrationUploadHeaders(request.headers, episodeId);
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const declaredBytes = declaredRequestBodyBytes(
      request.headers,
      launchMediaLimits.maximumBytes,
    );
    const bytes = Buffer.from(
      await readBoundedRequestBody(
        request,
        launchMediaLimits.maximumBytes,
        declaredBytes,
      ),
    );
    if (bytes.length < 1_000 || sniffMediaMagic(bytes) !== declaredMime) {
      return reply(
        {
          code: "NARRATION_AUDIO_CONTENT_MISMATCH",
          message: "The file contents do not match the selected audio format.",
          ok: false,
        },
        422,
        requestId,
      );
    }
    const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
    const requestHash = hashNarrationUploadRequest({
      byteLength: bytes.length,
      contentSha256: sourceSha256,
      declaredMime,
      idempotencyKey,
      metadata,
    });
    const { data: authority, error: authorityError } = await client.rpc(
      "command_prepare_episode_narration_upload",
      {
        p_byte_length: bytes.length,
        p_command_id: randomUUID(),
        p_configuration_candidate_id: metadata.configurationCandidateId,
        p_correlation_id: randomUUID(),
        p_declared_mime: declaredMime,
        p_display_filename: metadata.displayFilename,
        p_episode_id: metadata.episodeId,
        p_expected_configuration_version: metadata.expectedConfigurationVersion,
        p_idempotency_key: idempotencyKey,
        p_quarantine_asset_version_id: randomUUID(),
        p_request_hash: requestHash,
        p_source_sha256: sourceSha256,
        p_stable_asset_id: randomUUID(),
        p_upload_version_id: randomUUID(),
        p_workspace_id: metadata.workspaceId,
      },
    );
    if (authorityError) {
      const status =
        authorityError.code === "42501"
          ? 403
          : authorityError.code === "40001" || authorityError.code === "55000"
            ? 409
            : 503;
      return reply(
        {
          code:
            status === 403
              ? "NARRATION_UPLOAD_SCOPE_DENIED"
              : status === 409
                ? "NARRATION_UPLOAD_STALE"
                : "NARRATION_UPLOAD_UNAVAILABLE",
          message:
            status === 409
              ? "This Episode changed or World building has begun. Refresh before replacing its narration."
              : status === 403
                ? "This upload is outside your active Episode workspace."
                : "Narration upload is temporarily unavailable.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    const preparation = parseNarrationUploadPreparation(authority);
    const result = await processNarrationUpload({
      bytes,
      declaredMime,
      preparation,
      requestHash,
      sourceSha256,
      workspaceId: metadata.workspaceId,
    });
    return reply({ ok: true, result }, 200, requestId);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError) {
      return reply(
        {
          code:
            error.failure === "too-large"
              ? "NARRATION_UPLOAD_TOO_LARGE"
              : "NARRATION_UPLOAD_BODY_INVALID",
          message:
            error.failure === "too-large"
              ? "Narration files must be 100 MB or smaller."
              : "The narration upload stream was incomplete or invalid.",
          ok: false,
        },
        error.failure === "too-large" ? 413 : 400,
        requestId,
      );
    }
    if (
      error instanceof NarrationUploadContractError ||
      error instanceof CommandValidationError
    ) {
      return reply(
        {
          code: "INVALID_NARRATION_UPLOAD",
          message: error.message,
          ok: false,
        },
        400,
        requestId,
      );
    }
    if (error instanceof NarrationUploadProcessingError) {
      return reply(
        {
          code: error.retryable
            ? "NARRATION_UPLOAD_TEMPORARILY_UNAVAILABLE"
            : "NARRATION_UPLOAD_REJECTED",
          message: error.retryable
            ? "Narration preparation was interrupted. Retry the same upload safely."
            : error.message,
          ok: false,
        },
        error.retryable ? 503 : 422,
        requestId,
      );
    }
    return reply(
      {
        code: "NARRATION_UPLOAD_UNAVAILABLE",
        message: "Narration upload is temporarily unavailable.",
        ok: false,
      },
      503,
      requestId,
    );
  }
}

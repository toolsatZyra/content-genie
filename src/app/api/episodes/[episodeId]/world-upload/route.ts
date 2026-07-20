import { createHash, randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import {
  hashWorldUploadRequest,
  parseWorldUploadHeaders,
  WorldUploadContractError,
} from "@/domain/world/world-upload";
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
  parseWorldUploadPreparation,
  processWorldUpload,
  WorldUploadProcessingError,
} from "@/server/world-upload-processor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"] as const);
type ImageMime = "image/jpeg" | "image/png" | "image/webp";

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

export async function POST(
  request: NextRequest,
  context: Readonly<{ params: Promise<{ episodeId: string }> }>,
): Promise<NextResponse> {
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  let intakePrepared = false;
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
    const contentType = request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (!imageMimes.has(contentType as ImageMime)) {
      return reply(
        {
          code: "IMAGE_REQUIRED",
          message: "Choose a JPEG, PNG, or WebP still image.",
          ok: false,
        },
        415,
        requestId,
      );
    }
    const declared = declaredRequestBodyBytes(
      request.headers,
      launchMediaLimits.maximumImageBytes,
    );
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("x-idempotency-key"),
    );
    const { episodeId } = await context.params;
    const metadata = parseWorldUploadHeaders(request.headers, episodeId);
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const { data: scope, error: scopeError } = await client
      .from("episode_configuration_candidates")
      .select("id")
      .eq("id", metadata.configurationCandidateId)
      .eq("workspace_id", metadata.workspaceId)
      .eq("episode_id", metadata.episodeId)
      .maybeSingle();
    if (scopeError || !scope) {
      return reply({ code: "WORLD_SCOPE_DENIED", ok: false }, 403, requestId);
    }
    const bytes = Buffer.from(
      await readBoundedRequestBody(
        request,
        launchMediaLimits.maximumImageBytes,
        declared,
      ),
    );
    if (bytes.length < 64 || sniffMediaMagic(bytes) !== contentType) {
      return reply(
        {
          code: "IMAGE_CONTENT_MISMATCH",
          message: "The file contents do not match the selected image format.",
          ok: false,
        },
        422,
        requestId,
      );
    }
    const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
    const requestHash = hashWorldUploadRequest({
      byteLength: bytes.length,
      contentSha256: sourceSha256,
      declaredMime: contentType,
      metadata,
    });
    const { data: preparationValue, error: preparationError } = await client.rpc(
      "command_prepare_world_upload",
      {
        p_byte_length: bytes.length,
        p_candidate_version_id: metadata.candidateVersionId,
        p_command_id: randomUUID(),
        p_configuration_candidate_id: metadata.configurationCandidateId,
        p_correlation_id: randomUUID(),
        p_declared_mime: contentType,
        p_display_filename: metadata.displayFilename,
        p_entity_id: metadata.entityId,
        p_entity_kind: metadata.entityKind,
        p_expected_selection_version: metadata.expectedSelectionVersion,
        p_idempotency_key: idempotencyKey,
        p_intake_id: randomUUID(),
        p_quarantine_asset_version_id: randomUUID(),
        p_regeneration_request_id: randomUUID(),
        p_request_hash: requestHash,
        p_source_sha256: sourceSha256,
        p_stable_asset_id: randomUUID(),
        p_workspace_id: metadata.workspaceId,
      },
    );
    if (preparationError) {
      const status = preparationError.code === "42501" ? 403 : 409;
      return reply(
        {
          code: status === 409 ? "WORLD_UPLOAD_STALE" : "WORLD_SCOPE_DENIED",
          message:
            status === 409
              ? "This World anchor changed. Refresh it before uploading a replacement."
              : "This upload is outside your active workspace.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    const preparation = parseWorldUploadPreparation(preparationValue);
    intakePrepared = true;
    if (preparation.state === "promoted") {
      return reply({ ok: true, result: preparation }, 200, requestId);
    }
    const result = await processWorldUpload({
      bytes,
      declaredMime: contentType as ImageMime,
      displayFilename: metadata.displayFilename,
      entityKind: metadata.entityKind,
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
              ? "WORLD_UPLOAD_TOO_LARGE"
              : "WORLD_UPLOAD_BODY_INVALID",
          message:
            error.failure === "too-large"
              ? "World images must be 25 MB or smaller."
              : "The upload stream was incomplete or invalid.",
          ok: false,
        },
        error.failure === "too-large" ? 413 : 400,
        requestId,
      );
    }
    if (
      error instanceof WorldUploadContractError ||
      error instanceof CommandValidationError
    ) {
      return reply(
        { code: "INVALID_WORLD_UPLOAD", message: error.message, ok: false },
        400,
        requestId,
      );
    }
    if (error instanceof WorldUploadProcessingError) {
      return reply(
        {
          code: "WORLD_UPLOAD_REJECTED",
          message:
            "The image failed closed during isolated inspection. Your existing anchor was preserved; you can choose another image.",
          ok: false,
        },
        422,
        requestId,
      );
    }
    return reply(
      {
        code: intakePrepared ? "WORLD_UPLOAD_REJECTED" : "WORLD_UPLOAD_UNAVAILABLE",
        message: intakePrepared
          ? "The image failed safely before it became a World anchor."
          : "Secure upload intake is temporarily unavailable.",
        ok: false,
      },
      intakePrepared ? 422 : 503,
      requestId,
    );
  }
}

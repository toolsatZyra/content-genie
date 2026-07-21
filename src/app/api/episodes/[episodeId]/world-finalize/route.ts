import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { parseIdempotencyKey } from "@/security/command-envelope";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import { ensureSourceCulturalPacket } from "@/server/source-cultural-preflight";
import { ensureWorldReferencePack } from "@/server/world-reference-pack";

const MAXIMUM_BODY_BYTES = 2_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-request-id", requestId);
  return response;
}

function parseInput(value: unknown): Readonly<{
  configurationCandidateId: string;
  episodeId: string;
  workspaceId: string;
}> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("World finalization input is invalid.");
  }
  const input = value as Record<string, unknown>;
  const keys = ["configurationCandidateId", "episodeId", "workspaceId"];
  if (
    Object.keys(input).sort().join(",") !== keys.sort().join(",") ||
    keys.some((key) => typeof input[key] !== "string" || !uuidPattern.test(input[key]))
  ) {
    throw new TypeError("World finalization scope is invalid.");
  }
  return input as {
    configurationCandidateId: string;
    episodeId: string;
    workspaceId: string;
  };
}

export async function POST(
  request: NextRequest,
  context: Readonly<{ params: Promise<{ episodeId: string }> }>,
) {
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
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return reply({ code: "JSON_REQUIRED", ok: false }, 415, requestId);
  }
  try {
    parseIdempotencyKey(request.headers.get("x-idempotency-key"));
    const declared = declaredRequestBodyBytes(request.headers, MAXIMUM_BODY_BYTES);
    const raw = await readBoundedUtf8RequestBody(request, MAXIMUM_BODY_BYTES, declared);
    const input = parseInput(JSON.parse(raw) as unknown);
    const { episodeId } = await context.params;
    if (episodeId !== input.episodeId) {
      return reply({ code: "WORLD_SCOPE_DENIED", ok: false }, 403, requestId);
    }
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
      .eq("id", input.configurationCandidateId)
      .eq("workspace_id", input.workspaceId)
      .eq("episode_id", input.episodeId)
      .maybeSingle();
    if (scopeError || !scope) {
      return reply({ code: "WORLD_SCOPE_DENIED", ok: false }, 403, requestId);
    }
    const referencePack = await ensureWorldReferencePack({
      configurationCandidateId: input.configurationCandidateId,
      workspaceId: input.workspaceId,
    });
    if (!referencePack.ready || !referencePack.packId) {
      return reply(
        {
          code: "WORLD_ANCHORS_INCOMPLETE",
          message: "Accept every World anchor before starting Preflight.",
          ok: false,
        },
        409,
        requestId,
      );
    }
    const sourceReview = await ensureSourceCulturalPacket({
      configurationCandidateId: input.configurationCandidateId,
      workspaceId: input.workspaceId,
      worldReferencePackVersionId: referencePack.packId,
    });
    return reply({ ok: true, referencePack, sourceReview }, 200, requestId);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      error instanceof TypeError ||
      error instanceof BoundedRequestBodyError
    ) {
      return reply(
        { code: "INVALID_WORLD_FINALIZATION", message: error.message, ok: false },
        error instanceof BoundedRequestBodyError && error.failure === "too-large"
          ? 413
          : 400,
        requestId,
      );
    }
    console.error("World reference pack finalization failed safely", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return reply(
      {
        code: "WORLD_FINALIZATION_UNAVAILABLE",
        message:
          "The accepted World is safe, but its reference pack is not assembled yet. Retry Preflight.",
        ok: false,
      },
      503,
      requestId,
    );
  }
}

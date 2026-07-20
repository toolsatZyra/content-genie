import { after, NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import {
  parseWorldDecisionInput,
  prepareWorldDecision,
  WorldDecisionContractError,
} from "@/domain/world/world-decision";
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
import { ensureSourceCulturalPacket } from "@/server/source-cultural-preflight";
import { ensureWorldReferencePack } from "@/server/world-reference-pack";
import { advanceNextMvpPreflight } from "@/server/mvp-preflight-runner";
import { ensureWorldRegenerationRun } from "@/server/world-regeneration";

const MAX_WORLD_DECISION_BYTES = 24_000;

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-request-id", requestId);
  return response;
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
    return reply({ code: "ORIGIN_DENIED", ok: false }, 403, requestId);
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  ) {
    return reply({ code: "JSON_REQUIRED", ok: false }, 415, requestId);
  }
  try {
    const declared = declaredRequestBodyBytes(
      request.headers,
      MAX_WORLD_DECISION_BYTES,
    );
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("x-idempotency-key"),
    );
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user)
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    const raw = await readBoundedUtf8RequestBody(
      request,
      MAX_WORLD_DECISION_BYTES,
      declared,
    );
    const input = parseWorldDecisionInput(JSON.parse(raw) as unknown);
    const { episodeId } = await context.params;
    if (input.episodeId !== episodeId)
      throw new CommandValidationError("Route and body Episode IDs differ.");
    const { data: scope, error: scopeError } = await client
      .from("episode_configuration_candidates")
      .select("id")
      .eq("id", input.configurationCandidateId)
      .eq("workspace_id", input.workspaceId)
      .eq("episode_id", input.episodeId)
      .maybeSingle();
    if (scopeError || !scope)
      return reply({ code: "WORLD_SCOPE_DENIED", ok: false }, 403, requestId);
    const prepared = prepareWorldDecision(input);
    const { data, error } = await client.rpc("command_decide_world_candidate", {
      p_candidate_version_id: input.candidateVersionId,
      p_command_id: crypto.randomUUID(),
      p_configuration_candidate_id: input.configurationCandidateId,
      p_correlation_id: crypto.randomUUID(),
      p_decision: input.decision,
      p_entity_id: input.entityId,
      p_entity_kind: input.entityKind,
      p_expected_selection_version: input.expectedSelectionVersion,
      p_idempotency_key: idempotencyKey,
      p_request_hash: prepared.requestHash,
      p_revised_prompt_sha256: prepared.revisedPromptSha256,
      p_revised_prompt_text: input.revisedPromptText,
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400;
      return reply(
        {
          code: status === 409 ? "WORLD_SELECTION_STALE" : "WORLD_DECISION_REJECTED",
          message:
            status === 409
              ? "This world candidate changed. Refresh before deciding."
              : "Monica could not apply that world decision.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    const regenerationRequestId =
      input.decision === "regenerate" &&
      data &&
      typeof data === "object" &&
      typeof (data as Record<string, unknown>).regenerationRequestId === "string"
        ? ((data as Record<string, unknown>).regenerationRequestId as string)
        : null;
    if (regenerationRequestId) {
      try {
        const regeneration = await ensureWorldRegenerationRun(regenerationRequestId);
        if (regeneration.shouldTrigger) {
          after(async () => {
            await advanceNextMvpPreflight().catch((caught) => {
              console.error(
                "The immediate World recast worker did not finish; the durable cron will reconcile it.",
                caught,
              );
            });
          });
        }
      } catch (caught) {
        // The decision row remains durable. The minute worker claims every queued
        // regeneration, including requests created before this consumer existed.
        console.error(
          "World recast dispatch will be reconciled by the durable worker.",
          caught,
        );
      }
    }
    const referencePack =
      input.decision === "accept"
        ? await ensureWorldReferencePack({
            configurationCandidateId: input.configurationCandidateId,
            workspaceId: input.workspaceId,
          }).catch(() => ({ packId: null, ready: false, replayed: false }))
        : { packId: null, ready: false, replayed: false };
    const sourceReview =
      referencePack.ready && referencePack.packId
        ? await ensureSourceCulturalPacket({
            configurationCandidateId: input.configurationCandidateId,
            workspaceId: input.workspaceId,
            worldReferencePackVersionId: referencePack.packId,
          })
            .then((value) => ({ ...value, ready: true }))
            .catch(() => ({ packetId: null, ready: false, replayed: false }))
        : { packetId: null, ready: false, replayed: false };
    return reply(
      { ok: true, referencePack, result: data, sourceReview },
      200,
      requestId,
    );
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large") {
      return reply({ code: "WORLD_DECISION_TOO_LARGE", ok: false }, 413, requestId);
    }
    if (
      error instanceof SyntaxError ||
      error instanceof CommandValidationError ||
      error instanceof WorldDecisionContractError ||
      error instanceof BoundedRequestBodyError
    ) {
      return reply(
        { code: "INVALID_WORLD_DECISION", message: error.message, ok: false },
        400,
        requestId,
      );
    }
    return reply({ code: "WORLD_DECISION_UNAVAILABLE", ok: false }, 503, requestId);
  }
}

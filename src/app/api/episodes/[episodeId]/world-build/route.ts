import { createHash, randomUUID } from "node:crypto";

import { after, NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import {
  parseWorldBuildRequest,
  WORLD_BUILD_MAX_BODY_BYTES,
  WorldBuildContractError,
} from "@/domain/world/world-build";
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
import { advanceNextMvpPreflight } from "@/server/mvp-preflight-runner";
import { beginWorldBuildProgress } from "@/server/world-build-progress";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
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

function parseCreatedRun(value: unknown): Readonly<{
  aggregateVersion: number;
  preflightRunId: string;
}> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).preflightRunId !== "string" ||
    !Number.isSafeInteger((value as Record<string, unknown>).aggregateVersion)
  ) {
    throw new Error("World build authority returned an invalid run.");
  }
  return value as { aggregateVersion: number; preflightRunId: string };
}

function parseSpendIntent(value: unknown): Readonly<{
  hardCeilingMinor: number;
  intentId: string;
}> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).intentId !== "string" ||
    (value as Record<string, unknown>).hardCeilingMinor !== 500
  ) {
    throw new Error("World build spend authority returned an invalid intent.");
  }
  return value as { hardCeilingMinor: number; intentId: string };
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
    if (!environment.enableProviderSpend) {
      return reply({ code: "WORLD_GENERATION_DISABLED", ok: false }, 503, requestId);
    }
    if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
      return reply({ code: "JSON_REQUIRED", ok: false }, 415, requestId);
    }
    const declaredLength = declaredRequestBodyBytes(
      request.headers,
      WORLD_BUILD_MAX_BODY_BYTES,
    );
    const idempotencyKey = parseIdempotencyKey(
      request.headers.get("x-idempotency-key"),
    );
    const input = parseWorldBuildRequest(
      await readBoundedUtf8RequestBody(
        request,
        WORLD_BUILD_MAX_BODY_BYTES,
        declaredLength,
      ),
    );
    const { episodeId } = await context.params;
    if (input.episodeId !== episodeId.toLowerCase()) {
      throw new WorldBuildContractError("Episode route binding is invalid.");
    }
    const userClient = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const { data: configuration, error: scopeError } = await userClient
      .from("episode_configuration_candidates")
      .select(
        "id,aggregate_version,script_revision_id,state,voice_confirmed_at,look_confirmed_at",
      )
      .eq("id", input.configurationCandidateId)
      .eq("workspace_id", input.workspaceId)
      .eq("episode_id", input.episodeId)
      .maybeSingle();
    if (
      scopeError ||
      !configuration ||
      !configuration.voice_confirmed_at ||
      !configuration.look_confirmed_at ||
      !["world_design", "preflight"].includes(configuration.state)
    ) {
      return reply({ code: "WORLD_SCOPE_DENIED", ok: false }, 403, requestId);
    }
    const intentRequestHash = createHash("sha256")
      .update(
        JSON.stringify({
          configurationCandidateId: input.configurationCandidateId,
          episodeId: input.episodeId,
          expectedConfigurationVersion: Number(configuration.aggregate_version),
          hardCeilingMinor: 500,
          workspaceId: input.workspaceId,
        }),
      )
      .digest("hex");
    const { data: intentValue, error: intentError } = await userClient.rpc(
      "command_authorize_world_build_intent",
      {
        p_command_id: randomUUID(),
        p_configuration_candidate_id: input.configurationCandidateId,
        p_episode_id: input.episodeId,
        p_expected_configuration_version: Number(configuration.aggregate_version),
        p_hard_ceiling_minor: 500,
        p_idempotency_key: `world-intent:${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 48)}`,
        p_request_hash: intentRequestHash,
        p_workspace_id: input.workspaceId,
      },
    );
    if (intentError) {
      if (intentError.code === "42501") {
        return reply(
          {
            code: "WORLD_AUTHORITY_DENIED",
            message:
              "This session cannot authorize the bounded World pass. Sign in again and retry.",
            ok: false,
          },
          403,
          requestId,
        );
      }
      if (["23505", "40001"].includes(intentError.code ?? "")) {
        return reply({ code: "WORLD_BUILD_STALE", ok: false }, 409, requestId);
      }
      throw intentError;
    }
    const intent = parseSpendIntent(intentValue);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          configurationCandidateId: input.configurationCandidateId,
          episodeId: input.episodeId,
          hardCeilingMinor: intent.hardCeilingMinor,
          spendIntentId: intent.intentId,
          kind: "world_anchor",
          scriptRevisionId: configuration.script_revision_id,
          workspaceId: input.workspaceId,
        }),
      )
      .digest("hex");
    const admin = createAdminSupabaseClient();
    const { data: createdValue, error: createError } = await admin.rpc(
      "command_create_preflight_run",
      {
        p_command_id: randomUUID(),
        p_configuration_candidate_id: input.configurationCandidateId,
        p_episode_id: input.episodeId,
        p_idempotency_key: idempotencyKey,
        p_kind: "world_anchor",
        p_micro_authorization_id: null,
        p_micro_quote_id: null,
        p_micro_reservation_id: null,
        p_request_hash: requestHash,
        p_requires_micro_authority: false,
        p_script_revision_id: configuration.script_revision_id,
        p_workspace_id: input.workspaceId,
      },
    );
    if (createError) throw createError;
    const created = parseCreatedRun(createdValue);
    const { data: current, error: currentError } = await admin
      .from("preflight_runs")
      .select("id,state,aggregate_version")
      .eq("id", created.preflightRunId)
      .single();
    if (currentError || !current) {
      throw new Error("World build run could not be reconciled.");
    }
    if (current.state === "created") {
      const { error: enqueueError } = await admin.rpc(
        "command_transition_preflight_run",
        {
          p_command: "enqueue",
          p_expected_version: Number(current.aggregate_version),
          p_preflight_run_id: current.id,
          p_trigger_run_id: null,
        },
      );
      if (enqueueError) throw enqueueError;
    } else if (
      !["queued", "running", "waiting_external", "succeeded"].includes(current.state)
    ) {
      return reply({ code: "WORLD_BUILD_NOT_ACTIVE", ok: false }, 409, requestId);
    }
    await beginWorldBuildProgress({
      configurationCandidateId: input.configurationCandidateId,
      preflightRunId: created.preflightRunId,
      workspaceId: input.workspaceId,
    });
    try {
      after(async () => {
        try {
          await advanceNextMvpPreflight();
        } catch (error) {
          console.error(
            "The immediate MVP World worker did not finish; the durable cron will reconcile it.",
            error,
          );
        }
      });
    } catch (error) {
      // Some non-Next test/runtime harnesses do not install a request work store.
      // The queued run is durable and the minute cron remains the recovery owner.
      console.error(
        "The immediate MVP World worker could not be scheduled; the durable cron will reconcile it.",
        error,
      );
    }
    return reply(
      {
        ok: true,
        result: {
          preflightRunId: created.preflightRunId,
          spendCeilingUsd: intent.hardCeilingMinor / 100,
          state: current.state === "created" ? "queued" : current.state,
          triggerRunId: null,
        },
      },
      202,
      requestId,
    );
  } catch (error) {
    if (
      error instanceof WorldBuildContractError ||
      error instanceof CommandValidationError ||
      error instanceof BoundedRequestBodyError
    ) {
      return reply(
        {
          code:
            error instanceof BoundedRequestBodyError && error.failure === "too-large"
              ? "WORLD_BUILD_TOO_LARGE"
              : "INVALID_WORLD_BUILD",
          ok: false,
        },
        error instanceof BoundedRequestBodyError && error.failure === "too-large"
          ? 413
          : 400,
        requestId,
      );
    }
    return reply(
      {
        code: "WORLD_BUILD_OUTCOME_UNKNOWN",
        message:
          "Monica could not confirm dispatch. Retrying the same build request is safe.",
        ok: false,
      },
      503,
      requestId,
    );
  }
}

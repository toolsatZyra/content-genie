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
import { deterministicCommandUuid } from "@/server/deterministic-command-ids";

const MAX_BYTES = 4_096;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class WorldLockContractError extends Error {
  override readonly name = "WorldLockContractError";
}

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "no-store");
  return response;
}

function parse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WorldLockContractError("Body must be an object.");
  const row = value as Record<string, unknown>;
  const keys = [
    "configurationCandidateId",
    "episodeId",
    "expectedConfigurationVersion",
    "expectedEpisodeVersion",
    "quoteId",
    "workspaceId",
  ].sort();
  if (Object.keys(row).sort().join("|") !== keys.join("|"))
    throw new WorldLockContractError("Body is not exact.");
  if (
    ![row.configurationCandidateId, row.episodeId, row.quoteId, row.workspaceId].every(
      (item) => typeof item === "string" && uuid.test(item),
    )
  )
    throw new WorldLockContractError("IDs must be UUIDs.");
  if (
    ![row.expectedConfigurationVersion, row.expectedEpisodeVersion].every(
      (item) => Number.isInteger(item) && Number(item) > 0,
    )
  )
    throw new WorldLockContractError("Expected versions must be positive.");
  return row as {
    configurationCandidateId: string;
    episodeId: string;
    expectedConfigurationVersion: number;
    expectedEpisodeVersion: number;
    quoteId: string;
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
  )
    return reply({ code: "ORIGIN_DENIED", ok: false }, 403, requestId);
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return reply({ code: "JSON_REQUIRED", ok: false }, 415, requestId);
  try {
    const key = parseIdempotencyKey(request.headers.get("x-idempotency-key"));
    const raw = await readBoundedUtf8RequestBody(
      request,
      MAX_BYTES,
      declaredRequestBodyBytes(request.headers, MAX_BYTES),
    );
    const input = parse(JSON.parse(raw) as unknown);
    const { episodeId } = await context.params;
    if (input.episodeId !== episodeId)
      throw new WorldLockContractError("Route and body Episode IDs differ.");
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user)
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    const [episodeResult, quoteResult] = await Promise.all([
      client
        .from("episodes")
        .select("id,series_id,aggregate_version,series(aggregate_version)")
        .eq("id", episodeId)
        .eq("workspace_id", input.workspaceId)
        .maybeSingle(),
      client
        .from("production_quotes")
        .select("id")
        .eq("id", input.quoteId)
        .eq("configuration_candidate_id", input.configurationCandidateId)
        .eq("workspace_id", input.workspaceId)
        .maybeSingle(),
    ]);
    if (
      episodeResult.error ||
      quoteResult.error ||
      !episodeResult.data ||
      !quoteResult.data
    )
      return reply({ code: "WORLD_LOCK_SCOPE_DENIED", ok: false }, 403, requestId);
    const seriesRelation = episodeResult.data.series as
      | { aggregate_version: number | string }
      | readonly { aggregate_version: number | string }[]
      | null;
    const seriesVersion = Number(
      Array.isArray(seriesRelation)
        ? seriesRelation[0]?.aggregate_version
        : (seriesRelation as { aggregate_version: number | string } | null)
            ?.aggregate_version,
    );
    if (!Number.isInteger(seriesVersion) || seriesVersion < 1)
      return reply({ code: "WORLD_LOCK_SCOPE_DENIED", ok: false }, 403, requestId);
    const { data: confirmation, error: confirmationError } = await client
      .from("production_quote_confirmations")
      .select("id")
      .eq("production_quote_id", input.quoteId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (confirmationError || !confirmation)
      return reply({ code: "QUOTE_CONFIRMATION_REQUIRED", ok: false }, 409, requestId);

    const id = (label: string) =>
      deterministicCommandUuid("world-lock", label, input.workspaceId, user.id, key);
    const continuityId = id("continuity");
    const { data: prepared, error: prepareError } = await client.rpc(
      "prepare_first_episode_world_lock",
      {
        p_configuration_candidate_id: input.configurationCandidateId,
        p_continuity_state_version_id: continuityId,
        p_expected_configuration_version: input.expectedConfigurationVersion,
        p_expected_episode_version: input.expectedEpisodeVersion,
        p_expected_series_version: seriesVersion,
        p_production_quote_id: input.quoteId,
        p_quote_confirmation_id: confirmation.id,
        p_workspace_id: input.workspaceId,
      },
    );
    if (prepareError || !prepared || typeof prepared !== "object") {
      const status = prepareError?.code === "42501" ? 403 : 409;
      return reply(
        {
          code: status === 403 ? "AAL2_REQUIRED" : "WORLD_LOCK_STALE",
          message:
            status === 403
              ? "Verify with your authenticator before locking the world."
              : "A World Lock input changed. Refresh Preflight.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    const hashes = prepared as Record<string, unknown>;
    if (
      typeof hashes.manifestHash !== "string" ||
      typeof hashes.requestHash !== "string"
    )
      return reply(
        { code: "WORLD_LOCK_PREPARATION_INVALID", ok: false },
        503,
        requestId,
      );
    const commandId = id("command");
    const productionRunId = id("production-run");
    const { data, error } = await client.rpc("command_lock_first_episode_world", {
      p_budget_authorization_id: id("authorization"),
      p_budget_reservation_id: id("reservation"),
      p_command_id: commandId,
      p_configuration_candidate_id: input.configurationCandidateId,
      p_continuity_state_version_id: continuityId,
      p_correlation_id: id("correlation"),
      p_expected_configuration_version: input.expectedConfigurationVersion,
      p_expected_episode_version: input.expectedEpisodeVersion,
      p_expected_series_version: seriesVersion,
      p_idempotency_key: key,
      p_production_quote_id: input.quoteId,
      p_production_run_id: productionRunId,
      p_quote_confirmation_id: confirmation.id,
      p_release_manifest_hash: hashes.manifestHash,
      p_request_hash: hashes.requestHash,
      p_series_release_component_id: id("release-component"),
      p_series_release_decision_id: id("release-decision"),
      p_series_release_id: id("series-release"),
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400;
      return reply(
        {
          code: status === 403 ? "AAL2_REQUIRED" : "WORLD_LOCK_REJECTED",
          message:
            status === 403
              ? "Verify with your authenticator before locking the world."
              : "Monica found a stale or incomplete World Lock prerequisite.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    const { error: startError } = await client.rpc("command_start_mvp_production", {
      p_production_run_id: productionRunId,
      p_workspace_id: input.workspaceId,
    });
    return reply(
      {
        ok: true,
        productionQueued: !startError,
        productionRunId,
        result: data,
      },
      200,
      requestId,
    );
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large")
      return reply({ code: "REQUEST_TOO_LARGE", ok: false }, 413, requestId);
    if (
      error instanceof SyntaxError ||
      error instanceof BoundedRequestBodyError ||
      error instanceof WorldLockContractError
    )
      return reply(
        { code: "INVALID_WORLD_LOCK", message: error.message, ok: false },
        400,
        requestId,
      );
    return reply({ code: "WORLD_LOCK_UNAVAILABLE", ok: false }, 503, requestId);
  }
}

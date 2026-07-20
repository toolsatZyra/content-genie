import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { canonicalJson, parseIdempotencyKey } from "@/security/command-envelope";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";
import { deterministicCommandUuid } from "@/server/deterministic-command-ids";

const MAX_BYTES = 12_000;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class DecisionContractError extends Error {
  override readonly name = "DecisionContractError";
}

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-request-id", requestId);
  return response;
}

function parse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DecisionContractError("Body must be an object.");
  }
  const row = value as Record<string, unknown>;
  const keys = [
    "competencyScopeHash",
    "competencyVersionId",
    "decision",
    "episodeId",
    "expectedStatusVersion",
    "packetId",
    "rationale",
    "workspaceId",
  ].sort();
  if (Object.keys(row).sort().join("|") !== keys.join("|")) {
    throw new DecisionContractError("Body is not exact.");
  }
  if (
    ![row.competencyVersionId, row.episodeId, row.packetId, row.workspaceId].every(
      (item) => typeof item === "string" && uuid.test(item),
    )
  ) {
    throw new DecisionContractError("IDs must be UUIDs.");
  }
  if (row.decision !== "approve" && row.decision !== "block") {
    throw new DecisionContractError("Decision must be approve or block.");
  }
  if (
    !Number.isInteger(row.expectedStatusVersion) ||
    Number(row.expectedStatusVersion) < 1
  ) {
    throw new DecisionContractError("Status version must be positive.");
  }
  if (
    typeof row.competencyScopeHash !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.competencyScopeHash)
  ) {
    throw new DecisionContractError("Competency scope hash is invalid.");
  }
  if (
    typeof row.rationale !== "string" ||
    row.rationale.trim().length < 2 ||
    row.rationale.length > 4_000
  ) {
    throw new DecisionContractError("Rationale must contain 2–4,000 characters.");
  }
  return {
    competencyScopeHash: row.competencyScopeHash,
    competencyVersionId: row.competencyVersionId as string,
    decision: row.decision,
    episodeId: row.episodeId as string,
    expectedStatusVersion: Number(row.expectedStatusVersion),
    packetId: row.packetId as string,
    rationale: row.rationale.trim(),
    workspaceId: row.workspaceId as string,
  } as const;
}

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

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
    const key = parseIdempotencyKey(request.headers.get("x-idempotency-key"));
    const raw = await readBoundedUtf8RequestBody(
      request,
      MAX_BYTES,
      declaredRequestBodyBytes(request.headers, MAX_BYTES),
    );
    const input = parse(JSON.parse(raw) as unknown);
    const { episodeId } = await context.params;
    if (episodeId !== input.episodeId) {
      throw new DecisionContractError("Route and body Episode IDs differ.");
    }
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const { data: binding, error: bindingError } = await client
      .from("source_review_packet_world_bindings")
      .select(
        "source_review_packet_id,episode_configuration_candidates!inner(episode_id)",
      )
      .eq("source_review_packet_id", input.packetId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    const relation = binding?.episode_configuration_candidates as
      { episode_id: string } | readonly { episode_id: string }[] | null | undefined;
    const scopedEpisode = Array.isArray(relation)
      ? relation[0]?.episode_id
      : (relation as { episode_id: string } | null | undefined)?.episode_id;
    if (bindingError || !binding || scopedEpisode !== episodeId) {
      return reply({ code: "SOURCE_REVIEW_SCOPE_DENIED", ok: false }, 403, requestId);
    }
    const requestHash = sha256(canonicalJson(input));
    const commandId = deterministicCommandUuid(
      "source-review-decision",
      input.workspaceId,
      user.id,
      key,
    );
    const { data, error } = await client.rpc("command_submit_source_review", {
      p_command_id: commandId,
      p_competency_scope_hash: input.competencyScopeHash,
      p_competency_version_id: input.competencyVersionId,
      p_correlation_id: deterministicCommandUuid(
        "source-review-correlation",
        commandId,
      ),
      p_decision: input.decision,
      p_expected_status_version: input.expectedStatusVersion,
      p_idempotency_key: key,
      p_rationale: input.rationale,
      p_request_hash: requestHash,
      p_source_review_packet_id: input.packetId,
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400;
      return reply(
        {
          code:
            status === 403 ? "AAL2_OR_COMPETENCY_REQUIRED" : "SOURCE_REVIEW_REJECTED",
          message:
            status === 403
              ? "Verify your authenticator and activate the matching reviewer appointment."
              : "The evidence or review state changed. Refresh before deciding.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    return reply({ ok: true, result: data }, 200, requestId);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large") {
      return reply({ code: "REQUEST_TOO_LARGE", ok: false }, 413, requestId);
    }
    if (
      error instanceof SyntaxError ||
      error instanceof BoundedRequestBodyError ||
      error instanceof DecisionContractError
    ) {
      return reply(
        { code: "INVALID_SOURCE_REVIEW", message: error.message, ok: false },
        400,
        requestId,
      );
    }
    return reply({ code: "SOURCE_REVIEW_UNAVAILABLE", ok: false }, 503, requestId);
  }
}

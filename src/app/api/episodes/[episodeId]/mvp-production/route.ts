import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";

const MAX_BYTES = 8_192;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class MvpProductionContractError extends Error {
  override readonly name = "MvpProductionContractError";
}

type Input =
  | Readonly<{
      action: "review";
      culturalReviewConfirmed: boolean;
      decision: "approve" | "reject";
      expectedVersion: number;
      feedback: string;
      finalReviewConfirmed: boolean;
      masterId: string;
      workspaceId: string;
    }>
  | Readonly<{
      action: "retry";
      expectedVersion: number;
      productionRunId: string;
      workspaceId: string;
    }>
  | Readonly<{
      action: "start";
      productionRunId: string;
      workspaceId: string;
    }>;

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  return NextResponse.json(
    { ...body, requestId },
    {
      headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
      status,
    },
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpProductionContractError("Body must be an object.");
  }
  return value as Record<string, unknown>;
}

function parse(value: unknown): Input {
  const row = object(value);
  if (row.action === "start") {
    if (
      Object.keys(row).sort().join("|") !==
        ["action", "productionRunId", "workspaceId"].sort().join("|") ||
      typeof row.productionRunId !== "string" ||
      !uuid.test(row.productionRunId) ||
      typeof row.workspaceId !== "string" ||
      !uuid.test(row.workspaceId)
    ) {
      throw new MvpProductionContractError("Start request is invalid.");
    }
    return row as Input;
  }
  if (row.action === "retry") {
    if (
      Object.keys(row).sort().join("|") !==
        ["action", "expectedVersion", "productionRunId", "workspaceId"]
          .sort()
          .join("|") ||
      typeof row.productionRunId !== "string" ||
      !uuid.test(row.productionRunId) ||
      typeof row.workspaceId !== "string" ||
      !uuid.test(row.workspaceId) ||
      !Number.isSafeInteger(row.expectedVersion) ||
      Number(row.expectedVersion) < 1
    ) {
      throw new MvpProductionContractError("Retry request is invalid.");
    }
    return row as Input;
  }
  if (row.action === "review") {
    if (
      Object.keys(row).sort().join("|") !==
        [
          "action",
          "culturalReviewConfirmed",
          "decision",
          "expectedVersion",
          "feedback",
          "finalReviewConfirmed",
          "masterId",
          "workspaceId",
        ]
          .sort()
          .join("|") ||
      !["approve", "reject"].includes(String(row.decision)) ||
      typeof row.masterId !== "string" ||
      !uuid.test(row.masterId) ||
      typeof row.workspaceId !== "string" ||
      !uuid.test(row.workspaceId) ||
      !Number.isSafeInteger(row.expectedVersion) ||
      Number(row.expectedVersion) < 1 ||
      typeof row.culturalReviewConfirmed !== "boolean" ||
      typeof row.finalReviewConfirmed !== "boolean" ||
      typeof row.feedback !== "string" ||
      row.feedback.length > 4_000 ||
      row.feedback.includes("\0")
    ) {
      throw new MvpProductionContractError("Review request is invalid.");
    }
    return row as Input;
  }
  throw new MvpProductionContractError("Action is invalid.");
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
    const body = await readBoundedUtf8RequestBody(
      request,
      MAX_BYTES,
      declaredRequestBodyBytes(request.headers, MAX_BYTES),
    );
    const input = parse(JSON.parse(body) as unknown);
    const { episodeId } = await context.params;
    if (!uuid.test(episodeId)) {
      throw new MvpProductionContractError("Episode identity is invalid.");
    }
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const { data: episode, error: episodeError } = await client
      .from("episodes")
      .select("id")
      .eq("id", episodeId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (episodeError || !episode) {
      return reply({ code: "PRODUCTION_SCOPE_DENIED", ok: false }, 403, requestId);
    }
    if (input.action === "start") {
      const { data, error } = await client.rpc("command_start_mvp_production", {
        p_production_run_id: input.productionRunId,
        p_workspace_id: input.workspaceId,
      });
      if (error) {
        return reply({ code: "PRODUCTION_START_REJECTED", ok: false }, 409, requestId);
      }
      return reply({ ok: true, result: data }, 200, requestId);
    }
    if (input.action === "retry") {
      const { data, error } = await client.rpc("command_retry_mvp_production", {
        p_expected_version: input.expectedVersion,
        p_production_run_id: input.productionRunId,
        p_workspace_id: input.workspaceId,
      });
      if (error) {
        const status = error.code === "42501" ? 403 : 409;
        return reply(
          {
            code:
              status === 403
                ? "WORKSPACE_AUTHORITY_REQUIRED"
                : "PRODUCTION_RETRY_REJECTED",
            ok: false,
          },
          status,
          requestId,
        );
      }
      return reply({ ok: true, result: data }, 200, requestId);
    }
    const { data, error } = await client.rpc("command_review_mvp_master", {
      p_cultural_review_confirmed: input.culturalReviewConfirmed,
      p_decision: input.decision,
      p_expected_version: input.expectedVersion,
      p_feedback: input.feedback,
      p_final_review_confirmed: input.finalReviewConfirmed,
      p_master_id: input.masterId,
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : 409;
      return reply(
        {
          code:
            status === 403 ? "WORKSPACE_AUTHORITY_REQUIRED" : "MASTER_REVIEW_REJECTED",
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
      error instanceof MvpProductionContractError
    ) {
      return reply(
        { code: "INVALID_PRODUCTION_REQUEST", message: error.message, ok: false },
        400,
        requestId,
      );
    }
    return reply({ code: "PRODUCTION_UNAVAILABLE", ok: false }, 503, requestId);
  }
}

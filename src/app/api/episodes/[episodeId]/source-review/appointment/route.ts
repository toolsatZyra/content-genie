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

const MAX_BYTES = 4_096;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

class AppointmentContractError extends Error {
  override readonly name = "AppointmentContractError";
}

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-request-id", requestId);
  return response;
}

function parse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppointmentContractError("Body must be an object.");
  }
  const row = value as Record<string, unknown>;
  const keys = ["episodeId", "packetId", "workspaceId"].sort();
  if (Object.keys(row).sort().join("|") !== keys.join("|")) {
    throw new AppointmentContractError("Body is not exact.");
  }
  if (
    ![row.episodeId, row.packetId, row.workspaceId].every(
      (item) => typeof item === "string" && uuid.test(item),
    )
  ) {
    throw new AppointmentContractError("IDs must be UUIDs.");
  }
  return row as { episodeId: string; packetId: string; workspaceId: string };
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
      throw new AppointmentContractError("Route and body Episode IDs differ.");
    }
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }
    const { data: packet, error: packetError } = await client
      .from("source_review_packets")
      .select(
        "id,configuration_candidate_id,episode_configuration_candidates!inner(episode_id)",
      )
      .eq("id", input.packetId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    const relation = packet?.episode_configuration_candidates as
      { episode_id: string } | readonly { episode_id: string }[] | null | undefined;
    const scopedEpisode = Array.isArray(relation)
      ? relation[0]?.episode_id
      : (relation as { episode_id: string } | null | undefined)?.episode_id;
    if (packetError || !packet || scopedEpisode !== episodeId) {
      return reply({ code: "SOURCE_REVIEW_SCOPE_DENIED", ok: false }, 403, requestId);
    }
    const effectiveAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() + 366 * 24 * 60 * 60 * 1_000).toISOString();
    const evidence = {
      actorUserId: user.id,
      appointmentIssuer: "Zyra internal launch authority",
      attestation:
        "The reviewer is Zyra's designated launch decision maker and accepts responsibility for qualified cultural, theological, regional, rights, and dignity review.",
      effectiveAt,
      expiresAt,
      schemaVersion: "genie.cultural-reviewer-appointment.v1",
      workspaceId: input.workspaceId,
    };
    const requestHash = sha256(canonicalJson({ evidence, input }));
    const commandId = deterministicCommandUuid(
      "cultural-reviewer-appointment",
      input.workspaceId,
      user.id,
      key,
    );
    const { data, error } = await client.rpc("command_appoint_cultural_reviewer", {
      p_appointment_evidence_hash: sha256(canonicalJson(evidence)),
      p_appointment_issuer: evidence.appointmentIssuer,
      p_command_id: commandId,
      p_content_classes: ["all"],
      p_correlation_id: deterministicCommandUuid(
        "cultural-reviewer-correlation",
        commandId,
      ),
      p_effective_at: effectiveAt,
      p_expires_at: expiresAt,
      p_idempotency_key: key,
      p_languages: ["all"],
      p_regions: ["all"],
      p_request_hash: requestHash,
      p_reviewer_user_id: user.id,
      p_traditions: ["all"],
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400;
      return reply(
        {
          code: status === 403 ? "ADMIN_AUTHORITY_REQUIRED" : "APPOINTMENT_REJECTED",
          message:
            status === 403
              ? "Use a workspace admin account."
              : "The reviewer appointment changed. Refresh and try again.",
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
      error instanceof AppointmentContractError
    ) {
      return reply(
        { code: "INVALID_APPOINTMENT", message: error.message, ok: false },
        400,
        requestId,
      );
    }
    return reply({ code: "APPOINTMENT_UNAVAILABLE", ok: false }, 503, requestId);
  }
}

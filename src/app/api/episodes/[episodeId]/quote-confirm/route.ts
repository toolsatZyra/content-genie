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

class QuoteConfirmationContractError extends Error {
  override readonly name = "QuoteConfirmationContractError";
}

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "no-store");
  return response;
}

function parse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new QuoteConfirmationContractError("Body must be an object.");
  const row = value as Record<string, unknown>;
  const keys = [
    "episodeId",
    "hardCeilingMicrousd",
    "quoteHash",
    "quoteId",
    "workspaceId",
  ].sort();
  if (Object.keys(row).sort().join("|") !== keys.join("|"))
    throw new QuoteConfirmationContractError("Body is not exact.");
  if (
    ![row.episodeId, row.quoteId, row.workspaceId].every(
      (item) => typeof item === "string" && uuid.test(item),
    )
  )
    throw new QuoteConfirmationContractError("IDs must be UUIDs.");
  if (typeof row.quoteHash !== "string" || !/^[a-f0-9]{64}$/.test(row.quoteHash))
    throw new QuoteConfirmationContractError("quoteHash is invalid.");
  if (
    !Number.isInteger(row.hardCeilingMicrousd) ||
    Number(row.hardCeilingMicrousd) < 0 ||
    Number(row.hardCeilingMicrousd) > 50_000_000
  )
    throw new QuoteConfirmationContractError("hardCeilingMicrousd is invalid.");
  return row as {
    episodeId: string;
    hardCeilingMicrousd: number;
    quoteHash: string;
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
      throw new QuoteConfirmationContractError("Route and body Episode IDs differ.");
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user)
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    const { data: quote, error: quoteError } = await client
      .from("production_quotes")
      .select("id,configuration_candidate_id")
      .eq("id", input.quoteId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (quoteError || !quote)
      return reply({ code: "QUOTE_NOT_FOUND", ok: false }, 404, requestId);
    const { data: scope, error: scopeError } = await client
      .from("episode_configuration_candidates")
      .select("id")
      .eq("id", quote.configuration_candidate_id)
      .eq("episode_id", episodeId)
      .maybeSingle();
    if (scopeError || !scope)
      return reply({ code: "QUOTE_SCOPE_DENIED", ok: false }, 403, requestId);
    const commandId = deterministicCommandUuid(
      "quote-confirm",
      input.workspaceId,
      user.id,
      key,
    );
    const { data, error } = await client.rpc("command_confirm_production_quote", {
      p_command_id: commandId,
      p_hard_ceiling_microusd: input.hardCeilingMicrousd,
      p_quote_hash: input.quoteHash,
      p_quote_id: input.quoteId,
      p_workspace_id: input.workspaceId,
    });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : 400;
      return reply(
        {
          code:
            status === 403
              ? "WORKSPACE_AUTHORITY_REQUIRED"
              : "QUOTE_CONFIRMATION_REJECTED",
          message:
            status === 403
              ? "Use a workspace admin account before confirming the production ceiling."
              : "The quote changed or expired. Refresh Preflight.",
          ok: false,
        },
        status,
        requestId,
      );
    }
    return reply({ ok: true, result: { confirmationId: data } }, 200, requestId);
  } catch (error) {
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large")
      return reply({ code: "REQUEST_TOO_LARGE", ok: false }, 413, requestId);
    if (
      error instanceof SyntaxError ||
      error instanceof BoundedRequestBodyError ||
      error instanceof QuoteConfirmationContractError
    )
      return reply(
        { code: "INVALID_QUOTE_CONFIRMATION", message: error.message, ok: false },
        400,
        requestId,
      );
    return reply({ code: "QUOTE_CONFIRMATION_UNAVAILABLE", ok: false }, 503, requestId);
  }
}

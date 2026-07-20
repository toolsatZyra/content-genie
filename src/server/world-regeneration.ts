import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { postgresJsonbText } from "@/server/world-anchor-provider";

export class WorldRegenerationError extends Error {
  override readonly name = "WorldRegenerationError";
}

type RegenerationAuthority = Readonly<{
  configurationCandidateId: string;
  episodeId: string;
  preflightRunId: string | null;
  regenerationRequestId: string;
  scriptRevisionId: string;
  workspaceId: string;
}>;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function authority(value: unknown): RegenerationAuthority {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorldRegenerationError("World regeneration authority is malformed.");
  }
  const row = value as Record<string, unknown>;
  const keys = [
    "configurationCandidateId",
    "episodeId",
    "preflightRunId",
    "regenerationRequestId",
    "scriptRevisionId",
    "workspaceId",
  ];
  if (
    Object.keys(row).sort().join(",") !== keys.sort().join(",") ||
    keys
      .filter((key) => key !== "preflightRunId")
      .some((key) => typeof row[key] !== "string") ||
    (row.preflightRunId !== null && typeof row.preflightRunId !== "string")
  ) {
    throw new WorldRegenerationError("World regeneration authority is malformed.");
  }
  return row as RegenerationAuthority;
}

export async function ensureWorldRegenerationRun(
  regenerationRequestId: string,
): Promise<Readonly<{ preflightRunId: string; shouldTrigger: boolean }>> {
  const client = createAdminSupabaseClient();
  const { data: authorityValue, error: authorityError } = await client.rpc(
    "command_ensure_world_regeneration_authority",
    { p_regeneration_request_id: regenerationRequestId },
  );
  if (authorityError) {
    throw new WorldRegenerationError(
      "World regeneration authority could not be prepared.",
    );
  }
  const prepared = authority(authorityValue);
  if (prepared.regenerationRequestId !== regenerationRequestId) {
    throw new WorldRegenerationError("World regeneration authority scope is stale.");
  }
  let preflightRunId = prepared.preflightRunId;
  if (!preflightRunId) {
    const idempotencyKey = `world-regeneration:${regenerationRequestId}`;
    const requestHash = sha256(
      postgresJsonbText({
        configurationCandidateId: prepared.configurationCandidateId,
        episodeId: prepared.episodeId,
        kind: "world_anchor",
        regenerationRequestId,
        scriptRevisionId: prepared.scriptRevisionId,
        workspaceId: prepared.workspaceId,
      }),
    );
    const { data: created, error: createError } = await client.rpc(
      "command_create_preflight_run",
      {
        p_command_id: deterministicUuid(`command:${idempotencyKey}`),
        p_configuration_candidate_id: prepared.configurationCandidateId,
        p_episode_id: prepared.episodeId,
        p_idempotency_key: idempotencyKey,
        p_kind: "world_anchor",
        p_micro_authorization_id: null,
        p_micro_quote_id: null,
        p_micro_reservation_id: null,
        p_request_hash: requestHash,
        p_requires_micro_authority: false,
        p_script_revision_id: prepared.scriptRevisionId,
        p_workspace_id: prepared.workspaceId,
      },
    );
    if (
      createError ||
      !created ||
      typeof created !== "object" ||
      typeof (created as Record<string, unknown>).preflightRunId !== "string"
    ) {
      throw new WorldRegenerationError("World regeneration run could not be created.");
    }
    preflightRunId = (created as { preflightRunId: string }).preflightRunId;
    const { error: bindError } = await client.rpc(
      "command_bind_world_regeneration_run",
      {
        p_preflight_run_id: preflightRunId,
        p_regeneration_request_id: regenerationRequestId,
      },
    );
    if (bindError) {
      throw new WorldRegenerationError("World regeneration run could not be bound.");
    }
  }
  const { data: run, error: runError } = await client
    .from("preflight_runs")
    .select("id,state,aggregate_version")
    .eq("id", preflightRunId)
    .single();
  if (runError || !run) {
    throw new WorldRegenerationError("World regeneration run is unavailable.");
  }
  if (run.state === "created") {
    const { error: enqueueError } = await client.rpc(
      "command_transition_preflight_run",
      {
        p_command: "enqueue",
        p_expected_version: Number(run.aggregate_version),
        p_preflight_run_id: run.id,
        p_trigger_run_id: null,
      },
    );
    if (enqueueError) {
      throw new WorldRegenerationError("World regeneration run could not be queued.");
    }
    return Object.freeze({ preflightRunId: run.id as string, shouldTrigger: true });
  }
  if (!["queued", "running", "waiting_external", "succeeded"].includes(run.state)) {
    throw new WorldRegenerationError("World regeneration run stopped safely.");
  }
  return Object.freeze({
    preflightRunId: run.id as string,
    shouldTrigger: run.state === "queued",
  });
}

export async function ensureNextWorldRegenerationRun(): Promise<void> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("get_next_world_regeneration_queue_item");
  if (error)
    throw new WorldRegenerationError("World regeneration queue is unavailable.");
  if (!data) return;
  if (
    typeof data !== "object" ||
    typeof (data as Record<string, unknown>).regenerationRequestId !== "string"
  ) {
    throw new WorldRegenerationError("World regeneration queue item is malformed.");
  }
  await ensureWorldRegenerationRun(
    (data as { regenerationRequestId: string }).regenerationRequestId,
  );
}

export async function worldRegenerationRequestForRun(
  preflightRunId: string,
): Promise<string | null> {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "get_world_regeneration_request_for_run",
    { p_preflight_run_id: preflightRunId },
  );
  if (error || (data !== null && typeof data !== "string")) {
    throw new WorldRegenerationError("World regeneration binding is unavailable.");
  }
  return data;
}

export async function failWorldRegeneration(
  regenerationRequestId: string,
  safeFailureClass: string,
): Promise<void> {
  const { error } = await createAdminSupabaseClient().rpc(
    "command_fail_world_regeneration",
    {
      p_regeneration_request_id: regenerationRequestId,
      p_safe_failure_class: safeFailureClass,
    },
  );
  if (error)
    throw new WorldRegenerationError("World regeneration failure was not recorded.");
}

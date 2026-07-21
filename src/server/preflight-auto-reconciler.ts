import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { postgresJsonbText } from "@/server/world-anchor-provider";

export class PreflightAutoReconcilerError extends Error {
  override readonly name = "PreflightAutoReconcilerError";
}

type NarrationSeed = Readonly<{
  configurationCandidateId: string;
  episodeId: string;
  scriptRevisionId: string;
  sourceReviewPacketId: string;
  workspaceId: string;
}>;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export function narrationRunNeedsSuccessor(state: string): boolean {
  return ["canceled", "failed", "superseded"].includes(state);
}

export function narrationRunIdempotencyKey(
  input: Readonly<{
    configurationCandidateId: string;
    sourceReviewPacketId: string;
    supersededRunId?: string | null;
  }>,
): string {
  const base = `narration-auto:${input.configurationCandidateId}:${input.sourceReviewPacketId}`;
  return input.supersededRunId
    ? `${base}:retry:${sha256(input.supersededRunId).slice(0, 16)}`
    : base;
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function seed(value: unknown): NarrationSeed | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const keys = [
    "configurationCandidateId",
    "episodeId",
    "scriptRevisionId",
    "sourceReviewPacketId",
    "workspaceId",
  ] as const;
  if (keys.some((key) => typeof row[key] !== "string")) {
    throw new PreflightAutoReconcilerError(
      "Narration reconciliation input is malformed.",
    );
  }
  return Object.freeze({
    configurationCandidateId: row.configurationCandidateId as string,
    episodeId: row.episodeId as string,
    scriptRevisionId: row.scriptRevisionId as string,
    sourceReviewPacketId: row.sourceReviewPacketId as string,
    workspaceId: row.workspaceId as string,
  });
}

function createdRun(value: unknown): Readonly<{ preflightRunId: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PreflightAutoReconcilerError("Created narration run is malformed.");
  }
  const id = (value as Record<string, unknown>).preflightRunId;
  if (typeof id !== "string") {
    throw new PreflightAutoReconcilerError("Created narration run has no identity.");
  }
  return Object.freeze({ preflightRunId: id });
}

export async function ensureNarrationClockRun(
  input: Readonly<{
    configurationCandidateId: string;
    workspaceId: string;
  }>,
): Promise<
  Readonly<{
    preflightRunId: string | null;
    shouldTrigger: boolean;
    state: string;
  }>
> {
  const client = createAdminSupabaseClient();
  const { data: seedValue, error: seedError } = await client.rpc(
    "get_audio_identity_preflight_input",
    {
      p_configuration_candidate_id: input.configurationCandidateId,
      p_workspace_id: input.workspaceId,
    },
  );
  if (seedError) {
    throw new PreflightAutoReconcilerError("Narration readiness lookup failed.");
  }
  const prepared = seed(seedValue);
  if (!prepared) {
    return Object.freeze({
      preflightRunId: null,
      shouldTrigger: false,
      state: "waiting_source_review",
    });
  }
  if (
    prepared.workspaceId !== input.workspaceId ||
    prepared.configurationCandidateId !== input.configurationCandidateId
  ) {
    throw new PreflightAutoReconcilerError("Narration readiness scope is stale.");
  }
  const { data: existing, error: existingError } = await client
    .from("preflight_runs")
    .select("id,state,trigger_run_id,aggregate_version")
    .eq("workspace_id", input.workspaceId)
    .eq("configuration_candidate_id", input.configurationCandidateId)
    .eq("kind", "narration_clock")
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw new PreflightAutoReconcilerError("Narration run reconciliation failed.");
  }
  if (existing && !narrationRunNeedsSuccessor(existing.state as string)) {
    return Object.freeze({
      preflightRunId: existing.id as string,
      shouldTrigger: existing.state === "queued" && existing.trigger_run_id === null,
      state: existing.state as string,
    });
  }

  const supersededRunId = existing?.id as string | undefined;
  const idempotencyKey = narrationRunIdempotencyKey({
    configurationCandidateId: prepared.configurationCandidateId,
    sourceReviewPacketId: prepared.sourceReviewPacketId,
    supersededRunId: supersededRunId ?? null,
  });
  const request = Object.freeze({
    configurationCandidateId: prepared.configurationCandidateId,
    episodeId: prepared.episodeId,
    kind: "narration_clock",
    scriptRevisionId: prepared.scriptRevisionId,
    sourceReviewPacketId: prepared.sourceReviewPacketId,
    supersededRunId: supersededRunId ?? null,
    workspaceId: prepared.workspaceId,
  });
  const requestHash = sha256(postgresJsonbText(request));
  const { data: createdValue, error: createError } = await client.rpc(
    "command_create_preflight_run",
    {
      p_command_id: deterministicUuid(`command:${idempotencyKey}`),
      p_configuration_candidate_id: prepared.configurationCandidateId,
      p_episode_id: prepared.episodeId,
      p_idempotency_key: idempotencyKey,
      p_kind: "narration_clock",
      p_micro_authorization_id: null,
      p_micro_quote_id: null,
      p_micro_reservation_id: null,
      p_request_hash: requestHash,
      p_requires_micro_authority: false,
      p_script_revision_id: prepared.scriptRevisionId,
      p_workspace_id: prepared.workspaceId,
    },
  );
  if (createError) {
    throw new PreflightAutoReconcilerError("Narration run creation failed.");
  }
  const created = createdRun(createdValue);
  const { data: run, error: runError } = await client
    .from("preflight_runs")
    .select("id,state,aggregate_version")
    .eq("id", created.preflightRunId)
    .single();
  if (runError || !run) {
    throw new PreflightAutoReconcilerError("Narration run was not persisted.");
  }
  if (run.state === "created") {
    const { error: transitionError } = await client.rpc(
      "command_transition_preflight_run",
      {
        p_command: "enqueue",
        p_expected_version: Number(run.aggregate_version),
        p_preflight_run_id: run.id,
        p_trigger_run_id: null,
      },
    );
    if (transitionError) {
      throw new PreflightAutoReconcilerError("Narration run enqueue failed.");
    }
    return Object.freeze({
      preflightRunId: run.id as string,
      shouldTrigger: true,
      state: "queued",
    });
  }
  return Object.freeze({
    preflightRunId: run.id as string,
    shouldTrigger: run.state === "queued",
    state: run.state as string,
  });
}

export async function ensurePlanEvaluationRun(
  input: Readonly<{
    narrationPreflightRunId: string;
    workspaceId: string;
  }>,
): Promise<
  Readonly<{
    configurationCandidateId: string;
    preflightRunId: string;
    shouldTrigger: boolean;
    state: string;
  }>
> {
  const client = createAdminSupabaseClient();
  const [narrationRunResult, clockResult] = await Promise.all([
    client
      .from("preflight_runs")
      .select("id,episode_id,configuration_candidate_id,script_revision_id,kind,state")
      .eq("id", input.narrationPreflightRunId)
      .eq("workspace_id", input.workspaceId)
      .single(),
    client
      .from("narration_master_clock_versions")
      .select("id,configuration_candidate_id,script_revision_id,state")
      .eq("preflight_run_id", input.narrationPreflightRunId)
      .eq("workspace_id", input.workspaceId)
      .eq("state", "verified")
      .single(),
  ]);
  const narrationRun = narrationRunResult.data;
  const clock = clockResult.data;
  if (
    narrationRunResult.error ||
    clockResult.error ||
    !narrationRun ||
    !clock ||
    narrationRun.kind !== "narration_clock" ||
    narrationRun.state !== "succeeded" ||
    narrationRun.configuration_candidate_id !== clock.configuration_candidate_id ||
    narrationRun.script_revision_id !== clock.script_revision_id
  ) {
    throw new PreflightAutoReconcilerError(
      "Plan evaluation prerequisites are not verified.",
    );
  }
  const { data: existing, error: existingError } = await client
    .from("preflight_runs")
    .select("id,state,trigger_run_id,aggregate_version")
    .eq("workspace_id", input.workspaceId)
    .eq("configuration_candidate_id", narrationRun.configuration_candidate_id)
    .eq("kind", "plan_evaluation")
    .order("run_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw new PreflightAutoReconcilerError("Plan run reconciliation failed.");
  }
  if (existing) {
    return Object.freeze({
      configurationCandidateId: narrationRun.configuration_candidate_id,
      preflightRunId: existing.id as string,
      shouldTrigger: existing.state === "queued" && existing.trigger_run_id === null,
      state: existing.state as string,
    });
  }
  const idempotencyKey = `plan-auto:${narrationRun.configuration_candidate_id}:${clock.id}`;
  const request = Object.freeze({
    configurationCandidateId: narrationRun.configuration_candidate_id,
    episodeId: narrationRun.episode_id,
    kind: "plan_evaluation",
    masterClockVersionId: clock.id,
    scriptRevisionId: narrationRun.script_revision_id,
    workspaceId: input.workspaceId,
  });
  const { data: createdValue, error: createError } = await client.rpc(
    "command_create_preflight_run",
    {
      p_command_id: deterministicUuid(`command:${idempotencyKey}`),
      p_configuration_candidate_id: narrationRun.configuration_candidate_id,
      p_episode_id: narrationRun.episode_id,
      p_idempotency_key: idempotencyKey,
      p_kind: "plan_evaluation",
      p_micro_authorization_id: null,
      p_micro_quote_id: null,
      p_micro_reservation_id: null,
      p_request_hash: sha256(postgresJsonbText(request)),
      p_requires_micro_authority: false,
      p_script_revision_id: narrationRun.script_revision_id,
      p_workspace_id: input.workspaceId,
    },
  );
  if (createError) {
    throw new PreflightAutoReconcilerError("Plan run creation failed.");
  }
  const created = createdRun(createdValue);
  const { data: run, error: runError } = await client
    .from("preflight_runs")
    .select("id,state,aggregate_version")
    .eq("id", created.preflightRunId)
    .single();
  if (runError || !run) {
    throw new PreflightAutoReconcilerError("Plan run was not persisted.");
  }
  if (run.state === "created") {
    const { error: transitionError } = await client.rpc(
      "command_transition_preflight_run",
      {
        p_command: "enqueue",
        p_expected_version: Number(run.aggregate_version),
        p_preflight_run_id: run.id,
        p_trigger_run_id: null,
      },
    );
    if (transitionError) {
      throw new PreflightAutoReconcilerError("Plan run enqueue failed.");
    }
    return Object.freeze({
      configurationCandidateId: narrationRun.configuration_candidate_id,
      preflightRunId: run.id as string,
      shouldTrigger: true,
      state: "queued",
    });
  }
  return Object.freeze({
    configurationCandidateId: narrationRun.configuration_candidate_id,
    preflightRunId: run.id as string,
    shouldTrigger: run.state === "queued",
    state: run.state as string,
  });
}

export async function ensureNextPlanEvaluationRun(): Promise<Awaited<
  ReturnType<typeof ensurePlanEvaluationRun>
> | null> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client
    .from("preflight_runs")
    .select("id,workspace_id")
    .eq("kind", "narration_clock")
    .eq("state", "succeeded")
    .order("completed_at", { ascending: false })
    .limit(10);
  if (error) {
    throw new PreflightAutoReconcilerError(
      "Completed narration reconciliation failed.",
    );
  }
  for (const run of data ?? []) {
    const plan = await ensurePlanEvaluationRun({
      narrationPreflightRunId: run.id,
      workspaceId: run.workspace_id,
    });
    if (plan.shouldTrigger) return plan;
  }
  return null;
}

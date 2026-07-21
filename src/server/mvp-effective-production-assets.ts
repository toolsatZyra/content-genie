import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const MAXIMUM_SHOTS = 80;

export type EffectiveProductionJob = Readonly<{
  attempt_number: number;
  plan_bundle_id: string;
  production_run_id: string;
  workspace_id: string;
}>;

export type EffectiveClipRow = Readonly<{
  attempt_number: number;
  byte_length: number | null;
  content_sha256: string | null;
  duration_ms: number | null;
  end_ms: number;
  id: string;
  model_key: string;
  object_name: string | null;
  reference_asset_version_id: string;
  shot_number: number;
  start_ms: number;
  state: "complete" | "failed" | "submitted";
  storyboard_end_frame_id: string | null;
  storyboard_frame_id: string | null;
}>;

export type EffectiveStoryboardRow = Readonly<{
  attempt_number: number;
  content_sha256: string | null;
  endpoint: string;
  frame_role: "single" | "start" | "end";
  id: string;
  media_mime: string | null;
  model_key: string;
  object_name: string | null;
  shot_number: number;
  state: "complete" | "failed" | "submitted";
}>;

export type EffectiveStoryboardSelection = Readonly<{
  end: EffectiveStoryboardRow | null;
  primary: EffectiveStoryboardRow | null;
}>;

export type RepairDecisionRow = Readonly<{
  action:
    "reuse_all" | "regenerate_storyboard_and_clip" | "regenerate_clip" | "reedit_only";
  plan_version_id: string;
  shot_number: number;
  source_clip_id: string;
  source_storyboard_end_frame_id: string | null;
  source_storyboard_frame_id: string | null;
}>;

export class MvpEffectiveAssetsError extends Error {
  override readonly name = "MvpEffectiveAssetsError";

  constructor(
    message: string,
    readonly safeCode: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

function ordered<T extends { shot_number: number }>(
  rows: readonly T[],
  expected: number,
  label: string,
): readonly T[] {
  if (expected < 1 || expected > MAXIMUM_SHOTS || rows.length !== expected) {
    throw new MvpEffectiveAssetsError(label, "EFFECTIVE_ASSETS_INCOMPLETE");
  }
  const result = [...rows].sort((left, right) => left.shot_number - right.shot_number);
  if (result.some((row, index) => row.shot_number !== index + 1)) {
    throw new MvpEffectiveAssetsError(label, "EFFECTIVE_ASSETS_INCOMPLETE");
  }
  return Object.freeze(result);
}

async function activeRepair(job: EffectiveProductionJob) {
  const client = createAdminSupabaseClient();
  const { data: production, error: productionError } = await client
    .from("mvp_production_jobs")
    .select("active_repair_request_id")
    .eq("workspace_id", job.workspace_id)
    .eq("production_run_id", job.production_run_id)
    .eq("attempt_number", job.attempt_number)
    .single();
  if (productionError || !production?.active_repair_request_id) {
    throw new MvpEffectiveAssetsError(
      "The active repair request is unavailable.",
      "REPAIR_LEDGER_UNAVAILABLE",
    );
  }
  const { data: request, error: requestError } = await client
    .from("mvp_repair_request_worker")
    .select("id,state,version,total_shots,active_plan_version_id")
    .eq("id", production.active_repair_request_id)
    .eq("target_attempt_number", job.attempt_number)
    .single();
  if (requestError || !request?.active_plan_version_id) {
    throw new MvpEffectiveAssetsError(
      "The active repair plan is unavailable.",
      "REPAIR_LEDGER_UNAVAILABLE",
    );
  }
  return request;
}

export async function loadEffectiveEddPayload(
  job: EffectiveProductionJob,
): Promise<Record<string, unknown>> {
  const client = createAdminSupabaseClient();
  if (job.attempt_number > 1) {
    const request = await activeRepair(job);
    const { data: plan, error } = await client
      .from("mvp_repair_plan_version_worker")
      .select("repaired_edd_payload")
      .eq("id", request.active_plan_version_id)
      .single();
    if (error || !plan?.repaired_edd_payload) {
      throw new MvpEffectiveAssetsError(
        "The effective repaired EDD is unavailable.",
        "REPAIR_LEDGER_UNAVAILABLE",
      );
    }
    return plan.repaired_edd_payload as Record<string, unknown>;
  }
  const { data: bundle, error: bundleError } = await client
    .from("preflight_plan_bundles")
    .select("edd_version_id")
    .eq("workspace_id", job.workspace_id)
    .eq("id", job.plan_bundle_id)
    .single();
  if (bundleError || !bundle) {
    throw new MvpEffectiveAssetsError(
      "The effective EDD binding is unavailable.",
      "PRODUCTION_PLAN_UNAVAILABLE",
    );
  }
  const { data: edd, error: eddError } = await client
    .from("preflight_plan_component_versions")
    .select("payload")
    .eq("workspace_id", job.workspace_id)
    .eq("id", bundle.edd_version_id)
    .single();
  if (eddError || !edd?.payload) {
    throw new MvpEffectiveAssetsError(
      "The effective EDD is unavailable.",
      "PRODUCTION_PLAN_UNAVAILABLE",
    );
  }
  return edd.payload as Record<string, unknown>;
}

export async function loadRepairDecisions(
  job: EffectiveProductionJob,
): Promise<readonly RepairDecisionRow[]> {
  if (job.attempt_number <= 1) return Object.freeze([]);
  const request = await activeRepair(job);
  const { data, error } = await createAdminSupabaseClient()
    .from("mvp_repair_shot_decision_worker")
    .select(
      "plan_version_id,shot_number,action,source_storyboard_frame_id,source_storyboard_end_frame_id,source_clip_id",
    )
    .eq("repair_request_id", request.id)
    .eq("plan_version_id", request.active_plan_version_id)
    .order("shot_number");
  if (error || !data) {
    throw new MvpEffectiveAssetsError(
      "The repair shot decisions are unavailable.",
      "REPAIR_LEDGER_UNAVAILABLE",
    );
  }
  return ordered(
    data as RepairDecisionRow[],
    Number(request.total_shots),
    "The repair shot decisions are incomplete.",
  );
}

export async function recordReadyRepairSelections(
  job: EffectiveProductionJob,
): Promise<Readonly<{ selected: number; total: number }>> {
  if (job.attempt_number <= 1) return Object.freeze({ selected: 0, total: 0 });
  const client = createAdminSupabaseClient();
  const request = await activeRepair(job);
  const decisions = await loadRepairDecisions(job);
  const [
    { data: existing, error: existingError },
    { data: frames, error: framesError },
    { data: clips, error: clipsError },
  ] = await Promise.all([
    client
      .from("mvp_attempt_shot_asset_worker")
      .select("shot_number")
      .eq("repair_request_id", request.id),
    client
      .from("mvp_storyboard_frame_worker")
      .select("id,shot_number,frame_role,state")
      .eq("workspace_id", job.workspace_id)
      .eq("production_run_id", job.production_run_id)
      .eq("attempt_number", job.attempt_number),
    client
      .from("mvp_production_clip_worker")
      .select("id,shot_number,state,storyboard_frame_id,storyboard_end_frame_id")
      .eq("workspace_id", job.workspace_id)
      .eq("production_run_id", job.production_run_id)
      .eq("attempt_number", job.attempt_number),
  ]);
  if (existingError || framesError || clipsError) {
    throw new MvpEffectiveAssetsError(
      "The repair selection ledger is unavailable.",
      "REPAIR_LEDGER_UNAVAILABLE",
    );
  }
  const selected = new Set((existing ?? []).map((row) => Number(row.shot_number)));
  const frameById = new Map((frames ?? []).map((row) => [row.id, row]));
  const clipByShot = new Map(
    (clips ?? []).map((row) => [Number(row.shot_number), row]),
  );
  let version = Number(request.version);
  for (const decision of decisions) {
    if (selected.has(decision.shot_number)) continue;
    let frameId = decision.source_storyboard_frame_id;
    let endFrameId = decision.source_storyboard_end_frame_id;
    let clipId = decision.source_clip_id;
    if (decision.action === "regenerate_clip") {
      const clip = clipByShot.get(decision.shot_number);
      if (clip?.state !== "complete") continue;
      clipId = clip.id;
    } else if (decision.action === "regenerate_storyboard_and_clip") {
      const clip = clipByShot.get(decision.shot_number);
      const frame = clip?.storyboard_frame_id
        ? frameById.get(clip.storyboard_frame_id)
        : undefined;
      const endFrame = clip?.storyboard_end_frame_id
        ? frameById.get(clip.storyboard_end_frame_id)
        : undefined;
      if (
        frame?.state !== "complete" ||
        clip?.state !== "complete" ||
        clip.storyboard_frame_id !== frame.id ||
        (clip.storyboard_end_frame_id !== null && endFrame?.state !== "complete")
      ) {
        continue;
      }
      frameId = frame.id;
      endFrameId = endFrame?.id ?? null;
      clipId = clip.id;
    }
    const { data: recorded, error } = await client.rpc(
      "command_record_mvp_repair_shot_selection",
      {
        p_expected_request_version: version,
        p_plan_version_id: request.active_plan_version_id,
        p_repair_request_id: request.id,
        p_selected_clip_id: clipId,
        p_selected_storyboard_end_frame_id: endFrameId,
        p_selected_storyboard_frame_id: frameId,
        p_shot_number: decision.shot_number,
      },
    );
    if (error || !recorded) {
      throw new MvpEffectiveAssetsError(
        "A repair shot selection could not be recorded.",
        "REPAIR_LEDGER_FAILED",
        false,
      );
    }
    version = Number((recorded as Record<string, unknown>).version);
    selected.add(decision.shot_number);
  }
  return Object.freeze({ selected: selected.size, total: decisions.length });
}

async function selectedAssetIds(job: EffectiveProductionJob) {
  const request = await activeRepair(job);
  const { data, error } = await createAdminSupabaseClient()
    .from("mvp_attempt_shot_asset_worker")
    .select(
      "shot_number,selected_storyboard_frame_id,selected_storyboard_end_frame_id,selected_clip_id",
    )
    .eq("repair_request_id", request.id)
    .eq("target_attempt_number", job.attempt_number)
    .order("shot_number");
  if (error || !data) {
    throw new MvpEffectiveAssetsError(
      "The effective repair selections are unavailable.",
      "EFFECTIVE_ASSETS_INCOMPLETE",
    );
  }
  return ordered(
    data,
    Number(request.total_shots),
    "The effective repair selections are incomplete.",
  );
}

export async function loadEffectiveClips(
  job: EffectiveProductionJob,
): Promise<readonly EffectiveClipRow[]> {
  const client = createAdminSupabaseClient();
  if (job.attempt_number === 1) {
    const { data, error } = await client
      .from("mvp_production_clip_worker")
      .select(
        "id,attempt_number,shot_number,start_ms,end_ms,state,object_name,content_sha256,byte_length,duration_ms,model_key,reference_asset_version_id,storyboard_frame_id,storyboard_end_frame_id",
      )
      .eq("workspace_id", job.workspace_id)
      .eq("production_run_id", job.production_run_id)
      .eq("attempt_number", 1)
      .order("shot_number");
    if (error || !data) {
      throw new MvpEffectiveAssetsError(
        "The production clips are unavailable.",
        "EFFECTIVE_ASSETS_INCOMPLETE",
      );
    }
    return ordered(
      data as EffectiveClipRow[],
      data.length,
      "The production clips are incomplete.",
    );
  }
  const selections = await selectedAssetIds(job);
  const ids = selections.map(({ selected_clip_id }) => selected_clip_id);
  const { data, error } = await client
    .from("mvp_production_clip_worker")
    .select(
      "id,attempt_number,shot_number,start_ms,end_ms,state,object_name,content_sha256,byte_length,duration_ms,model_key,reference_asset_version_id,storyboard_frame_id,storyboard_end_frame_id",
    )
    .in("id", ids);
  if (error || !data || data.length !== ids.length) {
    throw new MvpEffectiveAssetsError(
      "The selected repair clips are unavailable.",
      "EFFECTIVE_ASSETS_INCOMPLETE",
    );
  }
  const byId = new Map((data as EffectiveClipRow[]).map((row) => [row.id, row]));
  return Object.freeze(ids.map((id) => byId.get(id)!));
}

export async function loadEffectiveStoryboards(
  job: EffectiveProductionJob,
): Promise<readonly EffectiveStoryboardSelection[]> {
  const client = createAdminSupabaseClient();
  const bindings =
    job.attempt_number === 1
      ? (await loadEffectiveClips(job)).map((clip) => ({
          endId: clip.storyboard_end_frame_id,
          primaryId: clip.storyboard_frame_id,
        }))
      : (await selectedAssetIds(job)).map((selection) => ({
          endId: selection.selected_storyboard_end_frame_id,
          primaryId: selection.selected_storyboard_frame_id,
        }));
  const ids = [
    ...new Set(
      bindings
        .flatMap(({ endId, primaryId }) => [primaryId, endId])
        .filter((id): id is string => id !== null),
    ),
  ];
  const { data, error } = ids.length
    ? await client
        .from("mvp_storyboard_frame_worker")
        .select(
          "id,attempt_number,shot_number,frame_role,state,object_name,content_sha256,media_mime,endpoint,model_key",
        )
        .in("id", ids)
    : { data: [], error: null };
  if (error || !data || data.length !== ids.length) {
    throw new MvpEffectiveAssetsError(
      "The selected production storyboards are unavailable.",
      "EFFECTIVE_ASSETS_INCOMPLETE",
    );
  }
  const byId = new Map((data as EffectiveStoryboardRow[]).map((row) => [row.id, row]));
  return Object.freeze(
    bindings.map(({ endId, primaryId }) =>
      Object.freeze({
        end: endId ? (byId.get(endId) ?? null) : null,
        primary: primaryId ? (byId.get(primaryId) ?? null) : null,
      }),
    ),
  );
}

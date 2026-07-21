import "server-only";

import { randomUUID } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  compileMvpRepairDirectorOutput,
  prepareMvpRepairDirector,
  type MvpRepairClarificationRound,
  type MvpRepairDirectorShotSummary,
  MvpRepairDirectorError,
} from "@/server/mvp-repair-director";
import {
  compileMvpRepairGroundingEvidence,
  mvpRepairEvidenceBundleSha256,
} from "@/server/mvp-repair-grounding-evidence";
import {
  OpenAiStructuredAgentError,
  runPreparedOpenAiStructuredAgent,
} from "@/server/openai-structured-agent";
import { postgresJsonbText } from "@/server/world-anchor-provider";
import { createHash } from "node:crypto";

const MAXIMUM_SHOTS = 80;

type RepairClaim = Readonly<{
  feedback: string;
  id: string;
  plan_bundle_id: string;
  planner_lease_token: string;
  production_run_id: string;
  source_attempt_number: number;
  target_attempt_number: number;
  version: number;
  workspace_id: string;
}>;

type SourceAsset = Readonly<{
  clipId: string;
  endFrameId: string | null;
  frameId: string | null;
  shotNumber: number;
}>;

export class MvpRepairProductionError extends Error {
  override readonly name = "MvpRepairProductionError";

  constructor(
    message: string,
    readonly safeCode: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeInteger(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new MvpRepairProductionError(label, "REPAIR_INPUT_INVALID");
  }
  return value as number;
}

function safeString(value: unknown, label: string, maximum = 2_000): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new MvpRepairProductionError(label, "REPAIR_INPUT_INVALID");
  }
  return value;
}

function exactObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpRepairProductionError(label, "REPAIR_INPUT_INVALID");
  }
  return value as Record<string, unknown>;
}

function clarificationRounds(value: unknown): readonly MvpRepairClarificationRound[] {
  if (!Array.isArray(value)) {
    throw new MvpRepairProductionError(
      "The repair clarification transcript is malformed.",
      "REPAIR_INPUT_INVALID",
    );
  }
  const grouped = new Map<number, { answer?: string; question?: string }>();
  for (const candidate of value) {
    const message = exactObject(
      candidate,
      "A repair clarification message is malformed.",
    );
    const round = safeInteger(
      message.round,
      "A repair clarification round is invalid.",
      1,
      3,
    );
    const kind = safeString(
      message.kind,
      "A repair clarification message kind is invalid.",
      16,
    );
    if (kind !== "question" && kind !== "answer") {
      throw new MvpRepairProductionError(
        "A repair clarification message kind is invalid.",
        "REPAIR_INPUT_INVALID",
      );
    }
    const entry = grouped.get(round) ?? {};
    if (entry[kind] !== undefined) {
      throw new MvpRepairProductionError(
        "A repair clarification round contains duplicate evidence.",
        "REPAIR_INPUT_INVALID",
      );
    }
    entry[kind] = safeString(
      message.content,
      "A repair clarification message is empty.",
      4_000,
    );
    grouped.set(round, entry);
  }
  const rounds = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([round, entry], index) => {
      if (round !== index + 1 || !entry.question || !entry.answer) {
        throw new MvpRepairProductionError(
          "The repair clarification transcript is incomplete.",
          "REPAIR_INPUT_INVALID",
        );
      }
      return Object.freeze({ answer: entry.answer, question: entry.question });
    });
  return Object.freeze(rounds);
}

function claimRow(value: unknown, feedback: unknown): RepairClaim {
  const row = exactObject(value, "The repair planner claim is malformed.");
  return Object.freeze({
    feedback: safeString(feedback, "The repair feedback is unavailable.", 4_000),
    id: safeString(row.id, "The repair request identity is invalid.", 100),
    plan_bundle_id: safeString(
      row.plan_bundle_id,
      "The repair plan binding is invalid.",
      100,
    ),
    planner_lease_token: safeString(
      row.planner_lease_token,
      "The repair planner lease is invalid.",
      100,
    ),
    production_run_id: safeString(
      row.production_run_id,
      "The repair production run is invalid.",
      100,
    ),
    source_attempt_number: safeInteger(
      row.source_attempt_number,
      "The repair source attempt is invalid.",
      1,
      19,
    ),
    target_attempt_number: safeInteger(
      row.target_attempt_number,
      "The repair target attempt is invalid.",
      2,
      20,
    ),
    version: safeInteger(
      row.version,
      "The repair request version is invalid.",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    workspace_id: safeString(row.workspace_id, "The repair workspace is invalid.", 100),
  });
}

async function loadSourceEdd(claim: RepairClaim): Promise<Record<string, unknown>> {
  const client = createAdminSupabaseClient();
  if (claim.source_attempt_number > 1) {
    const { data: priorRequest, error: priorError } = await client
      .from("mvp_repair_request_worker")
      .select("active_plan_version_id")
      .eq("production_run_id", claim.production_run_id)
      .eq("target_attempt_number", claim.source_attempt_number)
      .eq("state", "complete")
      .single();
    if (priorError || !priorRequest?.active_plan_version_id) {
      throw new MvpRepairProductionError(
        "The prior repaired EDD is unavailable.",
        "REPAIR_SOURCE_PLAN_MISSING",
      );
    }
    const { data: priorPlan, error: planError } = await client
      .from("mvp_repair_plan_version_worker")
      .select("repaired_edd_payload")
      .eq("id", priorRequest.active_plan_version_id)
      .single();
    if (planError || !priorPlan) {
      throw new MvpRepairProductionError(
        "The prior repaired EDD is unavailable.",
        "REPAIR_SOURCE_PLAN_MISSING",
      );
    }
    return exactObject(
      priorPlan.repaired_edd_payload,
      "The prior repaired EDD is malformed.",
    );
  }
  const { data: bundle, error: bundleError } = await client
    .from("preflight_plan_bundles")
    .select("edd_version_id")
    .eq("workspace_id", claim.workspace_id)
    .eq("id", claim.plan_bundle_id)
    .single();
  if (bundleError || !bundle) {
    throw new MvpRepairProductionError(
      "The source EDD binding is unavailable.",
      "REPAIR_SOURCE_PLAN_MISSING",
    );
  }
  const { data: edd, error: eddError } = await client
    .from("preflight_plan_component_versions")
    .select("payload")
    .eq("workspace_id", claim.workspace_id)
    .eq("id", bundle.edd_version_id)
    .single();
  if (eddError || !edd) {
    throw new MvpRepairProductionError(
      "The source EDD is unavailable.",
      "REPAIR_SOURCE_PLAN_MISSING",
    );
  }
  return exactObject(edd.payload, "The source EDD is malformed.");
}

async function loadSourceAssets(
  claim: RepairClaim,
  totalShots: number,
): Promise<readonly SourceAsset[]> {
  const client = createAdminSupabaseClient();
  const result =
    claim.source_attempt_number === 1
      ? await client
          .from("mvp_production_clip_worker")
          .select("id,shot_number,storyboard_frame_id,storyboard_end_frame_id")
          .eq("workspace_id", claim.workspace_id)
          .eq("production_run_id", claim.production_run_id)
          .eq("attempt_number", 1)
          .eq("state", "complete")
          .order("shot_number")
      : await client
          .from("mvp_attempt_shot_asset_worker")
          .select(
            "shot_number,selected_storyboard_frame_id,selected_storyboard_end_frame_id,selected_clip_id",
          )
          .eq("workspace_id", claim.workspace_id)
          .eq("production_run_id", claim.production_run_id)
          .eq("target_attempt_number", claim.source_attempt_number)
          .order("shot_number");
  if (result.error || !result.data || result.data.length !== totalShots) {
    throw new MvpRepairProductionError(
      "The effective source shot assets are incomplete.",
      "REPAIR_SOURCE_ASSETS_MISSING",
    );
  }
  return Object.freeze(
    result.data.map((row, index) => {
      const record = row as Record<string, unknown>;
      const shotNumber = safeInteger(
        record.shot_number,
        "A source asset shot number is invalid.",
        1,
        totalShots,
      );
      if (shotNumber !== index + 1) {
        throw new MvpRepairProductionError(
          "The effective source assets are out of order.",
          "REPAIR_SOURCE_ASSETS_MISSING",
        );
      }
      return Object.freeze({
        clipId: safeString(
          record.id ?? record.selected_clip_id,
          "A source clip identity is invalid.",
          100,
        ),
        endFrameId:
          record.storyboard_end_frame_id === null ||
          record.selected_storyboard_end_frame_id === null
            ? null
            : safeString(
                record.storyboard_end_frame_id ??
                  record.selected_storyboard_end_frame_id,
                "A source storyboard end identity is invalid.",
                100,
              ),
        frameId:
          record.storyboard_frame_id === null ||
          record.selected_storyboard_frame_id === null
            ? null
            : safeString(
                record.storyboard_frame_id ?? record.selected_storyboard_frame_id,
                "A source storyboard identity is invalid.",
                100,
              ),
        shotNumber,
      });
    }),
  );
}

function sourceSummaries(
  edd: Readonly<Record<string, unknown>>,
  assets: readonly SourceAsset[],
): readonly MvpRepairDirectorShotSummary[] {
  if (!Array.isArray(edd.shots) || edd.shots.length !== assets.length) {
    throw new MvpRepairProductionError(
      "The source EDD shot set is incomplete.",
      "REPAIR_SOURCE_PLAN_INVALID",
    );
  }
  return Object.freeze(
    edd.shots.map((candidate, index) => {
      const shot = exactObject(candidate, "A source EDD shot is malformed.");
      const shotNumber = safeInteger(
        shot.shotNumber,
        "A source EDD shot number is invalid.",
        1,
        assets.length,
      );
      const startMs = safeInteger(
        shot.startMs,
        "A source EDD start time is invalid.",
        0,
        120_000,
      );
      const endMs = safeInteger(
        shot.endMs,
        "A source EDD end time is invalid.",
        startMs + 1_000,
        120_000,
      );
      if (shotNumber !== index + 1 || assets[index]!.shotNumber !== shotNumber) {
        throw new MvpRepairProductionError(
          "The source EDD shot order is invalid.",
          "REPAIR_SOURCE_PLAN_INVALID",
        );
      }
      return Object.freeze({
        action: safeString(shot.action, "A source action is invalid."),
        cameraAngleAndDistance: safeString(
          shot.cameraAngleAndDistance,
          "A source framing decision is invalid.",
        ),
        cameraMotion: safeString(
          shot.cameraMotion,
          "A source camera motion is invalid.",
        ),
        cutType: safeString(shot.cutType, "A source cut is invalid."),
        durationMs: endMs - startMs,
        endMs,
        exactNarration: safeString(
          shot.exactNarration,
          "A source narration span is invalid.",
        ),
        lighting: safeString(shot.lighting, "A source lighting decision is invalid."),
        mood: safeString(shot.mood, "A source mood is invalid."),
        motionPromptBlueprint: safeString(
          shot.motionPromptBlueprint,
          "A source motion prompt is invalid.",
        ),
        narrativeFunction: safeString(
          shot.narrativeFunction,
          "A source narrative function is invalid.",
        ),
        promptBlueprint: safeString(
          shot.promptBlueprint,
          "A source prompt blueprint is invalid.",
        ),
        sceneComposition: safeString(
          shot.sceneComposition,
          "A source scene composition is invalid.",
        ),
        sfxCue: safeString(shot.sfxCue, "A source SFX cue is invalid."),
        sfxDurationMs: safeInteger(
          shot.sfxDurationMs,
          "A source SFX duration is invalid.",
          0,
          5_000,
        ),
        sfxGainDb: Number(shot.sfxGainDb),
        sfxStartOffsetMs: safeInteger(
          shot.sfxStartOffsetMs,
          "A source SFX offset is invalid.",
          0,
          14_999,
        ),
        shotNumber,
        startMs,
        sourceStoryboardAvailable: assets[index]!.frameId !== null,
        storyboardCompositionMode: (() => {
          const mode = safeString(
            shot.storyboardCompositionMode ?? "single_frame",
            "A source storyboard mode is invalid.",
            64,
          );
          if (
            mode !== "single_frame" &&
            mode !== "two_state_start_end" &&
            mode !== "split_screen_two_state"
          ) {
            throw new MvpRepairProductionError(
              "A source storyboard mode is invalid.",
              "REPAIR_SOURCE_PLAN_INVALID",
            );
          }
          return mode;
        })(),
        storyboardEndPromptBlueprint:
          shot.storyboardEndPromptBlueprint === null ||
          shot.storyboardEndPromptBlueprint === undefined
            ? null
            : safeString(
                shot.storyboardEndPromptBlueprint,
                "A source storyboard end prompt is invalid.",
              ),
        storyboardPromptBlueprint: safeString(
          shot.storyboardPromptBlueprint,
          "A source storyboard prompt is invalid.",
        ),
        storyboardStartPromptBlueprint: safeString(
          shot.storyboardStartPromptBlueprint ?? shot.storyboardPromptBlueprint,
          "A source storyboard start prompt is invalid.",
        ),
        visualIntent: safeString(
          shot.visualIntent,
          "A source visual intent is invalid.",
        ),
      });
    }),
  );
}

async function failRepair(claim: RepairClaim, error: MvpRepairProductionError) {
  await createAdminSupabaseClient().rpc("command_fail_mvp_repair_request", {
    p_error_code: error.safeCode,
    p_error_summary: error.message.slice(0, 500),
    p_expected_request_version: claim.version,
    p_planner_lease_token: claim.planner_lease_token,
    p_repair_request_id: claim.id,
  });
}

export async function advanceNextMvpRepairPlanning(): Promise<boolean> {
  const client = createAdminSupabaseClient();
  const { data: claimed, error: claimError } = await client.rpc(
    "command_claim_next_mvp_repair",
    { p_lease_seconds: 300 },
  );
  if (claimError) {
    throw new MvpRepairProductionError(
      "The repair planner could not claim its next request.",
      "REPAIR_LEDGER_FAILED",
      true,
    );
  }
  if (!claimed) return false;
  const claimedRecord = exactObject(claimed, "The repair planner claim is malformed.");
  const { data: request, error: requestError } = await client
    .from("mvp_repair_request_worker")
    .select("feedback,clarification_transcript")
    .eq("id", claimedRecord.id)
    .single();
  const claim = claimRow(claimedRecord, request?.feedback);
  try {
    if (requestError) {
      throw new MvpRepairProductionError(
        "The immutable owner feedback could not be loaded.",
        "REPAIR_INPUT_UNAVAILABLE",
        true,
      );
    }
    const sourceEdd = await loadSourceEdd(claim);
    if (!Array.isArray(sourceEdd.shots)) {
      throw new MvpRepairProductionError(
        "The source EDD shot set is unavailable.",
        "REPAIR_SOURCE_PLAN_INVALID",
      );
    }
    const totalShots = safeInteger(
      sourceEdd.shots.length,
      "The repair shot count is invalid.",
      1,
      MAXIMUM_SHOTS,
    );
    const [assets, edgesResult] = await Promise.all([
      loadSourceAssets(claim, totalShots),
      client
        .from("preflight_reference_edges")
        .select("shot_number,source_shot_number")
        .eq("workspace_id", claim.workspace_id)
        .eq("plan_bundle_id", claim.plan_bundle_id)
        .not("source_shot_number", "is", null)
        .order("shot_number"),
    ]);
    if (edgesResult.error) {
      throw new MvpRepairProductionError(
        "The repair continuity graph is unavailable.",
        "REPAIR_INPUT_UNAVAILABLE",
        true,
      );
    }
    const summaries = sourceSummaries(sourceEdd, assets);
    const preparation = prepareMvpRepairDirector({
      clarificationTranscript: clarificationRounds(
        request?.clarification_transcript ?? [],
      ),
      continuityEdges: (edgesResult.data ?? []).map((edge) => ({
        dependentShotNumber: Number(edge.shot_number),
        sourceShotNumber: Number(edge.source_shot_number),
      })),
      immutableOwnerFeedback: claim.feedback,
      shots: summaries,
      sourceEddHash: sha256(postgresJsonbText(sourceEdd)),
      totalShots,
    });
    const result = await runPreparedOpenAiStructuredAgent(
      preparation.preparedOpenAiRequest,
    );
    const compiled = compileMvpRepairDirectorOutput(preparation, result.output);
    const grounding = compileMvpRepairGroundingEvidence(preparation, compiled);
    const evidenceVersionId = randomUUID();
    if (compiled.decision === "clarification_required") {
      const clarificationId = randomUUID();
      const evidenceBundleSha256 = mvpRepairEvidenceBundleSha256({
        actionGroundingSha256: grounding.actionGroundingSha256,
        clarificationMessageId: clarificationId,
        clarificationTranscriptSha256: compiled.clarificationTranscriptHash,
        feedbackPointsSha256: grounding.feedbackPointsSha256,
        feedbackSha256: compiled.immutableFeedbackHash,
        inputManifestSha256: compiled.preparationHash,
        modelResultSha256: compiled.directorOutputHash,
        modelVersion: preparation.preparedOpenAiRequest.model,
        outcome: "clarification",
        promptSha256: preparation.preparedOpenAiRequest.promptHash,
        repairPlanVersionId: null,
        repairRequestId: claim.id,
        sourceEddContentSha256: compiled.sourceEddHash,
        sourceSummarySha256: compiled.sourceSummaryHash,
      });
      const { error: clarificationError } = await client.rpc(
        "command_publish_mvp_repair_clarification_grounded",
        {
          p_action_grounding_sha256: grounding.actionGroundingSha256,
          p_clarification_transcript_sha256: compiled.clarificationTranscriptHash,
          p_evidence_bundle_sha256: evidenceBundleSha256,
          p_evidence_version_id: evidenceVersionId,
          p_expected_request_version: claim.version,
          p_feedback_points: grounding.feedbackPoints,
          p_feedback_points_sha256: grounding.feedbackPointsSha256,
          p_input_manifest_sha256: compiled.preparationHash,
          p_model_result_sha256: compiled.directorOutputHash,
          p_model_version: preparation.preparedOpenAiRequest.model,
          p_planner_lease_token: claim.planner_lease_token,
          p_prompt_sha256: preparation.preparedOpenAiRequest.promptHash,
          p_question: compiled.clarification.question,
          p_question_id: clarificationId,
          p_repair_request_id: claim.id,
          p_source_edd_content_sha256: compiled.sourceEddHash,
          p_source_summary_sha256: compiled.sourceSummaryHash,
        },
      );
      if (clarificationError) {
        throw new MvpRepairProductionError(
          "Monica's clarification question could not be published.",
          "REPAIR_LEDGER_FAILED",
          true,
        );
      }
      return true;
    }
    const repairedEdd = Object.freeze({
      ...sourceEdd,
      shots: Object.freeze(
        sourceEdd.shots.map((candidate, index) => {
          const source = exactObject(candidate, "A source EDD shot is malformed.");
          const revised = compiled.revisedFieldsByShot.get(index + 1);
          return revised ? Object.freeze({ ...source, ...revised }) : source;
        }),
      ),
    });
    const decisions = compiled.plan.actions.map((decision) => ({
      action: decision.action,
      dependencyReason: decision.dependencyReason,
      reason: decision.reason,
      shotNumber: decision.shotNumber,
      sourceClipId: assets[decision.shotNumber - 1]!.clipId,
      sourceStoryboardEndFrameId: assets[decision.shotNumber - 1]!.endFrameId,
      sourceStoryboardFrameId: assets[decision.shotNumber - 1]!.frameId,
    }));
    const planVersionId = randomUUID();
    const evidenceBundleSha256 = mvpRepairEvidenceBundleSha256({
      actionGroundingSha256: grounding.actionGroundingSha256,
      clarificationMessageId: null,
      clarificationTranscriptSha256: compiled.clarificationTranscriptHash,
      feedbackPointsSha256: grounding.feedbackPointsSha256,
      feedbackSha256: compiled.immutableFeedbackHash,
      inputManifestSha256: compiled.preparationHash,
      modelResultSha256: compiled.directorOutputHash,
      modelVersion: preparation.preparedOpenAiRequest.model,
      outcome: "repair",
      promptSha256: preparation.preparedOpenAiRequest.promptHash,
      repairPlanVersionId: planVersionId,
      repairRequestId: claim.id,
      sourceEddContentSha256: compiled.sourceEddHash,
      sourceSummarySha256: compiled.sourceSummaryHash,
    });
    const { error: publishError } = await client.rpc(
      "command_publish_mvp_repair_plan_grounded",
      {
        p_action_grounding: grounding.actionGrounding,
        p_action_grounding_sha256: grounding.actionGroundingSha256,
        p_clarification_transcript_sha256: compiled.clarificationTranscriptHash,
        p_evidence_bundle_sha256: evidenceBundleSha256,
        p_evidence_version_id: evidenceVersionId,
        p_expected_request_version: claim.version,
        p_feedback_points: grounding.feedbackPoints,
        p_feedback_points_sha256: grounding.feedbackPointsSha256,
        p_input_manifest_sha256: preparation.preparationHash,
        p_model_result_sha256: compiled.directorOutputHash,
        p_model_version: preparation.preparedOpenAiRequest.model,
        p_plan_version_id: planVersionId,
        p_planner_lease_token: claim.planner_lease_token,
        p_prompt_sha256: preparation.preparedOpenAiRequest.promptHash,
        p_repair_request_id: claim.id,
        p_repaired_edd_payload: repairedEdd,
        p_shot_decisions: decisions,
        p_source_edd_content_sha256: compiled.sourceEddHash,
        p_source_summary_sha256: compiled.sourceSummaryHash,
      },
    );
    if (publishError) {
      throw new MvpRepairProductionError(
        "The selective repair plan could not be published.",
        "REPAIR_LEDGER_FAILED",
        true,
      );
    }
    return true;
  } catch (caught) {
    const safe =
      caught instanceof MvpRepairProductionError
        ? caught
        : caught instanceof MvpRepairDirectorError ||
            caught instanceof OpenAiStructuredAgentError
          ? new MvpRepairProductionError(caught.message, "REPAIR_PLANNER_FAILED")
          : new MvpRepairProductionError(
              "The repair planner stopped after an unexpected application error.",
              "REPAIR_PLANNER_FAILED",
            );
    await failRepair(claim, safe).catch(() => undefined);
    throw safe;
  }
}

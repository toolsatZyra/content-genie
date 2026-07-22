import "server-only";

import { createHash } from "node:crypto";

import { Sandbox } from "@vercel/sandbox";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { launchMediaLimits, sniffMediaMagic } from "@/security/media-ingest";
import {
  BoundedResponseBodyError,
  readResponseBodyBounded,
} from "@/server/bounded-response-body";
import {
  compileMvpEditRenderPlan,
  MvpEditRenderPlanError,
} from "@/server/mvp-edit-render-plan";
import {
  loadEffectiveClips,
  loadEffectiveEddPayload,
  recordReadyRepairSelections,
} from "@/server/mvp-effective-production-assets";
import {
  completeMvpMediaDispatchOutput,
  fetchMvpFalBilledResultForDispatch,
} from "@/server/mvp-media-dispatch";
import { fetchMvpFalQueueJson } from "@/server/mvp-media-provider-broker";
import {
  persistedMasterObjectMatches,
  persistedMasterRecordMatches,
  type RenderedMasterIdentity,
} from "@/server/mvp-master-integrity";
import {
  advanceMvpStoryboardAndClipSubmission,
  MvpStoryboardProductionError,
} from "@/server/mvp-storyboard-production";
import {
  advanceNextMvpRepairPlanning,
  MvpRepairProductionError,
} from "@/server/mvp-repair-production";
import {
  advanceNextMvpSfx,
  materializeMvpSfxCues,
  MvpSfxProductionError,
} from "@/server/mvp-sfx-production";
import {
  scanAndReencodeGeneratedVideo,
  SandboxMediaScannerError,
} from "@/server/sandbox-media-scanner";

const MAXIMUM_POLLS_PER_PASS = 8;
const MASTER_BUCKET = "workspace-media";

type JobState =
  | "repair_planning"
  | "queued"
  | "generating"
  | "sound_designing"
  | "rendering"
  | "review_ready";

type JobRow = Readonly<{
  attempt_number: number;
  episode_id: string;
  narration_asset_version_id: string;
  plan_bundle_id: string;
  production_run_id: string;
  state: JobState;
  version: number;
  worker_claim_token: string;
  worker_fencing_token: number;
  workspace_id: string;
}>;

type ClipRow = Readonly<{
  attempt_number: number;
  duration_ms: number | null;
  end_ms: number;
  external_request_id: string;
  id: string;
  object_name: string | null;
  provider_dispatch_id: string | null;
  production_run_id: string;
  response_url: string;
  shot_number: number;
  start_ms: number;
  state: "complete" | "failed" | "submitted";
  status_url: string;
  workspace_id: string;
}>;

type SfxRow = Readonly<{
  content_sha256: string | null;
  fade_in_ms: number;
  fade_out_ms: number;
  gain_db: number | string;
  object_name: string | null;
  shot_number: number;
  start_offset_ms: number;
  state: "complete" | "failed" | "prepared" | "claimed";
  trim_duration_ms: number;
}>;

export class MvpProductionError extends Error {
  override readonly name = "MvpProductionError";

  constructor(
    message: string,
    readonly safeCode: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function submitJob(job: JobRow): Promise<void> {
  const client = createAdminSupabaseClient();
  try {
    const progress = await advanceMvpStoryboardAndClipSubmission(job);
    if (!progress.complete) {
      const { error: progressError } = await client
        .from("mvp_production_jobs")
        .update({
          last_error_code: null,
          last_error_summary: null,
          completed_clips: progress.completedClips,
          completed_storyboards: progress.completedStoryboards,
          started_at: new Date().toISOString(),
          total_clips: progress.totalClips,
          total_storyboards: progress.totalStoryboards,
        })
        .eq("production_run_id", job.production_run_id)
        .eq("worker_claim_token", job.worker_claim_token)
        .eq("worker_fencing_token", job.worker_fencing_token);
      if (progressError) {
        throw new MvpProductionError(
          "Production submission progress could not be recorded.",
          "PRODUCTION_LEDGER_FAILED",
          false,
        );
      }
      return;
    }
    const { error: progressError } = await client
      .from("mvp_production_jobs")
      .update({
        completed_clips: progress.readyForSound
          ? progress.totalClips
          : progress.completedClips,
        completed_storyboards: progress.completedStoryboards,
        last_error_code: null,
        last_error_summary: null,
        started_at: new Date().toISOString(),
        state: "generating",
        total_clips: progress.totalClips,
        total_storyboards: progress.totalStoryboards,
        version: job.version + 1,
      })
      .eq("production_run_id", job.production_run_id)
      .eq("version", job.version)
      .eq("worker_claim_token", job.worker_claim_token)
      .eq("worker_fencing_token", job.worker_fencing_token);
    if (progressError) {
      throw new MvpProductionError(
        "The production job could not advance.",
        "PRODUCTION_LEDGER_FAILED",
        false,
      );
    }
    if (progress.readyForSound) await materializeMvpSfxCues(job);
  } catch (caught) {
    if (caught instanceof MvpStoryboardProductionError) {
      throw new MvpProductionError(caught.message, caught.safeCode, caught.retryable);
    }
    throw caught;
  }
}

async function completeClip(clip: ClipRow): Promise<boolean> {
  const status = await fetchMvpFalQueueJson(clip.status_url, 30_000);
  const state = String(status.status ?? "UNKNOWN");
  if (state !== "COMPLETED") {
    if (state.includes("FAILED") || state === "CANCELLED") {
      throw new MvpProductionError(
        "A video shot could not be generated.",
        "PROVIDER_GENERATION_FAILED",
        false,
      );
    }
    return false;
  }
  if (!clip.provider_dispatch_id) {
    throw new MvpProductionError(
      "The completed video is missing provider dispatch evidence.",
      "PRODUCTION_COST_AUTHORITY_UNAVAILABLE",
      false,
    );
  }
  const billedResult = await fetchMvpFalBilledResultForDispatch({
    externalRequestId: clip.external_request_id,
    providerDispatchId: clip.provider_dispatch_id,
    responseUrl: clip.response_url,
    timeoutMs: 60_000,
  });
  const video = billedResult.data.video as Record<string, unknown> | undefined;
  if (!video || typeof video.url !== "string") {
    throw new MvpProductionError(
      "The completed video result is malformed.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  const mediaUrl = new URL(video.url);
  if (
    mediaUrl.protocol !== "https:" ||
    mediaUrl.username ||
    mediaUrl.password ||
    mediaUrl.hash ||
    !mediaUrl.hostname.endsWith(".fal.media")
  ) {
    throw new MvpProductionError(
      "The completed video location is invalid.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  const mediaResponse = await fetch(mediaUrl, {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!mediaResponse.ok) {
    throw new MvpProductionError(
      "The generated video could not be downloaded safely.",
      "PROVIDER_MEDIA_UNAVAILABLE",
    );
  }
  let bytes: Buffer;
  try {
    bytes = await readResponseBodyBounded(
      mediaResponse,
      launchMediaLimits.maximumBytes,
    );
  } catch (caught) {
    if (!(caught instanceof BoundedResponseBodyError)) throw caught;
    throw new MvpProductionError(
      "The generated video could not be downloaded safely.",
      "PROVIDER_MEDIA_UNAVAILABLE",
      false,
    );
  }
  const client = createAdminSupabaseClient();
  const providerSha256 = sha256(bytes);
  const quarantineObjectName = `${clip.workspace_id}/mvp-clip-quarantine/${clip.production_run_id}/${clip.attempt_number}/${clip.shot_number}/${providerSha256}.mp4`;
  const { error: quarantineError } = await client.storage
    .from(MASTER_BUCKET)
    .upload(quarantineObjectName, bytes, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (quarantineError && quarantineError.message !== "The resource already exists") {
    throw new MvpProductionError(
      "The generated video could not be quarantined.",
      "PROVIDER_QUARANTINE_FAILED",
    );
  }
  if (quarantineError?.message === "The resource already exists") {
    const quarantinedBytes = await storageBytes(quarantineObjectName);
    if (sha256(quarantinedBytes) !== providerSha256) {
      throw new MvpProductionError(
        "The existing quarantine object does not match the provider result.",
        "PROVIDER_QUARANTINE_COLLISION",
        false,
      );
    }
  }
  let scan;
  try {
    scan = await scanAndReencodeGeneratedVideo({
      bytes,
      declaredMime: "video/mp4",
    });
  } catch (caught) {
    if (caught instanceof SandboxMediaScannerError) {
      throw new MvpProductionError(caught.message, "PROVIDER_MEDIA_SCAN_FAILED", false);
    }
    throw caught;
  }
  const retainedDurationMs = clip.end_ms - clip.start_ms;
  if (scan.durationMs < retainedDurationMs) {
    await client
      .from("mvp_production_clip_worker")
      .update({ state: "failed" })
      .eq("id", clip.id)
      .eq("state", "submitted");
    throw new MvpProductionError(
      "A generated clip is shorter than its exact editorial window; it will not be looped or stretched.",
      "PROVIDER_CLIP_TOO_SHORT",
      false,
    );
  }
  const objectName = `${clip.workspace_id}/mvp-clips/${clip.production_run_id}/${clip.attempt_number}/${clip.shot_number}.mp4`;
  const { error: uploadError } = await client.storage
    .from(MASTER_BUCKET)
    .upload(objectName, scan.outputBytes, {
      contentType: "video/mp4",
      upsert: false,
    });
  if (uploadError && uploadError.message !== "The resource already exists") {
    throw new MvpProductionError(
      "The generated clip could not be stored.",
      "PRODUCTION_STORAGE_FAILED",
    );
  }
  if (uploadError?.message === "The resource already exists") {
    const existingBytes = await storageBytes(objectName);
    if (sha256(existingBytes) !== scan.outputSha256) {
      throw new MvpProductionError(
        "The existing clip object does not match the claimed generation.",
        "PRODUCTION_STORAGE_COLLISION",
        false,
      );
    }
  }
  await completeMvpMediaDispatchOutput({
    billingEvent: billedResult.billingEvent,
    externalRequestId: clip.external_request_id,
    outputContentSha256: scan.outputSha256,
    providerDispatchId: clip.provider_dispatch_id,
    providerReportedBillableUnits: billedResult.providerReportedBillableUnits,
    providerUsageEvidenceSha256: billedResult.providerUsageEvidenceSha256,
  });
  const { error: updateError } = await client
    .from("mvp_production_clip_worker")
    .update({
      byte_length: scan.outputBytes.length,
      completed_at: new Date().toISOString(),
      content_sha256: scan.outputSha256,
      duration_ms: scan.durationMs,
      height: scan.height,
      object_name: objectName,
      state: "complete",
      width: scan.width,
    })
    .eq("id", clip.id)
    .eq("state", "submitted");
  if (updateError) {
    throw new MvpProductionError(
      "The generated clip could not be recorded.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
  return true;
}

async function pollJob(job: JobRow): Promise<void> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client
    .from("mvp_production_clip_worker")
    .select(
      "id,workspace_id,production_run_id,attempt_number,shot_number,start_ms,end_ms,state,external_request_id,status_url,response_url,object_name,duration_ms,provider_dispatch_id",
    )
    .eq("production_run_id", job.production_run_id)
    .eq("attempt_number", job.attempt_number)
    .order("shot_number");
  if (error || !data || (data.length < 1 && job.attempt_number === 1)) {
    throw new MvpProductionError(
      "The generated clip ledger is unavailable.",
      "PRODUCTION_LEDGER_FAILED",
    );
  }
  let polledThisPass = 0;
  for (const clip of data as ClipRow[]) {
    if (polledThisPass >= MAXIMUM_POLLS_PER_PASS) break;
    if (clip.state === "submitted") await completeClip(clip);
    if (clip.state === "submitted") polledThisPass += 1;
  }
  const { data: completed, error: countError } = await client
    .from("mvp_production_clip_worker")
    .select("id", { count: "exact" })
    .eq("production_run_id", job.production_run_id)
    .eq("attempt_number", job.attempt_number)
    .eq("state", "complete");
  if (countError) {
    throw new MvpProductionError(
      "The generated clip ledger is unavailable.",
      "PRODUCTION_LEDGER_FAILED",
    );
  }
  const completeCount = completed?.length ?? 0;
  const repairProgress = await recordReadyRepairSelections(job);
  const effectiveCompleteCount =
    job.attempt_number > 1 ? repairProgress.selected : completeCount;
  const { error: updateError } = await client
    .from("mvp_production_jobs")
    .update({ completed_clips: effectiveCompleteCount })
    .eq("production_run_id", job.production_run_id)
    .eq("attempt_number", job.attempt_number)
    .eq("state", "generating")
    .eq("worker_claim_token", job.worker_claim_token)
    .eq("worker_fencing_token", job.worker_fencing_token);
  if (updateError) {
    throw new MvpProductionError(
      "Production progress could not be recorded.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
  if (
    job.attempt_number > 1
      ? repairProgress.total > 0 && repairProgress.selected === repairProgress.total
      : completeCount === data.length
  ) {
    await materializeMvpSfxCues(job);
  }
}

async function sandboxCommand(
  sandbox: Sandbox,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  const result = await sandbox.runCommand(command, args, { timeoutMs });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  if (result.exitCode !== 0) {
    throw new MvpProductionError(
      `The isolated renderer failed: ${String(stderr).slice(0, 160)}`,
      "RENDER_FAILED",
    );
  }
  return String(stdout).trim();
}

async function storageBytes(objectName: string): Promise<Buffer> {
  const { data, error } = await createAdminSupabaseClient()
    .storage.from(MASTER_BUCKET)
    .download(objectName);
  if (error || !data) {
    throw new MvpProductionError(
      "A locked production asset could not be loaded.",
      "PRODUCTION_STORAGE_FAILED",
    );
  }
  return Buffer.from(await data.arrayBuffer());
}

function lockedCutTypes(value: unknown, shotCount: number): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpProductionError(
      "The locked editorial decisions are unavailable.",
      "RENDER_PLAN_INVALID",
      false,
    );
  }
  const shots = (value as Record<string, unknown>).shots;
  if (!Array.isArray(shots) || shots.length !== shotCount) {
    throw new MvpProductionError(
      "The locked editorial decisions do not match the rendered shots.",
      "RENDER_PLAN_INVALID",
      false,
    );
  }
  return Object.freeze(
    shots.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new MvpProductionError(
          "A locked editorial decision is invalid.",
          "RENDER_PLAN_INVALID",
          false,
        );
      }
      const shot = value as Record<string, unknown>;
      if (
        shot.shotNumber !== index + 1 ||
        typeof shot.cutType !== "string" ||
        shot.cutType.trim().length < 1 ||
        shot.cutType.length > 1_200
      ) {
        throw new MvpProductionError(
          "A locked editorial cut is invalid.",
          "RENDER_PLAN_INVALID",
          false,
        );
      }
      return shot.cutType;
    }),
  );
}

async function renderJob(job: JobRow): Promise<void> {
  const client = createAdminSupabaseClient();
  const [
    clips,
    { data: narration, error: narrationError },
    effectiveEdd,
    { data: soundEffects, error: soundEffectsError },
  ] = await Promise.all([
    loadEffectiveClips(job),
    client
      .from("asset_versions")
      .select("object_name")
      .eq("workspace_id", job.workspace_id)
      .eq("id", job.narration_asset_version_id)
      .single(),
    loadEffectiveEddPayload(job),
    client
      .from("mvp_production_sfx_worker")
      .select(
        "shot_number,state,object_name,content_sha256,start_offset_ms,trim_duration_ms,gain_db,fade_in_ms,fade_out_ms",
      )
      .eq("workspace_id", job.workspace_id)
      .eq("production_run_id", job.production_run_id)
      .eq("attempt_number", job.attempt_number)
      .order("shot_number"),
  ]);
  if (
    narrationError ||
    soundEffectsError ||
    clips.length < 1 ||
    clips.some(
      (clip) => clip.state !== "complete" || !clip.object_name || !clip.content_sha256,
    ) ||
    !narration ||
    !soundEffects ||
    soundEffects.length !== clips.length ||
    soundEffects.some((effect) => effect.state !== "complete")
  ) {
    throw new MvpProductionError(
      "Production assets are not ready to render.",
      "RENDER_INPUTS_INCOMPLETE",
    );
  }
  const cutTypes = lockedCutTypes(effectiveEdd, clips.length);
  const generatedSfx = (soundEffects as SfxRow[]).filter(
    ({ object_name }) => object_name !== null,
  );
  const [narrationBytes, clipBytes, sfxBytes] = await Promise.all([
    storageBytes(narration.object_name),
    Promise.all(
      clips.map(async (clip) => {
        const bytes = await storageBytes(clip.object_name!);
        if (sha256(bytes) !== clip.content_sha256) {
          throw new MvpProductionError(
            "A selected production clip failed its recorded content hash.",
            "RENDER_INPUT_HASH_MISMATCH",
            false,
          );
        }
        return bytes;
      }),
    ),
    Promise.all(
      generatedSfx.map(async (effect) => {
        const bytes = await storageBytes(effect.object_name!);
        if (!effect.content_sha256 || sha256(bytes) !== effect.content_sha256) {
          throw new MvpProductionError(
            "A generated SFX asset failed its recorded content hash.",
            "RENDER_INPUT_HASH_MISMATCH",
            false,
          );
        }
        return bytes;
      }),
    ),
  ]);
  let sandbox: (Sandbox & AsyncDisposable) | undefined;
  try {
    sandbox = await Sandbox.create({
      networkPolicy: "allow-all",
      persistent: false,
      resources: { vcpus: 4 },
      runtime: "node24",
      tags: { purpose: "genie-mvp-render" },
      timeout: 300_000,
    });
    await sandboxCommand(
      sandbox,
      "npm",
      [
        "install",
        "--no-save",
        "--no-audit",
        "--no-fund",
        "ffmpeg-static@5.3.0",
        "ffprobe-static@3.1.0",
      ],
      150_000,
    );
    await sandbox.updateNetworkPolicy("deny-all");
    const root = "/vercel/sandbox";
    const ffmpeg = `${root}/node_modules/ffmpeg-static/ffmpeg`;
    const ffprobe = `${root}/node_modules/ffprobe-static/bin/linux/x64/ffprobe`;
    const files = [
      { content: narrationBytes, path: `${root}/narration.mp3` },
      ...clipBytes.map((bytes, index) => ({
        content: bytes,
        path: `${root}/clip-${index + 1}.mp4`,
      })),
      ...sfxBytes.map((bytes, index) => ({
        content: bytes,
        path: `${root}/sfx-${index + 1}.mp3`,
      })),
    ];
    await sandbox.writeFiles(files);
    const probe = JSON.parse(
      await sandboxCommand(
        sandbox,
        ffprobe,
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "json",
          `${root}/narration.mp3`,
        ],
        60_000,
      ),
    ) as { format?: { duration?: string } };
    const durationSeconds = Number(probe.format?.duration);
    if (durationSeconds < 60 || durationSeconds > 120) {
      throw new MvpProductionError(
        "The locked narration duration is outside the launch range.",
        "RENDER_DURATION_INVALID",
        false,
      );
    }
    const narrationDurationMs = Math.round(durationSeconds * 1_000);
    const editShots = clips.map((clip, index) => {
      const startMs = Number(clip.start_ms);
      const endMs = Number(clip.end_ms);
      const retainedMs = endMs - startMs;
      if (
        !Number.isSafeInteger(startMs) ||
        !Number.isSafeInteger(endMs) ||
        retainedMs < 1_000 ||
        retainedMs > 15_000 ||
        Number(clip.duration_ms) < retainedMs ||
        (index === 0 ? startMs !== 0 : startMs !== Number(clips[index - 1]!.end_ms))
      ) {
        throw new MvpProductionError(
          "The locked editorial cut timing is invalid.",
          "RENDER_TIMELINE_INVALID",
          false,
        );
      }
      return Object.freeze({
        availableDurationMs: Number(clip.duration_ms),
        cutType: cutTypes[index]!,
        endMs,
        shotNumber: index + 1,
        startMs,
      });
    });
    if (Math.abs(Number(clips.at(-1)!.end_ms) - narrationDurationMs) > 50) {
      throw new MvpProductionError(
        "The editorial timeline does not end on the narration master clock.",
        "RENDER_TIMELINE_INVALID",
        false,
      );
    }
    let editPlan;
    try {
      editPlan = compileMvpEditRenderPlan(
        editShots,
        narrationDurationMs,
        generatedSfx.map((effect, index) => ({
          fadeInMs: Number(effect.fade_in_ms),
          fadeOutMs: Number(effect.fade_out_ms),
          gainDb: Number(effect.gain_db),
          inputIndex: clipBytes.length + 1 + index,
          shotNumber: Number(effect.shot_number),
          startOffsetMs: Number(effect.start_offset_ms),
          trimDurationMs: Number(effect.trim_duration_ms),
        })),
      );
    } catch (caught) {
      if (caught instanceof MvpEditRenderPlanError) {
        throw new MvpProductionError(caught.message, "RENDER_PLAN_INVALID", false);
      }
      throw caught;
    }
    const videoInputs = clipBytes.flatMap((_, index) => [
      "-i",
      `${root}/clip-${index + 1}.mp4`,
    ]);
    const sfxInputs = sfxBytes.flatMap((_, index) => [
      "-i",
      `${root}/sfx-${index + 1}.mp3`,
    ]);
    const output = `${root}/master.mp4`;
    await sandboxCommand(
      sandbox,
      ffmpeg,
      [
        "-v",
        "error",
        "-xerror",
        ...videoInputs,
        "-i",
        `${root}/narration.mp3`,
        ...sfxInputs,
        "-filter_complex",
        editPlan.filterComplex,
        "-map",
        `[${editPlan.videoLabel}]`,
        "-map",
        `[${editPlan.audioLabel}]`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-map_metadata",
        "-1",
        output,
      ],
      240_000,
    );
    const renderedProbe = JSON.parse(
      await sandboxCommand(
        sandbox,
        ffprobe,
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,duration,width,height:format=duration",
          "-of",
          "json",
          output,
        ],
        60_000,
      ),
    ) as {
      format?: { duration?: string };
      streams?: readonly {
        codec_type?: string;
        duration?: string;
        height?: number;
        width?: number;
      }[];
    };
    const videoStream = renderedProbe.streams?.find(
      ({ codec_type }) => codec_type === "video",
    );
    const audioStream = renderedProbe.streams?.find(
      ({ codec_type }) => codec_type === "audio",
    );
    const videoDurationMs = Math.round(
      Number(videoStream?.duration ?? renderedProbe.format?.duration) * 1_000,
    );
    const audioDurationMs = Math.round(
      Number(audioStream?.duration ?? renderedProbe.format?.duration) * 1_000,
    );
    if (
      videoStream?.width !== 1080 ||
      videoStream.height !== 1920 ||
      !Number.isSafeInteger(videoDurationMs) ||
      !Number.isSafeInteger(audioDurationMs) ||
      Math.abs(videoDurationMs - narrationDurationMs) > 50 ||
      Math.abs(audioDurationMs - narrationDurationMs) > 50 ||
      Math.abs(videoDurationMs - audioDurationMs) > 50
    ) {
      throw new MvpProductionError(
        "The rendered audio and picture do not match the locked master clock.",
        "RENDER_OUTPUT_TIMING_INVALID",
        false,
      );
    }
    const masterBytes = await sandbox.readFileToBuffer({ path: output });
    if (
      !masterBytes ||
      masterBytes.length < 1_024 ||
      masterBytes.length > launchMediaLimits.maximumBytes ||
      sniffMediaMagic(masterBytes) !== "video/mp4"
    ) {
      throw new MvpProductionError(
        "The isolated renderer produced an invalid master.",
        "RENDER_OUTPUT_INVALID",
        false,
      );
    }
    const objectName = `${job.workspace_id}/mvp-masters/${job.production_run_id}/${job.attempt_number}/master.mp4`;
    const masterSha256 = sha256(masterBytes);
    const renderedMasterIdentity: RenderedMasterIdentity = {
      byteLength: masterBytes.length,
      contentSha256: masterSha256,
      durationMs: Math.round(durationSeconds * 1_000),
      height: 1920,
      objectName,
      width: 1080,
    };
    const { error: uploadError } = await client.storage
      .from(MASTER_BUCKET)
      .upload(objectName, masterBytes, { contentType: "video/mp4", upsert: false });
    if (uploadError && uploadError.message !== "The resource already exists") {
      throw new MvpProductionError(
        "The rendered master could not be stored.",
        "PRODUCTION_STORAGE_FAILED",
      );
    }
    if (uploadError?.message === "The resource already exists") {
      const existingBytes = await storageBytes(objectName);
      if (
        !persistedMasterObjectMatches(
          {
            byteLength: existingBytes.length,
            contentSha256: sha256(existingBytes),
          },
          renderedMasterIdentity,
        )
      ) {
        throw new MvpProductionError(
          "The existing master object does not match the rendered film.",
          "PRODUCTION_STORAGE_COLLISION",
          false,
        );
      }
    }
    const { error: masterError } = await client.from("mvp_episode_masters").insert({
      attempt_number: job.attempt_number,
      byte_length: masterBytes.length,
      content_sha256: masterSha256,
      duration_ms: Math.round(durationSeconds * 1_000),
      episode_id: job.episode_id,
      height: 1920,
      object_name: objectName,
      production_run_id: job.production_run_id,
      state: "pending_review",
      width: 1080,
      workspace_id: job.workspace_id,
    });
    if (masterError && masterError.code !== "23505") {
      throw new MvpProductionError(
        "The rendered master could not be recorded.",
        "PRODUCTION_LEDGER_FAILED",
        false,
      );
    }
    if (masterError?.code === "23505") {
      const { data: existingMaster, error: existingMasterError } = await client
        .from("mvp_episode_masters")
        .select("object_name,content_sha256,byte_length,duration_ms,width,height")
        .eq("workspace_id", job.workspace_id)
        .eq("production_run_id", job.production_run_id)
        .eq("attempt_number", job.attempt_number)
        .maybeSingle();
      if (
        existingMasterError ||
        !existingMaster ||
        !persistedMasterRecordMatches(existingMaster, renderedMasterIdentity)
      ) {
        throw new MvpProductionError(
          "The existing master record does not match the rendered film.",
          "PRODUCTION_STORAGE_COLLISION",
          false,
        );
      }
    }
    const { data: transitionedJob, error: transitionError } = await client
      .from("mvp_production_jobs")
      .update({ state: "review_ready" })
      .eq("production_run_id", job.production_run_id)
      .eq("worker_claim_token", job.worker_claim_token)
      .eq("worker_fencing_token", job.worker_fencing_token)
      .select("production_run_id")
      .maybeSingle();
    if (transitionError || !transitionedJob) {
      throw new MvpProductionError(
        "The production worker lease expired before final review handoff.",
        "PRODUCTION_LEASE_LOST",
        false,
      );
    }
    const { error: runStatusError } = await client
      .from("production_run_statuses")
      .update({
        changed_at: new Date().toISOString(),
        reason: "Owner review required",
        state: "waiting_decision",
      })
      .eq("production_run_id", job.production_run_id);
    if (runStatusError) {
      throw new MvpProductionError(
        "The production run status could not enter owner review.",
        "PRODUCTION_LEDGER_FAILED",
        false,
      );
    }
  } finally {
    await sandbox?.stop().catch(() => undefined);
  }
}

async function failJob(job: JobRow, error: unknown): Promise<void> {
  const safe =
    error instanceof MvpProductionError
      ? error
      : error instanceof MvpSfxProductionError
        ? new MvpProductionError(error.message, error.safeCode, error.retryable)
        : error instanceof MvpRepairProductionError
          ? new MvpProductionError(error.message, error.safeCode, error.retryable)
          : new MvpProductionError(
              "Production paused after an unexpected application error.",
              "PRODUCTION_UNKNOWN",
            );
  await createAdminSupabaseClient()
    .from("mvp_production_jobs")
    .update({
      last_error_code: safe.safeCode,
      last_error_summary: safe.message.slice(0, 500),
      state: safe.retryable ? job.state : "failed",
    })
    .eq("production_run_id", job.production_run_id)
    .eq("attempt_number", job.attempt_number)
    .eq("state", job.state)
    .eq("worker_claim_token", job.worker_claim_token)
    .eq("worker_fencing_token", job.worker_fencing_token);
}

export async function advanceNextMvpProductionJob(): Promise<
  Readonly<{
    advanced: boolean;
    productionRunId?: string;
    state?: string;
  }>
> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("command_claim_next_mvp_production_job", {
    p_lease_seconds: 300,
  });
  if (error) {
    throw new MvpProductionError(
      "Production progress is unavailable.",
      "PRODUCTION_LEDGER_FAILED",
    );
  }
  if (!data) return Object.freeze({ advanced: false });
  const job = data as JobRow;
  if (
    typeof job.worker_claim_token !== "string" ||
    !Number.isSafeInteger(job.worker_fencing_token) ||
    job.worker_fencing_token < 1
  ) {
    throw new MvpProductionError(
      "Production worker ownership is malformed.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
  try {
    if (job.state === "repair_planning") await advanceNextMvpRepairPlanning();
    else if (job.state === "queued") await submitJob(job);
    else if (job.state === "generating") await pollJob(job);
    else if (job.state === "sound_designing") await advanceNextMvpSfx();
    else await renderJob(job);
    return Object.freeze({
      advanced: true,
      productionRunId: job.production_run_id,
      state: job.state,
    });
  } catch (caught) {
    await failJob(job, caught);
    throw caught;
  } finally {
    const { error: releaseError } = await client.rpc(
      "command_release_mvp_production_job",
      {
        p_production_run_id: job.production_run_id,
        p_worker_claim_token: job.worker_claim_token,
        p_worker_fencing_token: job.worker_fencing_token,
      },
    );
    if (releaseError && !releaseError.message.includes("release fence is stale")) {
      throw new MvpProductionError(
        "Production worker ownership could not be released.",
        "PRODUCTION_LEDGER_FAILED",
      );
    }
  }
}

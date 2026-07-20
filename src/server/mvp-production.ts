import "server-only";

import { createHash } from "node:crypto";

import { Sandbox } from "@vercel/sandbox";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { launchMediaLimits, sniffMediaMagic } from "@/security/media-ingest";
import { selectProductionReferences } from "@/server/production-reference-selection";

const QUEUE_ORIGIN = "https://queue.fal.run";
const MAXIMUM_CLIPS = 40;
const MAXIMUM_SUBMISSIONS_PER_PASS = 5;
const MAXIMUM_POLLS_PER_PASS = 8;
const MASTER_BUCKET = "workspace-media";

type JobState = "queued" | "generating" | "rendering" | "review_ready";

type JobRow = Readonly<{
  attempt_number: number;
  episode_id: string;
  narration_asset_version_id: string;
  plan_bundle_id: string;
  production_run_id: string;
  state: JobState;
  version: number;
  workspace_id: string;
}>;

type ClipRow = Readonly<{
  attempt_number: number;
  duration_ms: number | null;
  external_request_id: string;
  id: string;
  object_name: string | null;
  production_run_id: string;
  response_url: string;
  shot_number: number;
  state: "complete" | "failed" | "submitted";
  status_url: string;
  workspace_id: string;
}>;

type ShotRow = Readonly<{
  end_ms: number;
  motion_class: "camera_led" | "complex_general" | "simple_camera_subject";
  shot_number: number;
  start_ms: number;
}>;

type EditorialShot = Readonly<{
  promptBlueprint: string;
  realWorldReferenceAssetVersionId: string | null;
  shotNumber: number;
}>;

type SubmittedClip = Readonly<{
  externalRequestId: string;
  responseUrl: string;
  statusUrl: string;
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

function safeText(value: unknown, label: string, maximum = 16_000): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new MvpProductionError(
      `${label} is unavailable.`,
      "PRODUCTION_INPUT_INVALID",
    );
  }
  return value;
}

function exactControlUrl(value: unknown, requestId: string): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new MvpProductionError(
      "The provider returned an invalid job URL.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  const url = new URL(value);
  if (
    url.origin !== QUEUE_ORIGIN ||
    !url.pathname.includes(`/requests/${requestId}`) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new MvpProductionError(
      "The provider returned an invalid job URL.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  return url.toString();
}

function executableShots(shots: readonly ShotRow[]): readonly ShotRow[] {
  if (shots.length < 20 || shots.length > MAXIMUM_CLIPS) {
    throw new MvpProductionError(
      "The locked plan does not contain the required three-second visual coverage.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  for (const [index, shot] of shots.entries()) {
    if (
      shot.shot_number !== index + 1 ||
      shot.start_ms < 0 ||
      shot.end_ms <= shot.start_ms ||
      (index > 0 && shot.start_ms !== shots[index - 1]!.end_ms)
    ) {
      throw new MvpProductionError(
        "The locked shot timeline is not contiguous.",
        "PRODUCTION_PLAN_INVALID",
        false,
      );
    }
  }
  return shots;
}

function endpointFor(motionClass: ShotRow["motion_class"]): {
  modelKey: string;
  payload: (prompt: string, imageUrl: string) => Record<string, unknown>;
} {
  const negative =
    "distortion, flicker, morphing, extra limbs, text, watermark, abrupt cuts, speech, lip sync";
  if (motionClass === "camera_led") {
    return {
      modelKey: "fal-ai/kling-video/v3/pro/image-to-video",
      payload: (prompt, imageUrl) => ({
        cfg_scale: 0.5,
        duration: "3",
        generate_audio: false,
        negative_prompt: negative,
        prompt,
        shot_type: "customize",
        start_image_url: imageUrl,
      }),
    };
  }
  if (motionClass === "complex_general") {
    return {
      modelKey: "bytedance/seedance-2.0/reference-to-video",
      payload: (prompt, imageUrl) => ({
        aspect_ratio: "9:16",
        bitrate_mode: "standard",
        duration: "4",
        generate_audio: false,
        image_urls: [imageUrl],
        prompt: `@Image1 is the immutable visual reference. ${prompt}`,
        resolution: "720p",
      }),
    };
  }
  return {
    modelKey: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    payload: (prompt, imageUrl) => ({
      cfg_scale: 0.5,
      duration: "5",
      image_url: imageUrl,
      negative_prompt: negative,
      prompt,
    }),
  };
}

function finalPrompt(value: string, revisionDirection?: string | null): string {
  const prompt = safeText(value, "The locked shot prompt", 12_000);
  const revision = revisionDirection?.trim()
    ? ` Owner revision direction: ${safeText(revisionDirection.trim(), "The owner revision direction", 3_000)}`
    : "";
  return `${prompt}${revision} Preserve the supplied identity, anatomy, costume, sacred attributes, lighting, environment, and 9:16 composition exactly. Respectful Hindu devotional cinema. Natural controlled motion. No dialogue, lip sync, text, watermark, or cuts.`;
}

async function submitFalClip(input: {
  imageUrl: string;
  motionClass: ShotRow["motion_class"];
  prompt: string;
}): Promise<SubmittedClip & { modelKey: string }> {
  const key = process.env.FAL_KEY?.trim() ?? "";
  if (key.length < 16) {
    throw new MvpProductionError(
      "Video generation is not configured.",
      "PROVIDER_UNAVAILABLE",
      false,
    );
  }
  const endpoint = endpointFor(input.motionClass);
  const response = await fetch(`${QUEUE_ORIGIN}/${endpoint.modelKey}`, {
    body: JSON.stringify(endpoint.payload(input.prompt, input.imageUrl)),
    headers: {
      Authorization: `Key ${key}`,
      "content-type": "application/json",
    },
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new MvpProductionError(
      "The video provider did not accept the shot.",
      "PROVIDER_SUBMIT_FAILED",
      response.status >= 500 || response.status === 429,
    );
  }
  const body = (await response.json()) as Record<string, unknown>;
  const requestId = safeText(body.request_id, "The provider job identity", 200);
  if (!/^[A-Za-z0-9_-]{6,200}$/u.test(requestId)) {
    throw new MvpProductionError(
      "The video provider returned an invalid job identity.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  return Object.freeze({
    externalRequestId: requestId,
    modelKey: endpoint.modelKey,
    responseUrl: exactControlUrl(body.response_url, requestId),
    statusUrl: exactControlUrl(body.status_url, requestId),
  });
}

function editorialShots(value: unknown): readonly EditorialShot[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpProductionError(
      "The locked editorial plan is malformed.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  const shots = (value as Record<string, unknown>).shots;
  if (!Array.isArray(shots)) {
    throw new MvpProductionError(
      "The locked editorial plan is malformed.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  return Object.freeze(
    shots.map((shot) => {
      if (!shot || typeof shot !== "object" || Array.isArray(shot)) {
        throw new MvpProductionError(
          "The locked editorial shot is malformed.",
          "PRODUCTION_PLAN_INVALID",
          false,
        );
      }
      const row = shot as Record<string, unknown>;
      if (!Number.isSafeInteger(row.shotNumber)) {
        throw new MvpProductionError(
          "The locked editorial shot is malformed.",
          "PRODUCTION_PLAN_INVALID",
          false,
        );
      }
      const researchReference =
        row.realWorldReferenceAssetVersionId === undefined ||
        row.realWorldReferenceAssetVersionId === null
          ? null
          : safeText(
              row.realWorldReferenceAssetVersionId,
              "The researched visual reference",
              36,
            );
      if (
        researchReference !== null &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          researchReference,
        )
      ) {
        throw new MvpProductionError(
          "The researched visual reference is malformed.",
          "PRODUCTION_PLAN_INVALID",
          false,
        );
      }
      return Object.freeze({
        promptBlueprint: safeText(row.promptBlueprint, "The locked shot prompt"),
        realWorldReferenceAssetVersionId: researchReference,
        shotNumber: row.shotNumber as number,
      });
    }),
  );
}

async function submitJob(job: JobRow): Promise<void> {
  const client = createAdminSupabaseClient();
  const [bundleResult, shotsResult, edgesResult, existingResult, reviewResult] =
    await Promise.all([
      client
        .from("preflight_plan_bundles")
        .select("edd_version_id")
        .eq("workspace_id", job.workspace_id)
        .eq("id", job.plan_bundle_id)
        .single(),
      client
        .from("preflight_shots")
        .select("shot_number,start_ms,end_ms,motion_class")
        .eq("workspace_id", job.workspace_id)
        .eq("plan_bundle_id", job.plan_bundle_id)
        .order("shot_number"),
      client
        .from("preflight_reference_edges")
        .select("shot_number,reference_ordinal,reference_kind,asset_version_id")
        .eq("workspace_id", job.workspace_id)
        .eq("plan_bundle_id", job.plan_bundle_id)
        .not("asset_version_id", "is", null)
        .order("reference_ordinal"),
      client
        .schema("private")
        .from("mvp_production_clips")
        .select("shot_number")
        .eq("production_run_id", job.production_run_id)
        .eq("attempt_number", job.attempt_number),
      job.attempt_number > 1
        ? client
            .from("mvp_master_reviews")
            .select("feedback")
            .eq("episode_id", job.episode_id)
            .eq("decision", "reject")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (
    bundleResult.error ||
    shotsResult.error ||
    edgesResult.error ||
    existingResult.error ||
    reviewResult.error ||
    !bundleResult.data
  ) {
    throw new MvpProductionError(
      "The locked plan could not be loaded.",
      "PRODUCTION_PLAN_UNAVAILABLE",
    );
  }
  const { data: edd, error: eddError } = await client
    .from("preflight_plan_component_versions")
    .select("payload")
    .eq("workspace_id", job.workspace_id)
    .eq("id", bundleResult.data.edd_version_id)
    .single();
  if (eddError || !edd) {
    throw new MvpProductionError(
      "The locked editorial plan could not be loaded.",
      "PRODUCTION_PLAN_UNAVAILABLE",
    );
  }
  const selected = executableShots(shotsResult.data as ShotRow[]);
  const editorial = editorialShots(edd.payload);
  const prompts = new Map(
    editorial.map((shot) => [shot.shotNumber, shot.promptBlueprint]),
  );
  let referenceByShot: ReadonlyMap<number, string>;
  try {
    referenceByShot = selectProductionReferences(edgesResult.data, editorial);
  } catch {
    throw new MvpProductionError(
      "The editorial reference does not match the executable reference graph.",
      "PRODUCTION_REFERENCE_MISMATCH",
      false,
    );
  }
  const referenceIds = selected.map((shot) => referenceByShot.get(shot.shot_number));
  if (referenceIds.some((id) => !id)) {
    throw new MvpProductionError(
      "A locked shot is missing its approved visual reference.",
      "PRODUCTION_REFERENCE_MISSING",
      false,
    );
  }
  const { data: assets, error: assetError } = await client
    .from("asset_versions")
    .select("id,object_name")
    .eq("workspace_id", job.workspace_id)
    .in("id", referenceIds as string[]);
  if (assetError || !assets || assets.length !== new Set(referenceIds).size) {
    throw new MvpProductionError(
      "An approved visual reference is unavailable.",
      "PRODUCTION_REFERENCE_MISSING",
      false,
    );
  }
  const objectById = new Map(assets.map((asset) => [asset.id, asset.object_name]));
  const existingShots = new Set(
    (existingResult.data ?? []).map((row) => Number(row.shot_number)),
  );
  let submittedThisPass = 0;
  for (const shot of selected) {
    if (existingShots.has(shot.shot_number)) continue;
    if (submittedThisPass >= MAXIMUM_SUBMISSIONS_PER_PASS) break;
    const referenceId = referenceByShot.get(shot.shot_number)!;
    const objectName = objectById.get(referenceId);
    const prompt = prompts.get(shot.shot_number);
    if (!objectName || !prompt) {
      throw new MvpProductionError(
        "A locked shot input is unavailable.",
        "PRODUCTION_INPUT_MISSING",
        false,
      );
    }
    const { data: signed, error: signError } = await client.storage
      .from(MASTER_BUCKET)
      .createSignedUrl(objectName, 900);
    if (signError || !signed?.signedUrl) {
      throw new MvpProductionError(
        "A visual reference could not be signed.",
        "PRODUCTION_REFERENCE_UNAVAILABLE",
      );
    }
    const promptWithControls = finalPrompt(prompt, reviewResult.data?.feedback);
    const submitted = await submitFalClip({
      imageUrl: signed.signedUrl,
      motionClass: shot.motion_class,
      prompt: promptWithControls,
    });
    const { error: insertError } = await client
      .schema("private")
      .from("mvp_production_clips")
      .insert({
        attempt_number: job.attempt_number,
        end_ms: shot.end_ms,
        external_request_id: submitted.externalRequestId,
        model_key: submitted.modelKey,
        motion_class: shot.motion_class,
        production_run_id: job.production_run_id,
        prompt: promptWithControls,
        reference_asset_version_id: referenceId,
        response_url: submitted.responseUrl,
        shot_number: shot.shot_number,
        start_ms: shot.start_ms,
        state: "submitted",
        status_url: submitted.statusUrl,
        workspace_id: job.workspace_id,
      });
    if (insertError) {
      throw new MvpProductionError(
        "A video job was accepted but could not be recorded.",
        "PRODUCTION_LEDGER_FAILED",
        false,
      );
    }
    submittedThisPass += 1;
  }
  if (existingShots.size + submittedThisPass < selected.length) {
    const { error: progressError } = await client
      .from("mvp_production_jobs")
      .update({
        last_error_code: null,
        last_error_summary: null,
        started_at: new Date().toISOString(),
        total_clips: selected.length,
      })
      .eq("production_run_id", job.production_run_id);
    if (progressError) {
      throw new MvpProductionError(
        "Production submission progress could not be recorded.",
        "PRODUCTION_LEDGER_FAILED",
        false,
      );
    }
    return;
  }
  const { error: updateError } = await client
    .from("mvp_production_jobs")
    .update({
      completed_clips: 0,
      last_error_code: null,
      last_error_summary: null,
      started_at: new Date().toISOString(),
      state: "generating",
      total_clips: selected.length,
      version: job.version + 1,
    })
    .eq("production_run_id", job.production_run_id)
    .eq("version", job.version);
  if (updateError) {
    throw new MvpProductionError(
      "The production job could not advance.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
}

function parseMp4(bytes: Buffer): {
  durationMs: number;
  height: number;
  width: number;
} {
  if (
    bytes.length < 1_024 ||
    bytes.length > launchMediaLimits.maximumBytes ||
    sniffMediaMagic(bytes) !== "video/mp4"
  ) {
    throw new MvpProductionError(
      "A generated clip is not a valid MP4.",
      "PROVIDER_MEDIA_INVALID",
      false,
    );
  }
  let offset = 0;
  let durationMs = 0;
  let width = 0;
  let height = 0;
  while (offset + 8 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (size < 8 || offset + size > bytes.length) break;
    if (type === "moov") {
      const end = offset + size;
      for (let child = offset + 8; child + 8 <= end;) {
        const childSize = bytes.readUInt32BE(child);
        const childType = bytes.subarray(child + 4, child + 8).toString("ascii");
        if (childSize < 8 || child + childSize > end) break;
        if (childType === "mvhd") {
          const content = child + 8;
          const version = bytes[content];
          const scaleOffset = version === 1 ? content + 20 : content + 12;
          const durationOffset = version === 1 ? content + 24 : content + 16;
          const scale = bytes.readUInt32BE(scaleOffset);
          const duration =
            version === 1
              ? Number(bytes.readBigUInt64BE(durationOffset))
              : bytes.readUInt32BE(durationOffset);
          if (scale > 0) durationMs = Math.round((duration * 1_000) / scale);
        }
        child += childSize;
      }
    }
    offset += size;
  }
  // Provider canaries already establish exact vertical profiles. Dimensions are
  // normalized again by the final isolated renderer.
  width = 720;
  height = 1280;
  if (durationMs < 1_000 || durationMs > 30_000) {
    throw new MvpProductionError(
      "A generated clip has an invalid duration.",
      "PROVIDER_MEDIA_INVALID",
      false,
    );
  }
  return { durationMs, height, width };
}

async function completeClip(clip: ClipRow): Promise<boolean> {
  const key = process.env.FAL_KEY?.trim() ?? "";
  if (key.length < 16) {
    throw new MvpProductionError(
      "Video generation is not configured.",
      "PROVIDER_UNAVAILABLE",
      false,
    );
  }
  const statusResponse = await fetch(clip.status_url, {
    headers: { Authorization: `Key ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!statusResponse.ok) {
    throw new MvpProductionError(
      "Video progress is temporarily unavailable.",
      "PROVIDER_STATUS_FAILED",
    );
  }
  const status = (await statusResponse.json()) as Record<string, unknown>;
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
  const resultResponse = await fetch(clip.response_url, {
    headers: { Authorization: `Key ${key}` },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!resultResponse.ok) {
    throw new MvpProductionError(
      "The completed video result is unavailable.",
      "PROVIDER_RESULT_FAILED",
    );
  }
  const result = (await resultResponse.json()) as Record<string, unknown>;
  const video = result.video as Record<string, unknown> | undefined;
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
  const declared = Number(mediaResponse.headers.get("content-length") ?? "0");
  if (
    !mediaResponse.ok ||
    (declared > 0 && declared > launchMediaLimits.maximumBytes)
  ) {
    throw new MvpProductionError(
      "The generated video could not be downloaded safely.",
      "PROVIDER_MEDIA_UNAVAILABLE",
    );
  }
  const bytes = Buffer.from(await mediaResponse.arrayBuffer());
  const probe = parseMp4(bytes);
  const objectName = `${clip.workspace_id}/mvp-clips/${clip.production_run_id}/${clip.attempt_number}/${clip.shot_number}.mp4`;
  const client = createAdminSupabaseClient();
  const { error: uploadError } = await client.storage
    .from(MASTER_BUCKET)
    .upload(objectName, bytes, { contentType: "video/mp4", upsert: false });
  if (uploadError && uploadError.message !== "The resource already exists") {
    throw new MvpProductionError(
      "The generated clip could not be stored.",
      "PRODUCTION_STORAGE_FAILED",
    );
  }
  const { error: updateError } = await client
    .schema("private")
    .from("mvp_production_clips")
    .update({
      byte_length: bytes.length,
      completed_at: new Date().toISOString(),
      content_sha256: sha256(bytes),
      duration_ms: probe.durationMs,
      height: probe.height,
      object_name: objectName,
      state: "complete",
      width: probe.width,
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
    .schema("private")
    .from("mvp_production_clips")
    .select(
      "id,workspace_id,production_run_id,attempt_number,shot_number,state,external_request_id,status_url,response_url,object_name,duration_ms",
    )
    .eq("production_run_id", job.production_run_id)
    .eq("attempt_number", job.attempt_number)
    .order("shot_number");
  if (error || !data || data.length < 1) {
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
    .schema("private")
    .from("mvp_production_clips")
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
  const nextState = completeCount === data.length ? "rendering" : "generating";
  const { error: updateError } = await client
    .from("mvp_production_jobs")
    .update({ completed_clips: completeCount, state: nextState })
    .eq("production_run_id", job.production_run_id);
  if (updateError) {
    throw new MvpProductionError(
      "Production progress could not be recorded.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
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

async function renderJob(job: JobRow): Promise<void> {
  const client = createAdminSupabaseClient();
  const [
    { data: clips, error: clipsError },
    { data: narration, error: narrationError },
  ] = await Promise.all([
    client
      .schema("private")
      .from("mvp_production_clips")
      .select("shot_number,start_ms,end_ms,object_name,duration_ms,state")
      .eq("production_run_id", job.production_run_id)
      .eq("attempt_number", job.attempt_number)
      .order("shot_number"),
    client
      .from("asset_versions")
      .select("object_name")
      .eq("workspace_id", job.workspace_id)
      .eq("id", job.narration_asset_version_id)
      .single(),
  ]);
  if (
    clipsError ||
    narrationError ||
    !clips ||
    clips.length < 1 ||
    clips.some((clip) => clip.state !== "complete" || !clip.object_name) ||
    !narration
  ) {
    throw new MvpProductionError(
      "Production assets are not ready to render.",
      "RENDER_INPUTS_INCOMPLETE",
    );
  }
  const [narrationBytes, ...clipBytes] = await Promise.all([
    storageBytes(narration.object_name),
    ...clips.map((clip) => storageBytes(clip.object_name!)),
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
    const cutStarts = clips.map((clip, index) => {
      const startSeconds = Number(clip.start_ms) / 1_000;
      if (
        !Number.isFinite(startSeconds) ||
        startSeconds < 0 ||
        startSeconds >= durationSeconds ||
        (index > 0 && startSeconds <= Number(clips[index - 1]!.start_ms) / 1_000)
      ) {
        throw new MvpProductionError(
          "The locked editorial cut timing is invalid.",
          "RENDER_TIMELINE_INVALID",
          false,
        );
      }
      return index === 0 ? 0 : startSeconds;
    });
    const segmentDurations = cutStarts.map((start, index) => {
      const next = cutStarts[index + 1] ?? durationSeconds;
      const segment = next - start;
      if (segment < 0.25 || segment > durationSeconds) {
        throw new MvpProductionError(
          "The locked editorial segment timing is invalid.",
          "RENDER_TIMELINE_INVALID",
          false,
        );
      }
      return segment;
    });
    const videoInputs = clipBytes.flatMap((_, index) => [
      "-stream_loop",
      "-1",
      "-i",
      `${root}/clip-${index + 1}.mp4`,
    ]);
    const filters = segmentDurations
      .map(
        (segment, index) =>
          `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,trim=duration=${segment.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
      )
      .join(";");
    const concatInputs = segmentDurations.map((_, index) => `[v${index}]`).join("");
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
        "-filter_complex",
        `${filters};${concatInputs}concat=n=${segmentDurations.length}:v=1:a=0[v]`,
        "-map",
        "[v]",
        "-map",
        `${clipBytes.length}:a:0`,
        "-t",
        durationSeconds.toFixed(3),
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
    const { error: uploadError } = await client.storage
      .from(MASTER_BUCKET)
      .upload(objectName, masterBytes, { contentType: "video/mp4", upsert: false });
    if (uploadError && uploadError.message !== "The resource already exists") {
      throw new MvpProductionError(
        "The rendered master could not be stored.",
        "PRODUCTION_STORAGE_FAILED",
      );
    }
    const { error: masterError } = await client.from("mvp_episode_masters").insert({
      attempt_number: job.attempt_number,
      byte_length: masterBytes.length,
      content_sha256: sha256(masterBytes),
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
    await Promise.all([
      client
        .from("mvp_production_jobs")
        .update({ state: "review_ready" })
        .eq("production_run_id", job.production_run_id),
      client
        .from("production_run_statuses")
        .update({
          changed_at: new Date().toISOString(),
          reason: "Owner review required",
          state: "waiting_decision",
        })
        .eq("production_run_id", job.production_run_id),
    ]);
  } finally {
    await sandbox?.stop().catch(() => undefined);
  }
}

async function failJob(job: JobRow, error: unknown): Promise<void> {
  const safe =
    error instanceof MvpProductionError
      ? error
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
    .eq("production_run_id", job.production_run_id);
}

export async function advanceNextMvpProductionJob(): Promise<
  Readonly<{
    advanced: boolean;
    productionRunId?: string;
    state?: string;
  }>
> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client
    .from("mvp_production_jobs")
    .select(
      "production_run_id,workspace_id,episode_id,plan_bundle_id,narration_asset_version_id,state,attempt_number,version",
    )
    .in("state", ["queued", "generating", "rendering"])
    .order("updated_at")
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new MvpProductionError(
      "Production progress is unavailable.",
      "PRODUCTION_LEDGER_FAILED",
    );
  }
  if (!data) return Object.freeze({ advanced: false });
  const job = data as JobRow;
  try {
    if (job.state === "queued") await submitJob(job);
    else if (job.state === "generating") await pollJob(job);
    else await renderJob(job);
    return Object.freeze({
      advanced: true,
      productionRunId: job.production_run_id,
      state: job.state,
    });
  } catch (caught) {
    await failJob(job, caught);
    throw caught;
  }
}

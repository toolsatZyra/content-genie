import "server-only";

import { createHash } from "node:crypto";

import {
  compileNanoBananaReferenceContract,
  type NanoBananaReferenceInput,
  type NanoBananaReferenceRole,
} from "@/domain/provider/nano-banana-reference-contract";
import { compileImagePrompt, findLookByVersionId } from "@/domain/look/look-registry";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { launchMediaLimits, sniffMediaMagic } from "@/security/media-ingest";
import {
  inspectStillImageContainer,
  inspectStillImageDimensions,
  type StillImageMime,
} from "@/security/still-image-container";
import {
  compileKling25ImageToVideoPayload,
  compileKling3ImageToVideoPayload,
  selectKlingProviderDuration,
} from "@/server/kling-provider-reference-compiler";
import {
  compileSeedanceImageToVideo,
  compileSeedanceReferenceToVideo,
} from "@/server/seedance-reference-compiler";
import {
  scanAndReencodeWorldImage,
  SandboxMediaScannerError,
} from "@/server/sandbox-media-scanner";
import { postgresJsonbText } from "@/server/world-anchor-provider";
import {
  loadEffectiveEddPayload,
  loadRepairDecisions,
  recordReadyRepairSelections,
  type RepairDecisionRow,
} from "@/server/mvp-effective-production-assets";
import {
  completeMvpMediaDispatchOutput,
  dispatchMvpFalMedia,
  MvpMediaDispatchError,
} from "@/server/mvp-media-dispatch";
import { fetchMvpFalQueueJson } from "@/server/mvp-media-provider-broker";

const MEDIA_BUCKET = "workspace-media";
const MAXIMUM_SHOTS = 80;
const MAXIMUM_SUBMISSIONS_PER_PASS = 5;
const MAXIMUM_POLLS_PER_PASS = 8;

export type MvpSubmissionJob = Readonly<{
  attempt_number: number;
  episode_id: string;
  plan_bundle_id: string;
  production_run_id: string;
  workspace_id: string;
}>;

type ShotRow = Readonly<{
  end_ms: number;
  motion_class: "camera_led" | "complex_general" | "simple_camera_subject";
  shot_number: number;
  start_ms: number;
}>;

type SlotRow = Readonly<{
  duration_ms: number;
  id: string;
  input_strategy: string;
  retained_duration_ms: number;
  shot_number: number;
}>;

type EditorialShot = Readonly<{
  motionPromptBlueprint: string;
  realWorldReferenceAssetVersionId: string | null;
  shotNumber: number;
  storyboardCompositionMode:
    "single_frame" | "two_state_start_end" | "split_screen_two_state";
  storyboardEndPromptBlueprint: string | null;
  storyboardPromptBlueprint: string;
  storyboardStartPromptBlueprint: string;
}>;

type ReferenceEdge = Readonly<{
  asset_content_hash: string;
  asset_version_id: string | null;
  reference_kind: string;
  reference_ordinal: number;
  shot_number: number;
  source_shot_number: number | null;
}>;

type StoryboardFrame = Readonly<{
  attempt_number: number;
  completed_at: string | null;
  content_sha256: string | null;
  external_request_id: string;
  frame_role: "single" | "start" | "end";
  id: string;
  media_mime: StillImageMime | null;
  object_name: string | null;
  provider_dispatch_id: string | null;
  response_url: string;
  shot_number: number;
  state: "complete" | "failed" | "submitted";
  status_url: string;
}>;

export class MvpStoryboardProductionError extends Error {
  override readonly name = "MvpStoryboardProductionError";

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
    value.trim().length < 1 ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new MvpStoryboardProductionError(
      `${label} is unavailable.`,
      "PRODUCTION_INPUT_INVALID",
      false,
    );
  }
  return value.trim();
}

function executableShots(shots: readonly ShotRow[]): readonly ShotRow[] {
  if (shots.length < 1 || shots.length > MAXIMUM_SHOTS) {
    throw new MvpStoryboardProductionError(
      "The locked plan is outside the operational shot envelope.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  for (const [index, shot] of shots.entries()) {
    const duration = shot.end_ms - shot.start_ms;
    if (
      shot.shot_number !== index + 1 ||
      shot.start_ms < 0 ||
      duration < 1_000 ||
      duration > 15_000 ||
      (index > 0 && shot.start_ms !== shots[index - 1]!.end_ms)
    ) {
      throw new MvpStoryboardProductionError(
        "The locked semantic shot timeline is invalid.",
        "PRODUCTION_PLAN_INVALID",
        false,
      );
    }
  }
  return shots;
}

function editorialShots(
  value: unknown,
  compositionValue: unknown,
): readonly EditorialShot[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpStoryboardProductionError(
      "The locked editorial plan is malformed.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  const shots = (value as Record<string, unknown>).shots;
  if (!Array.isArray(shots)) {
    throw new MvpStoryboardProductionError(
      "The locked editorial plan is malformed.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  const compositionShots =
    compositionValue &&
    typeof compositionValue === "object" &&
    !Array.isArray(compositionValue) &&
    Array.isArray((compositionValue as Record<string, unknown>).shots)
      ? ((compositionValue as Record<string, unknown>).shots as unknown[])
      : [];
  return Object.freeze(
    shots.map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new MvpStoryboardProductionError(
          "A locked editorial shot is malformed.",
          "PRODUCTION_PLAN_INVALID",
          false,
        );
      }
      const shot = value as Record<string, unknown>;
      const legacyComposition =
        compositionShots[index] &&
        typeof compositionShots[index] === "object" &&
        !Array.isArray(compositionShots[index])
          ? (compositionShots[index] as Record<string, unknown>)
          : null;
      if (shot.shotNumber !== index + 1) {
        throw new MvpStoryboardProductionError(
          "The locked editorial shot sequence is malformed.",
          "PRODUCTION_PLAN_INVALID",
          false,
        );
      }
      const researchReference =
        shot.realWorldReferenceAssetVersionId === null ||
        shot.realWorldReferenceAssetVersionId === undefined
          ? null
          : safeText(
              shot.realWorldReferenceAssetVersionId,
              "The real-world reference identity",
              36,
            );
      const compositionMode =
        shot.storyboardCompositionMode ??
        (typeof shot.visualIntent === "string" &&
        shot.visualIntent
          .trimStart()
          .toLocaleLowerCase("en-US")
          .startsWith("split-screen two-state composition:")
          ? "split_screen_two_state"
          : "single_frame");
      if (
        compositionMode !== "single_frame" &&
        compositionMode !== "two_state_start_end" &&
        compositionMode !== "split_screen_two_state"
      ) {
        throw new MvpStoryboardProductionError(
          "The storyboard composition mode is invalid.",
          "PRODUCTION_PLAN_INVALID",
          false,
        );
      }
      return Object.freeze({
        motionPromptBlueprint: safeText(
          shot.motionPromptBlueprint ??
            `Animate this one accepted storyboard frame. ${safeText(
              legacyComposition?.staging,
              "The legacy shot action",
              1_200,
            )} ${safeText(
              legacyComposition?.cameraMotion,
              "The legacy camera motion",
              1_200,
            )} Preserve the frame's identities, architecture, lighting, and composition. Show one continuous full-frame shot; do not introduce a new subject, internal cut, prior event, or later event.`,
          "The motion prompt blueprint",
          2_000,
        ),
        realWorldReferenceAssetVersionId: researchReference,
        shotNumber: index + 1,
        storyboardCompositionMode: compositionMode,
        storyboardEndPromptBlueprint:
          compositionMode === "two_state_start_end"
            ? safeText(
                shot.storyboardEndPromptBlueprint,
                "The storyboard end prompt blueprint",
                8_000,
              )
            : null,
        storyboardPromptBlueprint: safeText(
          shot.storyboardPromptBlueprint ?? shot.promptBlueprint,
          "The storyboard prompt blueprint",
          8_000,
        ),
        storyboardStartPromptBlueprint: safeText(
          shot.storyboardStartPromptBlueprint ??
            shot.storyboardPromptBlueprint ??
            shot.promptBlueprint,
          "The storyboard start prompt blueprint",
          8_000,
        ),
      });
    }),
  );
}

function referenceRole(kind: string): NanoBananaReferenceRole {
  if (kind === "real_world") return "real_world_evidence";
  if (kind === "character") return "character_identity";
  if (kind === "continuity") return "continuity_state";
  if (kind === "location_master") return "location_geometry";
  throw new MvpStoryboardProductionError(
    "The storyboard reference role is unsupported.",
    "PRODUCTION_REFERENCE_MISMATCH",
    false,
  );
}

function referencePurpose(kind: string): string {
  if (kind === "real_world") {
    return "Preserve the publicly researched real-world architecture, ritual, festival, or temple evidence visible in this shot.";
  }
  if (kind === "character") {
    return "Preserve this character's exact face, body, costume, ornaments, sacred attributes, and identity only.";
  }
  if (kind === "continuity") {
    return "Preserve established screen direction, environment continuity, and identity state; do not copy the prior shot's composition.";
  }
  return "Preserve the accepted location or story-significant prop geometry, materials, architecture, and identity only.";
}

function finalStoryboardPrompt(blueprint: string, lookVersionId: string): string {
  const look = findLookByVersionId(lookVersionId);
  if (!look) {
    throw new MvpStoryboardProductionError(
      "The locked look is unavailable.",
      "PRODUCTION_LOOK_UNAVAILABLE",
      false,
    );
  }
  return compileImagePrompt(blueprint, look);
}

function finalMotionPrompt(blueprint: string): string {
  return safeText(
    `${blueprint} Use one uninterrupted 9:16 shot. Preserve the accepted storyboard's identities, anatomy, costume, sacred attributes, architecture, lighting, and composition. No dialogue, lip sync, text, watermark, collage, or internal cut.`,
    "The final motion prompt",
    2_400,
  );
}

function falMediaUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new MvpStoryboardProductionError(
      "The provider media location is invalid.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname.endsWith(".fal.media")
  ) {
    throw new MvpStoryboardProductionError(
      "The provider media location is invalid.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  return url;
}

async function dispatchFalMedia(input: Parameters<typeof dispatchMvpFalMedia>[0]) {
  try {
    return await dispatchMvpFalMedia(input);
  } catch (caught) {
    if (caught instanceof MvpMediaDispatchError) {
      throw new MvpStoryboardProductionError(
        caught.message,
        caught.safeCode,
        caught.retryable,
      );
    }
    throw caught;
  }
}

async function pollStoryboardFrame(frame: StoryboardFrame): Promise<boolean> {
  const status = await fetchMvpFalQueueJson(frame.status_url, 30_000);
  const state = String(status.status ?? "UNKNOWN");
  if (state !== "COMPLETED") {
    if (state.includes("FAILED") || state === "CANCELLED") {
      await createAdminSupabaseClient()
        .from("mvp_storyboard_frame_worker")
        .update({
          completed_at: new Date().toISOString(),
          last_error_code: "PROVIDER_GENERATION_FAILED",
          last_error_summary: "The storyboard image provider failed this shot.",
          state: "failed",
        })
        .eq("id", frame.id);
      throw new MvpStoryboardProductionError(
        "A storyboard image could not be generated.",
        "PROVIDER_GENERATION_FAILED",
        false,
      );
    }
    return false;
  }
  const result = await fetchMvpFalQueueJson(frame.response_url, 60_000);
  const images = result.images;
  if (!Array.isArray(images) || images.length !== 1) {
    throw new MvpStoryboardProductionError(
      "The storyboard result does not contain exactly one frame.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  const image = images[0];
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new MvpStoryboardProductionError(
      "The storyboard result is malformed.",
      "PROVIDER_RESPONSE_INVALID",
      false,
    );
  }
  const media = image as Record<string, unknown>;
  const mime = media.content_type;
  if (!["image/jpeg", "image/png", "image/webp"].includes(String(mime))) {
    throw new MvpStoryboardProductionError(
      "The storyboard frame media declaration is invalid.",
      "PROVIDER_MEDIA_INVALID",
      false,
    );
  }
  const mediaResponse = await fetch(falMediaUrl(media.url), {
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  const declared = Number(mediaResponse.headers.get("content-length") ?? "0");
  if (
    !mediaResponse.ok ||
    (declared > 0 && declared > launchMediaLimits.maximumImageBytes)
  ) {
    throw new MvpStoryboardProductionError(
      "The storyboard image could not be downloaded safely.",
      "PROVIDER_MEDIA_UNAVAILABLE",
    );
  }
  const bytes = Buffer.from(await mediaResponse.arrayBuffer());
  const dimensions = inspectStillImageDimensions(bytes, mime as StillImageMime);
  const providerWidth = media.width == null ? null : Number(media.width);
  const providerHeight = media.height == null ? null : Number(media.height);
  if (
    bytes.length < 1_024 ||
    bytes.length > launchMediaLimits.maximumImageBytes ||
    sniffMediaMagic(bytes) !== mime ||
    inspectStillImageContainer(bytes, mime as StillImageMime).status !== "valid" ||
    !dimensions ||
    dimensions.width < 720 ||
    dimensions.height < 1280 ||
    dimensions.width * dimensions.height > launchMediaLimits.maximumPixels ||
    Math.abs(dimensions.width / dimensions.height - 9 / 16) > 0.025 ||
    (providerWidth !== null &&
      (!Number.isSafeInteger(providerWidth) || providerWidth !== dimensions.width)) ||
    (providerHeight !== null &&
      (!Number.isSafeInteger(providerHeight) || providerHeight !== dimensions.height))
  ) {
    throw new MvpStoryboardProductionError(
      "The storyboard frame failed its media integrity checks.",
      "PROVIDER_MEDIA_INVALID",
      false,
    );
  }
  const extension =
    mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const client = createAdminSupabaseClient();
  const { data: current, error: currentError } = await client
    .from("mvp_storyboard_frame_worker")
    .select("workspace_id,production_run_id,attempt_number,shot_number,frame_role")
    .eq("id", frame.id)
    .single();
  if (currentError || !current) {
    throw new MvpStoryboardProductionError(
      "The storyboard ledger is unavailable.",
      "PRODUCTION_LEDGER_FAILED",
    );
  }
  const providerSha256 = sha256(bytes);
  const quarantineObjectName = `${current.workspace_id}/mvp-storyboard-quarantine/${current.production_run_id}/${current.attempt_number}/${current.shot_number}/${current.frame_role}/${providerSha256}.${extension}`;
  const { error: quarantineError } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(quarantineObjectName, bytes, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (quarantineError && quarantineError.message !== "The resource already exists") {
    throw new MvpStoryboardProductionError(
      "The storyboard frame could not be quarantined.",
      "PROVIDER_QUARANTINE_FAILED",
    );
  }
  if (quarantineError?.message === "The resource already exists") {
    const { data: existing, error: existingError } = await client.storage
      .from(MEDIA_BUCKET)
      .download(quarantineObjectName);
    const existingBytes = existing ? Buffer.from(await existing.arrayBuffer()) : null;
    if (existingError || !existingBytes || sha256(existingBytes) !== providerSha256) {
      throw new MvpStoryboardProductionError(
        "The existing storyboard quarantine object does not match the provider result.",
        "PROVIDER_QUARANTINE_COLLISION",
        false,
      );
    }
  }
  let scan;
  try {
    scan = await scanAndReencodeWorldImage({
      bytes,
      declaredMime: mime as StillImageMime,
    });
  } catch (caught) {
    if (caught instanceof SandboxMediaScannerError) {
      throw new MvpStoryboardProductionError(
        caught.message,
        "PROVIDER_MEDIA_SCAN_FAILED",
        false,
      );
    }
    throw caught;
  }
  if (
    scan.width !== dimensions.width ||
    scan.height !== dimensions.height ||
    Math.abs(scan.width / scan.height - 9 / 16) > 0.025
  ) {
    throw new MvpStoryboardProductionError(
      "The sanitized storyboard frame changed outside the accepted dimensions.",
      "PROVIDER_MEDIA_SCAN_FAILED",
      false,
    );
  }
  const roleSuffix = current.frame_role === "single" ? "" : `-${current.frame_role}`;
  const objectName = `${current.workspace_id}/mvp-storyboards/${current.production_run_id}/${current.attempt_number}/${current.shot_number}${roleSuffix}.${extension}`;
  const { error: uploadError } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(objectName, scan.outputBytes, {
      contentType: mime as string,
      upsert: false,
    });
  if (uploadError && uploadError.message !== "The resource already exists") {
    throw new MvpStoryboardProductionError(
      "The storyboard frame could not be stored.",
      "PRODUCTION_STORAGE_FAILED",
    );
  }
  if (uploadError?.message === "The resource already exists") {
    const { data: existing, error: existingError } = await client.storage
      .from(MEDIA_BUCKET)
      .download(objectName);
    const existingBytes = existing ? Buffer.from(await existing.arrayBuffer()) : null;
    if (
      existingError ||
      !existingBytes ||
      sha256(existingBytes) !== scan.outputSha256
    ) {
      throw new MvpStoryboardProductionError(
        "The existing storyboard object does not match the claimed generation.",
        "PRODUCTION_STORAGE_COLLISION",
        false,
      );
    }
  }
  if (frame.provider_dispatch_id) {
    await completeMvpMediaDispatchOutput({
      externalRequestId: frame.external_request_id,
      outputContentSha256: scan.outputSha256,
      providerDispatchId: frame.provider_dispatch_id,
    });
  }
  const { error: updateError } = await client
    .from("mvp_storyboard_frame_worker")
    .update({
      byte_length: scan.outputBytes.length,
      completed_at: new Date().toISOString(),
      content_sha256: scan.outputSha256,
      height: scan.height,
      media_mime: mime,
      object_name: objectName,
      state: "complete",
      width: scan.width,
    })
    .eq("id", frame.id)
    .eq("state", "submitted");
  if (updateError) {
    throw new MvpStoryboardProductionError(
      "The completed storyboard frame could not be recorded.",
      "PRODUCTION_LEDGER_FAILED",
      false,
    );
  }
  return true;
}

export function compileMvpVideoRequest(
  input: Readonly<{
    compositionMode: EditorialShot["storyboardCompositionMode"];
    expectedProviderDurationMs: number;
    motionClass: ShotRow["motion_class"];
    prompt: string;
    retainedDurationMs: number;
    storyboardEndFrameId?: string;
    storyboardEndUrl?: string;
    storyboardFrameId: string;
    storyboardUrl: string;
  }>,
): Readonly<{
  endpoint: string;
  payload: Readonly<Record<string, unknown>>;
  providerDurationMs: number;
}> {
  const negative =
    "distortion, flicker, morphing, extra limbs, text, watermark, abrupt cuts, speech, lip sync, collage";
  let compiled: {
    endpoint: string;
    payload: Readonly<Record<string, unknown>>;
    providerDurationMs: number;
  };
  if (input.compositionMode === "two_state_start_end") {
    if (
      !input.storyboardEndFrameId ||
      !input.storyboardEndUrl ||
      input.storyboardEndFrameId === input.storyboardFrameId ||
      input.storyboardEndUrl === input.storyboardUrl
    ) {
      throw new MvpStoryboardProductionError(
        "A two-state shot requires distinct clean start and end storyboard frames.",
        "PRODUCTION_STORYBOARD_STATE_MISSING",
        false,
      );
    }
    const result = compileSeedanceImageToVideo({
      editorialDurationMs: input.retainedDurationMs,
      endFrame: {
        assetVersionId: input.storyboardEndFrameId,
        role: "accepted_storyboard_end_frame",
        url: input.storyboardEndUrl,
      },
      generateAudio: false,
      prompt: input.prompt,
      resolution: "720p",
      startFrame: {
        assetVersionId: input.storyboardFrameId,
        role: "accepted_storyboard_start_frame",
        url: input.storyboardUrl,
      },
    });
    compiled = {
      endpoint: result.endpoint,
      payload: result.payload,
      providerDurationMs: result.timing.providerDurationMs,
    };
  } else if (input.compositionMode === "split_screen_two_state") {
    const result = compileSeedanceReferenceToVideo({
      editorialDurationMs: input.retainedDurationMs,
      generateAudio: false,
      imageReferences: [
        {
          assetVersionId: input.storyboardFrameId,
          role: "two_state_storyboard",
          url: input.storyboardUrl,
        },
      ],
      prompt: `Use @Image1 only as the ordered two-state storyboard guide. Show the first state full-frame, animate the described action continuously, and finish with the second state full-frame. Never show panels, a collage, or a split screen in the video. ${input.prompt}`,
      resolution: "720p",
    });
    compiled = {
      endpoint: result.endpoint,
      payload: result.payload,
      providerDurationMs: result.timing.providerDurationMs,
    };
  } else if (input.motionClass === "complex_general") {
    const result = compileSeedanceImageToVideo({
      editorialDurationMs: input.retainedDurationMs,
      generateAudio: false,
      prompt: input.prompt,
      resolution: "720p",
      startFrame: {
        assetVersionId: input.storyboardFrameId,
        role: "accepted_storyboard_frame",
        url: input.storyboardUrl,
      },
    });
    compiled = {
      endpoint: result.endpoint,
      payload: result.payload,
      providerDurationMs: result.timing.providerDurationMs,
    };
  } else if (
    input.motionClass === "simple_camera_subject" &&
    input.retainedDurationMs <= 10_000
  ) {
    const duration = selectKlingProviderDuration({
      model: "kling-2.5-pro",
      retainedDurationMs: input.retainedDurationMs,
    });
    compiled = {
      endpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
      payload: compileKling25ImageToVideoPayload({
        duration: duration.duration as "5" | "10",
        imageUrl: input.storyboardUrl,
        negativePrompt: negative,
        prompt: input.prompt,
      }),
      providerDurationMs: duration.requestedDurationMs,
    };
  } else {
    const duration = selectKlingProviderDuration({
      model: "kling-3-pro",
      retainedDurationMs: input.retainedDurationMs,
    });
    compiled = {
      endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
      payload: compileKling3ImageToVideoPayload({
        duration: duration.duration as Parameters<
          typeof compileKling3ImageToVideoPayload
        >[0]["duration"],
        negativePrompt: negative,
        prompt: input.prompt,
        startImageUrl: input.storyboardUrl,
      }),
      providerDurationMs: duration.requestedDurationMs,
    };
  }
  if (compiled.providerDurationMs !== input.expectedProviderDurationMs) {
    throw new MvpStoryboardProductionError(
      "The compiled provider duration does not match the locked production slot.",
      "PRODUCTION_PROVIDER_DURATION_MISMATCH",
      false,
    );
  }
  return Object.freeze(compiled);
}

export async function advanceMvpStoryboardAndClipSubmission(
  job: MvpSubmissionJob,
): Promise<
  Readonly<{
    complete: boolean;
    completedClips: number;
    completedStoryboards: number;
    readyForSound: boolean;
    totalClips: number;
    totalStoryboards: number;
  }>
> {
  const client = createAdminSupabaseClient();
  const [bundleResult, shotsResult, slotsResult, edgesResult, frameResult, clipResult] =
    await Promise.all([
      client
        .from("preflight_plan_bundles")
        .select("edd_version_id,composition_version_id,configuration_candidate_id")
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
        .from("preflight_provider_request_slots")
        .select("id,shot_number,duration_ms,retained_duration_ms,input_strategy")
        .eq("workspace_id", job.workspace_id)
        .eq("plan_bundle_id", job.plan_bundle_id)
        .eq("slot_kind", "primary")
        .order("shot_number"),
      client
        .from("preflight_reference_edges")
        .select(
          "shot_number,reference_ordinal,reference_kind,asset_version_id,asset_content_hash,source_shot_number",
        )
        .eq("workspace_id", job.workspace_id)
        .eq("plan_bundle_id", job.plan_bundle_id)
        .order("shot_number")
        .order("reference_ordinal"),
      client
        .from("mvp_storyboard_frame_worker")
        .select(
          "id,attempt_number,shot_number,frame_role,state,external_request_id,status_url,response_url,object_name,content_sha256,media_mime,completed_at,provider_dispatch_id",
        )
        .eq("workspace_id", job.workspace_id)
        .eq("production_run_id", job.production_run_id)
        .eq("attempt_number", job.attempt_number)
        .order("shot_number"),
      client
        .from("mvp_production_clip_worker")
        .select("shot_number")
        .eq("workspace_id", job.workspace_id)
        .eq("production_run_id", job.production_run_id)
        .eq("attempt_number", job.attempt_number),
    ]);
  if (
    bundleResult.error ||
    shotsResult.error ||
    slotsResult.error ||
    edgesResult.error ||
    frameResult.error ||
    clipResult.error ||
    !bundleResult.data
  ) {
    throw new MvpStoryboardProductionError(
      "The locked storyboard inputs could not be loaded.",
      "PRODUCTION_PLAN_UNAVAILABLE",
    );
  }
  const selected = executableShots(shotsResult.data as ShotRow[]);
  const slots = slotsResult.data as SlotRow[];
  if (
    slots.length !== selected.length ||
    slots.some(
      (slot, index) =>
        slot.shot_number !== index + 1 ||
        slot.retained_duration_ms !==
          selected[index]!.end_ms - selected[index]!.start_ms,
    )
  ) {
    throw new MvpStoryboardProductionError(
      "The locked provider slots do not match the semantic shot timeline.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  const { data: run, error: runError } = await client
    .from("production_runs")
    .select("production_quote_id")
    .eq("workspace_id", job.workspace_id)
    .eq("id", job.production_run_id)
    .single();
  const { data: pricedSlots, error: pricedSlotsError } = run?.production_quote_id
    ? await client
        .from("production_quote_lines")
        .select(
          "provider_request_slot_id,expected_amount_microusd,high_amount_microusd",
        )
        .eq("workspace_id", job.workspace_id)
        .eq("production_quote_id", run.production_quote_id)
        .eq("line_kind", "provider_clip")
        .in(
          "provider_request_slot_id",
          slots.map(({ id }) => id),
        )
    : { data: null, error: runError };
  if (
    runError ||
    pricedSlotsError ||
    !pricedSlots ||
    pricedSlots.length !== slots.length
  ) {
    throw new MvpStoryboardProductionError(
      "The locked provider cost slots are unavailable.",
      "PRODUCTION_COST_AUTHORITY_UNAVAILABLE",
      false,
    );
  }
  const costBySlotId = new Map(
    pricedSlots.map((line) => [
      line.provider_request_slot_id,
      {
        expected: Number(line.expected_amount_microusd),
        maximum: Number(line.high_amount_microusd),
      },
    ]),
  );
  if (
    slots.some((slot) => {
      const cost = costBySlotId.get(slot.id);
      return (
        !cost ||
        !Number.isSafeInteger(cost.expected) ||
        !Number.isSafeInteger(cost.maximum) ||
        cost.expected < 0 ||
        cost.maximum < cost.expected
      );
    })
  ) {
    throw new MvpStoryboardProductionError(
      "A locked provider cost slot is invalid.",
      "PRODUCTION_COST_AUTHORITY_UNAVAILABLE",
      false,
    );
  }
  const [
    effectiveEdd,
    decisions,
    { data: composition, error: compositionError },
    { data: configuration, error: configurationError },
  ] = await Promise.all([
    loadEffectiveEddPayload(job),
    loadRepairDecisions(job),
    client
      .from("preflight_plan_component_versions")
      .select("payload")
      .eq("workspace_id", job.workspace_id)
      .eq("id", bundleResult.data.composition_version_id)
      .single(),
    client
      .from("episode_configuration_candidates")
      .select("look_version_id")
      .eq("workspace_id", job.workspace_id)
      .eq("id", bundleResult.data.configuration_candidate_id)
      .single(),
  ]);
  if (compositionError || configurationError || !composition || !configuration) {
    throw new MvpStoryboardProductionError(
      "The locked editorial look and plan could not be loaded.",
      "PRODUCTION_PLAN_UNAVAILABLE",
    );
  }
  const editorial = editorialShots(effectiveEdd, composition.payload);
  if (editorial.length !== selected.length) {
    throw new MvpStoryboardProductionError(
      "The editorial shot count does not match the locked timeline.",
      "PRODUCTION_PLAN_INVALID",
      false,
    );
  }
  const edges = edgesResult.data as ReferenceEdge[];
  const edgesByShot = new Map<number, ReferenceEdge[]>();
  for (const edge of edges) {
    const group = edgesByShot.get(edge.shot_number) ?? [];
    group.push(edge);
    edgesByShot.set(edge.shot_number, group);
  }
  for (const shot of editorial) {
    const realWorld = (edgesByShot.get(shot.shotNumber) ?? []).filter(
      ({ reference_kind }) => reference_kind === "real_world",
    );
    if (
      realWorld.length > 1 ||
      (realWorld[0]?.asset_version_id ?? null) !== shot.realWorldReferenceAssetVersionId
    ) {
      throw new MvpStoryboardProductionError(
        "The editorial research reference does not match the executable graph.",
        "PRODUCTION_REFERENCE_MISMATCH",
        false,
      );
    }
  }
  const directAssetIds = [
    ...new Set(
      edges
        .map(({ asset_version_id }) => asset_version_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const { data: directAssets, error: directAssetsError } = await client
    .from("asset_versions")
    .select("id,object_name,content_sha256")
    .eq("workspace_id", job.workspace_id)
    .in("id", directAssetIds);
  if (
    directAssetsError ||
    !directAssets ||
    directAssets.length !== directAssetIds.length
  ) {
    throw new MvpStoryboardProductionError(
      "An accepted storyboard reference is unavailable.",
      "PRODUCTION_REFERENCE_MISSING",
      false,
    );
  }
  const objectByAssetId = new Map(
    directAssets.map(({ id, object_name }) => [id, object_name]),
  );
  const hashByAssetId = new Map(
    directAssets.map(({ id, content_sha256 }) => [id, content_sha256]),
  );
  if (
    edges.some(
      (edge) =>
        edge.asset_version_id !== null &&
        hashByAssetId.get(edge.asset_version_id) !== edge.asset_content_hash,
    )
  ) {
    throw new MvpStoryboardProductionError(
      "An accepted storyboard reference hash does not match the executable graph.",
      "PRODUCTION_REFERENCE_MISMATCH",
      false,
    );
  }

  const decisionByShot = new Map<number, RepairDecisionRow>(
    decisions.map((decision) => [decision.shot_number, decision]),
  );
  if (
    job.attempt_number > 1 &&
    (decisions.length !== selected.length ||
      selected.some((shot) => !decisionByShot.has(shot.shot_number)))
  ) {
    throw new MvpStoryboardProductionError(
      "The durable repair plan does not cover the locked shot timeline.",
      "REPAIR_PLAN_INCOMPLETE",
      false,
    );
  }
  const sourceFrameIds = [
    ...new Set(
      decisions
        .flatMap(({ source_storyboard_end_frame_id, source_storyboard_frame_id }) => [
          source_storyboard_frame_id,
          source_storyboard_end_frame_id,
        ])
        .filter((id): id is string => id !== null),
    ),
  ];
  const sourceFrameResult = sourceFrameIds.length
    ? await client
        .from("mvp_storyboard_frame_worker")
        .select(
          "id,attempt_number,shot_number,frame_role,state,external_request_id,status_url,response_url,object_name,content_sha256,media_mime,completed_at",
        )
        .in("id", sourceFrameIds)
    : { data: [], error: null };
  if (
    sourceFrameResult.error ||
    !sourceFrameResult.data ||
    sourceFrameResult.data.length !== sourceFrameIds.length ||
    sourceFrameResult.data.some(
      (frame) => frame.state !== "complete" || !frame.object_name,
    )
  ) {
    throw new MvpStoryboardProductionError(
      "A selected source storyboard is unavailable for repair.",
      "REPAIR_SOURCE_UNAVAILABLE",
      false,
    );
  }
  const sourceFrameById = new Map(
    (sourceFrameResult.data as StoryboardFrame[]).map((frame) => [frame.id, frame]),
  );

  let frames = (frameResult.data ?? []) as StoryboardFrame[];
  let polls = 0;
  for (const frame of frames) {
    if (polls >= MAXIMUM_POLLS_PER_PASS) break;
    if (frame.state === "failed") {
      throw new MvpStoryboardProductionError(
        "A storyboard frame is in a failed state.",
        "PROVIDER_GENERATION_FAILED",
        false,
      );
    }
    if (frame.state === "submitted") {
      await pollStoryboardFrame(frame);
      polls += 1;
    }
  }
  if (polls > 0) {
    const refreshed = await client
      .from("mvp_storyboard_frame_worker")
      .select(
        "id,attempt_number,shot_number,frame_role,state,external_request_id,status_url,response_url,object_name,content_sha256,media_mime,completed_at",
      )
      .eq("workspace_id", job.workspace_id)
      .eq("production_run_id", job.production_run_id)
      .eq("attempt_number", job.attempt_number)
      .order("shot_number");
    if (refreshed.error) {
      throw new MvpStoryboardProductionError(
        "The storyboard ledger could not be refreshed.",
        "PRODUCTION_LEDGER_FAILED",
      );
    }
    frames = (refreshed.data ?? []) as StoryboardFrame[];
  }
  const frameKey = (shotNumber: number, role: StoryboardFrame["frame_role"]) =>
    `${shotNumber}:${role}`;
  const frameByKey = new Map(
    frames.map((frame) => [frameKey(frame.shot_number, frame.frame_role), frame]),
  );
  const requiredFrameRoles = (
    shotNumber: number,
  ): readonly StoryboardFrame["frame_role"][] =>
    editorial[shotNumber - 1]!.storyboardCompositionMode === "two_state_start_end"
      ? ["start", "end"]
      : ["single"];
  const currentPrimaryFrame = (shotNumber: number) =>
    frameByKey.get(
      frameKey(
        shotNumber,
        editorial[shotNumber - 1]!.storyboardCompositionMode === "two_state_start_end"
          ? "start"
          : "single",
      ),
    );
  const effectiveFrameForShot = (shotNumber: number): StoryboardFrame | undefined => {
    const current = currentPrimaryFrame(shotNumber);
    if (current) return current;
    const decision = decisionByShot.get(shotNumber);
    if (decision?.action === "regenerate_storyboard_and_clip") return undefined;
    const sourceId = decision?.source_storyboard_frame_id;
    return sourceId ? sourceFrameById.get(sourceId) : undefined;
  };
  const effectiveEndFrameForShot = (
    shotNumber: number,
  ): StoryboardFrame | undefined => {
    const current = frameByKey.get(frameKey(shotNumber, "end"));
    if (current) return current;
    const decision = decisionByShot.get(shotNumber);
    if (decision?.action === "regenerate_storyboard_and_clip") return undefined;
    const sourceId = decision?.source_storyboard_end_frame_id;
    return sourceId ? sourceFrameById.get(sourceId) : undefined;
  };
  let submittedFrames = 0;
  for (const shot of selected) {
    const decision = decisionByShot.get(shot.shot_number);
    if (decision && decision.action !== "regenerate_storyboard_and_clip") {
      continue;
    }
    const editorialShot = editorial[shot.shot_number - 1]!;
    const roles = requiredFrameRoles(shot.shot_number);
    if (roles.every((role) => frameByKey.has(frameKey(shot.shot_number, role)))) {
      continue;
    }
    if (submittedFrames >= MAXIMUM_SUBMISSIONS_PER_PASS) break;
    const shotEdges = edgesByShot.get(shot.shot_number) ?? [];
    if (
      shotEdges.length < 1 ||
      shotEdges.length > 14 ||
      shotEdges.some((edge, index) => edge.reference_ordinal !== index + 1)
    ) {
      throw new MvpStoryboardProductionError(
        "The storyboard reference count is invalid.",
        "PRODUCTION_REFERENCE_MISSING",
        false,
      );
    }
    const unresolvedContinuity = shotEdges.some(
      (edge) =>
        edge.source_shot_number !== null &&
        effectiveFrameForShot(edge.source_shot_number)?.state !== "complete",
    );
    if (unresolvedContinuity) continue;
    for (const frameRole of roles) {
      if (frameByKey.has(frameKey(shot.shot_number, frameRole))) continue;
      if (submittedFrames >= MAXIMUM_SUBMISSIONS_PER_PASS) break;
      const references: NanoBananaReferenceInput[] = [];
      const referenceHashes: string[] = [];
      for (const edge of shotEdges) {
        const dependencyFrame =
          edge.source_shot_number === null
            ? undefined
            : effectiveFrameForShot(edge.source_shot_number);
        const objectName = edge.asset_version_id
          ? objectByAssetId.get(edge.asset_version_id)
          : dependencyFrame?.object_name;
        const identity = edge.asset_version_id ?? dependencyFrame?.id;
        const contentHash = edge.asset_version_id
          ? edge.asset_content_hash
          : dependencyFrame?.content_sha256;
        if (!objectName || !identity || !contentHash) {
          throw new MvpStoryboardProductionError(
            "A storyboard reference dependency is unavailable.",
            "PRODUCTION_REFERENCE_MISSING",
            false,
          );
        }
        const { data: signed, error: signError } = await client.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(objectName, 900);
        if (signError || !signed?.signedUrl) {
          throw new MvpStoryboardProductionError(
            "A storyboard reference could not be signed.",
            "PRODUCTION_REFERENCE_UNAVAILABLE",
          );
        }
        references.push({
          assetVersionId: identity,
          imageUrl: signed.signedUrl,
          purpose: referencePurpose(edge.reference_kind),
          role: referenceRole(edge.reference_kind),
        });
        referenceHashes.push(contentHash);
      }
      const compositionPrompt = finalStoryboardPrompt(
        frameRole === "end"
          ? editorialShot.storyboardEndPromptBlueprint!
          : editorialShot.storyboardStartPromptBlueprint,
        configuration.look_version_id,
      );
      const contract = compileNanoBananaReferenceContract({
        allowIntentionalSplitScreen:
          editorialShot.storyboardCompositionMode === "split_screen_two_state",
        compositionPrompt,
        references,
      });
      const bindingManifest = contract.bindings.map((binding, index) => {
        const edge = shotEdges[index]!;
        return Object.freeze({
          ...binding,
          contentHash: referenceHashes[index]!,
          providerField: "image_urls",
          providerToken: `${binding.imageToken} / ${binding.atToken}`,
          referenceKind: edge.reference_kind,
          sourceShotNumber: edge.source_shot_number,
        });
      });
      const payload: Record<string, unknown> = {
        aspect_ratio: "9:16",
        enable_web_search: false,
        limit_generations: true,
        num_images: 1,
        output_format: "png",
        prompt: contract.prompt,
        resolution: "2K",
        safety_tolerance: "2",
        thinking_level: "high",
        ...(contract.imageUrls.length > 0 ? { image_urls: contract.imageUrls } : {}),
        ...(contract.systemPrompt ? { system_prompt: contract.systemPrompt } : {}),
      };
      const submitted = await dispatchFalMedia({
        attemptNumber: job.attempt_number,
        dispatchKey: `storyboard:${shot.shot_number}:${frameRole}`,
        endpoint: contract.endpoint,
        episodeId: job.episode_id,
        expectedCostMicrousd: 120_000,
        inputManifestSha256: sha256(
          postgresJsonbText({
            bindingManifest,
            compositionMode: editorialShot.storyboardCompositionMode,
            endpoint: contract.endpoint,
            frameRole,
            prompt: contract.prompt,
            shotNumber: shot.shot_number,
            systemPrompt: contract.systemPrompt,
          }),
        ),
        maximumCostMicrousd: 120_000,
        mediaKind: "storyboard",
        payload,
        productionRunId: job.production_run_id,
        shotNumber: shot.shot_number,
        workspaceId: job.workspace_id,
      });
      const { data: inserted, error: insertError } = await client
        .from("mvp_storyboard_frame_worker")
        .insert({
          attempt_number: job.attempt_number,
          binding_manifest: bindingManifest,
          composition_mode: editorialShot.storyboardCompositionMode,
          endpoint: contract.endpoint,
          episode_id: job.episode_id,
          external_request_id: submitted.externalRequestId,
          frame_role: frameRole,
          model_key: "fal-ai/nano-banana-2",
          plan_bundle_id: job.plan_bundle_id,
          production_run_id: job.production_run_id,
          prompt: contract.prompt,
          provider_dispatch_id: submitted.providerDispatchId,
          response_url: submitted.responseUrl,
          shot_number: shot.shot_number,
          state: "submitted",
          status_url: submitted.statusUrl,
          system_prompt: contract.systemPrompt,
          workspace_id: job.workspace_id,
        })
        .select("id")
        .single();
      if (insertError || !inserted) {
        throw new MvpStoryboardProductionError(
          "A storyboard job was accepted but could not be recorded.",
          "PRODUCTION_LEDGER_FAILED",
          false,
        );
      }
      frameByKey.set(frameKey(shot.shot_number, frameRole), {
        attempt_number: job.attempt_number,
        completed_at: null,
        content_sha256: null,
        external_request_id: submitted.externalRequestId,
        frame_role: frameRole,
        id: inserted.id,
        media_mime: null,
        object_name: null,
        provider_dispatch_id: submitted.providerDispatchId,
        response_url: submitted.responseUrl,
        shot_number: shot.shot_number,
        state: "submitted",
        status_url: submitted.statusUrl,
      });
      submittedFrames += 1;
    }
  }
  const requiredStoryboardShots = selected.filter((shot) => {
    const decision = decisionByShot.get(shot.shot_number);
    return !decision || decision.action === "regenerate_storyboard_and_clip";
  });
  const completedRequiredStoryboards = requiredStoryboardShots.filter((shot) =>
    requiredFrameRoles(shot.shot_number).every(
      (role) => frameByKey.get(frameKey(shot.shot_number, role))?.state === "complete",
    ),
  ).length;
  let selectionProgress = await recordReadyRepairSelections(job);
  const completedStoryboards =
    job.attempt_number === 1
      ? completedRequiredStoryboards
      : selected.length - requiredStoryboardShots.length + completedRequiredStoryboards;
  if (completedRequiredStoryboards < requiredStoryboardShots.length) {
    return Object.freeze({
      complete: false,
      completedClips: selectionProgress.selected,
      completedStoryboards,
      readyForSound: false,
      totalClips: selected.length,
      totalStoryboards: selected.length,
    });
  }

  const existingClips = new Set(
    (clipResult.data ?? []).map(({ shot_number }) => Number(shot_number)),
  );
  let submittedClips = 0;
  for (const shot of selected) {
    const decision = decisionByShot.get(shot.shot_number);
    if (
      decision &&
      decision.action !== "regenerate_clip" &&
      decision.action !== "regenerate_storyboard_and_clip"
    ) {
      continue;
    }
    if (existingClips.has(shot.shot_number)) continue;
    if (submittedClips >= MAXIMUM_SUBMISSIONS_PER_PASS) break;
    const frame = effectiveFrameForShot(shot.shot_number);
    if (frame?.state !== "complete" || !frame.object_name) {
      throw new MvpStoryboardProductionError(
        "The accepted storyboard frame is unavailable.",
        "PRODUCTION_INPUT_MISSING",
        false,
      );
    }
    const { data: signed, error: signError } = await client.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(frame.object_name, 900);
    if (signError || !signed?.signedUrl) {
      throw new MvpStoryboardProductionError(
        "The accepted storyboard frame could not be signed.",
        "PRODUCTION_REFERENCE_UNAVAILABLE",
      );
    }
    const editorialShot = editorial[shot.shot_number - 1]!;
    const endFrame =
      editorialShot.storyboardCompositionMode === "two_state_start_end"
        ? effectiveEndFrameForShot(shot.shot_number)
        : undefined;
    if (
      editorialShot.storyboardCompositionMode === "two_state_start_end" &&
      (endFrame?.state !== "complete" || !endFrame.object_name)
    ) {
      throw new MvpStoryboardProductionError(
        "The accepted storyboard end frame is unavailable.",
        "PRODUCTION_INPUT_MISSING",
        false,
      );
    }
    const endSigned = endFrame?.object_name
      ? await client.storage
          .from(MEDIA_BUCKET)
          .createSignedUrl(endFrame.object_name, 900)
      : null;
    if (endSigned?.error || (endFrame && !endSigned?.data?.signedUrl)) {
      throw new MvpStoryboardProductionError(
        "The accepted storyboard end frame could not be signed.",
        "PRODUCTION_REFERENCE_UNAVAILABLE",
      );
    }
    const slot = slots[shot.shot_number - 1]!;
    const prompt = finalMotionPrompt(editorialShot.motionPromptBlueprint);
    const request = compileMvpVideoRequest({
      compositionMode: editorialShot.storyboardCompositionMode,
      expectedProviderDurationMs: slot.duration_ms,
      motionClass: shot.motion_class,
      prompt,
      retainedDurationMs: shot.end_ms - shot.start_ms,
      ...(endFrame && endSigned?.data?.signedUrl
        ? {
            storyboardEndFrameId: endFrame.id,
            storyboardEndUrl: endSigned.data.signedUrl,
          }
        : {}),
      storyboardFrameId: frame.id,
      storyboardUrl: signed.signedUrl,
    });
    const fallbackReference = (edgesByShot.get(shot.shot_number) ?? []).find(
      ({ asset_version_id }) => Boolean(asset_version_id),
    )?.asset_version_id;
    if (!fallbackReference) {
      throw new MvpStoryboardProductionError(
        "The locked shot has no durable source reference.",
        "PRODUCTION_REFERENCE_MISSING",
        false,
      );
    }
    const slotCost = costBySlotId.get(slot.id)!;
    const submitted = await dispatchFalMedia({
      attemptNumber: job.attempt_number,
      dispatchKey: `clip:${shot.shot_number}:motion`,
      endpoint: request.endpoint,
      episodeId: job.episode_id,
      expectedCostMicrousd: slotCost.expected,
      inputManifestSha256: sha256(
        postgresJsonbText({
          compositionMode: editorialShot.storyboardCompositionMode,
          endpoint: request.endpoint,
          fallbackReferenceAssetVersionId: fallbackReference,
          prompt,
          providerDurationMs: request.providerDurationMs,
          retainedDurationMs: shot.end_ms - shot.start_ms,
          shotNumber: shot.shot_number,
          storyboardEndFrameId: endFrame?.id ?? null,
          storyboardFrameId: frame.id,
        }),
      ),
      maximumCostMicrousd: slotCost.maximum,
      mediaKind: "clip",
      payload: request.payload,
      productionRunId: job.production_run_id,
      shotNumber: shot.shot_number,
      workspaceId: job.workspace_id,
    });
    const { error: insertError } = await client
      .from("mvp_production_clip_worker")
      .insert({
        attempt_number: job.attempt_number,
        end_ms: shot.end_ms,
        external_request_id: submitted.externalRequestId,
        model_key: request.endpoint,
        motion_class: shot.motion_class,
        production_run_id: job.production_run_id,
        prompt,
        provider_dispatch_id: submitted.providerDispatchId,
        reference_asset_version_id: fallbackReference,
        response_url: submitted.responseUrl,
        shot_number: shot.shot_number,
        start_ms: shot.start_ms,
        state: "submitted",
        status_url: submitted.statusUrl,
        storyboard_frame_id: frame.id,
        storyboard_end_frame_id: endFrame?.id ?? null,
        storyboard_end_source_attempt_number: endFrame?.attempt_number ?? null,
        storyboard_source_attempt_number: frame.attempt_number,
        workspace_id: job.workspace_id,
      });
    if (insertError) {
      throw new MvpStoryboardProductionError(
        "A video job was accepted but could not be recorded.",
        "PRODUCTION_LEDGER_FAILED",
        false,
      );
    }
    existingClips.add(shot.shot_number);
    submittedClips += 1;
  }
  selectionProgress = await recordReadyRepairSelections(job);
  const requiredClipShots = selected.filter((shot) => {
    const decision = decisionByShot.get(shot.shot_number);
    return (
      !decision ||
      decision.action === "regenerate_clip" ||
      decision.action === "regenerate_storyboard_and_clip"
    );
  });
  const allRequiredClipsSubmitted = requiredClipShots.every((shot) =>
    existingClips.has(shot.shot_number),
  );
  const readyForSound =
    job.attempt_number > 1 &&
    selectionProgress.total > 0 &&
    selectionProgress.selected === selectionProgress.total;
  return Object.freeze({
    complete: allRequiredClipsSubmitted || readyForSound,
    completedClips: selectionProgress.selected,
    completedStoryboards,
    readyForSound,
    totalClips: selected.length,
    totalStoryboards: selected.length,
  });
}

import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  compileElevenLabsSfx,
  ELEVENLABS_SFX_ENDPOINT,
  ELEVENLABS_SFX_MAX_AUDIO_BYTES,
  ELEVENLABS_SFX_MODEL_ID,
  ELEVENLABS_SFX_OUTPUT_FORMAT,
  ELEVENLABS_SFX_PROMPT_INFLUENCE,
  ElevenLabsSfxError,
  validateElevenLabsSfxResponse,
} from "@/server/elevenlabs-sfx";
import { loadEffectiveEddPayload } from "@/server/mvp-effective-production-assets";
import { postgresJsonbText } from "@/server/world-anchor-provider";

const MEDIA_BUCKET = "workspace-media";
const MAXIMUM_SHOTS = 80;

export type MvpSfxJob = Readonly<{
  attempt_number: number;
  plan_bundle_id: string;
  production_run_id: string;
  workspace_id: string;
}>;

type ShotTimingRow = Readonly<{
  end_ms: number;
  shot_number: number;
  start_ms: number;
}>;

type ClaimedSfxRow = Readonly<{
  attempt_number: number;
  cue_text: string;
  episode_id: string;
  id: string;
  lease_token: string;
  plan_bundle_id: string;
  production_run_id: string;
  provider_payload: Readonly<Record<string, unknown>>;
  requested_duration_ms: number;
  shot_number: number;
  trim_duration_ms: number;
  version: number;
  workspace_id: string;
}>;

export type ReusableMvpSfxRow = Readonly<{
  byte_length: number | null;
  content_sha256: string | null;
  cue_kind: "deliberate_silence" | "generated_effect";
  cue_sha256: string;
  cue_text: string;
  fade_in_ms: number;
  fade_out_ms: number;
  gain_db: number | string;
  id: string;
  model_contract_sha256: string | null;
  object_name: string | null;
  payload_sha256: string | null;
  prompt_sha256: string | null;
  requested_duration_ms: number | null;
  shot_number: number;
  start_offset_ms: number;
  state: string;
  trim_duration_ms: number;
}>;

export class MvpSfxProductionError extends Error {
  override readonly name = "MvpSfxProductionError";

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

function jsonHash(value: unknown): string {
  return sha256(postgresJsonbText(value));
}

function exactInteger(
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
    throw new MvpSfxProductionError(label, "SFX_PLAN_INVALID", false);
  }
  return value as number;
}

function exactCue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value !== value.trim() ||
    value.length > 1_200 ||
    value.includes("\0")
  ) {
    throw new MvpSfxProductionError(
      "A locked SFX cue is invalid.",
      "SFX_PLAN_INVALID",
      false,
    );
  }
  return value;
}

function eddShots(value: unknown, timings: readonly ShotTimingRow[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpSfxProductionError(
      "The locked SFX plan is unavailable.",
      "SFX_PLAN_INVALID",
      false,
    );
  }
  const shots = (value as Record<string, unknown>).shots;
  if (
    !Array.isArray(shots) ||
    shots.length < 1 ||
    shots.length > MAXIMUM_SHOTS ||
    shots.length !== timings.length
  ) {
    throw new MvpSfxProductionError(
      "The locked SFX plan does not match the shot timeline.",
      "SFX_PLAN_INVALID",
      false,
    );
  }
  return shots.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new MvpSfxProductionError(
        "A locked SFX decision is invalid.",
        "SFX_PLAN_INVALID",
        false,
      );
    }
    const shot = candidate as Record<string, unknown>;
    const timing = timings[index]!;
    const shotNumber = exactInteger(
      shot.shotNumber,
      "A locked SFX shot number is invalid.",
      1,
      shots.length,
    );
    if (
      shotNumber !== index + 1 ||
      timing.shot_number !== shotNumber ||
      timing.start_ms < 0 ||
      timing.end_ms <= timing.start_ms
    ) {
      throw new MvpSfxProductionError(
        "The locked SFX shot ordering is invalid.",
        "SFX_PLAN_INVALID",
        false,
      );
    }
    const cue = exactCue(shot.sfxCue);
    const durationMs = exactInteger(
      shot.sfxDurationMs,
      "A locked SFX duration is invalid.",
      0,
      5_000,
    );
    const startOffsetMs = exactInteger(
      shot.sfxStartOffsetMs,
      "A locked SFX offset is invalid.",
      0,
      14_999,
    );
    const gainDb = Number(shot.sfxGainDb);
    const silence = cue === "deliberate silence";
    if (
      !Number.isFinite(gainDb) ||
      gainDb < -30 ||
      gainDb > -9 ||
      (silence
        ? durationMs !== 0 || startOffsetMs !== 0
        : durationMs < 500 ||
          startOffsetMs + durationMs > timing.end_ms - timing.start_ms)
    ) {
      throw new MvpSfxProductionError(
        "A locked SFX mix decision is invalid.",
        "SFX_PLAN_INVALID",
        false,
      );
    }
    return Object.freeze({
      cue,
      durationMs,
      gainDb,
      shotNumber,
      silence,
      startOffsetMs,
    });
  });
}

const modelContract = Object.freeze({
  endpoint: ELEVENLABS_SFX_ENDPOINT,
  loop: false,
  modelId: ELEVENLABS_SFX_MODEL_ID,
  outputFormat: ELEVENLABS_SFX_OUTPUT_FORMAT,
  promptInfluence: ELEVENLABS_SFX_PROMPT_INFLUENCE,
  schemaVersion: "genie.elevenlabs-sfx.v1",
});

export function isReusableMvpSfxSource(
  row: ReusableMvpSfxRow | undefined,
  parameters: Readonly<Record<string, unknown>>,
): row is ReusableMvpSfxRow {
  return Boolean(
    row &&
    row.state === "complete" &&
    row.cue_kind === "generated_effect" &&
    row.object_name &&
    row.content_sha256 &&
    row.byte_length &&
    row.cue_text === parameters.p_cue_text &&
    row.cue_sha256 === parameters.p_cue_sha256 &&
    row.prompt_sha256 === parameters.p_prompt_sha256 &&
    row.payload_sha256 === parameters.p_payload_sha256 &&
    row.model_contract_sha256 === parameters.p_model_contract_sha256 &&
    row.requested_duration_ms === parameters.p_requested_duration_ms &&
    row.start_offset_ms === parameters.p_start_offset_ms &&
    row.trim_duration_ms === parameters.p_trim_duration_ms &&
    Number(row.gain_db) === Number(parameters.p_gain_db) &&
    row.fade_in_ms === parameters.p_fade_in_ms &&
    row.fade_out_ms === parameters.p_fade_out_ms,
  );
}

async function copyReusableSfx(
  client: ReturnType<typeof createAdminSupabaseClient>,
  source: ReusableMvpSfxRow,
  targetObjectName: string,
): Promise<void> {
  const { data, error } = await client.storage
    .from(MEDIA_BUCKET)
    .download(source.object_name!);
  const bytes = data ? Buffer.from(await data.arrayBuffer()) : null;
  if (
    error ||
    !bytes ||
    bytes.length !== source.byte_length ||
    sha256(bytes) !== source.content_sha256
  ) {
    throw new MvpSfxProductionError(
      "A reusable SFX source failed its recorded integrity evidence.",
      "SFX_REUSE_SOURCE_INVALID",
      false,
    );
  }
  const { error: uploadError } = await client.storage
    .from(MEDIA_BUCKET)
    .upload(targetObjectName, bytes, {
      contentType: "audio/mpeg",
      upsert: false,
    });
  if (uploadError?.message === "The resource already exists") {
    const { data: existing, error: existingError } = await client.storage
      .from(MEDIA_BUCKET)
      .download(targetObjectName);
    const existingBytes = existing ? Buffer.from(await existing.arrayBuffer()) : null;
    if (
      existingError ||
      !existingBytes ||
      sha256(existingBytes) !== source.content_sha256
    ) {
      throw new MvpSfxProductionError(
        "The reusable SFX target conflicts with existing media.",
        "SFX_STORAGE_COLLISION",
        false,
      );
    }
  } else if (uploadError) {
    throw new MvpSfxProductionError(
      "The reusable SFX could not be copied into the repair attempt.",
      "SFX_STORAGE_FAILED",
    );
  }
}

export async function materializeMvpSfxCues(job: MvpSfxJob): Promise<void> {
  const client = createAdminSupabaseClient();
  const [effectiveEdd, { data: timings, error: timingError }] = await Promise.all([
    loadEffectiveEddPayload(job),
    client
      .from("preflight_shots")
      .select("shot_number,start_ms,end_ms")
      .eq("workspace_id", job.workspace_id)
      .eq("plan_bundle_id", job.plan_bundle_id)
      .order("shot_number"),
  ]);
  if (timingError || !timings) {
    throw new MvpSfxProductionError(
      "The locked SFX inputs could not be loaded.",
      "SFX_PLAN_UNAVAILABLE",
    );
  }
  const shots = eddShots(effectiveEdd, timings as ShotTimingRow[]);
  const sourceSfxResult =
    job.attempt_number > 1
      ? await client
          .from("mvp_production_sfx_worker")
          .select(
            "id,shot_number,cue_kind,cue_text,cue_sha256,prompt_sha256,payload_sha256,model_contract_sha256,requested_duration_ms,start_offset_ms,trim_duration_ms,gain_db,fade_in_ms,fade_out_ms,state,object_name,content_sha256,byte_length",
          )
          .eq("workspace_id", job.workspace_id)
          .eq("production_run_id", job.production_run_id)
          .eq("attempt_number", job.attempt_number - 1)
          .order("shot_number")
      : { data: [], error: null };
  if (sourceSfxResult.error) {
    throw new MvpSfxProductionError(
      "The prior SFX ledger could not be inspected for exact reuse.",
      "SFX_PLAN_UNAVAILABLE",
    );
  }
  const sourceByShot = new Map(
    ((sourceSfxResult.data ?? []) as ReusableMvpSfxRow[]).map((row) => [
      row.shot_number,
      row,
    ]),
  );
  for (const shot of shots) {
    let parameters: Record<string, unknown>;
    if (shot.silence) {
      const compiled = compileElevenLabsSfx({
        kind: "deliberate_silence",
        shotNumber: shot.shotNumber,
        targetAssetId: job.plan_bundle_id,
      });
      parameters = {
        p_cue_kind: "deliberate_silence",
        p_cue_sha256: sha256(shot.cue),
        p_cue_text: shot.cue,
        p_fade_in_ms: 0,
        p_fade_out_ms: 0,
        p_gain_db: shot.gainDb,
        p_model_contract: null,
        p_model_contract_sha256: null,
        p_payload_sha256: null,
        p_prompt_sha256: null,
        p_prompt_text: null,
        p_provider_payload: null,
        p_requested_duration_ms: null,
        p_start_offset_ms: 0,
        p_trim_duration_ms: 0,
      };
      if (compiled.kind !== "silence") {
        throw new MvpSfxProductionError(
          "A deliberate-silence cue attempted provider spend.",
          "SFX_PLAN_INVALID",
          false,
        );
      }
    } else {
      const compiled = compileElevenLabsSfx({
        acousticDescription: shot.cue,
        durationMs: shot.durationMs,
        kind: "effect",
        shotNumber: shot.shotNumber,
        targetAssetId: job.plan_bundle_id,
      });
      if (compiled.kind !== "request") {
        throw new MvpSfxProductionError(
          "A generated SFX cue did not compile.",
          "SFX_PLAN_INVALID",
          false,
        );
      }
      const fadeMs = Math.min(75, Math.floor(shot.durationMs / 4));
      parameters = {
        p_cue_kind: "generated_effect",
        p_cue_sha256: sha256(shot.cue),
        p_cue_text: shot.cue,
        p_fade_in_ms: fadeMs,
        p_fade_out_ms: fadeMs,
        p_gain_db: shot.gainDb,
        p_model_contract: modelContract,
        p_model_contract_sha256: jsonHash(modelContract),
        p_payload_sha256: compiled.payloadSha256,
        p_prompt_sha256: compiled.promptSha256,
        p_prompt_text: compiled.body.text,
        p_provider_payload: compiled.body,
        p_requested_duration_ms: compiled.durationMs,
        p_start_offset_ms: shot.startOffsetMs,
        p_trim_duration_ms: shot.durationMs,
      };
    }
    const source = sourceByShot.get(shot.shotNumber);
    const reuse = isReusableMvpSfxSource(source, parameters) ? source : null;
    if (reuse) {
      await copyReusableSfx(
        client,
        reuse,
        `${job.workspace_id}/mvp-sfx/${job.production_run_id}/${job.attempt_number}/${shot.shotNumber}.mp3`,
      );
    }
    const { error } = await client.rpc("command_materialize_mvp_sfx_cue", {
      ...parameters,
      p_attempt_number: job.attempt_number,
      p_production_run_id: job.production_run_id,
      p_shot_number: shot.shotNumber,
      p_source_sfx_id: reuse?.id ?? null,
      p_total_sfx: shots.length,
      p_workspace_id: job.workspace_id,
    });
    if (error) {
      throw new MvpSfxProductionError(
        "A locked SFX cue could not be materialized.",
        "SFX_LEDGER_FAILED",
        false,
      );
    }
  }
}

function claimedRow(value: unknown): ClaimedSfxRow | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MvpSfxProductionError(
      "The SFX claim is malformed.",
      "SFX_LEDGER_FAILED",
      false,
    );
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.workspace_id !== "string" ||
    typeof row.episode_id !== "string" ||
    typeof row.production_run_id !== "string" ||
    typeof row.plan_bundle_id !== "string" ||
    typeof row.lease_token !== "string" ||
    typeof row.cue_text !== "string" ||
    !row.provider_payload ||
    typeof row.provider_payload !== "object" ||
    Array.isArray(row.provider_payload)
  ) {
    throw new MvpSfxProductionError(
      "The SFX claim is incomplete.",
      "SFX_LEDGER_FAILED",
      false,
    );
  }
  return {
    attempt_number: exactInteger(
      row.attempt_number,
      "The claimed SFX attempt is invalid.",
      1,
      20,
    ),
    cue_text: row.cue_text,
    episode_id: row.episode_id,
    id: row.id,
    lease_token: row.lease_token,
    plan_bundle_id: row.plan_bundle_id,
    production_run_id: row.production_run_id,
    provider_payload: row.provider_payload as Readonly<Record<string, unknown>>,
    requested_duration_ms: exactInteger(
      row.requested_duration_ms,
      "The claimed SFX duration is invalid.",
      500,
      30_000,
    ),
    shot_number: exactInteger(
      row.shot_number,
      "The claimed SFX shot is invalid.",
      1,
      MAXIMUM_SHOTS,
    ),
    trim_duration_ms: exactInteger(
      row.trim_duration_ms,
      "The claimed SFX trim is invalid.",
      500,
      5_000,
    ),
    version: exactInteger(
      row.version,
      "The claimed SFX version is invalid.",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    workspace_id: row.workspace_id,
  };
}

async function failClaim(
  claim: ClaimedSfxRow,
  input: Readonly<{
    code: string;
    message: string;
    providerResponseHash: string | null;
    providerUsageCount: number | null;
    stage: "media_validation" | "provider";
  }>,
): Promise<void> {
  await createAdminSupabaseClient().rpc("command_fail_mvp_sfx", {
    p_error_code: input.code,
    p_error_summary: input.message.slice(0, 500),
    p_expected_version: claim.version,
    p_failure_stage: input.stage,
    p_lease_token: claim.lease_token,
    p_provider_response_sha256: input.providerResponseHash,
    p_provider_usage_count: input.providerUsageCount,
    p_qc_evidence: null,
    p_qc_evidence_sha256: null,
    p_sfx_id: claim.id,
  });
}

export async function advanceNextMvpSfx(): Promise<boolean> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("command_claim_next_mvp_sfx", {
    p_lease_seconds: 300,
  });
  if (error) {
    throw new MvpSfxProductionError(
      "The next SFX cue could not be claimed.",
      "SFX_LEDGER_FAILED",
    );
  }
  const claim = claimedRow(data);
  if (!claim) return false;

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
  if (apiKey.length < 16) {
    await failClaim(claim, {
      code: "SFX_PROVIDER_UNAVAILABLE",
      message: "ElevenLabs sound generation is not configured.",
      providerResponseHash: null,
      providerUsageCount: null,
      stage: "provider",
    });
    throw new MvpSfxProductionError(
      "ElevenLabs sound generation is not configured.",
      "SFX_PROVIDER_UNAVAILABLE",
      false,
    );
  }

  let responseBytes: Buffer | null = null;
  let usageCount: number | null = null;
  try {
    const response = await fetch(ELEVENLABS_SFX_ENDPOINT, {
      body: JSON.stringify(claim.provider_payload),
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new MvpSfxProductionError(
        `ElevenLabs sound generation failed with ${response.status}.`,
        "SFX_PROVIDER_FAILED",
      );
    }
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (
      !Number.isSafeInteger(declared) ||
      declared < 0 ||
      declared > ELEVENLABS_SFX_MAX_AUDIO_BYTES
    ) {
      throw new MvpSfxProductionError(
        "The ElevenLabs SFX response exceeded its media bound.",
        "SFX_MEDIA_INVALID",
        false,
      );
    }
    responseBytes = Buffer.from(await response.arrayBuffer());
    const validated = validateElevenLabsSfxResponse({
      bytes: responseBytes,
      characterCostHeader: response.headers.get("character-cost"),
      contentType: response.headers.get("content-type"),
    });
    usageCount = validated.characterCost;
    if (validated.durationMs < claim.trim_duration_ms) {
      throw new MvpSfxProductionError(
        "The generated SFX is shorter than its locked edit window.",
        "SFX_MEDIA_TOO_SHORT",
        false,
      );
    }
    const exactObjectName = `${claim.workspace_id}/mvp-sfx/${claim.production_run_id}/${claim.attempt_number}/${claim.shot_number}.mp3`;
    const { error: uploadError } = await client.storage
      .from(MEDIA_BUCKET)
      .upload(exactObjectName, validated.bytes, {
        contentType: validated.contentType,
        upsert: false,
      });
    if (uploadError && uploadError.message !== "The resource already exists") {
      throw new MvpSfxProductionError(
        "The generated SFX could not be stored.",
        "SFX_STORAGE_FAILED",
      );
    }
    if (uploadError?.message === "The resource already exists") {
      const { data: existing, error: existingError } = await client.storage
        .from(MEDIA_BUCKET)
        .download(exactObjectName);
      const existingBytes = existing ? Buffer.from(await existing.arrayBuffer()) : null;
      if (
        existingError ||
        !existingBytes ||
        sha256(existingBytes) !== validated.audioSha256
      ) {
        throw new MvpSfxProductionError(
          "The existing SFX object does not match the claimed generation.",
          "SFX_STORAGE_COLLISION",
          false,
        );
      }
    }
    const qcEvidence = Object.freeze({
      byteLength: validated.byteLength,
      contentSha256: validated.audioSha256,
      measuredDurationMs: validated.durationMs,
      passed: true,
      schemaVersion: "genie.mvp-sfx-qc.v1",
    });
    const { error: completeError } = await client.rpc("command_complete_mvp_sfx", {
      p_byte_length: validated.byteLength,
      p_content_sha256: validated.audioSha256,
      p_expected_version: claim.version,
      p_generated_duration_ms: validated.durationMs,
      p_lease_token: claim.lease_token,
      p_object_name: exactObjectName,
      p_provider_response_sha256: validated.responseSha256,
      p_provider_usage_count: validated.characterCost,
      p_qc_evidence: qcEvidence,
      p_qc_evidence_sha256: jsonHash(qcEvidence),
      p_sfx_id: claim.id,
    });
    if (completeError) {
      throw new MvpSfxProductionError(
        "The completed SFX evidence could not be recorded.",
        "SFX_LEDGER_FAILED",
        false,
      );
    }
    return true;
  } catch (caught) {
    const safe =
      caught instanceof MvpSfxProductionError
        ? caught
        : caught instanceof ElevenLabsSfxError
          ? new MvpSfxProductionError(caught.message, "SFX_MEDIA_INVALID", false)
          : new MvpSfxProductionError(
              "Sound generation stopped after an unexpected provider error.",
              "SFX_PROVIDER_FAILED",
            );
    const responseHash = responseBytes ? sha256(responseBytes) : null;
    await failClaim(claim, {
      code: safe.safeCode,
      message: safe.message,
      providerResponseHash: responseHash,
      providerUsageCount: usageCount,
      stage: responseHash ? "media_validation" : "provider",
    }).catch(() => undefined);
    throw safe;
  }
}

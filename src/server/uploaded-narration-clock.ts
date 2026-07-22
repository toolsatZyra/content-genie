import "server-only";

import { createHash } from "node:crypto";

import type { PreflightControlExecutionInput } from "@/server/preflight-control-ledger";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  compileNarrationAlignmentSegments,
  NarrationIngestError,
} from "@/server/narration-ingest";
import type { SpeechAlignment } from "@/server/provider-adapters";
import { postgresJsonbText } from "@/server/world-anchor-provider";

export class UploadedNarrationClockError extends Error {
  override readonly name = "UploadedNarrationClockError";

  constructor(
    message: string,
    readonly safeClass = "uploaded_narration.clock_failed",
    readonly retryable = false,
  ) {
    super(message);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseAlignment(value: unknown): SpeechAlignment {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UploadedNarrationClockError(
      "Uploaded narration timing is malformed.",
      "uploaded_narration.alignment_invalid",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
      ["characterEndTimesSeconds", "characterStartTimesSeconds", "characters"]
        .sort()
        .join(",") ||
    !Array.isArray(record.characters) ||
    !Array.isArray(record.characterStartTimesSeconds) ||
    !Array.isArray(record.characterEndTimesSeconds) ||
    record.characters.length < 1 ||
    record.characters.length > 8_192 ||
    record.characterStartTimesSeconds.length !== record.characters.length ||
    record.characterEndTimesSeconds.length !== record.characters.length ||
    record.characters.some((character) => typeof character !== "string") ||
    record.characterStartTimesSeconds.some(
      (time) => typeof time !== "number" || !Number.isFinite(time),
    ) ||
    record.characterEndTimesSeconds.some(
      (time) => typeof time !== "number" || !Number.isFinite(time),
    )
  ) {
    throw new UploadedNarrationClockError(
      "Uploaded narration timing is invalid.",
      "uploaded_narration.alignment_invalid",
    );
  }
  return Object.freeze({
    characterEndTimesSeconds: Object.freeze([
      ...(record.characterEndTimesSeconds as number[]),
    ]),
    characters: Object.freeze([...(record.characters as string[])]),
    characterStartTimesSeconds: Object.freeze([
      ...(record.characterStartTimesSeconds as number[]),
    ]),
  });
}

export async function getNarrationSourceKind(input: {
  configurationCandidateId: string;
  workspaceId: string;
}): Promise<"elevenlabs_v3" | "uploaded_audio"> {
  const { data, error } = await createAdminSupabaseClient()
    .from("episode_configuration_candidates")
    .select("narration_source_kind")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.configurationCandidateId)
    .single();
  if (
    error ||
    !data ||
    (data.narration_source_kind !== "elevenlabs_v3" &&
      data.narration_source_kind !== "uploaded_audio")
  ) {
    throw new UploadedNarrationClockError(
      "Narration source authority is unavailable.",
      "uploaded_narration.source_unavailable",
      true,
    );
  }
  return data.narration_source_kind;
}

export async function getConfirmedUploadedNarrationAssetVersionId(input: {
  configurationCandidateId: string;
  workspaceId: string;
}): Promise<string> {
  const client = createAdminSupabaseClient();
  const { data: configuration, error: configurationError } = await client
    .from("episode_configuration_candidates")
    .select("narration_source_kind,selected_narration_upload_version_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.configurationCandidateId)
    .single();
  if (
    configurationError ||
    configuration?.narration_source_kind !== "uploaded_audio" ||
    typeof configuration.selected_narration_upload_version_id !== "string"
  ) {
    throw new UploadedNarrationClockError(
      "Confirmed uploaded narration authority is unavailable.",
      "uploaded_narration.authority_unavailable",
      true,
    );
  }
  const { data: upload, error: uploadError } = await client
    .from("episode_narration_upload_versions")
    .select("promoted_asset_version_id,state")
    .eq("workspace_id", input.workspaceId)
    .eq("id", configuration.selected_narration_upload_version_id)
    .single();
  if (
    uploadError ||
    upload?.state !== "confirmed" ||
    typeof upload.promoted_asset_version_id !== "string"
  ) {
    throw new UploadedNarrationClockError(
      "Confirmed uploaded narration asset is unavailable.",
      "uploaded_narration.asset_unavailable",
      true,
    );
  }
  return upload.promoted_asset_version_id;
}

export async function prepareUploadedNarrationMasterClock(input: {
  audioIdentitySelectionId: string;
  executionInput: PreflightControlExecutionInput;
}): Promise<
  Readonly<{
    durationMs: number;
    masterClockVersionId: string;
    narrationAssetVersionId: string;
    narrationUploadVersionId: string;
    segmentCount: number;
  }>
> {
  const client = createAdminSupabaseClient();
  const [configurationResult, selectionResult] = await Promise.all([
    client
      .from("episode_configuration_candidates")
      .select(
        "narration_source_kind,selected_narration_upload_version_id,script_revision_id",
      )
      .eq("workspace_id", input.executionInput.workspaceId)
      .eq("id", input.executionInput.configurationCandidateId)
      .single(),
    client
      .from("preflight_audio_identity_selections")
      .select("pronunciation_lexicon_version_id,state")
      .eq("workspace_id", input.executionInput.workspaceId)
      .eq("id", input.audioIdentitySelectionId)
      .single(),
  ]);
  const configuration = configurationResult.data;
  if (
    configurationResult.error ||
    selectionResult.error ||
    !configuration ||
    configuration.narration_source_kind !== "uploaded_audio" ||
    configuration.script_revision_id !== input.executionInput.scriptRevisionId ||
    typeof configuration.selected_narration_upload_version_id !== "string" ||
    selectionResult.data?.state !== "verified"
  ) {
    throw new UploadedNarrationClockError(
      "Confirmed uploaded narration authority is stale.",
      "uploaded_narration.authority_stale",
      true,
    );
  }
  const [uploadResult, pronunciationResult] = await Promise.all([
    client
      .from("episode_narration_upload_versions")
      .select(
        "alignment_json,duration_ms,promoted_asset_version_id,quality_evidence,quality_evidence_hash,state,transcription_text,transcription_sha256",
      )
      .eq("workspace_id", input.executionInput.workspaceId)
      .eq("id", configuration.selected_narration_upload_version_id)
      .single(),
    client
      .from("pronunciation_entries")
      .select("id,processing_start_scalar,processing_end_scalar,exact_text,devanagari")
      .eq("lexicon_version_id", selectionResult.data.pronunciation_lexicon_version_id)
      .eq("verification_status", "verified")
      .order("processing_start_scalar", { ascending: true }),
  ]);
  const upload = uploadResult.data;
  if (
    uploadResult.error ||
    pronunciationResult.error ||
    !upload ||
    upload.state !== "confirmed" ||
    typeof upload.duration_ms !== "number" ||
    upload.duration_ms < 60_000 ||
    upload.duration_ms > 120_000 ||
    typeof upload.promoted_asset_version_id !== "string" ||
    upload.transcription_text !== input.executionInput.rawScript ||
    upload.transcription_sha256 !== input.executionInput.rawScriptSha256 ||
    !upload.quality_evidence ||
    typeof upload.quality_evidence_hash !== "string"
  ) {
    throw new UploadedNarrationClockError(
      "Confirmed uploaded narration evidence is incomplete.",
      "uploaded_narration.evidence_incomplete",
      true,
    );
  }
  const alignment = parseAlignment(upload.alignment_json);
  let segments: readonly Record<string, unknown>[];
  try {
    segments = compileNarrationAlignmentSegments({
      alignment,
      durationMs: upload.duration_ms,
      exactText: input.executionInput.processingText,
      pronunciationEntries: (pronunciationResult.data ?? []).map((entry) => ({
        devanagari: entry.devanagari,
        exact_text: entry.exact_text,
        id: entry.id,
        processing_end_scalar: entry.processing_end_scalar,
        processing_start_scalar: entry.processing_start_scalar,
      })),
      timeScale: 1,
    });
  } catch (error) {
    if (error instanceof NarrationIngestError) {
      throw new UploadedNarrationClockError(
        error.message,
        error.safeClass,
        error.retryable,
      );
    }
    throw error;
  }
  const masterClockVersionId = deterministicUuid(
    `run:${input.executionInput.preflightRunId}:master-clock:v1`,
  );
  const performanceProfileHash = sha256(
    postgresJsonbText({
      durationPreserved: true,
      ownerConfirmed: true,
      profile: "genie.owner-uploaded-narration.v1",
      sourceKind: "uploaded_audio",
    }),
  );
  const { data: result, error } = await client.rpc(
    "command_record_uploaded_narration_master_clock",
    {
      p_alignment_hash: sha256(postgresJsonbText(segments)),
      p_audio_evidence: upload.quality_evidence,
      p_audio_evidence_hash: upload.quality_evidence_hash,
      p_audio_identity_selection_id: input.audioIdentitySelectionId,
      p_configuration_candidate_id: input.executionInput.configurationCandidateId,
      p_master_clock_id: masterClockVersionId,
      p_narration_upload_version_id: configuration.selected_narration_upload_version_id,
      p_performance_profile_hash: performanceProfileHash,
      p_preflight_run_id: input.executionInput.preflightRunId,
      p_processing_text_sha256: input.executionInput.processingTextSha256,
      p_segments: segments,
      p_workspace_id: input.executionInput.workspaceId,
    },
  );
  if (error || result !== masterClockVersionId) {
    throw new UploadedNarrationClockError(
      "Uploaded narration master clock could not be published.",
      "uploaded_narration.clock_ledger_rejected",
      true,
    );
  }
  return Object.freeze({
    durationMs: upload.duration_ms,
    masterClockVersionId,
    narrationAssetVersionId: upload.promoted_asset_version_id,
    narrationUploadVersionId: configuration.selected_narration_upload_version_id,
    segmentCount: segments.length,
  });
}

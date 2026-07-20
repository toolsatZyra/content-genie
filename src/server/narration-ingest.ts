import "server-only";

import { createHash } from "node:crypto";

import type { SpeechAlignment } from "@/server/provider-adapters";
import {
  NarrationAudioQcError,
  runIndependentNarrationAudioQc,
} from "@/server/narration-audio-qc";
import {
  SandboxMediaScannerError,
  scanAndReencodeNarrationAudio,
  type SandboxAudioScanResult,
} from "@/server/sandbox-media-scanner";
import { postgresJsonbText } from "@/server/world-anchor-provider";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export class NarrationIngestError extends Error {
  override readonly name = "NarrationIngestError";

  constructor(
    message: string,
    readonly safeClass = "narration.ingest_failed",
    readonly retryable = false,
  ) {
    super(message);
  }
}

type NarrationIngestClaim = Readonly<{
  alignment: SpeechAlignment;
  alignmentHash: string;
  audioIdentitySelectionId: string;
  jobId: string;
  leaseExpiresAt: string;
  leaseToken: string;
  objectName: string;
  preflightRunId: string;
  promotedAssetVersionId: string | null;
  providerRequestId: string;
  quarantineAssetVersionId: string;
  sourceAudioSha256: string;
  scanEvidence: NarrationScanEvidence | null;
  stageAttemptId: string;
  targetAssetId: string;
  workspaceId: string;
}>;

type NarrationScanEvidence = Readonly<{
  audibleSeamsDetected: false;
  clippingDetected: false;
  corruptFramesDetected: false;
  durationMs: number;
  sourceDurationMs: number;
  timeScale: number;
  unintendedSilenceDetected: false;
}>;

type PronunciationEntry = Readonly<{
  devanagari: string;
  exact_text: string;
  id: string;
  processing_end_scalar: number;
  processing_start_scalar: number;
}>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function deterministicUuid(seed: string): string {
  const bytes = Buffer.from(sha256(seed).slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) {
    throw new NarrationIngestError(
      "The narration ingest ledger rejected work.",
      "narration.ledger_rejected",
      ["40001", "P0002"].includes(error.code ?? ""),
    );
  }
  return data;
}

const claimKeys = [
  "alignment",
  "alignmentHash",
  "audioIdentitySelectionId",
  "jobId",
  "leaseExpiresAt",
  "leaseToken",
  "objectName",
  "preflightRunId",
  "promotedAssetVersionId",
  "providerRequestId",
  "quarantineAssetVersionId",
  "scanEvidence",
  "sourceAudioSha256",
  "stageAttemptId",
  "targetAssetId",
  "workspaceId",
] as const;

function parseAlignment(value: unknown): SpeechAlignment {
  if (
    !exactObject(value, [
      "characterEndTimesSeconds",
      "characters",
      "characterStartTimesSeconds",
    ])
  ) {
    throw new NarrationIngestError(
      "Narration alignment is malformed.",
      "narration.alignment_invalid",
    );
  }
  const alignment = value as Record<string, unknown>;
  const characters = alignment.characters;
  const starts = alignment.characterStartTimesSeconds;
  const ends = alignment.characterEndTimesSeconds;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    characters.length < 1 ||
    characters.length > 20_000 ||
    characters.length !== starts.length ||
    characters.length !== ends.length ||
    characters.some((item) => typeof item !== "string" || item.length < 1) ||
    starts.some((item) => typeof item !== "number" || !Number.isFinite(item)) ||
    ends.some((item) => typeof item !== "number" || !Number.isFinite(item))
  ) {
    throw new NarrationIngestError(
      "Narration alignment is invalid.",
      "narration.alignment_invalid",
    );
  }
  return Object.freeze({
    characterEndTimesSeconds: Object.freeze([...(ends as number[])]),
    characters: Object.freeze([...(characters as string[])]),
    characterStartTimesSeconds: Object.freeze([...(starts as number[])]),
  });
}

function parseScanEvidence(value: unknown): NarrationScanEvidence | null {
  if (value === null) return null;
  if (
    !exactObject(value, [
      "audibleSeamsDetected",
      "clippingDetected",
      "corruptFramesDetected",
      "durationMs",
      "sourceDurationMs",
      "timeScale",
      "unintendedSilenceDetected",
    ])
  ) {
    throw new NarrationIngestError(
      "Narration scan evidence is malformed.",
      "narration.scan_evidence_invalid",
    );
  }
  const evidence = value as Record<string, unknown>;
  if (
    evidence.audibleSeamsDetected !== false ||
    evidence.clippingDetected !== false ||
    evidence.corruptFramesDetected !== false ||
    evidence.unintendedSilenceDetected !== false ||
    !Number.isSafeInteger(evidence.durationMs) ||
    (evidence.durationMs as number) < 60_000 ||
    (evidence.durationMs as number) > 120_000 ||
    !Number.isSafeInteger(evidence.sourceDurationMs) ||
    (evidence.sourceDurationMs as number) < 1_000 ||
    typeof evidence.timeScale !== "number" ||
    !Number.isFinite(evidence.timeScale) ||
    evidence.timeScale < 0.8 ||
    evidence.timeScale > 1.25
  ) {
    throw new NarrationIngestError(
      "Narration scan evidence is invalid.",
      "narration.scan_evidence_invalid",
    );
  }
  return Object.freeze(evidence as NarrationScanEvidence);
}

function scanEvidence(scanned: SandboxAudioScanResult): NarrationScanEvidence {
  if (scanned.unintendedSilenceDetected) {
    throw new NarrationIngestError(
      "The generated narration contains an unintended long silence.",
      "narration.unintended_silence",
    );
  }
  return Object.freeze({
    audibleSeamsDetected: scanned.audibleSeamsDetected,
    clippingDetected: scanned.clippingDetected,
    corruptFramesDetected: scanned.corruptFramesDetected,
    durationMs: scanned.durationMs,
    sourceDurationMs: scanned.sourceDurationMs,
    timeScale: scanned.timeScale,
    unintendedSilenceDetected: false,
  });
}

async function claimNextNarration(): Promise<NarrationIngestClaim | null> {
  const value = await rpc("command_claim_narration_ingest", { p_job_id: null });
  if (value === null) return null;
  if (!exactObject(value, claimKeys)) {
    throw new NarrationIngestError(
      "Narration ingest claim is malformed.",
      "narration.claim_invalid",
    );
  }
  const record = value as Record<string, unknown>;
  const alignment = parseAlignment(record.alignment);
  const retainedScanEvidence = parseScanEvidence(record.scanEvidence);
  for (const key of [
    "alignmentHash",
    "audioIdentitySelectionId",
    "jobId",
    "leaseExpiresAt",
    "leaseToken",
    "objectName",
    "preflightRunId",
    "providerRequestId",
    "quarantineAssetVersionId",
    "sourceAudioSha256",
    "stageAttemptId",
    "targetAssetId",
    "workspaceId",
  ]) {
    if (typeof record[key] !== "string") {
      throw new NarrationIngestError(
        "Narration ingest claim is invalid.",
        "narration.claim_invalid",
      );
    }
  }
  if (
    record.promotedAssetVersionId !== null &&
    typeof record.promotedAssetVersionId !== "string"
  ) {
    throw new NarrationIngestError(
      "Narration promotion identity is invalid.",
      "narration.claim_invalid",
    );
  }
  return Object.freeze({
    ...(record as Omit<NarrationIngestClaim, "alignment" | "scanEvidence">),
    alignment,
    scanEvidence: retainedScanEvidence,
  });
}

async function recoverPromotedAsset(
  claim: NarrationIngestClaim,
): Promise<string | null> {
  if (claim.promotedAssetVersionId) return claim.promotedAssetVersionId;
  const client = createAdminSupabaseClient();
  const { data, error } = await client
    .from("asset_versions")
    .select("id")
    .eq("workspace_id", claim.workspaceId)
    .eq("source_quarantine_version_id", claim.quarantineAssetVersionId)
    .maybeSingle();
  if (error) {
    throw new NarrationIngestError(
      "Narration promotion reconciliation failed.",
      "narration.promotion_reconciliation_failed",
      true,
    );
  }
  if (!data) return null;
  return data.id;
}

async function promoteNarration(
  claim: NarrationIngestClaim,
  scanned: SandboxAudioScanResult,
): Promise<string> {
  const client = createAdminSupabaseClient();
  const policyValue = await rpc("get_active_media_ingest_policy", {});
  if (
    !exactObject(policyValue, ["id", "policy", "policyHash"]) ||
    typeof (policyValue as Record<string, unknown>).id !== "string"
  ) {
    throw new NarrationIngestError(
      "Narration media policy is malformed.",
      "narration.media_policy_invalid",
    );
  }
  const attestationId = await rpc("command_record_ingest_attestation", {
    p_decompressed_bytes: scanned.decompressedBytes,
    p_duration_ms: scanned.durationMs,
    p_frame_count: null,
    p_height: null,
    p_magic_mime: scanned.magicMime,
    p_malware_status: "clean",
    p_metadata_stripped: true,
    p_output_byte_length: scanned.outputBytes.length,
    p_output_sha256: scanned.outputSha256,
    p_parser_sandboxed: true,
    p_policy_version_id: (policyValue as Record<string, string>).id,
    p_probe_sha256: scanned.probeSha256,
    p_quarantine_asset_version_id: claim.quarantineAssetVersionId,
    p_reencoded_mime: scanned.magicMime,
    p_scan_engine: scanned.scanEngine,
    p_scan_version: scanned.scanVersion,
    p_scanner_task_id: `narration-output:${claim.jobId}`,
    p_scanner_task_version: scanned.scannerTaskVersion,
    p_width: null,
    p_workspace_id: claim.workspaceId,
  });
  if (typeof attestationId !== "string") {
    throw new NarrationIngestError(
      "Narration ingest attestation is malformed.",
      "narration.attestation_invalid",
    );
  }
  const assetVersionId = deterministicUuid(`job:${claim.jobId}:promoted-audio-v1`);
  const finalObjectName = `${claim.workspaceId}/narration/${claim.targetAssetId}/${assetVersionId}/source`;
  await client.storage.from("workspace-media").remove([finalObjectName]);
  const upload = await client.storage
    .from("workspace-media")
    .upload(finalObjectName, scanned.outputBytes, {
      cacheControl: "0",
      contentType: scanned.magicMime,
      upsert: false,
    });
  if (upload.error) {
    throw new NarrationIngestError(
      "Sanitized narration could not be stored.",
      "narration.storage_failed",
      true,
    );
  }
  try {
    const promotion = await rpc("command_promote_quarantine_asset", {
      p_asset_kind: "narration",
      p_asset_version_id: assetVersionId,
      p_final_object_name: finalObjectName,
      p_ingest_attestation_id: attestationId,
      p_quarantine_asset_version_id: claim.quarantineAssetVersionId,
      p_storage_version: upload.data.id ?? scanned.outputSha256,
      p_workspace_id: claim.workspaceId,
    });
    if (
      !promotion ||
      typeof promotion !== "object" ||
      (promotion as Record<string, unknown>).assetVersionId !== assetVersionId
    ) {
      throw new NarrationIngestError(
        "Narration promotion result is malformed.",
        "narration.promotion_invalid",
      );
    }
    await rpc("command_record_narration_asset_promotion", {
      p_job_id: claim.jobId,
      p_lease_token: claim.leaseToken,
      p_promoted_asset_version_id: assetVersionId,
      p_scan_evidence: scanEvidence(scanned),
    });
    return assetVersionId;
  } catch (error) {
    const { data } = await client
      .from("asset_versions")
      .select("id")
      .eq("id", assetVersionId)
      .maybeSingle();
    if (data?.id === assetVersionId) {
      await rpc("command_record_narration_asset_promotion", {
        p_job_id: claim.jobId,
        p_lease_token: claim.leaseToken,
        p_promoted_asset_version_id: assetVersionId,
        p_scan_evidence: scanEvidence(scanned),
      });
      return assetVersionId;
    }
    await client.storage.from("workspace-media").remove([finalObjectName]);
    throw error;
  }
}

function alignmentSegments(input: {
  alignment: SpeechAlignment;
  durationMs: number;
  exactText: string;
  pronunciationEntries: readonly PronunciationEntry[];
  timeScale: number;
}) {
  if (input.alignment.characters.join("") !== input.exactText) {
    throw new NarrationIngestError(
      "Provider alignment does not reproduce the exact processing text.",
      "narration.alignment_text_mismatch",
    );
  }
  const cumulativeUtf16Ends: number[] = [];
  let utf16Cursor = 0;
  for (const character of input.alignment.characters) {
    utf16Cursor += character.length;
    cumulativeUtf16Ends.push(utf16Cursor);
  }
  const segments: Array<Record<string, unknown>> = [];
  let scalarCursor = 0;
  let priorEndMs = 0;
  const tokens = [...input.exactText.matchAll(/\s+|\S+/gu)];
  if (tokens.length < 1 || tokens.length > 2_000) {
    throw new NarrationIngestError(
      "Narration token alignment exceeds its bounded segment contract.",
      "narration.alignment_segment_limit",
    );
  }
  for (const [tokenIndex, match] of tokens.entries()) {
    const exactText = match[0];
    const utf16Start = match.index;
    const utf16End = utf16Start + exactText.length;
    const startItem = cumulativeUtf16Ends.findIndex((end) => end > utf16Start);
    const endItem = cumulativeUtf16Ends.findIndex((end) => end >= utf16End);
    if (startItem < 0 || endItem < startItem) {
      throw new NarrationIngestError(
        "Narration token timing is incomplete.",
        "narration.alignment_timing_invalid",
      );
    }
    const startScalar = scalarCursor;
    const endScalar = startScalar + Array.from(exactText).length;
    scalarCursor = endScalar;
    const kind = /^\s+$/u.test(exactText) ? "authored_pause" : "spoken";
    const providerStartMs = Math.round(
      input.alignment.characterStartTimesSeconds[startItem]! * 1_000 * input.timeScale,
    );
    const providerEndMs = Math.round(
      input.alignment.characterEndTimesSeconds[endItem]! * 1_000 * input.timeScale,
    );
    const startMs = Math.min(input.durationMs, Math.max(priorEndMs, providerStartMs));
    let endMs = Math.min(input.durationMs, Math.max(startMs, providerEndMs));
    if (kind === "spoken" && endMs === startMs) {
      endMs = Math.min(input.durationMs, startMs + 1);
    }
    if (tokenIndex === tokens.length - 1) endMs = input.durationMs;
    if (kind === "spoken" && endMs <= startMs) {
      throw new NarrationIngestError(
        "Narration spoken timing collapsed during sanitization.",
        "narration.alignment_timing_invalid",
      );
    }
    segments.push({
      endMs,
      endScalar,
      exactText,
      kind,
      pronunciationEntryIds: input.pronunciationEntries
        .filter(
          (entry) =>
            entry.processing_start_scalar >= startScalar &&
            entry.processing_end_scalar <= endScalar,
        )
        .map((entry) => entry.id),
      startMs,
      startScalar,
    });
    priorEndMs = endMs;
  }
  if (scalarCursor !== Array.from(input.exactText).length) {
    throw new NarrationIngestError(
      "Narration scalar coverage is incomplete.",
      "narration.alignment_text_mismatch",
    );
  }
  return Object.freeze(segments);
}

async function assembleMasterClock(input: {
  assetVersionId: string;
  claim: NarrationIngestClaim;
  scanned: Pick<
    SandboxAudioScanResult,
    | "audibleSeamsDetected"
    | "clippingDetected"
    | "corruptFramesDetected"
    | "durationMs"
    | "timeScale"
    | "unintendedSilenceDetected"
  >;
}): Promise<string> {
  const client = createAdminSupabaseClient();
  const [runResult, selectionResult, probeResult, existingClockResult] =
    await Promise.all([
      client
        .from("preflight_runs")
        .select(
          "configuration_candidate_id,configuration:episode_configuration_candidates!inner(narrator_gender),script:script_revisions!inner(processing_text,processing_utf8_sha256)",
        )
        .eq("id", input.claim.preflightRunId)
        .single(),
      client
        .from("preflight_audio_identity_selections")
        .select("pronunciation_lexicon_version_id,state")
        .eq("id", input.claim.audioIdentitySelectionId)
        .single(),
      client
        .from("media_probes")
        .select("id,duration_ms")
        .eq("asset_version_id", input.assetVersionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single(),
      client
        .from("narration_master_clock_versions")
        .select("id,narration_asset_version_id")
        .eq("preflight_run_id", input.claim.preflightRunId)
        .maybeSingle(),
    ]);
  if (existingClockResult.data) {
    if (existingClockResult.data.narration_asset_version_id !== input.assetVersionId) {
      throw new NarrationIngestError(
        "Narration master-clock replay conflicts.",
        "narration.clock_replay_conflict",
      );
    }
    return existingClockResult.data.id;
  }
  const scriptRelation = runResult.data?.script as unknown;
  const script = Array.isArray(scriptRelation) ? scriptRelation[0] : scriptRelation;
  const configurationRelation = runResult.data?.configuration as unknown;
  const configuration = Array.isArray(configurationRelation)
    ? configurationRelation[0]
    : configurationRelation;
  if (
    runResult.error ||
    selectionResult.error ||
    probeResult.error ||
    existingClockResult.error ||
    !script ||
    typeof script !== "object" ||
    !configuration ||
    typeof configuration !== "object" ||
    !["female", "male"].includes(
      String((configuration as Record<string, unknown>).narrator_gender),
    ) ||
    typeof (script as Record<string, unknown>).processing_text !== "string" ||
    typeof (script as Record<string, unknown>).processing_utf8_sha256 !== "string" ||
    selectionResult.data?.state !== "verified" ||
    probeResult.data?.duration_ms !== input.scanned.durationMs
  ) {
    throw new NarrationIngestError(
      "Narration master-clock inputs are stale.",
      "narration.clock_input_stale",
    );
  }
  const scriptRecord = script as {
    processing_text: string;
    processing_utf8_sha256: string;
  };
  const exactText = scriptRecord.processing_text;
  const { data: pronunciationEntries, error: pronunciationError } = await client
    .from("pronunciation_entries")
    .select("id,processing_start_scalar,processing_end_scalar,exact_text,devanagari")
    .eq("lexicon_version_id", selectionResult.data.pronunciation_lexicon_version_id)
    .eq("verification_status", "verified")
    .order("processing_start_scalar", { ascending: true });
  if (pronunciationError || !pronunciationEntries?.length) {
    throw new NarrationIngestError(
      "Verified pronunciation evidence is unavailable.",
      "narration.pronunciation_evidence_missing",
    );
  }
  const segments = alignmentSegments({
    alignment: input.claim.alignment,
    durationMs: input.scanned.durationMs,
    exactText,
    pronunciationEntries,
    timeScale: input.scanned.timeScale,
  });
  if (input.scanned.unintendedSilenceDetected) {
    throw new NarrationIngestError(
      "The generated narration contains an unintended long silence.",
      "narration.unintended_silence",
    );
  }
  if (
    input.scanned.audibleSeamsDetected ||
    input.scanned.clippingDetected ||
    input.scanned.corruptFramesDetected ||
    input.scanned.unintendedSilenceDetected
  ) {
    throw new NarrationIngestError(
      "The generated narration failed deterministic audio inspection.",
      "narration.deterministic_audio_qc_failed",
    );
  }
  const audioEvidence = await runIndependentNarrationAudioQc({
    assetVersionId: input.assetVersionId,
    exactText,
    jobId: input.claim.jobId,
    leaseToken: input.claim.leaseToken,
    narratorGender: (configuration as { narrator_gender: "female" | "male" })
      .narrator_gender,
    probeVersionId: probeResult.data.id,
    processingTextSha256: scriptRecord.processing_utf8_sha256,
    pronunciationEntries: pronunciationEntries.map((entry) => ({
      devanagari: entry.devanagari,
      exactText: entry.exact_text,
    })),
    scanEvidence: {
      audibleSeamsDetected: false,
      clippingDetected: false,
      corruptFramesDetected: false,
      unintendedSilenceDetected: false,
    },
  });
  const masterClockId = deterministicUuid(
    `run:${input.claim.preflightRunId}:master-clock:v1`,
  );
  const value = await rpc("command_record_narration_master_clock", {
    p_alignment_hash: sha256(postgresJsonbText(segments)),
    p_audio_evidence: audioEvidence,
    p_audio_evidence_hash: sha256(postgresJsonbText(audioEvidence)),
    p_audio_identity_selection_id: input.claim.audioIdentitySelectionId,
    p_configuration_candidate_id: runResult.data!.configuration_candidate_id,
    p_master_clock_id: masterClockId,
    p_narration_asset_version_id: input.assetVersionId,
    p_performance_profile_hash: sha256(
      postgresJsonbText({
        alignmentHash: input.claim.alignmentHash,
        continuousSynthesis: true,
        loudnessTargetLufs: -16,
        peakTargetDbtp: -1.5,
        profile: "genie.expressive-hindi-delhi.v1",
      }),
    ),
    p_preflight_run_id: input.claim.preflightRunId,
    p_processing_text_sha256: scriptRecord.processing_utf8_sha256,
    p_segments: segments,
    p_workspace_id: input.claim.workspaceId,
  });
  if (value !== masterClockId) {
    throw new NarrationIngestError(
      "Narration master-clock publication is malformed.",
      "narration.clock_result_invalid",
    );
  }
  return masterClockId;
}

export async function processNextNarrationIngest(): Promise<Readonly<{
  completed: boolean;
  jobId: string;
  narrationPreflightRunId: string;
  workspaceId: string;
}> | null> {
  const claim = await claimNextNarration();
  if (!claim) return null;
  try {
    let assetVersionId = await recoverPromotedAsset(claim);
    let scanned: SandboxAudioScanResult;
    if (!assetVersionId || !claim.scanEvidence) {
      const client = createAdminSupabaseClient();
      const download = await client.storage
        .from("quarantine")
        .download(claim.objectName);
      if (download.error || !download.data) {
        throw new NarrationIngestError(
          "Narration quarantine bytes are unavailable.",
          "narration.quarantine_download_failed",
          true,
        );
      }
      const bytes = Buffer.from(await download.data.arrayBuffer());
      if (sha256(bytes) !== claim.sourceAudioSha256) {
        throw new NarrationIngestError(
          "Narration quarantine checksum changed.",
          "narration.quarantine_checksum_mismatch",
        );
      }
      scanned = await scanAndReencodeNarrationAudio({
        bytes,
        declaredMime: "audio/mpeg",
      });
      if (assetVersionId) {
        await rpc("command_record_narration_asset_promotion", {
          p_job_id: claim.jobId,
          p_lease_token: claim.leaseToken,
          p_promoted_asset_version_id: assetVersionId,
          p_scan_evidence: scanEvidence(scanned),
        });
      } else {
        assetVersionId = await promoteNarration(claim, scanned);
      }
    } else {
      scanned = {
        audibleSeamsDetected: claim.scanEvidence.audibleSeamsDetected,
        clippingDetected: claim.scanEvidence.clippingDetected,
        corruptFramesDetected: claim.scanEvidence.corruptFramesDetected,
        decompressedBytes: Math.ceil(
          (claim.scanEvidence.durationMs / 1_000) * 44_100 * 2,
        ),
        durationMs: claim.scanEvidence.durationMs,
        magicMime: "audio/mpeg",
        outputBytes: Buffer.alloc(0),
        outputSha256: "0".repeat(64),
        probeSha256: "0".repeat(64),
        scanEngine: "ClamAV.FFmpeg",
        scanVersion: "recovered",
        scannerTaskVersion: "genie-narration-audio-sandbox-v1",
        sourceDurationMs: claim.scanEvidence.sourceDurationMs,
        timeScale: claim.scanEvidence.timeScale,
        unintendedSilenceDetected: claim.scanEvidence.unintendedSilenceDetected,
      };
    }
    const masterClockVersionId = await assembleMasterClock({
      assetVersionId,
      claim,
      scanned,
    });
    await rpc("command_complete_narration_ingest", {
      p_job_id: claim.jobId,
      p_lease_token: claim.leaseToken,
      p_master_clock_version_id: masterClockVersionId,
      p_promoted_asset_version_id: assetVersionId,
    });
    return Object.freeze({
      completed: true,
      jobId: claim.jobId,
      narrationPreflightRunId: claim.preflightRunId,
      workspaceId: claim.workspaceId,
    });
  } catch (error) {
    const disposition =
      error instanceof SandboxMediaScannerError
        ? {
            retryable: error.safeClass.startsWith("scanner."),
            safeClass: error.safeClass,
          }
        : error instanceof NarrationAudioQcError
          ? { retryable: error.retryable, safeClass: error.safeClass }
          : error instanceof NarrationIngestError
            ? { retryable: error.retryable, safeClass: error.safeClass }
            : { retryable: true, safeClass: "narration.ingest_unknown" };
    await rpc("command_fail_narration_ingest", {
      p_job_id: claim.jobId,
      p_lease_token: claim.leaseToken,
      p_retryable: disposition.retryable,
      p_safe_failure_class: disposition.safeClass,
    });
    return Object.freeze({
      completed: false,
      jobId: claim.jobId,
      narrationPreflightRunId: claim.preflightRunId,
      workspaceId: claim.workspaceId,
    });
  }
}

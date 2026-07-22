import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NarrationUploadMime } from "@/domain/narration/narration-upload";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { SandboxAudioScanResult } from "@/server/sandbox-media-scanner";
import { SandboxMediaScannerError } from "@/server/sandbox-media-scanner";
import { scanAndReencodeNarrationAudio } from "@/server/sandbox-media-scanner";
import {
  compareUploadedNarrationToOriginalScript,
  transcribeSanitizedUploadedNarrationMp3,
  UploadedNarrationAlignmentError,
} from "@/server/uploaded-narration-alignment";
import { postgresJsonbText } from "@/server/world-anchor-provider";

const signedPreviewSeconds = 90;

export type NarrationUploadPreparation = Readonly<{
  quarantineAssetVersionId: string;
  stableAssetId: string;
  state: "confirmed" | "prepared" | "rejected" | "superseded" | "verified";
  stateVersion: number;
  uploadVersionId: string;
  versionNumber: number;
}>;

export type ProcessedNarrationUpload = Readonly<{
  assetVersionId: string;
  comparisonEvidence: Readonly<Record<string, unknown>>;
  durationMs: number;
  originalFilename: string;
  signedUrl: string;
  state: "confirmed" | "verified";
  transcriptionText: string;
  uploadVersionId: string;
}>;

type RetainedNarrationUploadAttestation = Readonly<{
  alignmentHash: string;
  alignmentJson: unknown;
  decompressedBytes: number;
  durationMs: number;
  id: string;
  policyVersionId: string;
  probeSha256: string;
  quarantineAssetVersionId: string;
  qualityEvidence: Readonly<Record<string, unknown>>;
  qualityEvidenceHash: string;
  sanitizedByteLength: number;
  sanitizedMime: string;
  sanitizedSha256: string;
  scanEngine: string;
  scanVersion: string;
  scriptComparisonHash: string;
  scriptComparisonJson: Readonly<Record<string, unknown>>;
  sourceByteLength: number;
  sourceMime: string;
  sourceSha256: string;
  transcriptionSha256: string;
  transcriptionText: string;
}>;

type NarrationUploadProcessingState = Readonly<{
  attestation: RetainedNarrationUploadAttestation | null;
  promotedAssetVersionId: string | null;
  state: string;
  stateVersion: number;
  uploadVersionId: string;
}>;

export class NarrationUploadProcessingError extends Error {
  override readonly name = "NarrationUploadProcessingError";

  constructor(
    message: string,
    readonly safeClass: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function deterministicNarrationUploadUuid(
  uploadVersionId: string,
  purpose: "asset-version" | "attestation",
): string {
  const digest = createHash("sha256")
    .update(`genie.owner-narration-upload.${purpose}.v1\0${uploadVersionId}`)
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function deterministicNarrationRecoveryScanUuid(
  uploadVersionId: string,
  attestationId: string,
  scanned: SandboxAudioScanResult,
): string {
  const digest = createHash("sha256")
    .update(
      postgresJsonbText({
        attestationId,
        decompressedBytes: scanned.decompressedBytes,
        durationMs: scanned.durationMs,
        probeSha256: scanned.probeSha256,
        sanitizedByteLength: scanned.outputBytes.length,
        sanitizedSha256: scanned.outputSha256,
        scanEngine: scanned.scanEngine,
        scanVersion: scanned.scanVersion,
        schemaVersion: "genie.owner-narration-recovery-scan.v1",
        uploadVersionId,
      }),
    )
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

export function parseNarrationUploadPreparation(
  value: unknown,
): NarrationUploadPreparation {
  const keys = [
    "ok",
    "quarantineAssetVersionId",
    "stableAssetId",
    "state",
    "stateVersion",
    "uploadVersionId",
    "versionNumber",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    record.ok !== true ||
    !["confirmed", "prepared", "rejected", "superseded", "verified"].includes(
      String(record.state),
    ) ||
    !Number.isSafeInteger(record.stateVersion) ||
    !Number.isSafeInteger(record.versionNumber) ||
    (record.stateVersion as number) < 1 ||
    (record.versionNumber as number) < 1 ||
    ["quarantineAssetVersionId", "stableAssetId", "uploadVersionId"].some(
      (key) => typeof record[key] !== "string",
    )
  ) {
    throw new NarrationUploadProcessingError(
      "The narration upload authority was malformed.",
      "narration_upload.authority_malformed",
    );
  }
  return value as NarrationUploadPreparation;
}

export function parseNarrationUploadProcessingState(
  value: unknown,
): NarrationUploadProcessingState {
  const keys = [
    "attestation",
    "promotedAssetVersionId",
    "state",
    "stateVersion",
    "uploadVersionId",
  ] as const;
  const record = value as Record<string, unknown>;
  if (
    !exactObject(value, keys) ||
    typeof record.uploadVersionId !== "string" ||
    typeof record.state !== "string" ||
    !Number.isSafeInteger(record.stateVersion) ||
    (record.stateVersion as number) < 1 ||
    (record.promotedAssetVersionId !== null &&
      typeof record.promotedAssetVersionId !== "string") ||
    (record.attestation !== null &&
      !isRetainedNarrationUploadAttestation(record.attestation))
  ) {
    throw new NarrationUploadProcessingError(
      "Narration upload recovery evidence was malformed.",
      "narration_upload.recovery_evidence_malformed",
      true,
    );
  }
  return value as NarrationUploadProcessingState;
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isRetainedNarrationUploadAttestation(
  value: unknown,
): value is RetainedNarrationUploadAttestation {
  const keys = [
    "alignmentHash",
    "alignmentJson",
    "decompressedBytes",
    "durationMs",
    "id",
    "policyVersionId",
    "probeSha256",
    "quarantineAssetVersionId",
    "qualityEvidence",
    "qualityEvidenceHash",
    "sanitizedByteLength",
    "sanitizedMime",
    "sanitizedSha256",
    "scanEngine",
    "scanVersion",
    "scriptComparisonHash",
    "scriptComparisonJson",
    "sourceByteLength",
    "sourceMime",
    "sourceSha256",
    "transcriptionSha256",
    "transcriptionText",
  ] as const;
  if (!exactObject(value, keys)) return false;
  const record = value as Record<string, unknown>;
  const integers = [
    record.decompressedBytes,
    record.durationMs,
    record.sanitizedByteLength,
    record.sourceByteLength,
  ];
  const hashes = [
    record.alignmentHash,
    record.probeSha256,
    record.qualityEvidenceHash,
    record.sanitizedSha256,
    record.scriptComparisonHash,
    record.sourceSha256,
    record.transcriptionSha256,
  ];
  if (
    [
      record.id,
      record.policyVersionId,
      record.quarantineAssetVersionId,
      record.scanEngine,
      record.scanVersion,
    ].some((entry) => typeof entry !== "string" || entry.length < 1) ||
    !["audio/mpeg", "audio/wav"].includes(String(record.sourceMime)) ||
    record.sanitizedMime !== "audio/mpeg" ||
    integers.some((entry) => !Number.isSafeInteger(entry) || Number(entry) < 1) ||
    hashes.some((entry) => !isSha256(entry)) ||
    record.alignmentJson === null ||
    typeof record.alignmentJson !== "object" ||
    !isJsonObject(record.scriptComparisonJson) ||
    !isJsonObject(record.qualityEvidence) ||
    typeof record.transcriptionText !== "string" ||
    record.transcriptionText.trim().length < 1
  ) {
    return false;
  }
  return (
    sha256(record.transcriptionText) === record.transcriptionSha256 &&
    sha256(postgresJsonbText(record.alignmentJson)) === record.alignmentHash &&
    sha256(postgresJsonbText(record.scriptComparisonJson)) ===
      record.scriptComparisonHash &&
    sha256(postgresJsonbText(record.qualityEvidence)) === record.qualityEvidenceHash
  );
}

export function assertRetainedNarrationUploadAttestationMatches(
  attestation: RetainedNarrationUploadAttestation,
  input: Readonly<{
    bytes: Buffer;
    declaredMime: NarrationUploadMime;
    preparation: Pick<NarrationUploadPreparation, "quarantineAssetVersionId">;
    sourceSha256: string;
  }>,
  scanned: SandboxAudioScanResult,
): Readonly<{ scannerIdentityDrift: boolean }> {
  if (
    sha256(input.bytes) !== input.sourceSha256 ||
    attestation.quarantineAssetVersionId !==
      input.preparation.quarantineAssetVersionId ||
    attestation.sourceMime !== input.declaredMime ||
    attestation.sourceSha256 !== input.sourceSha256 ||
    attestation.sourceByteLength !== input.bytes.length ||
    attestation.sanitizedMime !== "audio/mpeg" ||
    attestation.sanitizedSha256 !== scanned.outputSha256 ||
    attestation.sanitizedByteLength !== scanned.outputBytes.length ||
    attestation.decompressedBytes !== scanned.decompressedBytes ||
    attestation.durationMs !== scanned.durationMs ||
    attestation.probeSha256 !== scanned.probeSha256
  ) {
    throw new NarrationUploadProcessingError(
      "Retained narration evidence conflicted with the inspected upload.",
      "narration_upload.retained_attestation_conflict",
    );
  }
  return Object.freeze({
    scannerIdentityDrift:
      attestation.scanEngine !== scanned.scanEngine ||
      attestation.scanVersion !== scanned.scanVersion,
  });
}

async function rpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) {
    throw new NarrationUploadProcessingError(
      "The narration upload ledger rejected a processing step.",
      "narration_upload.ledger_rejected",
      true,
    );
  }
  return data;
}

async function uploadOrVerify(
  client: SupabaseClient,
  bucket: "quarantine" | "workspace-media",
  objectName: string,
  bytes: Buffer,
  contentType: string,
): Promise<string> {
  const expectedHash = sha256(bytes);
  const storage = client.storage.from(bucket);
  const upload = await storage.upload(objectName, bytes, {
    cacheControl: "0",
    contentType,
    metadata: { sha256: expectedHash },
    upsert: false,
  });
  if (!upload.error) {
    const receipt = await storage.info(objectName);
    if (
      receipt.error ||
      receipt.data.id !== upload.data.id ||
      typeof receipt.data.version !== "string" ||
      receipt.data.version.length < 1
    ) {
      throw new NarrationUploadProcessingError(
        "Narration storage receipt was invalid.",
        "narration_upload.storage_receipt_invalid",
        true,
      );
    }
    return receipt.data.version;
  }
  const existing = await storage.download(objectName);
  if (existing.error) {
    throw new NarrationUploadProcessingError(
      "Narration could not enter isolated storage.",
      "narration_upload.storage_failed",
      true,
    );
  }
  const existingBytes = Buffer.from(await existing.data.arrayBuffer());
  if (sha256(existingBytes) !== expectedHash) {
    throw new NarrationUploadProcessingError(
      "An immutable narration object conflicted with this upload.",
      "narration_upload.storage_conflict",
    );
  }
  const receipt = await storage.info(objectName);
  if (
    receipt.error ||
    typeof receipt.data.version !== "string" ||
    receipt.data.version.length < 1
  ) {
    throw new NarrationUploadProcessingError(
      "Existing narration storage receipt was invalid.",
      "narration_upload.storage_receipt_invalid",
      true,
    );
  }
  return receipt.data.version;
}

type UploadRow = Readonly<{
  alignment_hash: string | null;
  display_filename: string;
  duration_ms: number | null;
  original_script_revision_id: string;
  promoted_asset_version_id: string | null;
  script_comparison_json: Readonly<Record<string, unknown>> | null;
  state: string;
  transcription_text: string | null;
}>;

async function uploadRow(
  client: SupabaseClient,
  workspaceId: string,
  uploadVersionId: string,
): Promise<UploadRow> {
  const { data, error } = await client
    .from("episode_narration_upload_versions")
    .select(
      "alignment_hash,display_filename,duration_ms,original_script_revision_id,promoted_asset_version_id,script_comparison_json,state,transcription_text",
    )
    .eq("workspace_id", workspaceId)
    .eq("id", uploadVersionId)
    .single();
  if (error || !data) {
    throw new NarrationUploadProcessingError(
      "Narration upload evidence is unavailable.",
      "narration_upload.evidence_unavailable",
      true,
    );
  }
  return data as UploadRow;
}

async function signPromotedAudio(
  client: SupabaseClient,
  workspaceId: string,
  assetVersionId: string,
): Promise<string> {
  const { data: asset, error } = await client
    .from("asset_versions")
    .select("bucket_id,media_mime,object_name")
    .eq("workspace_id", workspaceId)
    .eq("id", assetVersionId)
    .single();
  if (
    error ||
    !asset ||
    asset.bucket_id !== "workspace-media" ||
    asset.media_mime !== "audio/mpeg"
  ) {
    throw new NarrationUploadProcessingError(
      "The promoted narration asset is unavailable.",
      "narration_upload.asset_unavailable",
      true,
    );
  }
  const signed = await client.storage
    .from("workspace-media")
    .createSignedUrl(asset.object_name, signedPreviewSeconds);
  if (signed.error || !signed.data.signedUrl) {
    throw new NarrationUploadProcessingError(
      "The narration preview is temporarily unavailable.",
      "narration_upload.preview_unavailable",
      true,
    );
  }
  return signed.data.signedUrl;
}

async function completedUpload(
  client: SupabaseClient,
  workspaceId: string,
  uploadVersionId: string,
): Promise<ProcessedNarrationUpload | null> {
  const row = await uploadRow(client, workspaceId, uploadVersionId);
  if (row.state !== "verified" && row.state !== "confirmed") return null;
  if (
    !row.promoted_asset_version_id ||
    !row.duration_ms ||
    !row.transcription_text ||
    !row.script_comparison_json
  ) {
    throw new NarrationUploadProcessingError(
      "The verified narration upload is incomplete.",
      "narration_upload.verified_evidence_incomplete",
    );
  }
  return Object.freeze({
    assetVersionId: row.promoted_asset_version_id,
    comparisonEvidence: row.script_comparison_json,
    durationMs: row.duration_ms,
    originalFilename: row.display_filename,
    signedUrl: await signPromotedAudio(
      client,
      workspaceId,
      row.promoted_asset_version_id,
    ),
    state: row.state,
    transcriptionText: row.transcription_text,
    uploadVersionId,
  });
}

function alignmentJson(alignment: {
  characterEndTimesSeconds: readonly number[];
  characters: readonly string[];
  characterStartTimesSeconds: readonly number[];
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    characterEndTimesSeconds: alignment.characterEndTimesSeconds,
    characters: alignment.characters,
    characterStartTimesSeconds: alignment.characterStartTimesSeconds,
  });
}

export async function processNarrationUpload(input: {
  bytes: Buffer;
  declaredMime: NarrationUploadMime;
  preparation: NarrationUploadPreparation;
  requestHash: string;
  sourceSha256: string;
  workspaceId: string;
}): Promise<ProcessedNarrationUpload> {
  const client = createAdminSupabaseClient();
  const replay = await completedUpload(
    client,
    input.workspaceId,
    input.preparation.uploadVersionId,
  );
  if (replay) return replay;

  const quarantineObjectName = `${input.workspaceId}/quarantine/${input.preparation.stableAssetId}/${input.preparation.quarantineAssetVersionId}/source`;
  let finalObjectName: string | null = null;
  let finalObjectCleanupAllowed = false;
  try {
    await uploadOrVerify(
      client,
      "quarantine",
      quarantineObjectName,
      input.bytes,
      input.declaredMime,
    );
    await rpc(client, "command_ensure_episode_narration_upload_quarantine", {
      p_object_name: quarantineObjectName,
      p_provenance_hash: sha256(
        postgresJsonbText({
          requestHash: input.requestHash,
          sourceSha256: input.sourceSha256,
          uploadVersionId: input.preparation.uploadVersionId,
          workspaceId: input.workspaceId,
        }),
      ),
      p_upload_version_id: input.preparation.uploadVersionId,
      p_workspace_id: input.workspaceId,
    });
    const scanned = await scanAndReencodeNarrationAudio({
      bytes: input.bytes,
      declaredMime: input.declaredMime,
      preserveDuration: true,
    });
    const processingState = parseNarrationUploadProcessingState(
      await rpc(client, "get_episode_narration_upload_processing_state", {
        p_upload_version_id: input.preparation.uploadVersionId,
        p_workspace_id: input.workspaceId,
      }),
    );
    if (processingState.uploadVersionId !== input.preparation.uploadVersionId) {
      throw new NarrationUploadProcessingError(
        "Narration upload recovery evidence did not bind this upload.",
        "narration_upload.recovery_evidence_conflict",
      );
    }
    let attestationId: string;
    if (processingState.attestation) {
      const recoveryValidation = assertRetainedNarrationUploadAttestationMatches(
        processingState.attestation,
        input,
        scanned,
      );
      attestationId = processingState.attestation.id;
      const recoveryScanId = deterministicNarrationRecoveryScanUuid(
        input.preparation.uploadVersionId,
        attestationId,
        scanned,
      );
      const recordedRecoveryScan = await rpc(
        client,
        "command_record_episode_narration_upload_recovery_scan",
        {
          p_attestation_id: attestationId,
          p_decompressed_bytes: scanned.decompressedBytes,
          p_duration_ms: scanned.durationMs,
          p_probe_sha256: scanned.probeSha256,
          p_recovery_scan_id: recoveryScanId,
          p_sanitized_byte_length: scanned.outputBytes.length,
          p_sanitized_sha256: scanned.outputSha256,
          p_scan_engine: scanned.scanEngine,
          p_scan_version: scanned.scanVersion,
          p_scanner_identity_drift: recoveryValidation.scannerIdentityDrift,
          p_source_byte_length: input.bytes.length,
          p_source_sha256: input.sourceSha256,
          p_upload_version_id: input.preparation.uploadVersionId,
          p_workspace_id: input.workspaceId,
        },
      );
      if (recordedRecoveryScan !== recoveryScanId) {
        throw new NarrationUploadProcessingError(
          "Narration recovery inspection evidence was malformed.",
          "narration_upload.recovery_scan_evidence_malformed",
          true,
        );
      }
    } else {
      const transcription = await transcribeSanitizedUploadedNarrationMp3(
        scanned.outputBytes,
      );
      if (
        Math.abs(transcription.durationSeconds * 1_000 - scanned.durationMs) > 1_500
      ) {
        throw new NarrationUploadProcessingError(
          "The narration transcript timing did not bind to the inspected audio.",
          "narration_upload.transcription_duration_mismatch",
        );
      }
      const current = await uploadRow(
        client,
        input.workspaceId,
        input.preparation.uploadVersionId,
      );
      const { data: originalScript, error: scriptError } = await client
        .from("script_revisions")
        .select("raw_text")
        .eq("workspace_id", input.workspaceId)
        .eq("id", current.original_script_revision_id)
        .single();
      if (scriptError || !originalScript?.raw_text) {
        throw new NarrationUploadProcessingError(
          "The earlier script is unavailable for advisory comparison.",
          "narration_upload.original_script_unavailable",
          true,
        );
      }
      const comparison = compareUploadedNarrationToOriginalScript(
        originalScript.raw_text,
        transcription.authoritativeText,
      );
      const alignment = alignmentJson(transcription.speechAlignment);
      const qualityEvidence = Object.freeze({
        durationPreserved: Math.abs(scanned.timeScale - 1) <= 0.01,
        ownerConfirmationRequired: true,
        scriptComparisonAdvisoryOnly: true,
        technicalInspection: {
          audibleSeamsDetected: scanned.audibleSeamsDetected,
          clippingDetected: scanned.clippingDetected,
          corruptFramesDetected: scanned.corruptFramesDetected,
          metadataStripped: true,
          parserSandboxed: true,
          longSilenceDetected: scanned.unintendedSilenceDetected,
        },
        transcription: {
          alignmentSha256: transcription.alignmentSha256,
          evidenceSha256: transcription.evidenceSha256,
          language: transcription.language,
          model: "whisper-1",
          providerResponseSha256: transcription.providerResponseSha256,
          wordCount: transcription.wordCount,
        },
        schemaVersion: "genie.owner-narration-quality-evidence.v1",
      });
      const policyValue = await rpc(
        client,
        "get_active_narration_upload_ingest_policy",
        {},
      );
      if (
        !exactObject(policyValue, ["id", "policy", "policyHash"]) ||
        typeof (policyValue as Record<string, unknown>).id !== "string"
      ) {
        throw new NarrationUploadProcessingError(
          "Narration ingest policy evidence is unavailable.",
          "narration_upload.policy_unavailable",
          true,
        );
      }
      const policyVersionId = (policyValue as Record<string, string>).id;
      attestationId = deterministicNarrationUploadUuid(
        input.preparation.uploadVersionId,
        "attestation",
      );
      const attested = await rpc(client, "command_attest_episode_narration_upload", {
        p_alignment_hash: sha256(postgresJsonbText(alignment)),
        p_alignment_json: alignment,
        p_attestation_id: attestationId,
        p_decompressed_bytes: scanned.decompressedBytes,
        p_duration_ms: scanned.durationMs,
        p_policy_version_id: policyVersionId,
        p_probe_sha256: scanned.probeSha256,
        p_quality_evidence: qualityEvidence,
        p_quality_evidence_hash: sha256(postgresJsonbText(qualityEvidence)),
        p_sanitized_byte_length: scanned.outputBytes.length,
        p_sanitized_sha256: scanned.outputSha256,
        p_scan_engine: scanned.scanEngine,
        p_scan_version: scanned.scanVersion,
        p_script_comparison_hash: sha256(postgresJsonbText(comparison)),
        p_script_comparison_json: comparison,
        p_transcription_sha256: transcription.transcriptSha256,
        p_transcription_text: transcription.authoritativeText,
        p_upload_version_id: input.preparation.uploadVersionId,
        p_workspace_id: input.workspaceId,
      });
      if (attested !== attestationId) {
        throw new NarrationUploadProcessingError(
          "Narration inspection attestation was malformed.",
          "narration_upload.attestation_malformed",
        );
      }
    }
    const assetVersionId = deterministicNarrationUploadUuid(
      input.preparation.uploadVersionId,
      "asset-version",
    );
    finalObjectName = `${input.workspaceId}/narration/${input.preparation.stableAssetId}/${assetVersionId}/source`;
    const storageVersion = await uploadOrVerify(
      client,
      "workspace-media",
      finalObjectName,
      scanned.outputBytes,
      "audio/mpeg",
    );
    finalObjectCleanupAllowed = true;
    // Once promotion starts, a lost response may hide a committed transaction.
    // Retain the deterministic object and let the next attempt reconcile it.
    finalObjectCleanupAllowed = false;
    const promotion = await rpc(client, "command_promote_episode_narration_upload", {
      p_asset_version_id: assetVersionId,
      p_attestation_id: attestationId,
      p_final_object_name: finalObjectName,
      p_storage_version: storageVersion,
      p_upload_version_id: input.preparation.uploadVersionId,
      p_workspace_id: input.workspaceId,
    });
    if (
      !promotion ||
      typeof promotion !== "object" ||
      typeof (promotion as Record<string, unknown>).assetVersionId !== "string"
    ) {
      throw new NarrationUploadProcessingError(
        "Narration promotion was malformed.",
        "narration_upload.promotion_malformed",
      );
    }
    const promotedAssetVersionId = (promotion as Record<string, string>).assetVersionId;
    if (promotedAssetVersionId !== assetVersionId && finalObjectName) {
      await client.storage.from("workspace-media").remove([finalObjectName]);
      finalObjectName = null;
    } else {
      finalObjectName = null;
    }
    const result = await completedUpload(
      client,
      input.workspaceId,
      input.preparation.uploadVersionId,
    );
    if (!result) {
      throw new NarrationUploadProcessingError(
        "Narration promotion did not publish verified evidence.",
        "narration_upload.promotion_incomplete",
        true,
      );
    }
    return result;
  } catch (error) {
    const disposition =
      error instanceof NarrationUploadProcessingError
        ? error
        : error instanceof SandboxMediaScannerError
          ? new NarrationUploadProcessingError(
              error.message,
              error.safeClass,
              error.safeClass.startsWith("scanner."),
            )
          : error instanceof UploadedNarrationAlignmentError
            ? new NarrationUploadProcessingError(
                error.message,
                error.safeClass,
                error.safeClass.includes("provider"),
              )
            : new NarrationUploadProcessingError(
                "The narration upload could not be prepared.",
                "narration_upload.processing_failed",
                true,
              );
    if (!disposition.retryable) {
      try {
        await client.rpc("command_reject_episode_narration_upload", {
          p_safe_failure_class: disposition.safeClass,
          p_upload_version_id: input.preparation.uploadVersionId,
          p_workspace_id: input.workspaceId,
        });
      } catch {
        // The original failure remains authoritative; rejection is best effort.
      }
    }
    if (finalObjectName && finalObjectCleanupAllowed) {
      await client.storage
        .from("workspace-media")
        .remove([finalObjectName])
        .catch(() => undefined);
    }
    throw disposition;
  }
}

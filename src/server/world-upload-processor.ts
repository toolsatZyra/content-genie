import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { scanAndReencodeWorldImage } from "@/server/sandbox-media-scanner";

export type WorldUploadPreparation = Readonly<{
  assetVersionId?: string;
  intakeId: string;
  quarantineAssetVersionId: string;
  regenerationRequestId: string;
  selectionVersion: number;
  stableAssetId: string;
  state: string;
  worldVersionId?: string;
}>;

export class WorldUploadProcessingError extends Error {
  override readonly name = "WorldUploadProcessingError";

  constructor(
    message: string,
    readonly safeClass: string,
  ) {
    super(message);
  }
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

export function parseWorldUploadPreparation(value: unknown): WorldUploadPreparation {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const state = record?.state;
  const expectedKeys =
    state === "promoted"
      ? [
          "assetVersionId",
          "intakeId",
          "ok",
          "quarantineAssetVersionId",
          "regenerationRequestId",
          "selectionVersion",
          "stableAssetId",
          "state",
          "worldVersionId",
        ]
      : [
          "intakeId",
          "ok",
          "quarantineAssetVersionId",
          "regenerationRequestId",
          "selectionVersion",
          "stableAssetId",
          "state",
        ];
  if (
    !exactObject(value, expectedKeys) ||
    record?.ok !== true ||
    !["registered", "scanning", "promoted"].includes(String(state)) ||
    !Number.isSafeInteger(record.selectionVersion) ||
    ![
      "intakeId",
      "quarantineAssetVersionId",
      "regenerationRequestId",
      "stableAssetId",
    ].every((key) => typeof record[key] === "string") ||
    (state === "promoted" &&
      (typeof record.assetVersionId !== "string" ||
        typeof record.worldVersionId !== "string"))
  ) {
    throw new WorldUploadProcessingError(
      "The World upload authority was malformed.",
      "upload.authority_malformed",
    );
  }
  return value as WorldUploadPreparation;
}

async function rpc(
  client: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, parameters);
  if (error) {
    throw new WorldUploadProcessingError(
      "The secure media ledger rejected a processing step.",
      "upload.ledger_rejected",
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
  const expectedHash = createHash("sha256").update(bytes).digest("hex");
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
      throw new WorldUploadProcessingError(
        "Media storage receipt was invalid.",
        "upload.storage_receipt_invalid",
      );
    }
    return receipt.data.version;
  }
  const existing = await storage.download(objectName);
  if (existing.error) {
    throw new WorldUploadProcessingError(
      "Media could not enter isolated storage.",
      "upload.storage_failed",
    );
  }
  const existingBytes = Buffer.from(await existing.data.arrayBuffer());
  if (createHash("sha256").update(existingBytes).digest("hex") !== expectedHash) {
    throw new WorldUploadProcessingError(
      "An immutable media object conflicted with this upload.",
      "upload.storage_conflict",
    );
  }
  const receipt = await storage.info(objectName);
  if (
    receipt.error ||
    typeof receipt.data.version !== "string" ||
    receipt.data.version.length < 1
  ) {
    throw new WorldUploadProcessingError(
      "Existing media storage receipt was invalid.",
      "upload.storage_receipt_invalid",
    );
  }
  return receipt.data.version;
}

async function failIntake(
  client: SupabaseClient,
  workspaceId: string,
  intakeId: string,
  safeClass: string,
): Promise<void> {
  await client.rpc("command_fail_world_upload", {
    p_intake_id: intakeId,
    p_safe_failure_class: safeClass,
    p_workspace_id: workspaceId,
  });
}

export async function processWorldUpload(input: {
  bytes: Buffer;
  declaredMime: "image/jpeg" | "image/png" | "image/webp";
  displayFilename: string;
  entityKind: "character" | "location";
  preparation: WorldUploadPreparation;
  requestHash: string;
  sourceSha256: string;
  workspaceId: string;
}): Promise<unknown> {
  const client = createAdminSupabaseClient();
  const quarantineObjectName = `${input.workspaceId}/quarantine/${input.preparation.stableAssetId}/${input.preparation.quarantineAssetVersionId}/source`;
  let finalObjectName: string | null = null;
  try {
    await uploadOrVerify(
      client,
      "quarantine",
      quarantineObjectName,
      input.bytes,
      input.declaredMime,
    );
    const provenanceHash = createHash("sha256")
      .update(
        JSON.stringify({
          intakeId: input.preparation.intakeId,
          requestHash: input.requestHash,
          sourceSha256: input.sourceSha256,
          stableAssetId: input.preparation.stableAssetId,
          workspaceId: input.workspaceId,
        }),
      )
      .digest("hex");
    await rpc(client, "command_ensure_world_upload_quarantine", {
      p_intake_id: input.preparation.intakeId,
      p_object_name: quarantineObjectName,
      p_provenance_hash: provenanceHash,
      p_workspace_id: input.workspaceId,
    });
    await rpc(client, "command_mark_world_upload_scanning", {
      p_intake_id: input.preparation.intakeId,
      p_workspace_id: input.workspaceId,
    });
    const policyValue = await rpc(client, "get_active_media_ingest_policy", {});
    if (
      !exactObject(policyValue, ["id", "policy", "policyHash"]) ||
      typeof (policyValue as Record<string, unknown>).id !== "string" ||
      typeof (policyValue as Record<string, unknown>).policyHash !== "string"
    ) {
      throw new WorldUploadProcessingError(
        "The media policy evidence is unavailable.",
        "upload.policy_unavailable",
      );
    }
    const policyVersionId = (policyValue as Record<string, string>).id;
    const scanned = await scanAndReencodeWorldImage({
      bytes: input.bytes,
      declaredMime: input.declaredMime,
    });
    const attestationId = await rpc(client, "command_ensure_world_upload_attestation", {
      p_decompressed_bytes: scanned.decompressedBytes,
      p_height: scanned.height,
      p_intake_id: input.preparation.intakeId,
      p_magic_mime: scanned.magicMime,
      p_output_byte_length: scanned.outputBytes.length,
      p_output_sha256: scanned.outputSha256,
      p_policy_version_id: policyVersionId,
      p_probe_sha256: scanned.probeSha256,
      p_scan_engine: scanned.scanEngine,
      p_scan_version: scanned.scanVersion,
      p_scanner_task_id: `world-upload:${input.preparation.intakeId}`,
      p_scanner_task_version: scanned.scannerTaskVersion,
      p_width: scanned.width,
      p_workspace_id: input.workspaceId,
    });
    if (typeof attestationId !== "string") {
      throw new WorldUploadProcessingError(
        "The media attestation was malformed.",
        "upload.attestation_malformed",
      );
    }
    const assetKind =
      input.entityKind === "character" ? "character_anchor" : "location_anchor";
    const assetVersionId = randomUUID();
    finalObjectName = `${input.workspaceId}/${assetKind}/${input.preparation.stableAssetId}/${assetVersionId}/source`;
    const storageVersion = await uploadOrVerify(
      client,
      "workspace-media",
      finalObjectName,
      scanned.outputBytes,
      scanned.magicMime,
    );
    const promotion = await rpc(client, "command_ensure_world_upload_promotion", {
      p_asset_kind: assetKind,
      p_asset_version_id: assetVersionId,
      p_final_object_name: finalObjectName,
      p_ingest_attestation_id: attestationId,
      p_intake_id: input.preparation.intakeId,
      p_storage_version: storageVersion,
      p_workspace_id: input.workspaceId,
    });
    if (
      !promotion ||
      typeof promotion !== "object" ||
      typeof (promotion as Record<string, unknown>).assetVersionId !== "string"
    ) {
      throw new WorldUploadProcessingError(
        "The promoted media record was malformed.",
        "upload.promotion_malformed",
      );
    }
    if (
      (promotion as Record<string, string>).assetVersionId !== assetVersionId &&
      finalObjectName
    ) {
      await client.storage.from("workspace-media").remove([finalObjectName]);
      finalObjectName = null;
    }
    return await rpc(client, "command_complete_world_upload", {
      p_asset_version_id: (promotion as Record<string, string>).assetVersionId,
      p_intake_id: input.preparation.intakeId,
      p_workspace_id: input.workspaceId,
      p_world_version_id: randomUUID(),
    });
  } catch (error) {
    const safeClass =
      error instanceof WorldUploadProcessingError
        ? error.safeClass
        : error &&
            typeof error === "object" &&
            "safeClass" in error &&
            typeof (error as { safeClass?: unknown }).safeClass === "string"
          ? (error as { safeClass: string }).safeClass
          : "upload.processing_failed";
    await failIntake(client, input.workspaceId, input.preparation.intakeId, safeClass);
    if (finalObjectName) {
      await client.storage
        .from("workspace-media")
        .remove([finalObjectName])
        .catch(() => undefined);
    }
    if (error instanceof WorldUploadProcessingError) throw error;
    throw new WorldUploadProcessingError(
      "The upload failed safely before becoming a World anchor.",
      safeClass,
    );
  }
}

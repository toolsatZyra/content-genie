import "server-only";

import { createHash } from "node:crypto";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { postgresJsonbText } from "@/server/world-anchor-provider";

export class WorldReferencePackError extends Error {
  override readonly name = "WorldReferencePackError";
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

type CharacterSelectionRow = Readonly<{
  aggregate_version: number | string;
  selected_version_id: string | null;
  state: string;
}>;

type CharacterVersionRow = Readonly<{
  anchor_asset_version_id: string;
  id: string;
  identity_manifest_hash: string;
  prompt_sha256: string;
}>;

type LocationSelectionRow = Readonly<{
  aggregate_version: number | string;
  selected_version_id: string | null;
  state: string;
}>;

type LocationVersionRow = Readonly<{
  empty_anchor_asset_version_id: string;
  id: string;
  location_manifest_hash: string;
  prompt_sha256: string;
  temple_evidence_set_hash: string | null;
}>;

export function buildAnchorDerivedIdentityPack(input: CharacterVersionRow) {
  const cropManifest = {
    cells: [
      {
        crop: { height: 1, width: 1, x: 0, y: 0 },
        role: "full_vertical_anchor",
        sourceAssetVersionId: input.anchor_asset_version_id,
      },
      {
        crop: { height: 0.36, width: 0.68, x: 0.16, y: 0.04 },
        role: "face_identity_crop",
        sourceAssetVersionId: input.anchor_asset_version_id,
      },
      {
        crop: { height: 0.58, width: 0.82, x: 0.09, y: 0.18 },
        role: "costume_and_attribute_crop",
        sourceAssetVersionId: input.anchor_asset_version_id,
      },
    ],
    identityPolicy: {
      compositeSheetIsRenderAnchor: false,
      primaryRenderAnchorAssetVersionId: input.anchor_asset_version_id,
      rationale:
        "A single clean identity anchor is used for generation; deterministic crops provide inspection views without multi-pose collage drift.",
    },
    schemaVersion: "genie.anchor-derived-character-sheet.v1",
    sourceCharacterManifestHash: input.identity_manifest_hash,
    sourcePromptSha256: input.prompt_sha256,
  } as const;
  const cropManifestHash = sha256(postgresJsonbText(cropManifest));
  const qcEvidenceHash = sha256(
    postgresJsonbText({
      cropManifestHash,
      evidence: "promoted_anchor_and_deterministic_crop_geometry",
      schemaVersion: "genie.character-sheet-qc-evidence.v1",
      sourceAssetVersionId: input.anchor_asset_version_id,
    }),
  );
  return Object.freeze({ cropManifest, cropManifestHash, qcEvidenceHash });
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, parameters);
  if (error) throw new WorldReferencePackError("World reference ledger rejected work.");
  return data;
}

export async function ensureWorldReferencePack(input: {
  configurationCandidateId: string;
  workspaceId: string;
}): Promise<Readonly<{ packId: string | null; ready: boolean; replayed: boolean }>> {
  const client = createAdminSupabaseClient();
  await rpc("command_reconcile_current_world_selections", {
    p_configuration_candidate_id: input.configurationCandidateId,
    p_workspace_id: input.workspaceId,
  });
  const [characterSelectionsResult, locationSelectionsResult] = await Promise.all([
    client
      .from("character_selections")
      .select("aggregate_version,selected_version_id,state")
      .eq("workspace_id", input.workspaceId)
      .eq("configuration_candidate_id", input.configurationCandidateId),
    client
      .from("location_selections")
      .select("aggregate_version,selected_version_id,state")
      .eq("workspace_id", input.workspaceId)
      .eq("configuration_candidate_id", input.configurationCandidateId),
  ]);
  if (characterSelectionsResult.error || locationSelectionsResult.error) {
    throw new WorldReferencePackError("World selections are unavailable.");
  }
  const characterSelections = (characterSelectionsResult.data ??
    []) as CharacterSelectionRow[];
  const locationSelections = (locationSelectionsResult.data ??
    []) as LocationSelectionRow[];
  const allSelections = [...characterSelections, ...locationSelections];
  if (
    allSelections.length < 1 ||
    allSelections.some(
      (selection) =>
        selection.state !== "accepted" || selection.selected_version_id === null,
    )
  ) {
    return Object.freeze({ packId: null, ready: false, replayed: false });
  }

  const characterVersionIds = characterSelections.map(
    (selection) => selection.selected_version_id!,
  );
  const locationVersionIds = locationSelections.map(
    (selection) => selection.selected_version_id!,
  );
  const [characterVersionsResult, locationVersionsResult] = await Promise.all([
    characterVersionIds.length
      ? client
          .from("character_versions")
          .select("id,anchor_asset_version_id,identity_manifest_hash,prompt_sha256")
          .eq("workspace_id", input.workspaceId)
          .in("id", characterVersionIds)
      : Promise.resolve({ data: [], error: null }),
    locationVersionIds.length
      ? client
          .from("location_versions")
          .select(
            "id,empty_anchor_asset_version_id,location_manifest_hash,prompt_sha256,temple_evidence_set_hash",
          )
          .eq("workspace_id", input.workspaceId)
          .in("id", locationVersionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (characterVersionsResult.error || locationVersionsResult.error) {
    throw new WorldReferencePackError("Accepted World versions are unavailable.");
  }
  const characterVersions = (characterVersionsResult.data ??
    []) as CharacterVersionRow[];
  const locationVersions = (locationVersionsResult.data ?? []) as LocationVersionRow[];
  if (
    characterVersions.length !== characterVersionIds.length ||
    locationVersions.length !== locationVersionIds.length
  ) {
    throw new WorldReferencePackError("Accepted World versions are incomplete.");
  }

  const existingSheetsResult = characterVersionIds.length
    ? await client
        .from("character_sheet_versions")
        .select("id,character_version_id,state")
        .eq("workspace_id", input.workspaceId)
        .in("character_version_id", characterVersionIds)
        .eq("state", "verified")
    : { data: [], error: null };
  if (existingSheetsResult.error) {
    throw new WorldReferencePackError("Character identity packs are unavailable.");
  }
  const sheetByCharacter = new Map(
    (existingSheetsResult.data ?? []).map((row) => [
      row.character_version_id as string,
      row.id as string,
    ]),
  );
  for (const version of [...characterVersions].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    if (sheetByCharacter.has(version.id)) continue;
    const sheet = buildAnchorDerivedIdentityPack(version);
    const sheetId = deterministicUuid(
      `character-sheet:${version.id}:${sheet.cropManifestHash}`,
    );
    await rpc("command_record_character_sheet", {
      p_character_version_id: version.id,
      p_crop_manifest: sheet.cropManifest,
      p_crop_manifest_hash: sheet.cropManifestHash,
      p_provider_profile: "genie.anchor-derived-identity-pack.v1",
      p_qc_evidence_hash: sheet.qcEvidenceHash,
      p_sheet_asset_version_id: version.anchor_asset_version_id,
      p_sheet_version_id: sheetId,
      p_state: "verified",
      p_workspace_id: input.workspaceId,
    });
    sheetByCharacter.set(version.id, sheetId);
  }

  const selectionSet = {
    characters: characterSelections
      .map((selection) => ({
        aggregateVersion: Number(selection.aggregate_version),
        versionId: selection.selected_version_id!,
      }))
      .sort((a, b) => a.versionId.localeCompare(b.versionId)),
    locations: locationSelections
      .map((selection) => ({
        aggregateVersion: Number(selection.aggregate_version),
        versionId: selection.selected_version_id!,
      }))
      .sort((a, b) => a.versionId.localeCompare(b.versionId)),
    schemaVersion: "genie.world-selection-set.v1",
  };
  const selectionSetHash = sha256(postgresJsonbText(selectionSet));
  const existingPackResult = await client
    .from("world_reference_pack_versions")
    .select("id,selection_set_hash,state")
    .eq("workspace_id", input.workspaceId)
    .eq("configuration_candidate_id", input.configurationCandidateId)
    .eq("selection_set_hash", selectionSetHash)
    .eq("state", "verified")
    .maybeSingle();
  if (existingPackResult.error) {
    throw new WorldReferencePackError("World reference pack lookup failed.");
  }
  if (existingPackResult.data) {
    return Object.freeze({
      packId: existingPackResult.data.id as string,
      ready: true,
      replayed: true,
    });
  }

  const manifest = {
    characters: characterVersions
      .map((version) => ({
        anchorAssetVersionId: version.anchor_asset_version_id,
        characterManifestHash: version.identity_manifest_hash,
        characterVersionId: version.id,
        identityPackVersionId: sheetByCharacter.get(version.id)!,
      }))
      .sort((a, b) => a.characterVersionId.localeCompare(b.characterVersionId)),
    configurationCandidateId: input.configurationCandidateId,
    locations: locationVersions
      .map((version) => ({
        anchorAssetVersionId: version.empty_anchor_asset_version_id,
        locationManifestHash: version.location_manifest_hash,
        locationVersionId: version.id,
        templeEvidenceSetHash: version.temple_evidence_set_hash,
      }))
      .sort((a, b) => a.locationVersionId.localeCompare(b.locationVersionId)),
    schemaVersion: "genie.world-reference-pack.v1",
    selectionSetHash,
  } as const;
  const manifestHash = sha256(postgresJsonbText(manifest));
  const qcEvidenceHash = sha256(
    postgresJsonbText({
      characterCount: characterVersions.length,
      locationCount: locationVersions.length,
      manifestHash,
      rule: "all_selections_accepted_all_identity_packs_verified",
      schemaVersion: "genie.world-reference-pack-qc.v1",
    }),
  );
  const packId = deterministicUuid(
    `world-reference-pack:${input.configurationCandidateId}:${manifestHash}`,
  );
  try {
    await rpc("command_record_world_reference_pack", {
      p_configuration_candidate_id: input.configurationCandidateId,
      p_manifest: manifest,
      p_manifest_hash: manifestHash,
      p_pack_version_id: packId,
      p_qc_evidence_hash: qcEvidenceHash,
      p_selection_set_hash: selectionSetHash,
      p_state: "verified",
      p_workspace_id: input.workspaceId,
    });
  } catch {
    const replay = await client
      .from("world_reference_pack_versions")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("configuration_candidate_id", input.configurationCandidateId)
      .eq("selection_set_hash", selectionSetHash)
      .eq("state", "verified")
      .maybeSingle();
    if (replay.error || !replay.data) {
      throw new WorldReferencePackError("World reference pack could not be finalized.");
    }
    return Object.freeze({
      packId: replay.data.id as string,
      ready: true,
      replayed: true,
    });
  }
  return Object.freeze({ packId, ready: true, replayed: false });
}

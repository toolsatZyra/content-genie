import "server-only";

import { createHash } from "node:crypto";

import { Sandbox } from "@vercel/sandbox";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  loadEffectiveClips,
  loadEffectiveStoryboards,
} from "@/server/mvp-effective-production-assets";

const MEDIA_BUCKET = "workspace-media";
const SANDBOX_ROOT = "/vercel/sandbox";
const PACKAGE_LIMIT_BYTES = 1_073_741_824;

type PackageRow = Readonly<{
  attempt_number: number;
  claim_token: string;
  episode_id: string;
  id: string;
  master_id: string;
  master_version: number;
  production_run_id: string;
  version: number;
  workspace_id: string;
}>;

type MasterRow = Readonly<{
  attempt_number: number;
  byte_length: number;
  content_sha256: string;
  duration_ms: number;
  id: string;
  object_name: string;
  state: "approved";
}>;

type ClipRow = Readonly<{
  byte_length: number;
  content_sha256: string;
  duration_ms: number;
  id: string;
  model_key: string;
  object_name: string;
  reference_asset_version_id: string;
  storyboard_end_frame_id: string | null;
  storyboard_frame_id: string | null;
  shot_number: number;
  start_ms: number;
  end_ms: number;
}>;

type AssetRow = Readonly<{
  content_sha256: string;
  id: string;
  media_mime: "image/jpeg" | "image/png" | "image/webp";
  object_name: string;
}>;

type StoryboardRow = AssetRow &
  Readonly<{
    endpoint: string;
    model_key: string;
  }>;

type EddShot = Readonly<{
  endMs: number;
  endScalar: number;
  exactNarration: string;
  shotNumber: number;
  startMs: number;
  startScalar: number;
}>;

type EddBinding = Readonly<{
  contentSha256: string;
  identityKind: "preflight_edd_version" | "repair_plan_version";
  payload: Readonly<Record<string, unknown>>;
  versionId: string;
}>;

type PackageFile = Readonly<{
  byteLength: number;
  path: string;
  sha256: string;
}>;

export class MvpEditPackageError extends Error {
  override readonly name = "MvpEditPackageError";

  constructor(
    message: string,
    readonly safeCode: string,
  ) {
    super(message);
  }
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function shotLabel(shotNumber: number): string {
  if (!Number.isInteger(shotNumber) || shotNumber < 1 || shotNumber > 80) {
    throw new MvpEditPackageError(
      "The approved edit contains an invalid shot number.",
      "EDIT_PACKAGE_INPUT_INVALID",
    );
  }
  return String(shotNumber).padStart(3, "0");
}

function imageExtension(mime: AssetRow["media_mime"]): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

function exactEddShots(binding: EddBinding, expectedShots: number): readonly EddShot[] {
  const value = binding.payload.shots;
  if (!Array.isArray(value) || value.length !== expectedShots) {
    throw new MvpEditPackageError(
      "The approved edit decision document is incomplete.",
      "EDIT_PACKAGE_EDD_INVALID",
    );
  }
  let expectedStartMs = 0;
  let expectedStartScalar = 0;
  return Object.freeze(
    value.map((candidate, index) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new MvpEditPackageError(
          "The approved edit decision document is malformed.",
          "EDIT_PACKAGE_EDD_INVALID",
        );
      }
      const row = candidate as Record<string, unknown>;
      const shot = {
        endMs: Number(row.endMs),
        endScalar: Number(row.endScalar),
        exactNarration: row.exactNarration,
        shotNumber: Number(row.shotNumber),
        startMs: Number(row.startMs),
        startScalar: Number(row.startScalar),
      };
      if (
        shot.shotNumber !== index + 1 ||
        !Number.isSafeInteger(shot.startMs) ||
        !Number.isSafeInteger(shot.endMs) ||
        !Number.isSafeInteger(shot.startScalar) ||
        !Number.isSafeInteger(shot.endScalar) ||
        shot.startMs !== expectedStartMs ||
        shot.startScalar !== expectedStartScalar ||
        shot.endMs <= shot.startMs ||
        shot.endScalar <= shot.startScalar ||
        typeof shot.exactNarration !== "string" ||
        shot.exactNarration.length < 1
      ) {
        throw new MvpEditPackageError(
          "The approved edit decision document has invalid shot windows.",
          "EDIT_PACKAGE_EDD_INVALID",
        );
      }
      expectedStartMs = shot.endMs;
      expectedStartScalar = shot.endScalar;
      return Object.freeze(shot as EddShot);
    }),
  );
}

async function loadEddBinding(input: {
  activeRepairRequestId: string | null;
  attemptNumber: number;
  planBundleId: string;
  workspaceId: string;
}): Promise<EddBinding> {
  const client = createAdminSupabaseClient();
  if (input.attemptNumber > 1) {
    if (!input.activeRepairRequestId) {
      throw new MvpEditPackageError(
        "The approved repair decision document binding is unavailable.",
        "EDIT_PACKAGE_EDD_UNAVAILABLE",
      );
    }
    const { data: request, error: requestError } = await client
      .from("mvp_repair_request_worker")
      .select("active_plan_version_id,target_attempt_number")
      .eq("id", input.activeRepairRequestId)
      .single();
    if (
      requestError ||
      !request?.active_plan_version_id ||
      Number(request.target_attempt_number) !== input.attemptNumber
    ) {
      throw new MvpEditPackageError(
        "The approved repair decision document binding is unavailable.",
        "EDIT_PACKAGE_EDD_UNAVAILABLE",
      );
    }
    const { data: plan, error: planError } = await client
      .from("mvp_repair_plan_version_worker")
      .select("repaired_edd_payload,repaired_edd_content_sha256")
      .eq("id", request.active_plan_version_id)
      .single();
    if (
      planError ||
      !plan?.repaired_edd_payload ||
      typeof plan.repaired_edd_content_sha256 !== "string"
    ) {
      throw new MvpEditPackageError(
        "The approved repair decision document is unavailable.",
        "EDIT_PACKAGE_EDD_UNAVAILABLE",
      );
    }
    return Object.freeze({
      contentSha256: plan.repaired_edd_content_sha256,
      identityKind: "repair_plan_version" as const,
      payload: plan.repaired_edd_payload as Record<string, unknown>,
      versionId: request.active_plan_version_id,
    });
  }
  const { data: bundle, error: bundleError } = await client
    .from("preflight_plan_bundles")
    .select("edd_version_id")
    .eq("workspace_id", input.workspaceId)
    .eq("id", input.planBundleId)
    .single();
  if (bundleError || !bundle?.edd_version_id) {
    throw new MvpEditPackageError(
      "The approved edit decision document binding is unavailable.",
      "EDIT_PACKAGE_EDD_UNAVAILABLE",
    );
  }
  const { data: edd, error: eddError } = await client
    .from("preflight_plan_component_versions")
    .select("payload,content_hash")
    .eq("workspace_id", input.workspaceId)
    .eq("id", bundle.edd_version_id)
    .eq("component_kind", "edd")
    .single();
  if (eddError || !edd?.payload || typeof edd.content_hash !== "string") {
    throw new MvpEditPackageError(
      "The approved edit decision document is unavailable.",
      "EDIT_PACKAGE_EDD_UNAVAILABLE",
    );
  }
  return Object.freeze({
    contentSha256: edd.content_hash,
    identityKind: "preflight_edd_version" as const,
    payload: edd.payload as Record<string, unknown>,
    versionId: bundle.edd_version_id,
  });
}

async function sandboxCommand(
  sandbox: Sandbox,
  command: string,
  args: readonly string[],
  timeoutMs = 60_000,
): Promise<string> {
  const result = await sandbox.runCommand(command, [...args], { timeoutMs });
  if (result.exitCode !== 0) {
    throw new MvpEditPackageError(
      "The approved media package could not be assembled.",
      "EDIT_PACKAGE_BUILD_FAILED",
    );
  }
  return result.stdout();
}

async function storageBytes(objectName: string): Promise<Buffer> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.storage.from(MEDIA_BUCKET).download(objectName);
  if (error || !data) {
    throw new MvpEditPackageError(
      "An approved media asset could not be opened.",
      "EDIT_PACKAGE_ASSET_UNAVAILABLE",
    );
  }
  return Buffer.from(await data.arrayBuffer());
}

async function writeVerifiedFile(
  sandbox: Sandbox,
  objectName: string,
  expectedSha256: string,
  packagePath: string,
): Promise<PackageFile> {
  const bytes = await storageBytes(objectName);
  const digest = sha256(bytes);
  if (digest !== expectedSha256) {
    throw new MvpEditPackageError(
      "An approved media asset failed its integrity check.",
      "EDIT_PACKAGE_ASSET_MISMATCH",
    );
  }
  await sandbox.writeFiles([
    { content: bytes, path: `${SANDBOX_ROOT}/${packagePath}` },
  ]);
  return { byteLength: bytes.byteLength, path: packagePath, sha256: digest };
}

const ZIP_SCRIPT = String.raw`
import { readFile, stat, writeFile } from "node:fs/promises";

const root = "/vercel/sandbox";
const paths = JSON.parse(await readFile(root + "/zip-files.json", "utf8"));
const table = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }

const local = [];
const central = [];
let offset = 0;
for (const relative of paths) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(relative) || relative.includes("..")) throw new Error("unsafe path");
  const info = await stat(root + "/" + relative);
  if (!info.isFile()) throw new Error("not a file");
  const data = await readFile(root + "/" + relative);
  const name = Buffer.from(relative, "utf8");
  const crc = crc32(data);
  const header = Buffer.concat([
    Buffer.from([0x50,0x4b,0x03,0x04]), u16(20), u16(0x0800), u16(0),
    u16(0), u16(0x0021), u32(crc), u32(data.length), u32(data.length),
    u16(name.length), u16(0), name,
  ]);
  local.push(header, data);
  central.push(Buffer.concat([
    Buffer.from([0x50,0x4b,0x01,0x02]), u16(20), u16(20), u16(0x0800), u16(0),
    u16(0), u16(0x0021), u32(crc), u32(data.length), u32(data.length),
    u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
  ]));
  offset += header.length + data.length;
}
const centralBytes = Buffer.concat(central);
const end = Buffer.concat([
  Buffer.from([0x50,0x4b,0x05,0x06]), u16(0), u16(0), u16(paths.length),
  u16(paths.length), u32(centralBytes.length), u32(offset), u16(0),
]);
await writeFile(root + "/approved-assets.zip", Buffer.concat([...local, centralBytes, end]));
`;

async function buildPackage(packageRow: PackageRow): Promise<{
  byteLength: number;
  contentSha256: string;
  objectName: string;
}> {
  const client = createAdminSupabaseClient();
  const [masterResult, jobResult] = await Promise.all([
    client
      .from("mvp_episode_masters")
      .select(
        "id,state,attempt_number,object_name,content_sha256,byte_length,duration_ms",
      )
      .eq("workspace_id", packageRow.workspace_id)
      .eq("id", packageRow.master_id)
      .single(),
    client
      .from("mvp_production_jobs")
      .select("plan_bundle_id,active_repair_request_id")
      .eq("workspace_id", packageRow.workspace_id)
      .eq("production_run_id", packageRow.production_run_id)
      .eq("attempt_number", packageRow.attempt_number)
      .single(),
  ]);
  if (masterResult.error || jobResult.error || !masterResult.data || !jobResult.data) {
    throw new MvpEditPackageError(
      "The approved edit ledger could not be loaded.",
      "EDIT_PACKAGE_LEDGER_UNAVAILABLE",
    );
  }
  const master = masterResult.data as MasterRow;
  const effectiveJob = {
    attempt_number: packageRow.attempt_number,
    plan_bundle_id: jobResult.data.plan_bundle_id,
    production_run_id: packageRow.production_run_id,
    workspace_id: packageRow.workspace_id,
  };
  const [effectiveClips, effectiveStoryboards, eddBinding] = await Promise.all([
    loadEffectiveClips(effectiveJob),
    loadEffectiveStoryboards(effectiveJob),
    loadEddBinding({
      activeRepairRequestId: jobResult.data.active_repair_request_id,
      attemptNumber: packageRow.attempt_number,
      planBundleId: jobResult.data.plan_bundle_id,
      workspaceId: packageRow.workspace_id,
    }),
  ]);
  const clips = effectiveClips as readonly ClipRow[];
  const eddShots = exactEddShots(eddBinding, clips.length);
  if (
    master.state !== "approved" ||
    master.attempt_number !== packageRow.attempt_number ||
    clips.length < 1 ||
    clips.some(
      (clip, index) =>
        clip.shot_number !== index + 1 ||
        !clip.object_name ||
        !clip.content_sha256 ||
        !clip.byte_length ||
        !clip.duration_ms,
    )
  ) {
    throw new MvpEditPackageError(
      "The approved edit ledger is incomplete.",
      "EDIT_PACKAGE_LEDGER_INCOMPLETE",
    );
  }

  const legacyAssetIds = [
    ...new Set(
      clips
        .filter((clip) => clip.storyboard_frame_id === null)
        .map((clip) => clip.reference_asset_version_id),
    ),
  ];
  const assetResult = await (legacyAssetIds.length > 0
    ? client
        .from("asset_versions")
        .select("id,object_name,content_sha256,media_mime")
        .eq("workspace_id", packageRow.workspace_id)
        .in("id", legacyAssetIds)
    : Promise.resolve({ data: [], error: null }));
  if (
    assetResult.error ||
    !assetResult.data ||
    assetResult.data.length !== legacyAssetIds.length ||
    effectiveStoryboards.length !== clips.length ||
    effectiveStoryboards.some(
      (selection, index) =>
        clips[index]!.storyboard_frame_id !== null &&
        (!selection.primary ||
          !selection.primary.object_name ||
          !selection.primary.content_sha256 ||
          !selection.primary.media_mime ||
          (clips[index]!.storyboard_end_frame_id !== null &&
            (!selection.end ||
              !selection.end.object_name ||
              !selection.end.content_sha256 ||
              !selection.end.media_mime))),
    )
  ) {
    throw new MvpEditPackageError(
      "A storyboard source used by the approved edit is unavailable.",
      "EDIT_PACKAGE_STORYBOARD_UNAVAILABLE",
    );
  }
  const legacyAssetById = new Map(
    (assetResult.data as readonly AssetRow[]).map((asset) => [asset.id, asset]),
  );
  const sourcesForClip = (
    clip: ClipRow,
  ): readonly Readonly<{
    asset: StoryboardRow | AssetRow;
    role: "single" | "start" | "end";
  }>[] => {
    if (!clip.storyboard_frame_id) {
      const asset = legacyAssetById.get(clip.reference_asset_version_id);
      return asset ? [{ asset, role: "single" }] : [];
    }
    const selection = effectiveStoryboards[clip.shot_number - 1]!;
    if (!selection.primary) return [];
    return [
      {
        asset: selection.primary as StoryboardRow,
        role: selection.end ? "start" : "single",
      },
      ...(selection.end
        ? [{ asset: selection.end as StoryboardRow, role: "end" as const }]
        : []),
    ];
  };

  let sandbox: (Sandbox & AsyncDisposable) | undefined;
  try {
    sandbox = await Sandbox.create({
      networkPolicy: "deny-all",
      persistent: false,
      resources: { vcpus: 2 },
      runtime: "node24",
      tags: { purpose: "genie-mvp-edit-package" },
      timeout: 300_000,
    });
    await sandboxCommand(sandbox, "mkdir", [
      "-p",
      `${SANDBOX_ROOT}/storyboard-images`,
      `${SANDBOX_ROOT}/video-clips`,
    ]);

    const files: PackageFile[] = [];
    files.push(
      await writeVerifiedFile(
        sandbox,
        master.object_name,
        master.content_sha256,
        "approved-master.mp4",
      ),
    );
    for (const clip of clips) {
      const label = shotLabel(clip.shot_number);
      files.push(
        await writeVerifiedFile(
          sandbox,
          clip.object_name,
          clip.content_sha256,
          `video-clips/shot-${label}.mp4`,
        ),
      );
      const sources = sourcesForClip(clip);
      if (sources.length < 1) {
        throw new MvpEditPackageError(
          "A storyboard source used by the approved edit is unavailable.",
          "EDIT_PACKAGE_STORYBOARD_UNAVAILABLE",
        );
      }
      for (const { asset, role } of sources) {
        files.push(
          await writeVerifiedFile(
            sandbox,
            asset.object_name,
            asset.content_sha256,
            `storyboard-images/shot-${label}-${role}.${imageExtension(asset.media_mime)}`,
          ),
        );
      }
    }

    const manifest = {
      approvedEdd: {
        contentSha256: eddBinding.contentSha256,
        identityKind: eddBinding.identityKind,
        versionId: eddBinding.versionId,
      },
      attemptNumber: packageRow.attempt_number,
      episodeId: packageRow.episode_id,
      files,
      format: "genie-approved-edit-package.v2",
      masterContentSha256: master.content_sha256,
      masterId: packageRow.master_id,
      masterVersion: packageRow.master_version,
      productionRunId: packageRow.production_run_id,
      shots: clips.map((clip) => {
        const eddShot = eddShots[clip.shot_number - 1]!;
        if (clip.start_ms !== eddShot.startMs || clip.end_ms !== eddShot.endMs) {
          throw new MvpEditPackageError(
            "A selected clip does not match its approved edit decision window.",
            "EDIT_PACKAGE_TIMELINE_MISMATCH",
          );
        }
        const sources = sourcesForClip(clip);
        return {
          clip: {
            assetId: clip.id,
            contentSha256: clip.content_sha256,
            modelEndpoint: clip.model_key,
            path: `video-clips/shot-${shotLabel(clip.shot_number)}.mp4`,
            provider: "fal",
          },
          endMs: clip.end_ms,
          exactNarration: eddShot.exactNarration,
          scriptScalarWindow: {
            endExclusive: eddShot.endScalar,
            startInclusive: eddShot.startScalar,
          },
          shotNumber: clip.shot_number,
          sourceAssetVersionId:
            clip.storyboard_frame_id === null ? clip.reference_asset_version_id : null,
          sourceImages: sources.map(({ asset, role }) => ({
            assetId: asset.id,
            contentSha256: asset.content_sha256,
            modelEndpoint: "model_key" in asset ? asset.model_key : null,
            path: `storyboard-images/shot-${shotLabel(clip.shot_number)}-${role}.${imageExtension(asset.media_mime)}`,
            provider: "model_key" in asset ? "fal" : null,
            providerEndpoint: "endpoint" in asset ? asset.endpoint : null,
            role,
          })),
          storyboardEndFrameId: clip.storyboard_end_frame_id,
          storyboardFrameId: clip.storyboard_frame_id,
          startMs: clip.start_ms,
        };
      }),
      workspaceId: packageRow.workspace_id,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
    const checksumBytes = Buffer.from(
      `${files.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`,
    );
    await sandbox.writeFiles([
      { content: manifestBytes, path: `${SANDBOX_ROOT}/manifest.json` },
      { content: checksumBytes, path: `${SANDBOX_ROOT}/SHA256SUMS.txt` },
      { content: Buffer.from(ZIP_SCRIPT), path: `${SANDBOX_ROOT}/create-zip.mjs` },
      {
        content: Buffer.from(
          JSON.stringify([
            ...files.map((file) => file.path),
            "manifest.json",
            "SHA256SUMS.txt",
          ]),
        ),
        path: `${SANDBOX_ROOT}/zip-files.json`,
      },
    ]);
    await sandboxCommand(sandbox, "node", [`${SANDBOX_ROOT}/create-zip.mjs`], 240_000);
    const packageBytes = await sandbox.readFileToBuffer({
      path: `${SANDBOX_ROOT}/approved-assets.zip`,
    });
    if (
      !packageBytes ||
      packageBytes.byteLength < 1_024 ||
      packageBytes.byteLength > PACKAGE_LIMIT_BYTES
    ) {
      throw new MvpEditPackageError(
        "The approved media package is outside the supported size envelope.",
        "EDIT_PACKAGE_SIZE_INVALID",
      );
    }
    const objectName = `${packageRow.workspace_id}/mvp-edit-packages/${packageRow.master_id}/${packageRow.master_version}/approved-assets.zip`;
    const packageSha256 = sha256(packageBytes);
    const { error: uploadError } = await client.storage
      .from(MEDIA_BUCKET)
      .upload(objectName, packageBytes, {
        cacheControl: "31536000",
        contentType: "application/zip",
        upsert: false,
      });
    if (uploadError) {
      // The upload response can be lost after the canonical object commits.
      // Reconcile the immutable bytes at that exact path before deciding that
      // another write is necessary. A different object always fails closed.
      const existingBytes = await storageBytes(objectName).catch(() => null);
      if (
        !existingBytes ||
        existingBytes.byteLength !== packageBytes.byteLength ||
        sha256(existingBytes) !== packageSha256
      ) {
        throw new MvpEditPackageError(
          "The approved media package could not be stored.",
          "EDIT_PACKAGE_STORAGE_FAILED",
        );
      }
    }
    return {
      byteLength: packageBytes.byteLength,
      contentSha256: packageSha256,
      objectName,
    };
  } finally {
    await sandbox?.stop().catch(() => undefined);
  }
}

export async function advanceNextMvpEditPackage(): Promise<{
  advanced: boolean;
  packageId?: string;
  state?: "failed" | "ready";
}> {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc("claim_next_mvp_edit_package");
  if (error) {
    throw new MvpEditPackageError(
      "The approved media package queue is unavailable.",
      "EDIT_PACKAGE_QUEUE_UNAVAILABLE",
    );
  }
  if (!data) return { advanced: false };
  const packageRow = data as PackageRow;
  if (!packageRow.claim_token) {
    throw new MvpEditPackageError(
      "The approved media package claim is not fenced.",
      "EDIT_PACKAGE_QUEUE_UNAVAILABLE",
    );
  }
  try {
    const built = await buildPackage(packageRow);
    const { error: completionError } = await client.rpc("complete_mvp_edit_package", {
      p_byte_length: built.byteLength,
      p_claim_token: packageRow.claim_token,
      p_content_sha256: built.contentSha256,
      p_expected_version: packageRow.version,
      p_object_name: built.objectName,
      p_package_id: packageRow.id,
    });
    if (completionError) {
      throw new MvpEditPackageError(
        "The approved media package completion could not be recorded.",
        "EDIT_PACKAGE_COMPLETION_FAILED",
      );
    }
    return { advanced: true, packageId: packageRow.id, state: "ready" };
  } catch (caught) {
    const failure =
      caught instanceof MvpEditPackageError
        ? caught
        : new MvpEditPackageError(
            "The approved media package could not be prepared.",
            "EDIT_PACKAGE_UNAVAILABLE",
          );
    await client.rpc("fail_mvp_edit_package", {
      p_claim_token: packageRow.claim_token,
      p_error_code: failure.safeCode,
      p_error_summary: failure.message,
      p_expected_version: packageRow.version,
      p_package_id: packageRow.id,
    });
    throw failure;
  }
}

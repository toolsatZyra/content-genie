import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manifestPath = path.join(root, "src", "domain", "look", "look-pack.v1.json");
const previewRoot = path.join(root, "public", "looks");
const manifestBytes = fs.readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};
const SOURCE_COMMIT = "3d57ccf4cebd30019cc862c692c83a8049169d3a";
const SOURCE_TREE = "37ea0060ac2f67223a62a397ad0cec645913f698";
const PREVIEW_TREE = "7b86dd826b5c1a47c3951e2f4050e603f71c6a54";
const CATALOG_BLOB = "e3e2c68a7994260d624c5b03f4f977511c4dfb48";
const CATALOG_SHA256 =
  "6b12dac1e8c7beec096ee1fcff755a814ecab58bb921bf8ad4901167334e0033";
const REPOSITORY_URL = "https://github.com/toolsatZyra/doctor-z";
const localRequire = createRequire(import.meta.url);
const nextRequire = createRequire(localRequire.resolve("next/package.json"));
const sharp = nextRequire("sharp");

function gitBlobSha1(bytes) {
  return crypto
    .createHash("sha1")
    .update(Buffer.from(`blob ${bytes.length}\0`))
    .update(bytes)
    .digest("hex");
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

// This decoder is intentionally independent of the importer's implementation.
// It validates the RIFF chunk graph and decodes dimensions from VP8, VP8L, or
// VP8X bitstreams instead of trusting the extension or declared manifest size.
function decodeWebP(bytes, label) {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw new Error(`${label}: invalid WebP RIFF container`);
  }

  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) {
      throw new Error(`${label}: truncated WebP chunk header`);
    }
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const nextOffset = dataEnd + (size & 1);
    if (dataEnd > bytes.length || nextOffset > bytes.length) {
      throw new Error(`${label}: truncated ${type} WebP chunk`);
    }
    chunks.push({ dataStart, size, type });
    offset = nextOffset;
  }

  const extended = chunks.filter(({ type }) => type === "VP8X");
  const imageChunks = chunks.filter(({ type }) => type === "VP8 " || type === "VP8L");
  if (
    extended.length > 1 ||
    imageChunks.length !== 1 ||
    chunks.some(({ type }) => type === "ANIM" || type === "ANMF")
  ) {
    throw new Error(`${label}: expected exactly one static WebP image bitstream`);
  }

  let canvas;
  if (extended.length === 1) {
    const chunk = extended[0];
    const flags = bytes[chunk.dataStart];
    if (
      chunks[0] !== chunk ||
      chunk.size !== 10 ||
      (flags & 0xc3) !== 0 ||
      bytes.readUIntLE(chunk.dataStart + 1, 3) !== 0
    ) {
      throw new Error(`${label}: invalid VP8X header`);
    }
    canvas = {
      format: "VP8X",
      height: readUInt24LE(bytes, chunk.dataStart + 7) + 1,
      width: readUInt24LE(bytes, chunk.dataStart + 4) + 1,
    };
  }

  const image = imageChunks[0];
  let decoded;
  if (image.type === "VP8 ") {
    if (image.size < 10) throw new Error(`${label}: truncated VP8 header`);
    const frameTag = bytes.readUIntLE(image.dataStart, 3);
    const firstPartitionLength = frameTag >>> 5;
    if (
      (frameTag & 1) !== 0 ||
      ((frameTag >>> 1) & 7) > 3 ||
      ((frameTag >>> 4) & 1) !== 1 ||
      firstPartitionLength + 10 > image.size ||
      bytes[image.dataStart + 3] !== 0x9d ||
      bytes[image.dataStart + 4] !== 0x01 ||
      bytes[image.dataStart + 5] !== 0x2a
    ) {
      throw new Error(`${label}: invalid VP8 key-frame bitstream`);
    }
    decoded = {
      format: "VP8",
      height: bytes.readUInt16LE(image.dataStart + 8) & 0x3fff,
      width: bytes.readUInt16LE(image.dataStart + 6) & 0x3fff,
    };
  } else {
    if (image.size < 5 || bytes[image.dataStart] !== 0x2f) {
      throw new Error(`${label}: invalid VP8L bitstream`);
    }
    const bits = bytes.readUInt32LE(image.dataStart + 1);
    if (bits >>> 29 !== 0) {
      throw new Error(`${label}: unsupported VP8L version`);
    }
    decoded = {
      format: "VP8L",
      height: ((bits >>> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    };
  }

  if (
    decoded.width === 0 ||
    decoded.height === 0 ||
    (canvas && (canvas.width !== decoded.width || canvas.height !== decoded.height))
  ) {
    throw new Error(`${label}: inconsistent WebP dimensions`);
  }
  return canvas
    ? { ...canvas, bitstreamFormat: decoded.format }
    : { ...decoded, bitstreamFormat: decoded.format };
}

async function fullyDecodeWebPPixels(bytes, label, structural) {
  try {
    const image = sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: 1280 * 720,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    if (
      metadata.format !== "webp" ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width !== structural.width ||
      metadata.height !== structural.height ||
      info.width !== structural.width ||
      info.height !== structural.height ||
      !Number.isInteger(info.channels) ||
      data.length !== info.width * info.height * info.channels
    ) {
      throw new Error("decoded pixel metadata is inconsistent");
    }
  } catch (error) {
    throw new Error(`${label}: full WebP pixel decode failed`, { cause: error });
  }
}

function sourceRawUrl(repositoryPath) {
  return `https://raw.githubusercontent.com/toolsatZyra/doctor-z/${SOURCE_COMMIT}/${repositoryPath}`;
}

async function assertPreviewArtifact(look, previewBytes) {
  const sourcePath = `public/looks/${look.id}.webp`;
  const decoded = decodeWebP(previewBytes, look.id);
  await fullyDecodeWebPPixels(previewBytes, look.id, decoded);
  if (
    look.preview.path !== `/looks/${look.id}.webp` ||
    look.preview.width !== 1280 ||
    look.preview.height !== 720 ||
    decoded.width !== 1280 ||
    decoded.height !== 720 ||
    look.preview.webpBitstreamFormat !== decoded.bitstreamFormat ||
    look.preview.sha256 !== sha256(previewBytes) ||
    look.provenance.sourcePreviewBlobSha1 !== gitBlobSha1(previewBytes) ||
    look.provenance.sourcePreviewPath !== sourcePath ||
    look.provenance.sourcePreviewRawUrl !== sourceRawUrl(sourcePath) ||
    look.provenance.sourceCatalogSha256 !== CATALOG_SHA256 ||
    look.provenance.sourceCommit !== SOURCE_COMMIT ||
    look.lockedLookBlockSha256 !== sha256(look.lockedLookBlock) ||
    look.negativePolicy?.schemaVersion !== "genie-look-negative-policy.v1" ||
    look.negativePolicy.rules?.length !== 5 ||
    look.negativePolicy.sha256 !==
      sha256(
        canonical({
          promptTail: look.negativePolicy.promptTail,
          rules: look.negativePolicy.rules,
          schemaVersion: look.negativePolicy.schemaVersion,
        }),
      ) ||
    look.visualQcBaseline?.schemaVersion !== "genie-look-visual-qc-baseline.v1" ||
    look.visualQcBaseline.checks?.length !== 3 ||
    Object.keys(look.visualQcBaseline.semantics ?? {})
      .sort()
      .join(",") !== "color,contrast,lens,lighting,texture" ||
    look.visualQcBaseline.sourceLookBlockSha256 !== look.lockedLookBlockSha256 ||
    look.visualQcBaseline.negativePolicySha256 !== look.negativePolicy.sha256 ||
    look.visualQcBaseline.sha256 !==
      sha256(
        canonical({
          checks: look.visualQcBaseline.checks,
          negativePolicySha256: look.visualQcBaseline.negativePolicySha256,
          schemaVersion: look.visualQcBaseline.schemaVersion,
          semantics: look.visualQcBaseline.semantics,
          sourceLookBlockSha256: look.visualQcBaseline.sourceLookBlockSha256,
        }),
      )
  ) {
    throw new Error(`Look artifact integrity failed for ${look.id}.`);
  }
}

async function assertRejected(label, action) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`Negative control was accepted: ${label}`);
}

const generationCheck = spawnSync(
  process.execPath,
  ["scripts/generate-phase2-config-migration.mjs", "--check"],
  {
    cwd: root,
    encoding: "utf8",
    shell: false,
  },
);
if (generationCheck.status !== 0) {
  throw new Error(
    generationCheck.stderr || generationCheck.stdout || "Generation check failed",
  );
}

const hardeningGenerationCheck = spawnSync(
  process.execPath,
  ["scripts/generate-phase2-script-hardening-migration.mjs", "--check"],
  {
    cwd: root,
    encoding: "utf8",
    shell: false,
  },
);
if (hardeningGenerationCheck.status !== 0) {
  throw new Error(
    hardeningGenerationCheck.stderr ||
      hardeningGenerationCheck.stdout ||
      "Script hardening generation check failed",
  );
}

if (
  manifest.schemaVersion !== "genie-look-pack.v1" ||
  manifest.packId !== "ai-director-curated-looks" ||
  manifest.packVersion !== 1 ||
  manifest.defaultLookId !== "glowing-divine-realism" ||
  manifest.looks.length !== 117 ||
  new Set(manifest.looks.map(({ id }) => id)).size !== 117
) {
  throw new Error("The reviewed Genie look-pack identity is invalid.");
}
if (
  manifest.importedFrom.repositoryUrl !== REPOSITORY_URL ||
  manifest.importedFrom.commitUrl !== `${REPOSITORY_URL}/commit/${SOURCE_COMMIT}` ||
  manifest.importedFrom.sourceCommit !== SOURCE_COMMIT ||
  manifest.importedFrom.sourceTreeSha1 !== SOURCE_TREE ||
  manifest.importedFrom.previewTreePath !== "public/looks" ||
  manifest.importedFrom.previewTreeSha1 !== PREVIEW_TREE ||
  manifest.importedFrom.catalogPath !== "tools/look-gen/all-looks.json" ||
  manifest.importedFrom.catalogBlobSha1 !== CATALOG_BLOB ||
  manifest.importedFrom.catalogSha256 !== CATALOG_SHA256 ||
  manifest.importedFrom.catalogRawUrl !== sourceRawUrl("tools/look-gen/all-looks.json")
) {
  throw new Error("The AI Director source provenance pin changed.");
}

const previewNames = fs
  .readdirSync(previewRoot)
  .filter((filename) => filename.endsWith(".webp"))
  .sort();
const expectedPreviewNames = manifest.looks.map(({ id }) => `${id}.webp`).sort();
if (
  previewNames.length !== 117 ||
  previewNames.some((filename, index) => filename !== expectedPreviewNames[index])
) {
  throw new Error("The production look-preview tree is not exactly 117 files.");
}

for (const look of manifest.looks) {
  const previewBytes = fs.readFileSync(path.join(previewRoot, `${look.id}.webp`));
  await assertPreviewArtifact(look, previewBytes);
  if (
    /on can and splash|turquoise \(pool\)|the streetlight|wide-angle distortion|blown-to-white background|crushed pure-black background/i.test(
      look.lockedLookBlock,
    )
  ) {
    throw new Error(`Look tail injects scene or lens geometry for ${look.id}.`);
  }
}

const controlLook = manifest.looks[0];
const controlBytes = fs.readFileSync(path.join(previewRoot, `${controlLook.id}.webp`));
const invalidContainer = Buffer.from(controlBytes);
invalidContainer[0] ^= 0xff;
await assertRejected("forged WebP header", () =>
  decodeWebP(invalidContainer, "control"),
);

const tamperedBytes = Buffer.from(controlBytes);
tamperedBytes[tamperedBytes.length - 1] ^= 0x01;
await assertRejected("preview payload hash mismatch", () =>
  assertPreviewArtifact(controlLook, tamperedBytes),
);

const forgedProvenance = {
  ...controlLook,
  provenance: {
    ...controlLook.provenance,
    sourcePreviewBlobSha1: "0".repeat(40),
  },
};
await assertRejected("forged source blob provenance", () =>
  assertPreviewArtifact(forgedProvenance, controlBytes),
);

const forgedNegativePolicy = {
  ...controlLook,
  negativePolicy: {
    ...controlLook.negativePolicy,
    promptTail: "Permit logos and malformed anatomy.",
  },
};
await assertRejected("forged structured negative policy", () =>
  assertPreviewArtifact(forgedNegativePolicy, controlBytes),
);

const forgedVisualQc = {
  ...controlLook,
  visualQcBaseline: {
    ...controlLook.visualQcBaseline,
    semantics: { ...controlLook.visualQcBaseline.semantics, color: "Anything." },
  },
};
await assertRejected("forged visual QC baseline", () =>
  assertPreviewArtifact(forgedVisualQc, controlBytes),
);

const schemaMigration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260717121600_phase2_looks_voices_and_config.sql",
  ),
  "utf8",
);
const provenanceCorrection = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260717121605_phase2_0011_look_pack_provenance_correction.sql",
  ),
  "utf8",
);
const voiceFailClosedCorrection = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260717121606_phase2_voice_canary_fail_closed.sql",
  ),
  "utf8",
);
const lookPolicyCorrection = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260717121608_phase2_look_policy_baselines.sql",
  ),
  "utf8",
);
const lookSeedCorpus = [1, 2, 3, 4]
  .map((batch) =>
    fs.readFileSync(
      path.join(
        root,
        "supabase",
        "migrations",
        `2026071712160${batch}_phase2_0011_look_seed_0${batch}.sql`,
      ),
      "utf8",
    ),
  )
  .join("\n");
for (const expected of [
  sha256(manifestBytes),
  manifest.importedFrom.repositoryUrl,
  manifest.importedFrom.sourceCommit,
  manifest.importedFrom.catalogSha256,
]) {
  if (!schemaMigration.includes(expected)) {
    throw new Error(
      `The generated database look pack is missing exact provenance: ${expected}`,
    );
  }
}
for (const corrected of [
  manifest.importedFrom.repositoryUrl,
  manifest.importedFrom.sourceCommit,
  manifest.importedFrom.catalogSha256,
]) {
  if (!provenanceCorrection.includes(corrected)) {
    throw new Error(`The forward provenance correction is missing: ${corrected}`);
  }
}
for (const failClosedInvariant of [
  "voice_availability_events_no_unattested_verification",
  "voice verification requires an authenticated provider receipt",
  "create or replace function public.command_withdraw_voice_version(",
  "availability.status not in ('pending_authenticated_canary', 'verified')",
  "prior_status := availability.status",
]) {
  if (
    !schemaMigration.includes(failClosedInvariant) ||
    !voiceFailClosedCorrection.includes(failClosedInvariant)
  ) {
    throw new Error(`Voice canary path is not fail closed: ${failClosedInvariant}`);
  }
}
for (const look of manifest.looks) {
  for (const binding of [look.negativePolicy.sha256, look.visualQcBaseline.sha256]) {
    if (!lookSeedCorpus.includes(binding) || !lookPolicyCorrection.includes(binding)) {
      throw new Error(`Persisted look policy binding is missing: ${binding}`);
    }
  }
  for (const reconciledValue of [
    look.lockedLookBlockSha256,
    look.preview.sha256,
    look.provenance.sourcePromptSha256,
    look.provenance.sourceRecordSha256,
  ]) {
    if (!lookPolicyCorrection.includes(reconciledValue)) {
      throw new Error(
        `Prelaunch immutable look reconciliation is missing: ${reconciledValue}`,
      );
    }
  }
}
for (const reconciliationColumn of [
  "set look_key =",
  "locked_look_block_sha256 =",
  "preview_sha256 =",
  "source_prompt_sha256 =",
  "source_record_sha256 =",
  "manifest_entry_hash =",
]) {
  if (!lookPolicyCorrection.includes(reconciliationColumn)) {
    throw new Error(
      `Look-policy correction omits immutable reconciliation: ${reconciliationColumn}`,
    );
  }
}
for (const forbiddenTransition of [
  "and p_status in ('verified', 'withdrawn')",
  "set status = p_status",
]) {
  if (
    schemaMigration.includes(forbiddenTransition) ||
    voiceFailClosedCorrection.includes(forbiddenTransition)
  ) {
    throw new Error(
      `Caller-authored voice verification transition survived: ${forbiddenTransition}`,
    );
  }
}

for (const stale of [
  "C:/Work/Code/ai-director",
  "36701719d33d1777232007871552f2a7076335795e5012ddd8d10fdbfcdc4cc7",
]) {
  if (schemaMigration.includes(stale) || provenanceCorrection.includes(stale)) {
    throw new Error(`Stale local look-pack provenance survived generation: ${stale}`);
  }
}

console.log(
  "Phase 2 generation policy passed: 117 full WebP pixel decodes, three negative controls, deterministic seeds, and exact provenance pins.",
);

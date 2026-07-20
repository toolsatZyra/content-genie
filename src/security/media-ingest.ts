const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export const QUARANTINE_MANIFEST_SCHEMA_VERSION = "genie.quarantine-manifest.v1";
export const INGEST_ATTESTATION_SCHEMA_VERSION = "genie.ingest-attestation.v1";

export const launchMediaLimits = Object.freeze({
  maximumAudioDurationMs: 30 * 60 * 1_000,
  maximumBytes: 100 * 1024 * 1024,
  maximumDecompressedBytes: 256 * 1024 * 1024,
  maximumFrameCount: 36_000,
  maximumImageBytes: 25 * 1024 * 1024,
  maximumPixels: 40_000_000,
});

export type SafeMediaMime =
  "audio/mpeg" | "audio/wav" | "image/jpeg" | "image/png" | "image/webp" | "video/mp4";

export type QuarantineManifest = Readonly<{
  assetId: string;
  assetVersionId: string;
  bucketId: "quarantine";
  byteLength: number;
  declaredMime: SafeMediaMime;
  displayFilename: string;
  objectName: string;
  schemaVersion: typeof QUARANTINE_MANIFEST_SCHEMA_VERSION;
  sha256: string;
  sourceKind: "provider_output" | "research_fetch" | "upload";
  workspaceId: string;
}>;

export type IngestAttestation = Readonly<{
  createdAt: string;
  decompressedBytes: number;
  durationMs: number | null;
  frameCount: number | null;
  height: number | null;
  magicMime: SafeMediaMime;
  malwareStatus: "clean";
  metadataStripped: true;
  outputSha256: string;
  parserSandboxed: true;
  policyVersionId: string;
  probeSha256: string;
  quarantineAssetVersionId: string;
  reencodedMime: SafeMediaMime;
  scanEngine: string;
  scanVersion: string;
  schemaVersion: typeof INGEST_ATTESTATION_SCHEMA_VERSION;
  width: number | null;
}>;

export class MediaIngestPolicyError extends Error {
  override readonly name = "MediaIngestPolicyError";
}

const safeMimes = new Set<SafeMediaMime>([
  "audio/mpeg",
  "audio/wav",
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
]);

function exact(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new MediaIngestPolicyError(`${field} is invalid.`);
  }
  return value.toLowerCase();
}

function integer(value: unknown, field: string, minimum: number, maximum: number) {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    throw new MediaIngestPolicyError(`${field} is invalid.`);
  }
  return value as number;
}

function nullableInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number | null {
  return value === null ? null : integer(value, field, minimum, maximum);
}

function mime(value: unknown, field: string): SafeMediaMime {
  if (typeof value !== "string" || !safeMimes.has(value as SafeMediaMime)) {
    throw new MediaIngestPolicyError(`${field} is invalid.`);
  }
  return value as SafeMediaMime;
}

export function sniffMediaMagic(bytes: Uint8Array): SafeMediaMime | null {
  if (
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.slice(8, 12)).toString("ascii") === "WAVE"
  ) {
    return "audio/wav";
  }
  if (
    bytes.length >= 3 &&
    (Buffer.from(bytes.slice(0, 3)).toString("ascii") === "ID3" ||
      (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0))
  ) {
    return "audio/mpeg";
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.slice(4, 8)).toString("ascii") === "ftyp"
  ) {
    return "video/mp4";
  }
  return null;
}

export function parseQuarantineManifest(value: unknown): QuarantineManifest {
  const keys = [
    "assetId",
    "assetVersionId",
    "bucketId",
    "byteLength",
    "declaredMime",
    "displayFilename",
    "objectName",
    "schemaVersion",
    "sha256",
    "sourceKind",
    "workspaceId",
  ] as const;
  if (!exact(value, keys)) {
    throw new MediaIngestPolicyError("Quarantine manifest is not exact.");
  }
  const input = value as Record<string, unknown>;
  const workspaceId = uuid(input.workspaceId, "workspaceId");
  const assetId = uuid(input.assetId, "assetId");
  const assetVersionId = uuid(input.assetVersionId, "assetVersionId");
  const declaredMime = mime(input.declaredMime, "declaredMime");
  if (
    input.schemaVersion !== QUARANTINE_MANIFEST_SCHEMA_VERSION ||
    input.bucketId !== "quarantine" ||
    !["provider_output", "research_fetch", "upload"].includes(
      String(input.sourceKind),
    ) ||
    typeof input.sha256 !== "string" ||
    !sha256Pattern.test(input.sha256) ||
    typeof input.displayFilename !== "string" ||
    input.displayFilename.length < 1 ||
    input.displayFilename.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(input.displayFilename) ||
    typeof input.objectName !== "string" ||
    input.objectName !==
      `${workspaceId}/quarantine/${assetId}/${assetVersionId}/source` ||
    input.objectName.includes("..") ||
    input.objectName.includes("\\")
  ) {
    throw new MediaIngestPolicyError("Quarantine manifest is invalid.");
  }
  const byteLength = integer(
    input.byteLength,
    "byteLength",
    1,
    declaredMime.startsWith("image/")
      ? launchMediaLimits.maximumImageBytes
      : launchMediaLimits.maximumBytes,
  );
  return Object.freeze({
    assetId,
    assetVersionId,
    bucketId: "quarantine",
    byteLength,
    declaredMime,
    displayFilename: input.displayFilename,
    objectName: input.objectName,
    schemaVersion: QUARANTINE_MANIFEST_SCHEMA_VERSION,
    sha256: input.sha256,
    sourceKind: input.sourceKind as QuarantineManifest["sourceKind"],
    workspaceId,
  });
}

export function parseIngestAttestation(value: unknown): IngestAttestation {
  const keys = [
    "createdAt",
    "decompressedBytes",
    "durationMs",
    "frameCount",
    "height",
    "magicMime",
    "malwareStatus",
    "metadataStripped",
    "outputSha256",
    "parserSandboxed",
    "policyVersionId",
    "probeSha256",
    "quarantineAssetVersionId",
    "reencodedMime",
    "scanEngine",
    "scanVersion",
    "schemaVersion",
    "width",
  ] as const;
  if (!exact(value, keys)) {
    throw new MediaIngestPolicyError("Ingest attestation is not exact.");
  }
  const input = value as Record<string, unknown>;
  const magicMime = mime(input.magicMime, "magicMime");
  const reencodedMime = mime(input.reencodedMime, "reencodedMime");
  if (
    input.schemaVersion !== INGEST_ATTESTATION_SCHEMA_VERSION ||
    input.malwareStatus !== "clean" ||
    input.metadataStripped !== true ||
    input.parserSandboxed !== true ||
    magicMime !== reencodedMime ||
    typeof input.outputSha256 !== "string" ||
    !sha256Pattern.test(input.outputSha256) ||
    typeof input.probeSha256 !== "string" ||
    !sha256Pattern.test(input.probeSha256) ||
    typeof input.scanEngine !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$/u.test(input.scanEngine) ||
    typeof input.scanVersion !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(input.scanVersion) ||
    typeof input.createdAt !== "string" ||
    Number.isNaN(Date.parse(input.createdAt))
  ) {
    throw new MediaIngestPolicyError("Ingest attestation is invalid.");
  }
  const width = nullableInteger(input.width, "width", 1, 32_768);
  const height = nullableInteger(input.height, "height", 1, 32_768);
  const durationMs = nullableInteger(
    input.durationMs,
    "durationMs",
    1,
    launchMediaLimits.maximumAudioDurationMs,
  );
  const frameCount = nullableInteger(
    input.frameCount,
    "frameCount",
    1,
    launchMediaLimits.maximumFrameCount,
  );
  if (
    (magicMime.startsWith("image/") &&
      (width === null ||
        height === null ||
        width * height > launchMediaLimits.maximumPixels ||
        durationMs !== null ||
        frameCount !== null)) ||
    (magicMime.startsWith("audio/") &&
      (durationMs === null || width !== null || height !== null)) ||
    (magicMime === "video/mp4" &&
      (durationMs === null || frameCount === null || width === null || height === null))
  ) {
    throw new MediaIngestPolicyError("Ingest probe dimensions are invalid.");
  }
  return Object.freeze({
    createdAt: input.createdAt,
    decompressedBytes: integer(
      input.decompressedBytes,
      "decompressedBytes",
      1,
      launchMediaLimits.maximumDecompressedBytes,
    ),
    durationMs,
    frameCount,
    height,
    magicMime,
    malwareStatus: "clean",
    metadataStripped: true,
    outputSha256: input.outputSha256,
    parserSandboxed: true,
    policyVersionId: uuid(input.policyVersionId, "policyVersionId"),
    probeSha256: input.probeSha256,
    quarantineAssetVersionId: uuid(
      input.quarantineAssetVersionId,
      "quarantineAssetVersionId",
    ),
    reencodedMime,
    scanEngine: input.scanEngine,
    scanVersion: input.scanVersion,
    schemaVersion: INGEST_ATTESTATION_SCHEMA_VERSION,
    width,
  });
}

export function assertPromotableAsset(
  manifestValue: unknown,
  attestationValue: unknown,
): Readonly<{
  assetId: string;
  outputSha256: string;
  policyVersionId: string;
  promotedMime: SafeMediaMime;
  quarantineAssetVersionId: string;
  workspaceId: string;
}> {
  const manifest = parseQuarantineManifest(manifestValue);
  const attestation = parseIngestAttestation(attestationValue);
  if (
    attestation.quarantineAssetVersionId !== manifest.assetVersionId ||
    attestation.magicMime !== manifest.declaredMime
  ) {
    throw new MediaIngestPolicyError("Ingest attestation does not bind the input.");
  }
  return Object.freeze({
    assetId: manifest.assetId,
    outputSha256: attestation.outputSha256,
    policyVersionId: attestation.policyVersionId,
    promotedMime: attestation.reencodedMime,
    quarantineAssetVersionId: manifest.assetVersionId,
    workspaceId: manifest.workspaceId,
  });
}

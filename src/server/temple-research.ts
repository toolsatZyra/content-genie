import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { getServerEnvironment } from "@/config/server-env";
import type {
  ExtractedLocation,
  RealWorldSubjectKind,
} from "@/domain/agent/world-extraction";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  fetchRemoteToQuarantineBuffer,
  RemoteFetchPolicyError,
  type RemoteFetchResult,
} from "@/security/remote-fetch";
import { getActiveRemoteFetchPolicy } from "@/server/provider-broker-ledger";
import { retainDistinctResearchReference } from "@/server/research-reference-selection";
import {
  SandboxMediaScannerError,
  scanAndReencodeWorldImage,
} from "@/server/sandbox-media-scanner";
import type { PreflightTaskEnvelope } from "../../trigger/preflight-contract";

const SOURCE_API = "https://en.wikipedia.org/w/api.php";
const MAX_API_BYTES = 2 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 25 * 1024 * 1024;
const SIGNED_REFERENCE_SECONDS = 15 * 60;
const eligibleMimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
export const RESEARCH_REFERENCE_BATCH_SIZE = 4;

export class TempleResearchError extends Error {
  override readonly name = "TempleResearchError";

  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export const RESEARCH_QUARANTINE_SOURCE_KIND = "research_fetch";

export function buildResearchRemoteFetchCommand(input: {
  allowlistVersionHash: string;
  allowlistVersionId: string;
  environment: "development" | "preview" | "production" | "test";
  envelope: Pick<
    PreflightTaskEnvelope,
    "preflightRunId" | "stageAttemptId" | "workspaceId"
  >;
  result: Pick<
    RemoteFetchResult,
    "canonicalUrl" | "redirectCount" | "resolvedAddressHashes" | "sha256"
  >;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    p_allowlist_version_hash: input.allowlistVersionHash,
    p_allowlist_version_id: input.allowlistVersionId,
    p_canonical_url_hash: sha256(input.result.canonicalUrl),
    p_environment: input.environment,
    p_exact_hostname: new URL(input.result.canonicalUrl).hostname.toLowerCase(),
    p_fetch_class: "research_reference",
    p_maximum_bytes: MAX_REFERENCE_BYTES,
    p_preflight_run_id: input.envelope.preflightRunId,
    p_redirect_count: input.result.redirectCount,
    p_resolved_address_hashes: input.result.resolvedAddressHashes,
    p_response_sha256: input.result.sha256,
    p_safe_failure_class: null,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_status: "fetched",
    p_timeout_ms: 60_000,
    p_workspace_id: input.envelope.workspaceId,
  });
}

type ReferenceMetadata = Readonly<{
  attributionRequired: boolean;
  authorCredit: string;
  canonicalTitle: string;
  licenseShortName: string;
  licenseUrl: string;
  sourceFileUrl: string;
  sourceHeight: number;
  sourceMetadataHash: string;
  sourcePageUrl: string;
  sourceWidth: number;
}>;

export type TempleResearchEvidence = Readonly<{
  evidenceSetHash: string;
  imageUrls: readonly string[];
  packetId: string;
}>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function postgresJsonbText(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => {
        const leftBytes = Buffer.from(left, "utf8");
        const rightBytes = Buffer.from(right, "utf8");
        return (
          leftBytes.length - rightBytes.length || Buffer.compare(leftBytes, rightBytes)
        );
      })
      .map(([key, nested]) => `${JSON.stringify(key)}: ${postgresJsonbText(nested)}`)
      .join(", ")}}`;
  }
  throw new TempleResearchError("Temple evidence is not JSON-compatible.");
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
    console.error("Temple research ledger RPC rejected work.", {
      code: error.code,
      command: name,
    });
    throw new TempleResearchError("The temple-research ledger rejected work.");
  }
  return data;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function searchable(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function distinctiveTokens(placeName: string): readonly string[] {
  const ignored = new Set([
    "fast",
    "fasting",
    "festival",
    "india",
    "mandir",
    "observance",
    "puja",
    "ritual",
    "shrine",
    "temple",
    "the",
    "of",
    "vrat",
    "vrata",
  ]);
  return Object.freeze(
    searchable(placeName)
      .split(" ")
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

export function buildResearchSearchTerms(
  placeName: string,
  subjectKind: RealWorldSubjectKind,
): readonly string[] {
  const exact = placeName.trim();
  const distinctive = distinctiveTokens(exact).join(" ");
  return Object.freeze(
    [
      exact,
      ...(["festival", "ritual"].includes(subjectKind) &&
      distinctive.length > 0 &&
      searchable(exact) !== distinctive
        ? [distinctive]
        : []),
    ].filter(
      (value, index, values) => value.length > 0 && values.indexOf(value) === index,
    ),
  );
}

export function researchReferenceBatches<T>(
  values: readonly T[],
): readonly (readonly T[])[] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += RESEARCH_REFERENCE_BATCH_SIZE) {
    batches.push(values.slice(index, index + RESEARCH_REFERENCE_BATCH_SIZE));
  }
  return Object.freeze(batches.map((batch) => Object.freeze(batch)));
}

function extValue(metadata: unknown, key: string, maximum = 4_000): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const field = (metadata as Record<string, unknown>)[key];
  if (!field || typeof field !== "object" || Array.isArray(field)) return null;
  const value = (field as Record<string, unknown>).value;
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    return null;
  }
  return value;
}

function normalizedLicenseUrl(value: string | null, sourcePageUrl: string): string {
  if (!value) return sourcePageUrl;
  const normalized = value.startsWith("//")
    ? `https:${value}`
    : value.replace(/^http:\/\//u, "https://");
  try {
    const url = new URL(normalized);
    if (
      url.protocol === "https:" &&
      ["creativecommons.org", "commons.wikimedia.org"].includes(
        url.hostname.toLowerCase(),
      )
    ) {
      return url.toString();
    }
  } catch {
    // The source page remains the authoritative license evidence fallback.
  }
  return sourcePageUrl;
}

function parseReferencePage(
  value: unknown,
  placeName: string,
  subjectKind: RealWorldSubjectKind,
): ReferenceMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const page = value as Record<string, unknown>;
  if (
    page.ns !== 6 ||
    typeof page.title !== "string" ||
    !Array.isArray(page.imageinfo)
  ) {
    return null;
  }
  const info = page.imageinfo[0];
  if (!info || typeof info !== "object" || Array.isArray(info)) return null;
  const image = info as Record<string, unknown>;
  if (
    !eligibleMimeTypes.includes(image.mime as (typeof eligibleMimeTypes)[number]) ||
    !Number.isSafeInteger(image.width) ||
    !Number.isSafeInteger(image.height) ||
    (image.width as number) < 800 ||
    (image.height as number) < 800 ||
    typeof image.thumburl !== "string" ||
    typeof image.descriptionurl !== "string"
  ) {
    return null;
  }
  let fileUrl: URL;
  let pageUrl: URL;
  try {
    fileUrl = new URL(image.thumburl);
    pageUrl = new URL(image.descriptionurl);
  } catch {
    return null;
  }
  if (
    fileUrl.protocol !== "https:" ||
    fileUrl.hostname.toLowerCase() !== "upload.wikimedia.org" ||
    !fileUrl.pathname.startsWith("/wikipedia/commons/") ||
    pageUrl.protocol !== "https:" ||
    pageUrl.hostname.toLowerCase() !== "commons.wikimedia.org" ||
    !pageUrl.pathname.startsWith("/wiki/File:")
  ) {
    return null;
  }
  const metadata = image.extmetadata;
  const licenseShortName = extValue(metadata, "LicenseShortName", 100);
  const machineLicense = extValue(metadata, "License", 100)?.toLowerCase() ?? "";
  const eligibleLicense =
    /^(cc0|cc-by(?:-sa)?-[0-9.]+|pd(?:-|$))/u.test(machineLicense) ||
    /^(CC0|CC BY(?:-SA)?|Public domain|PD)/iu.test(licenseShortName ?? "");
  if (!licenseShortName || !eligibleLicense) return null;
  const title = decodeHtml(page.title);
  const description = decodeHtml(extValue(metadata, "ImageDescription") ?? "");
  const categories = decodeHtml(extValue(metadata, "Categories") ?? "");
  const evidenceText = searchable(`${title} ${description} ${categories}`);
  const tokens = distinctiveTokens(placeName);
  if (tokens.length < 1 || !tokens.some((token) => evidenceText.includes(token))) {
    return null;
  }
  const kindEvidence = {
    festival: /festival|puja|celebration|procession|utsav/u,
    none: /$a/u,
    ritual:
      /ritual|worship|prayer|ceremony|aarti|arti|puja|abhishek|fast|fasting|observance|vrat|vrata/u,
    temple: /temple|mandir|shrine|devasthan/u,
  }[subjectKind];
  if (!kindEvidence.test(evidenceText)) return null;
  const authorCredit =
    decodeHtml(extValue(metadata, "Artist", 4_000) ?? "") ||
    "Wikimedia Commons contributor";
  const sourcePageUrl = pageUrl.toString();
  const parsed = {
    attributionRequired:
      extValue(metadata, "AttributionRequired", 16)?.toLowerCase() === "true",
    authorCredit: authorCredit.slice(0, 1_000),
    canonicalTitle: title.slice(0, 500),
    licenseShortName,
    licenseUrl: normalizedLicenseUrl(
      extValue(metadata, "LicenseUrl", 2_048),
      sourcePageUrl,
    ),
    sourceFileUrl: fileUrl.toString(),
    sourceHeight: image.height as number,
    sourcePageUrl,
    sourceWidth: image.width as number,
  };
  return Object.freeze({
    ...parsed,
    sourceMetadataHash: sha256(postgresJsonbText(parsed)),
  });
}

async function fetchReferenceMetadata(
  placeName: string,
  subjectKind: RealWorldSubjectKind,
): Promise<
  Readonly<{
    apiResponseSha256: string;
    querySha256: string;
    references: readonly ReferenceMetadata[];
  }>
> {
  const unique = new Map<
    string,
    Readonly<{ rank: number; reference: ReferenceMetadata }>
  >();
  const responseEvidence: {
    querySha256: string;
    responseSha256: string;
    searchTerm: string;
  }[] = [];
  const searchTerms = buildResearchSearchTerms(placeName, subjectKind);
  for (const [queryIndex, searchTerm] of searchTerms.entries()) {
    const url = new URL(SOURCE_API);
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      generator: "search",
      gsrlimit: "50",
      gsrnamespace: "6",
      gsrsearch: searchTerm,
      iiprop: "url|mime|size|sha1|extmetadata",
      iiurlwidth: "1600",
      prop: "imageinfo",
    }).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetch(url, {
        cache: "no-store",
        credentials: "omit",
        headers: {
          Accept: "application/json",
          "User-Agent": "Zyra-Genie-Real-World-Research/1.0",
        },
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      throw new TempleResearchError(
        "Temple reference metadata could not be reached.",
        true,
      );
    } finally {
      clearTimeout(timer);
    }
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (
      !response.ok ||
      !response.headers
        .get("content-type")
        ?.toLowerCase()
        .startsWith("application/json") ||
      (declaredLength > 0 && declaredLength > MAX_API_BYTES)
    ) {
      throw new TempleResearchError(
        "Temple reference metadata was rejected.",
        response.status >= 500,
      );
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 2 || bytes.length > MAX_API_BYTES) {
      throw new TempleResearchError("Temple reference metadata size was invalid.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new TempleResearchError("Temple reference metadata was malformed.");
    }
    const pages =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).query
        : null;
    const pageList =
      pages && typeof pages === "object" && !Array.isArray(pages)
        ? (pages as Record<string, unknown>).pages
        : null;
    responseEvidence.push({
      querySha256: sha256(url.toString()),
      responseSha256: sha256(bytes),
      searchTerm,
    });
    if (!Array.isArray(pageList)) continue;
    for (const page of pageList) {
      const reference = parseReferencePage(page, placeName, subjectKind);
      const sourceRank =
        page &&
        typeof page === "object" &&
        !Array.isArray(page) &&
        Number.isSafeInteger((page as Record<string, unknown>).index)
          ? Number((page as Record<string, unknown>).index)
          : 999;
      const rank = queryIndex * 1_000 + sourceRank;
      if (reference && !unique.has(reference.sourcePageUrl)) {
        unique.set(reference.sourcePageUrl, { rank, reference });
      }
    }
  }
  const references = [...unique.values()]
    .sort((left, right) => {
      const place = searchable(placeName);
      const leftScore = searchable(left.reference.canonicalTitle).includes(place)
        ? 1
        : 0;
      const rightScore = searchable(right.reference.canonicalTitle).includes(place)
        ? 1
        : 0;
      return (
        rightScore - leftScore ||
        left.rank - right.rank ||
        left.reference.canonicalTitle.localeCompare(right.reference.canonicalTitle)
      );
    })
    .map(({ reference }) => reference)
    .slice(0, 12);
  if (references.length < 2) {
    throw new TempleResearchError(
      "Two independently licensed photographs of the real-world subject were not found.",
    );
  }
  return Object.freeze({
    apiResponseSha256:
      responseEvidence.length === 1
        ? responseEvidence[0]!.responseSha256
        : sha256(postgresJsonbText(responseEvidence)),
    querySha256:
      responseEvidence.length === 1
        ? responseEvidence[0]!.querySha256
        : sha256(
            postgresJsonbText(
              responseEvidence.map(({ querySha256, searchTerm }) => ({
                querySha256,
                searchTerm,
              })),
            ),
          ),
    references: Object.freeze(references),
  });
}

async function recordRemoteFetch(input: {
  envelope: PreflightTaskEnvelope;
  policy: Awaited<ReturnType<typeof getActiveRemoteFetchPolicy>>;
  result: RemoteFetchResult;
}): Promise<string> {
  const value = await rpc(
    "command_record_remote_fetch",
    buildResearchRemoteFetchCommand({
      allowlistVersionHash: input.policy.manifestHash,
      allowlistVersionId: input.policy.allowlistVersionId,
      environment: input.policy.environment,
      envelope: input.envelope,
      result: input.result,
    }),
  );
  if (typeof value !== "string") {
    throw new TempleResearchError("Temple remote-fetch evidence was malformed.");
  }
  return value;
}

async function uploadOrVerify(input: {
  bucket: "quarantine" | "workspace-media";
  bytes: Buffer;
  contentType: string;
  objectName: string;
}): Promise<string> {
  const storage = createAdminSupabaseClient().storage.from(input.bucket);
  const contentSha256 = sha256(input.bytes);
  const upload = await storage.upload(input.objectName, input.bytes, {
    cacheControl: "0",
    contentType: input.contentType,
    metadata: { sha256: contentSha256 },
    upsert: false,
  });
  if (!upload.error) {
    const receipt = await storage.info(input.objectName);
    if (
      receipt.error ||
      receipt.data.id !== upload.data.id ||
      typeof receipt.data.version !== "string" ||
      receipt.data.version.length < 1
    ) {
      throw new TempleResearchError("Temple media storage receipt was invalid.");
    }
    return receipt.data.version;
  }
  const existing = await storage.download(input.objectName);
  if (existing.error) {
    throw new TempleResearchError(
      "Temple media could not enter isolated storage.",
      true,
    );
  }
  const bytes = Buffer.from(await existing.data.arrayBuffer());
  if (sha256(bytes) !== contentSha256) {
    throw new TempleResearchError("Temple media storage replay conflicted.");
  }
  const receipt = await storage.info(input.objectName);
  if (
    receipt.error ||
    typeof receipt.data.version !== "string" ||
    receipt.data.version.length < 1
  ) {
    throw new TempleResearchError("Temple media storage receipt was invalid.");
  }
  return receipt.data.version;
}

async function findPromotedResearchAsset(
  workspaceId: string,
  contentSha256: string,
): Promise<Readonly<{
  assetVersionId: string;
  contentSha256: string;
  objectName: string;
}> | null> {
  const { data, error } = await createAdminSupabaseClient()
    .from("asset_versions")
    .select("id,object_name,content_sha256,asset:assets!inner(asset_kind)")
    .eq("workspace_id", workspaceId)
    .eq("content_sha256", contentSha256)
    .eq("asset.asset_kind", "research_reference")
    .order("promoted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error)
    throw new TempleResearchError("Research-asset replay lookup failed.", true);
  return data
    ? Object.freeze({
        assetVersionId: data.id,
        contentSha256: data.content_sha256,
        objectName: data.object_name,
      })
    : null;
}

async function promoteReference(input: {
  envelope: PreflightTaskEnvelope;
  fetchResult: RemoteFetchResult;
  metadata: ReferenceMetadata;
  policy: Awaited<ReturnType<typeof getActiveRemoteFetchPolicy>>;
}): Promise<
  Readonly<{ assetVersionId: string; contentSha256: string; objectName: string }>
> {
  const remoteFetchRequestId = await recordRemoteFetch({
    envelope: input.envelope,
    policy: input.policy,
    result: input.fetchResult,
  });
  const stableAssetId = deterministicUuid(
    `temple-reference:${input.envelope.workspaceId}:${input.metadata.sourcePageUrl}`,
  );
  const quarantineAssetVersionId = randomUUID();
  const quarantineObjectName = `${input.envelope.workspaceId}/quarantine/${stableAssetId}/${quarantineAssetVersionId}/source`;
  await uploadOrVerify({
    bucket: "quarantine",
    bytes: input.fetchResult.bytes,
    contentType: input.fetchResult.contentType,
    objectName: quarantineObjectName,
  });
  const provenanceHash = sha256(
    postgresJsonbText({
      remoteFetchRequestId,
      sourceMetadataHash: input.metadata.sourceMetadataHash,
      sourcePageUrl: input.metadata.sourcePageUrl,
      workspaceId: input.envelope.workspaceId,
    }),
  );
  const quarantine = await rpc("command_register_quarantine_asset", {
    p_byte_length: input.fetchResult.bytes.length,
    p_declared_mime: input.fetchResult.contentType,
    p_display_filename: input.metadata.canonicalTitle.slice(0, 500),
    p_object_name: quarantineObjectName,
    p_provenance_hash: provenanceHash,
    p_provider_request_id: null,
    p_quarantine_version_id: quarantineAssetVersionId,
    p_remote_fetch_request_id: remoteFetchRequestId,
    p_source_kind: RESEARCH_QUARANTINE_SOURCE_KIND,
    p_source_sha256: input.fetchResult.sha256,
    p_stable_asset_id: stableAssetId,
    p_workspace_id: input.envelope.workspaceId,
  });
  if (
    !exactObject(quarantine, ["ok", "quarantineAssetVersionId", "state"]) ||
    (quarantine as Record<string, unknown>).ok !== true ||
    (quarantine as Record<string, unknown>).state !== "quarantined"
  ) {
    throw new TempleResearchError("Temple quarantine evidence was malformed.");
  }
  const scanned = await scanAndReencodeWorldImage({
    bytes: input.fetchResult.bytes,
    declaredMime: input.fetchResult.contentType as (typeof eligibleMimeTypes)[number],
  });
  const policyValue = await rpc("get_active_media_ingest_policy", {});
  if (
    !exactObject(policyValue, ["id", "policy", "policyHash"]) ||
    typeof (policyValue as Record<string, unknown>).id !== "string"
  ) {
    throw new TempleResearchError("Media ingest policy was malformed.");
  }
  const attestationId = await rpc("command_record_ingest_attestation", {
    p_decompressed_bytes: scanned.decompressedBytes,
    p_duration_ms: null,
    // Still-image attestations use dimensions and leave video frame count null.
    p_frame_count: null,
    p_height: scanned.height,
    p_magic_mime: scanned.magicMime,
    p_malware_status: "clean",
    p_metadata_stripped: true,
    p_output_byte_length: scanned.outputBytes.length,
    p_output_sha256: scanned.outputSha256,
    p_parser_sandboxed: true,
    p_policy_version_id: (policyValue as Record<string, string>).id,
    p_probe_sha256: scanned.probeSha256,
    p_quarantine_asset_version_id: quarantineAssetVersionId,
    p_reencoded_mime: scanned.magicMime,
    p_scan_engine: scanned.scanEngine,
    p_scan_version: scanned.scanVersion,
    p_scanner_task_id: `temple-reference:${quarantineAssetVersionId}`,
    p_scanner_task_version: scanned.scannerTaskVersion,
    p_width: scanned.width,
    p_workspace_id: input.envelope.workspaceId,
  });
  if (typeof attestationId !== "string") {
    throw new TempleResearchError("Temple media attestation was malformed.");
  }
  const existing = await findPromotedResearchAsset(
    input.envelope.workspaceId,
    scanned.outputSha256,
  );
  if (existing) return existing;
  const assetVersionId = randomUUID();
  const objectName = `${input.envelope.workspaceId}/research_reference/${stableAssetId}/${assetVersionId}/source`;
  const storageVersion = await uploadOrVerify({
    bucket: "workspace-media",
    bytes: scanned.outputBytes,
    contentType: scanned.magicMime,
    objectName,
  });
  const promotion = await rpc("command_promote_quarantine_asset", {
    p_asset_kind: "research_reference",
    p_asset_version_id: assetVersionId,
    p_final_object_name: objectName,
    p_ingest_attestation_id: attestationId,
    p_quarantine_asset_version_id: quarantineAssetVersionId,
    p_storage_version: storageVersion,
    p_workspace_id: input.envelope.workspaceId,
  });
  if (
    !promotion ||
    typeof promotion !== "object" ||
    (promotion as Record<string, unknown>).assetVersionId !== assetVersionId
  ) {
    throw new TempleResearchError("Temple research promotion was malformed.");
  }
  return Object.freeze({
    assetVersionId,
    contentSha256: scanned.outputSha256,
    objectName,
  });
}

async function signedImageUrls(
  objectNames: readonly string[],
): Promise<readonly string[]> {
  const client = createAdminSupabaseClient();
  const urls: string[] = [];
  for (const objectName of objectNames) {
    const { data, error } = await client.storage
      .from("workspace-media")
      .createSignedUrl(objectName, SIGNED_REFERENCE_SECONDS);
    if (error || !data?.signedUrl) {
      throw new TempleResearchError("Temple reference signing failed.", true);
    }
    urls.push(data.signedUrl);
  }
  return Object.freeze(urls);
}

async function replayEvidence(
  extractionResultId: string,
  locationKey: string,
): Promise<TempleResearchEvidence | null> {
  const value = await rpc("get_temple_research_replay_context", {
    p_location_key: locationKey,
    p_world_extraction_result_id: extractionResultId,
  });
  if (value === null) return null;
  if (
    !exactObject(value, ["evidenceSetHash", "packetId", "references"]) ||
    typeof (value as Record<string, unknown>).packetId !== "string" ||
    typeof (value as Record<string, unknown>).evidenceSetHash !== "string" ||
    !Array.isArray((value as Record<string, unknown>).references)
  ) {
    throw new TempleResearchError("Temple research replay was malformed.");
  }
  const references = (value as { references: unknown[] }).references;
  if (
    references.length < 2 ||
    references.some(
      (reference) =>
        !reference ||
        typeof reference !== "object" ||
        typeof (reference as Record<string, unknown>).objectName !== "string",
    )
  ) {
    throw new TempleResearchError("Temple research replay was incomplete.");
  }
  const replay = value as {
    evidenceSetHash: string;
    packetId: string;
    references: { objectName: string }[];
  };
  return Object.freeze({
    evidenceSetHash: replay.evidenceSetHash,
    imageUrls: await signedImageUrls(
      replay.references.map((reference) => reference.objectName),
    ),
    packetId: replay.packetId,
  });
}

export async function researchRealWorldSubject(input: {
  envelope: PreflightTaskEnvelope;
  extractionResultId: string;
  location: ExtractedLocation;
}): Promise<TempleResearchEvidence> {
  if (
    !input.location.researchRequired ||
    input.location.realWorldSubjectKind === "none" ||
    !input.location.realPlaceName
  ) {
    throw new TempleResearchError(
      "Real-world research was requested for a non-public subject.",
    );
  }
  const replay = await replayEvidence(
    input.extractionResultId,
    input.location.canonicalKey,
  );
  if (replay) return replay;
  const environment = getServerEnvironment().environment;
  const policy = await getActiveRemoteFetchPolicy({
    environment,
    fetchClass: "research_reference",
  });
  const metadata = await fetchReferenceMetadata(
    input.location.realPlaceName,
    input.location.realWorldSubjectKind,
  );
  const promoted: {
    assetVersionId: string;
    contentSha256: string;
    metadata: ReferenceMetadata;
    objectName: string;
  }[] = [];
  const fetchedContentHashes = new Set<string>();
  let recoverableCandidateFailure = false;
  for (const batch of researchReferenceBatches(metadata.references)) {
    const settled = await Promise.allSettled(
      batch.map(async (reference) => {
        const fetched = await fetchRemoteToQuarantineBuffer(reference.sourceFileUrl, {
          allowedContentTypes: eligibleMimeTypes,
          allowedHosts: policy.allowedHosts,
          fetchClass: "research_reference",
          maximumBytes: MAX_REFERENCE_BYTES,
          maximumRedirects: 2,
          timeoutMs: 60_000,
        });
        if (fetchedContentHashes.has(fetched.sha256)) return null;
        fetchedContentHashes.add(fetched.sha256);
        return {
          asset: await promoteReference({
            envelope: input.envelope,
            fetchResult: fetched,
            metadata: reference,
            policy,
          }),
          reference,
        };
      }),
    );
    for (const candidate of settled) {
      if (candidate.status === "rejected") {
        if (
          candidate.reason instanceof RemoteFetchPolicyError ||
          candidate.reason instanceof SandboxMediaScannerError
        ) {
          recoverableCandidateFailure ||=
            candidate.reason instanceof RemoteFetchPolicyError
              ? candidate.reason.retryable
              : candidate.reason.safeClass.startsWith("scanner.");
          continue;
        }
        throw candidate.reason;
      }
      if (!candidate.value) continue;
      retainDistinctResearchReference(promoted, {
        ...candidate.value.asset,
        metadata: candidate.value.reference,
      });
    }
    if (promoted.length === 4) break;
  }
  if (promoted.length < 2) {
    throw new TempleResearchError(
      "Two content-distinct licensed photographs of the real-world subject were not found.",
      recoverableCandidateFailure,
    );
  }
  const referenceManifest = promoted.map(({ assetVersionId, metadata: reference }) => ({
    assetVersionId,
    attributionRequired: reference.attributionRequired,
    authorCredit: reference.authorCredit,
    canonicalTitle: reference.canonicalTitle,
    licenseShortName: reference.licenseShortName,
    licenseUrl: reference.licenseUrl,
    sourceFileUrl: reference.sourceFileUrl,
    sourceHeight: reference.sourceHeight,
    sourceMetadataHash: reference.sourceMetadataHash,
    sourcePageUrl: reference.sourcePageUrl,
    sourceWidth: reference.sourceWidth,
  }));
  const evidence = {
    apiResponseSha256: metadata.apiResponseSha256,
    locationKey: input.location.canonicalKey,
    querySha256: metadata.querySha256,
    realPlaceName: input.location.realPlaceName,
    references: referenceManifest,
    schemaVersion: "genie.temple-research-evidence.v1",
    worldExtractionResultId: input.extractionResultId,
  };
  const evidenceSetHash = sha256(postgresJsonbText(evidence));
  const packetId = deterministicUuid(
    `temple-research:${input.extractionResultId}:${input.location.canonicalKey}:${evidenceSetHash}`,
  );
  const recorded = await rpc("command_record_temple_research_packet", {
    p_api_response_sha256: metadata.apiResponseSha256,
    p_evidence_set_hash: evidenceSetHash,
    p_location_key: input.location.canonicalKey,
    p_packet_id: packetId,
    p_preflight_run_id: input.envelope.preflightRunId,
    p_query_sha256: metadata.querySha256,
    p_real_place_name: input.location.realPlaceName,
    p_references: referenceManifest,
    p_stage_attempt_id: input.envelope.stageAttemptId,
    p_workspace_id: input.envelope.workspaceId,
    p_world_extraction_result_id: input.extractionResultId,
  });
  if (
    !exactObject(recorded, ["evidenceSetHash", "ok", "packetId", "replayed"]) ||
    (recorded as Record<string, unknown>).ok !== true ||
    (recorded as Record<string, unknown>).packetId !== packetId ||
    (recorded as Record<string, unknown>).evidenceSetHash !== evidenceSetHash
  ) {
    throw new TempleResearchError("Temple research record was malformed.");
  }
  return Object.freeze({
    evidenceSetHash,
    imageUrls: await signedImageUrls(promoted.map(({ objectName }) => objectName)),
    packetId,
  });
}

// Compatibility alias for callers and evidence whose durable table names predate
// festival and ritual research support.
export const researchNamedTemple = researchRealWorldSubject;

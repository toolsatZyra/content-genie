import "server-only";

import { createHash } from "node:crypto";

import type { ParsedFalWebhook } from "@/domain/provider/fal-webhook";
import { canonicalJson } from "@/security/command-envelope";
import { launchMediaLimits, sniffMediaMagic } from "@/security/media-ingest";
import {
  inspectStillImageDimensions,
  type StillImageMime,
} from "@/security/still-image-container";
import { readResponseBodyBounded } from "@/server/bounded-response-body";
import {
  getNextFalAuthenticatedPollCandidate,
  getProviderDispatchManifest,
  recordFalSignedWebhook,
} from "@/server/provider-broker-ledger";

const MAXIMUM_RESULT_BYTES = 1024 * 1024;
const pendingStatuses = new Set([400, 404, 409, 422, 425]);

export class FalResultRecoveryError extends Error {
  override readonly name = "FalResultRecoveryError";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function boundedBody(response: Response): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readResponseBodyBounded(response, MAXIMUM_RESULT_BYTES);
  } catch {
    throw new FalResultRecoveryError("FAL recovery result is too large.");
  }
  if (bytes.length < 1) {
    throw new FalResultRecoveryError("FAL recovery result size is invalid.");
  }
  return bytes.toString("utf8");
}

async function exactImageMetadata(
  media: Record<string, unknown>,
  fetchImplementation: typeof fetch,
): Promise<{ height: number; url: string; width: number }> {
  if (
    typeof media.url !== "string" ||
    !["image/png", "image/jpeg", "image/webp"].includes(String(media.content_type))
  ) {
    throw new FalResultRecoveryError("FAL recovery media metadata is invalid.");
  }
  let url: URL;
  try {
    url = new URL(media.url);
  } catch {
    throw new FalResultRecoveryError("FAL recovery media URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname.endsWith(".fal.media")
  ) {
    throw new FalResultRecoveryError("FAL recovery media URL is invalid.");
  }
  const declaredWidth = media.width == null ? null : Number(media.width);
  const declaredHeight = media.height == null ? null : Number(media.height);
  if (
    declaredWidth !== null &&
    declaredHeight !== null &&
    Number.isSafeInteger(declaredWidth) &&
    Number.isSafeInteger(declaredHeight) &&
    declaredWidth >= 320 &&
    declaredHeight >= 320 &&
    declaredWidth * declaredHeight <= launchMediaLimits.maximumPixels
  ) {
    return { height: declaredHeight, url: url.toString(), width: declaredWidth };
  }

  const response = await fetchImplementation(url, {
    method: "GET",
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new FalResultRecoveryError("FAL recovery media is unavailable.");
  }
  let bytes: Buffer;
  try {
    bytes = await readResponseBodyBounded(
      response,
      launchMediaLimits.maximumImageBytes,
    );
  } catch {
    throw new FalResultRecoveryError("FAL recovery media is unavailable.");
  }
  const mime = media.content_type as StillImageMime;
  const dimensions = inspectStillImageDimensions(bytes, mime);
  if (
    bytes.length < 1_024 ||
    bytes.length > launchMediaLimits.maximumImageBytes ||
    sniffMediaMagic(bytes) !== mime ||
    !dimensions ||
    dimensions.width < 320 ||
    dimensions.height < 320 ||
    dimensions.width * dimensions.height > launchMediaLimits.maximumPixels ||
    (declaredWidth !== null && declaredWidth !== dimensions.width) ||
    (declaredHeight !== null && declaredHeight !== dimensions.height)
  ) {
    throw new FalResultRecoveryError("FAL recovery media failed validation.");
  }
  return { ...dimensions, url: url.toString() };
}

export type FalResultRecoveryResult = Readonly<{
  checked: boolean;
  providerRequestId: string | null;
  recovered: boolean;
}>;

export async function recoverNextCompletedFalResult(
  input: Readonly<{
    environment: string;
    falKey?: string;
    fetchImplementation?: typeof fetch;
  }>,
): Promise<FalResultRecoveryResult> {
  const candidate = await getNextFalAuthenticatedPollCandidate({
    environment: input.environment,
  });
  if (!candidate) {
    return Object.freeze({ checked: false, providerRequestId: null, recovered: false });
  }
  const falKey = (input.falKey ?? process.env.FAL_KEY ?? "").trim();
  if (falKey.length < 16) {
    throw new FalResultRecoveryError("FAL recovery credential is unavailable.");
  }
  const manifest = await getProviderDispatchManifest(candidate.providerRequestId);
  if (
    manifest.provider !== "fal" ||
    !["gen_image", "edit_image"].includes(manifest.operation)
  ) {
    throw new FalResultRecoveryError("FAL recovery manifest is invalid.");
  }
  const fetchImplementation = input.fetchImplementation ?? fetch;
  const response = await fetchImplementation(
    `https://queue.fal.run/${manifest.modelKey}/requests/${candidate.externalJobId}`,
    {
      headers: { Authorization: `Key ${falKey}` },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (pendingStatuses.has(response.status)) {
    return Object.freeze({
      checked: true,
      providerRequestId: candidate.providerRequestId,
      recovered: false,
    });
  }
  if (!response.ok) {
    throw new FalResultRecoveryError(
      `FAL recovery result returned HTTP ${response.status}.`,
    );
  }
  const rawBody = await boundedBody(response);
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new FalResultRecoveryError("FAL recovery result JSON is invalid.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FalResultRecoveryError("FAL recovery result is invalid.");
  }
  const images = (value as Record<string, unknown>).images;
  if (!Array.isArray(images) || images.length !== 1) {
    throw new FalResultRecoveryError("FAL recovery image output is not exact.");
  }
  const image = images[0];
  if (!image || typeof image !== "object" || Array.isArray(image)) {
    throw new FalResultRecoveryError("FAL recovery image output is invalid.");
  }
  const media = image as Record<string, unknown>;
  const targetAssetId = manifest.payload.targetAssetId;
  if (typeof targetAssetId !== "string") {
    throw new FalResultRecoveryError("FAL recovery media metadata is invalid.");
  }
  const metadata = await exactImageMetadata(media, fetchImplementation);
  const output = Object.freeze({
    contentType: media.content_type as "image/jpeg" | "image/png" | "image/webp",
    height: metadata.height,
    ordinal: 1 as const,
    targetAssetId,
    url: metadata.url,
    urlSha256: sha256(metadata.url),
    width: metadata.width,
  });
  const canonicalPayloadHash = sha256(
    canonicalJson({
      externalJobId: candidate.externalJobId,
      gatewayRequestId: candidate.externalJobId,
      outputs: [output],
      status: "OK",
    }),
  );
  const webhook: ParsedFalWebhook = Object.freeze({
    canonicalPayloadHash,
    externalJobId: candidate.externalJobId,
    gatewayRequestId: candidate.externalJobId,
    outputs: Object.freeze([output]),
    rawBodySha256: sha256(rawBody),
    safeSummary: Object.freeze({
      gatewayRequestId: candidate.externalJobId,
      hasPayload: true,
      outputCount: 1,
      status: "OK",
      verificationClass: "authenticated_poll",
    }),
    status: "OK",
  });
  const recorded = await recordFalSignedWebhook({
    providerEventId: `poll:${candidate.externalJobId}`,
    providerRequestId: candidate.providerRequestId,
    webhook,
  });
  return Object.freeze({
    checked: true,
    providerRequestId: candidate.providerRequestId,
    recovered: ["accepted", "recorded"].includes(recorded.disposition),
  });
}

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
  failFalAuthenticatedPollCandidate,
  getNextFalAuthenticatedPollCandidate,
  getProviderDispatchManifest,
  recordFalSignedWebhook,
  releaseFalAuthenticatedPollCredentialClaim,
} from "@/server/provider-broker-ledger";

const MAXIMUM_RESULT_BYTES = 1024 * 1024;
const pendingStatuses = new Set([400, 404, 409, 422, 425]);
const credentialStatuses = new Set([401, 403]);
const terminalStatuses = new Set([410]);
const METHOD_NOT_ALLOWED = 405;
// FAL queue requests are durable and can remain in progress while runners
// scale or retry. The ledger already bounds authenticated claims at 100, so
// use that same terminal budget instead of failing a valid long-running job
// after only five cron passes.
const MAXIMUM_POLL_ATTEMPTS = 100;

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

async function fetchFalQueueResult(
  input: Readonly<{
    externalJobId: string;
    falKey: string;
    fetchImplementation: typeof fetch;
    modelKey: string;
  }>,
): Promise<Response> {
  const baseUrl = `https://queue.fal.run/${input.modelKey}/requests/${input.externalJobId}`;
  const request = {
    headers: { Authorization: `Key ${input.falKey}` },
    method: "GET",
    redirect: "error" as const,
    signal: AbortSignal.timeout(30_000),
  };
  const direct = await input.fetchImplementation(baseUrl, request);
  if (direct.status !== METHOD_NOT_ALLOWED) return direct;

  // FAL can expose an input subpath such as `nano-banana-2/edit` while its
  // submission receipt points status/result retrieval at the parent model
  // route. We currently persist the verified request id and endpoint id, so
  // recover that documented receipt shape deterministically when the subpath
  // rejects GET. Do not broaden beyond one exact trailing path segment.
  const modelSegments = input.modelKey.split("/");
  if (modelSegments.length === 3) {
    const parentModelKey = modelSegments.slice(0, 2).join("/");
    const parent = await input.fetchImplementation(
      `https://queue.fal.run/${parentModelKey}/requests/${input.externalJobId}`,
      request,
    );
    if (parent.status !== METHOD_NOT_ALLOWED) return parent;
  }

  // FAL receipts have used both the direct request URL and an explicit
  // `/response` URL across queue/model versions. A bounded authenticated
  // fallback keeps durable recovery compatible with either receipt shape.
  return input.fetchImplementation(`${baseUrl}/response`, request);
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
  const falKey = (input.falKey ?? process.env.FAL_KEY ?? "").trim();
  if (falKey.length < 16) {
    throw new FalResultRecoveryError("FAL recovery credential is unavailable.");
  }
  const candidate = await getNextFalAuthenticatedPollCandidate({
    environment: input.environment,
  });
  if (!candidate) {
    return Object.freeze({ checked: false, providerRequestId: null, recovered: false });
  }
  const terminalizeAtBudget = async (
    safeErrorClass: string,
    error: unknown,
  ): Promise<FalResultRecoveryResult> => {
    if (candidate.pollAttemptCount < MAXIMUM_POLL_ATTEMPTS) {
      throw error;
    }
    await failFalAuthenticatedPollCandidate({
      providerRequestId: candidate.providerRequestId,
      safeErrorClass,
    });
    return Object.freeze({
      checked: true,
      providerRequestId: candidate.providerRequestId,
      recovered: false,
    });
  };
  let manifest: Awaited<ReturnType<typeof getProviderDispatchManifest>>;
  try {
    manifest = await getProviderDispatchManifest(candidate.providerRequestId);
    if (
      manifest.provider !== "fal" ||
      !["gen_image", "edit_image"].includes(manifest.operation)
    ) {
      throw new FalResultRecoveryError("FAL recovery manifest is invalid.");
    }
  } catch (error) {
    if (error instanceof FalResultRecoveryError) {
      return terminalizeAtBudget("fal.poll.manifest-invalid", error);
    }
    throw error;
  }
  const fetchImplementation = input.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchFalQueueResult({
      externalJobId: candidate.externalJobId,
      falKey,
      fetchImplementation,
      modelKey: manifest.modelKey,
    });
  } catch (error) {
    if (candidate.pollAttemptCount >= MAXIMUM_POLL_ATTEMPTS) {
      await failFalAuthenticatedPollCandidate({
        providerRequestId: candidate.providerRequestId,
        safeErrorClass: "fal.poll.transport-exhausted",
      });
      return Object.freeze({
        checked: true,
        providerRequestId: candidate.providerRequestId,
        recovered: false,
      });
    }
    throw error;
  }
  if (pendingStatuses.has(response.status)) {
    if (candidate.pollAttemptCount >= MAXIMUM_POLL_ATTEMPTS) {
      await failFalAuthenticatedPollCandidate({
        providerRequestId: candidate.providerRequestId,
        safeErrorClass: "fal.poll.result-exhausted",
      });
    }
    return Object.freeze({
      checked: true,
      providerRequestId: candidate.providerRequestId,
      recovered: false,
    });
  }
  if (!response.ok) {
    if (credentialStatuses.has(response.status)) {
      await releaseFalAuthenticatedPollCredentialClaim({
        expectedPollAttemptCount: candidate.pollAttemptCount,
        providerRequestId: candidate.providerRequestId,
      });
      throw new FalResultRecoveryError(
        `FAL recovery credential was rejected with HTTP ${response.status}.`,
      );
    }
    if (
      terminalStatuses.has(response.status) ||
      candidate.pollAttemptCount >= MAXIMUM_POLL_ATTEMPTS
    ) {
      await failFalAuthenticatedPollCandidate({
        providerRequestId: candidate.providerRequestId,
        safeErrorClass: `fal.poll.http-${response.status}`,
      });
      return Object.freeze({
        checked: true,
        providerRequestId: candidate.providerRequestId,
        recovered: false,
      });
    }
    throw new FalResultRecoveryError(
      `FAL recovery result returned HTTP ${response.status}.`,
    );
  }
  let rawBody: string;
  let output: Readonly<{
    contentType: "image/jpeg" | "image/png" | "image/webp";
    height: number;
    ordinal: 1;
    targetAssetId: string;
    url: string;
    urlSha256: string;
    width: number;
  }>;
  try {
    rawBody = await boundedBody(response);
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
    output = Object.freeze({
      contentType: media.content_type as "image/jpeg" | "image/png" | "image/webp",
      height: metadata.height,
      ordinal: 1 as const,
      targetAssetId,
      url: metadata.url,
      urlSha256: sha256(metadata.url),
      width: metadata.width,
    });
  } catch (error) {
    return terminalizeAtBudget("fal.poll.output-invalid", error);
  }
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

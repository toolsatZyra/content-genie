import "server-only";

import { createHash } from "node:crypto";

import type { ParsedFalWebhook } from "@/domain/provider/fal-webhook";
import { canonicalJson } from "@/security/command-envelope";
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
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declared) || declared > MAXIMUM_RESULT_BYTES) {
    throw new FalResultRecoveryError("FAL recovery result is too large.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAXIMUM_RESULT_BYTES) {
    throw new FalResultRecoveryError("FAL recovery result size is invalid.");
  }
  return bytes.toString("utf8");
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
  const response = await (input.fetchImplementation ?? fetch)(
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
  if (
    typeof targetAssetId !== "string" ||
    typeof media.url !== "string" ||
    !media.url.startsWith("https://") ||
    !["image/png", "image/jpeg", "image/webp"].includes(String(media.content_type)) ||
    !Number.isSafeInteger(media.width) ||
    !Number.isSafeInteger(media.height)
  ) {
    throw new FalResultRecoveryError("FAL recovery media metadata is invalid.");
  }
  const output = Object.freeze({
    contentType: media.content_type as "image/jpeg" | "image/png" | "image/webp",
    height: media.height as number,
    ordinal: 1 as const,
    targetAssetId,
    url: media.url,
    urlSha256: sha256(media.url),
    width: media.width as number,
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

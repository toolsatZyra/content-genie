import "server-only";

import { createHash } from "node:crypto";

import { readJsonResponseBounded } from "@/server/bounded-response-body";

const QUEUE_ORIGIN = "https://queue.fal.run";
const MAXIMUM_PROVIDER_JSON_BYTES = 131_072;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class MvpMediaProviderBrokerError extends Error {
  override readonly name = "MvpMediaProviderBrokerError";

  constructor(
    message: string,
    readonly disposition: "terminal" | "unknown",
    readonly safeCode: string,
  ) {
    super(message);
  }
}

function falKey(): string {
  const key = process.env.FAL_KEY?.trim() ?? "";
  if (key.length < 16) {
    throw new MvpMediaProviderBrokerError(
      "FAL generation is not configured.",
      "terminal",
      "PROVIDER_UNAVAILABLE",
    );
  }
  return key;
}

function queueUrl(value: string, requestId?: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MvpMediaProviderBrokerError(
      "The provider returned an invalid queue URL.",
      "terminal",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  const pathSegments = url.pathname.split("/");
  const hasExactRequest = pathSegments.some(
    (segment, index) => segment === "requests" && pathSegments[index + 1] === requestId,
  );
  if (
    url.origin !== QUEUE_ORIGIN ||
    url.username ||
    url.password ||
    url.hash ||
    (requestId && !hasExactRequest)
  ) {
    throw new MvpMediaProviderBrokerError(
      "The provider returned an invalid queue URL.",
      "terminal",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  return url;
}

function controlUrl(value: unknown, requestId: string): string {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new MvpMediaProviderBrokerError(
      "The provider returned an invalid queue URL.",
      "terminal",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  return queueUrl(value, requestId).toString();
}

export type MvpFalControl = Readonly<{
  externalRequestId: string;
  responseUrl: string;
  statusUrl: string;
}>;

export type MvpFalBilledResult = Readonly<{
  data: Record<string, unknown>;
  providerReportedBillableUnits: number;
  providerUsageEvidenceSha256: string;
}>;

function billableUnits(response: Response): Readonly<{
  canonical: string;
  value: number;
}> {
  const raw = response.headers.get("x-fal-billable-units")?.trim() ?? "";
  if (!/^(?:0|[1-9][0-9]*)(?:[.][0-9]{1,4})?$/u.test(raw)) {
    throw new MvpMediaProviderBrokerError(
      "The provider result is missing exact billing evidence.",
      "terminal",
      "PROVIDER_BILLING_UNRECONCILED",
    );
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) {
    throw new MvpMediaProviderBrokerError(
      "The provider result contains invalid billing evidence.",
      "terminal",
      "PROVIDER_BILLING_UNRECONCILED",
    );
  }
  return Object.freeze({ canonical: String(value), value });
}

export async function submitMvpFalProvider(
  endpoint: string,
  payload: Readonly<Record<string, unknown>>,
  providerDispatchId: string,
  callbackToken: string,
): Promise<MvpFalControl> {
  let submitUrl: URL;
  try {
    const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL?.trim() ?? "");
    if (
      appUrl.protocol !== "https:" ||
      appUrl.username ||
      appUrl.password ||
      appUrl.hash ||
      !uuidPattern.test(providerDispatchId) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(callbackToken)
    ) {
      throw new TypeError("invalid callback identity");
    }
    const callback = new URL(
      `/api/internal/provider-webhooks/fal-mvp/${providerDispatchId.toLowerCase()}`,
      appUrl,
    );
    callback.searchParams.set("token", callbackToken);
    submitUrl = new URL(`${QUEUE_ORIGIN}/${endpoint}`);
    submitUrl.searchParams.set("fal_webhook", callback.toString());
  } catch {
    throw new MvpMediaProviderBrokerError(
      "FAL generation callback is not configured.",
      "terminal",
      "PROVIDER_UNAVAILABLE",
    );
  }
  let response: Response;
  try {
    response = await fetch(submitUrl, {
      body: JSON.stringify(payload),
      headers: {
        Authorization: `Key ${falKey()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (caught) {
    if (caught instanceof MvpMediaProviderBrokerError) throw caught;
    throw new MvpMediaProviderBrokerError(
      "The provider submission outcome is unknown.",
      "unknown",
      "PROVIDER_OUTCOME_UNKNOWN",
    );
  }
  if (!response.ok) {
    throw new MvpMediaProviderBrokerError(
      "The provider rejected the media request.",
      response.status === 408 || response.status === 429 || response.status >= 500
        ? "unknown"
        : "terminal",
      response.status === 408 || response.status === 429 || response.status >= 500
        ? "PROVIDER_OUTCOME_UNKNOWN"
        : "PROVIDER_SUBMISSION_REJECTED",
    );
  }
  let parsed: unknown;
  try {
    parsed = await readJsonResponseBounded(response, MAXIMUM_PROVIDER_JSON_BYTES);
  } catch {
    throw new MvpMediaProviderBrokerError(
      "The provider accepted a request but returned an unreadable receipt.",
      "unknown",
      "PROVIDER_OUTCOME_UNKNOWN",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MvpMediaProviderBrokerError(
      "The provider accepted a request but returned an invalid receipt.",
      "unknown",
      "PROVIDER_OUTCOME_UNKNOWN",
    );
  }
  const body = parsed as Record<string, unknown>;
  const requestId = body.request_id;
  if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{6,200}$/u.test(requestId)) {
    throw new MvpMediaProviderBrokerError(
      "The provider accepted a request but returned an invalid receipt.",
      "unknown",
      "PROVIDER_OUTCOME_UNKNOWN",
    );
  }
  try {
    return Object.freeze({
      externalRequestId: requestId,
      responseUrl: controlUrl(body.response_url, requestId),
      statusUrl: controlUrl(body.status_url, requestId),
    });
  } catch (caught) {
    if (!(caught instanceof MvpMediaProviderBrokerError)) throw caught;
    throw new MvpMediaProviderBrokerError(
      "The provider accepted a request but returned an invalid receipt.",
      "unknown",
      "PROVIDER_OUTCOME_UNKNOWN",
    );
  }
}

async function fetchMvpFalQueueResponse(
  urlValue: string,
  timeoutMs: number,
): Promise<Readonly<{ data: Record<string, unknown>; response: Response; url: URL }>> {
  const url = queueUrl(urlValue);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Key ${falKey()}` },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (caught) {
    if (caught instanceof MvpMediaProviderBrokerError) throw caught;
    throw new MvpMediaProviderBrokerError(
      "The provider queue outcome is temporarily unknown.",
      "unknown",
      "PROVIDER_STATUS_FAILED",
    );
  }
  if (!response.ok) {
    throw new MvpMediaProviderBrokerError(
      "The provider queue request failed.",
      response.status >= 500 || response.status === 408 || response.status === 429
        ? "unknown"
        : "terminal",
      "PROVIDER_STATUS_FAILED",
    );
  }
  let parsed: unknown;
  try {
    parsed = await readJsonResponseBounded(response, MAXIMUM_PROVIDER_JSON_BYTES);
  } catch {
    throw new MvpMediaProviderBrokerError(
      "The provider queue response is malformed.",
      "terminal",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MvpMediaProviderBrokerError(
      "The provider queue response is malformed.",
      "terminal",
      "PROVIDER_RESPONSE_INVALID",
    );
  }
  return Object.freeze({
    data: parsed as Record<string, unknown>,
    response,
    url,
  });
}

export async function fetchMvpFalQueueJson(
  urlValue: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  return (await fetchMvpFalQueueResponse(urlValue, timeoutMs)).data;
}

export async function fetchMvpFalQueueResult(
  urlValue: string,
  timeoutMs: number,
): Promise<MvpFalBilledResult> {
  const result = await fetchMvpFalQueueResponse(urlValue, timeoutMs);
  const billing = billableUnits(result.response);
  return Object.freeze({
    data: result.data,
    providerReportedBillableUnits: billing.value,
    providerUsageEvidenceSha256: createHash("sha256")
      .update(
        JSON.stringify({
          billableUnits: billing.canonical,
          responseUrl: result.url.toString(),
          sourceHeader: "x-fal-billable-units",
        }),
        "utf8",
      )
      .digest("hex"),
  });
}

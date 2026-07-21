import "server-only";

const QUEUE_ORIGIN = "https://queue.fal.run";

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

export async function submitMvpFalProvider(
  endpoint: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<MvpFalControl> {
  let response: Response;
  try {
    response = await fetch(`${QUEUE_ORIGIN}/${endpoint}`, {
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
    parsed = await response.json();
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

export async function fetchMvpFalQueueJson(
  urlValue: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
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
    parsed = await response.json();
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
  return parsed as Record<string, unknown>;
}

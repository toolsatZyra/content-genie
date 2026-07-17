export const MAX_CLIENT_DIAGNOSTIC_BYTES = 16_384;

export class ClientDiagnosticIntakeError extends Error {
  override readonly name = "ClientDiagnosticIntakeError";

  constructor(
    readonly code:
      "BODY_TOO_LARGE" | "INVALID_CONTENT_TYPE" | "INVALID_ORIGIN" | "RATE_LIMITED",
    message: string,
  ) {
    super(message);
  }
}

export class DiagnosticRateLimiter {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 20,
    private readonly windowMs = 60_000,
    private readonly maxBuckets = 500,
  ) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.#buckets.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.#buckets.size >= this.maxBuckets) {
        const oldest = this.#buckets.keys().next().value as string | undefined;
        if (oldest) this.#buckets.delete(oldest);
      }
      this.#buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }
}

export function validateClientDiagnosticHeaders(
  headers: Headers,
  requestUrl: string,
  configuredPublicUrl?: string,
): void {
  const contentLength = Number(headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_CLIENT_DIAGNOSTIC_BYTES) {
    throw new ClientDiagnosticIntakeError(
      "BODY_TOO_LARGE",
      "Client diagnostic body exceeds the byte limit.",
    );
  }

  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !contentType.startsWith("application/json") &&
    !contentType.startsWith("text/plain")
  ) {
    throw new ClientDiagnosticIntakeError(
      "INVALID_CONTENT_TYPE",
      "Client diagnostic content type is not accepted.",
    );
  }

  const expectedOrigin = new URL(configuredPublicUrl || requestUrl).origin;
  const origin = headers.get("origin");
  const fetchSite = headers.get("sec-fetch-site");
  if (origin !== expectedOrigin || (fetchSite && fetchSite !== "same-origin")) {
    throw new ClientDiagnosticIntakeError(
      "INVALID_ORIGIN",
      "Client diagnostic origin is not same-origin.",
    );
  }
}

export async function readBoundedDiagnosticJson(request: Request): Promise<unknown> {
  if (!request.body) {
    throw new SyntaxError("Client diagnostic body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_CLIENT_DIAGNOSTIC_BYTES) {
        await reader.cancel();
        throw new ClientDiagnosticIntakeError(
          "BODY_TOO_LARGE",
          "Client diagnostic body exceeds the byte limit.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

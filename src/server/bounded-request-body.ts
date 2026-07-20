export type BoundedRequestBodyFailure =
  "invalid-length" | "invalid-utf8" | "length-mismatch" | "read-failed" | "too-large";

export class BoundedRequestBodyError extends Error {
  readonly failure: BoundedRequestBodyFailure;

  constructor(failure: BoundedRequestBodyFailure, message: string) {
    super(message);
    this.name = "BoundedRequestBodyError";
    this.failure = failure;
  }
}

function assertMaximumBytes(maximumBytes: number): void {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new TypeError("The request-body byte limit is invalid.");
  }
}

export function declaredRequestBodyBytes(
  headers: Headers,
  maximumBytes: number,
): number | null {
  assertMaximumBytes(maximumBytes);
  const value = headers.get("content-length");
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new BoundedRequestBodyError(
      "invalid-length",
      "Invalid request content length.",
    );
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new BoundedRequestBodyError(
      "invalid-length",
      "Invalid request content length.",
    );
  }
  if (length > maximumBytes) {
    throw new BoundedRequestBodyError("too-large", "Request body is too large.");
  }
  return length;
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // The bounded-reader failure remains authoritative.
  }
}

export async function readBoundedUtf8RequestBody(
  request: Request,
  maximumBytes: number,
  declaredBytes = declaredRequestBodyBytes(request.headers, maximumBytes),
): Promise<string> {
  const bytes = await readBoundedRequestBody(request, maximumBytes, declaredBytes);
  try {
    const body = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
    const encoded = new TextEncoder().encode(body);
    if (
      encoded.byteLength !== bytes.byteLength ||
      encoded.some((value, index) => value !== bytes[index])
    ) {
      throw new TypeError("UTF-8 round trip mismatch.");
    }
    return body;
  } catch {
    throw new BoundedRequestBodyError(
      "invalid-utf8",
      "Request body is not valid UTF-8.",
    );
  }
}

export async function readBoundedRequestBody(
  request: Request,
  maximumBytes: number,
  declaredBytes = declaredRequestBodyBytes(request.headers, maximumBytes),
): Promise<Uint8Array> {
  assertMaximumBytes(maximumBytes);
  if (!request.body) {
    if (declaredBytes !== null && declaredBytes !== 0) {
      throw new BoundedRequestBodyError(
        "length-mismatch",
        "Request content length did not match the body.",
      );
    }
    return new Uint8Array();
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch {
        await cancelReader(reader);
        throw new BoundedRequestBodyError(
          "read-failed",
          "Request body could not be read safely.",
        );
      }
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) {
        await cancelReader(reader);
        throw new BoundedRequestBodyError(
          "read-failed",
          "Request body could not be read safely.",
        );
      }
      const nextTotal = totalBytes + part.value.byteLength;
      if (!Number.isSafeInteger(nextTotal) || nextTotal > maximumBytes) {
        await cancelReader(reader);
        throw new BoundedRequestBodyError("too-large", "Request body is too large.");
      }
      if (declaredBytes !== null && nextTotal > declaredBytes) {
        await cancelReader(reader);
        throw new BoundedRequestBodyError(
          "length-mismatch",
          "Request content length did not match the body.",
        );
      }
      chunks.push(part.value);
      totalBytes = nextTotal;
    }
  } finally {
    reader.releaseLock();
  }

  if (declaredBytes !== null && totalBytes !== declaredBytes) {
    throw new BoundedRequestBodyError(
      "length-mismatch",
      "Request content length did not match the body.",
    );
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

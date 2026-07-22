import "server-only";

export class BoundedResponseBodyError extends Error {
  override readonly name = "BoundedResponseBodyError";
}

function declaredLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (value === null) return null;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new BoundedResponseBodyError("The response length declaration is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new BoundedResponseBodyError("The response length declaration is invalid.");
  }
  return parsed;
}

function hasIdentityContentEncoding(response: Response): boolean {
  const value = response.headers.get("content-encoding")?.trim().toLowerCase();
  return value === undefined || value === "" || value === "identity";
}

export async function readResponseBodyBounded(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new BoundedResponseBodyError("The response byte limit is invalid.");
  }
  const declared = declaredLength(response);
  const identityEncoded = hasIdentityContentEncoding(response);
  if (identityEncoded && declared !== null && declared > maximumBytes) {
    throw new BoundedResponseBodyError("The response exceeds its byte limit.");
  }
  if (!response.body) {
    throw new BoundedResponseBodyError("The response body is unavailable.");
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel("response byte limit exceeded").catch(() => undefined);
        throw new BoundedResponseBodyError("The response exceeds its byte limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (identityEncoded && declared !== null && received !== declared) {
    throw new BoundedResponseBodyError(
      "The response body does not match its length declaration.",
    );
  }
  return Buffer.concat(chunks, received);
}

export async function readJsonResponseBounded(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const bytes = await readResponseBodyBounded(response, maximumBytes);
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new BoundedResponseBodyError("The response JSON is invalid.");
  }
}

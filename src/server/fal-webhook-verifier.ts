import "server-only";

import { createPublicKey, verify } from "node:crypto";

import {
  FalWebhookError,
  parseFalWebhookSignatureEnvelope,
} from "@/domain/provider/fal-webhook";

const FAL_JWKS_URL = "https://rest.fal.ai/.well-known/jwks.json";
const JWKS_CACHE_MS = 60 * 60 * 1_000;

type FalJwk = Readonly<{ crv: "Ed25519"; kty: "OKP"; x: string }>;
let cache: { expiresAt: number; keys: readonly FalJwk[] } | undefined;

function parseJwks(value: unknown): readonly FalJwk[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FalWebhookError("FAL JWKS is malformed.", true);
  }
  const keys = (value as Record<string, unknown>).keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 16) {
    throw new FalWebhookError("FAL JWKS key set is invalid.", true);
  }
  const parsed = keys.flatMap((key) => {
    if (!key || typeof key !== "object" || Array.isArray(key)) return [];
    const record = key as Record<string, unknown>;
    if (
      record.kty !== "OKP" ||
      record.crv !== "Ed25519" ||
      typeof record.x !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(record.x)
    ) {
      return [];
    }
    return [{ crv: "Ed25519", kty: "OKP", x: record.x } as const];
  });
  if (parsed.length < 1) {
    throw new FalWebhookError("FAL JWKS has no supported key.", true);
  }
  return Object.freeze(parsed);
}

async function fetchJwks(
  fetchImplementation: typeof fetch,
): Promise<readonly FalJwk[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.keys;
  let response: Response;
  try {
    response = await fetchImplementation(FAL_JWKS_URL, {
      headers: { Accept: "application/json" },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new FalWebhookError("FAL JWKS is unavailable.", true);
  }
  if (
    !response.ok ||
    response.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  ) {
    throw new FalWebhookError("FAL JWKS response is invalid.", true);
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > 64 * 1024) {
    throw new FalWebhookError("FAL JWKS response is too large.", true);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > 64 * 1024) {
    throw new FalWebhookError("FAL JWKS response size is invalid.", true);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new FalWebhookError("FAL JWKS JSON is malformed.", true);
  }
  const keys = parseJwks(value);
  cache = { expiresAt: now + JWKS_CACHE_MS, keys };
  return keys;
}

export async function verifyFalWebhook(
  headers: Headers,
  rawBody: string,
  options: Readonly<{
    fetchImplementation?: typeof fetch;
    nowSeconds?: number;
  }> = {},
): Promise<{ requestId: string; userId: string }> {
  const envelope = parseFalWebhookSignatureEnvelope(
    headers,
    rawBody,
    options.nowSeconds,
  );
  const keys = await fetchJwks(options.fetchImplementation ?? fetch);
  const verified = keys.some((jwk) => {
    try {
      return verify(
        null,
        envelope.message,
        createPublicKey({ format: "jwk", key: jwk }),
        envelope.signature,
      );
    } catch {
      return false;
    }
  });
  if (!verified) {
    throw new FalWebhookError("FAL webhook signature is invalid.", true);
  }
  return Object.freeze({ requestId: envelope.requestId, userId: envelope.userId });
}

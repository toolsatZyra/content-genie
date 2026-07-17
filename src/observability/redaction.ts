const bearer = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const jwt = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;
const providerKey = /\b(?:sk|key|token|secret)[-_][A-Za-z0-9_-]{8,}\b/gi;
const seedCanary = /GENIE_SERVER_SECRET_CANARY_[A-Za-z0-9_-]+/g;
const privateKey =
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/g;
const credentialUrl =
  /\b(?:postgres(?:ql)?|redis|mysql):\/\/[^@\s:/]+:[^@\s]+@[^\s]+/gi;
const sensitiveSegments = new Set([
  "authorization",
  "cookie",
  "credential",
  "jwt",
  "key",
  "password",
  "secret",
  "signedurl",
  "token",
]);

const MAX_DEPTH = 5;
const MAX_KEYS = 50;
const MAX_STRING = 2_000;

export type RedactedValue =
  | boolean
  | null
  | number
  | string
  | RedactedValue[]
  | { readonly [key: string]: RedactedValue };

export function redactText(value: string): string {
  return value
    .replace(privateKey, "[REDACTED_PRIVATE_KEY]")
    .replace(credentialUrl, "[REDACTED_CREDENTIAL_URL]")
    .replace(bearer, "[REDACTED_BEARER]")
    .replace(jwt, "[REDACTED_JWT]")
    .replace(providerKey, "[REDACTED_SECRET]")
    .replace(seedCanary, "[REDACTED_CANARY]")
    .slice(0, MAX_STRING);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
  const segments = normalized.split("_").filter(Boolean);
  return (
    segments.some((segment) => sensitiveSegments.has(segment)) ||
    segments.join("").includes("signedurl")
  );
}

export function redactValue(value: unknown, depth = 0): RedactedValue {
  if (depth >= MAX_DEPTH) return "[TRUNCATED_DEPTH]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return redactText(value);
  if (value instanceof Error) {
    return {
      message: redactText(value.message),
      name: value.name,
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((entry) => redactValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_KEYS)
        .map(([key, entry]) => [
          key,
          isSensitiveKey(key) ? "[REDACTED]" : redactValue(entry, depth + 1),
        ]),
    );
  }
  return redactText(String(value));
}

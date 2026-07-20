import "server-only";

import { timingSafeEqual } from "node:crypto";

import { getServerEnvironment } from "@/config/server-env";

export type SecureIngestCronEnvironment = Readonly<{
  cronSecret: string;
  environment: "development" | "preview" | "production" | "test";
}>;

export class SecureIngestCronEnvironmentError extends Error {
  override readonly name = "SecureIngestCronEnvironmentError";
}

export function parseSecureIngestCronSecret(
  source: Readonly<Record<string, string | undefined>>,
): string {
  const value = source.CRON_SECRET?.trim() ?? "";
  if (value.length < 32 || value.length > 512 || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new SecureIngestCronEnvironmentError(
      "Secure-ingest cron authorization is unavailable.",
    );
  }
  return value;
}

export function hasValidCronAuthorization(headers: Headers, secret: string): boolean {
  const authorization = headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const actualBytes = Buffer.from(authorization, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

let cached: SecureIngestCronEnvironment | undefined;

export function getSecureIngestCronEnvironment(): SecureIngestCronEnvironment {
  if (cached) return cached;
  const server = getServerEnvironment();
  if (!server.enableProviderSpend) {
    throw new SecureIngestCronEnvironmentError("Provider spend is disabled.");
  }
  cached = Object.freeze({
    cronSecret: parseSecureIngestCronSecret(process.env),
    environment: server.environment,
  });
  return cached;
}

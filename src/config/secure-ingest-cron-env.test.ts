import { describe, expect, it } from "vitest";

import {
  hasValidCronAuthorization,
  parseSecureIngestCronSecret,
  SecureIngestCronEnvironmentError,
} from "./secure-ingest-cron-env";

const secret = "s".repeat(48);

describe("secure-ingest cron environment", () => {
  it("accepts only a bounded non-whitespace secret", () => {
    expect(parseSecureIngestCronSecret({ CRON_SECRET: secret })).toBe(secret);
    expect(() => parseSecureIngestCronSecret({ CRON_SECRET: "short" })).toThrow(
      SecureIngestCronEnvironmentError,
    );
    expect(() =>
      parseSecureIngestCronSecret({ CRON_SECRET: `${"s".repeat(40)} bad` }),
    ).toThrow(SecureIngestCronEnvironmentError);
  });

  it("compares the exact Vercel bearer authorization", () => {
    expect(
      hasValidCronAuthorization(
        new Headers({ authorization: `Bearer ${secret}` }),
        secret,
      ),
    ).toBe(true);
    expect(
      hasValidCronAuthorization(
        new Headers({ authorization: `Bearer ${secret.slice(0, -1)}x` }),
        secret,
      ),
    ).toBe(false);
    expect(hasValidCronAuthorization(new Headers(), secret)).toBe(false);
  });
});

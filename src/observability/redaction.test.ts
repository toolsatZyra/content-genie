import { describe, expect, it } from "vitest";

import { redactText, redactValue } from "@/observability/redaction";

describe("diagnostic redaction", () => {
  it("removes credentials and seeded canaries", () => {
    const source =
      "Bearer abcdefghijklmnop GENIE_SERVER_SECRET_CANARY_seed key-abcdefghijkl";
    const output = redactText(source);

    expect(output).not.toContain("abcdefghijklmnop");
    expect(output).not.toContain("GENIE_SERVER_SECRET_CANARY_seed");
    expect(output).toContain("[REDACTED");
  });

  it("redacts sensitive keys recursively", () => {
    expect(
      redactValue({
        authorization: "Bearer private-value",
        nested: {
          cookie: "session=private",
          safe: "episode-42",
        },
      }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: {
        cookie: "[REDACTED]",
        safe: "episode-42",
      },
    });
  });

  it("normalizes camelCase and hyphenated secret field names", () => {
    expect(
      redactValue({
        accessToken: "private-access-token",
        apiKey: "private-api-key",
        "refresh-token": "private-refresh-token",
        signedUrl: "https://example.invalid/private",
        "x-api-key": "private-header-key",
      }),
    ).toEqual({
      accessToken: "[REDACTED]",
      apiKey: "[REDACTED]",
      "refresh-token": "[REDACTED]",
      signedUrl: "[REDACTED]",
      "x-api-key": "[REDACTED]",
    });
  });

  it("redacts credential URLs and private key material embedded in text", () => {
    const result = redactText(
      "postgresql://user:password@example.invalid/db -----BEGIN PRIVATE KEY----- secret -----END PRIVATE KEY-----",
    );
    expect(result).not.toContain("password");
    expect(result).not.toContain("BEGIN PRIVATE KEY");
  });

  it("bounds arrays, depth, errors, primitives, and unsupported values", () => {
    expect(redactValue(null)).toBeNull();
    expect(redactValue(true)).toBe(true);
    expect(redactValue(42)).toBe(42);
    expect(redactValue(new Error("Bearer abcdefghijklmnop"))).toEqual({
      message: "[REDACTED_BEARER]",
      name: "Error",
    });
    expect(redactValue(["safe", "key-abcdefghijkl"])).toEqual([
      "safe",
      "[REDACTED_SECRET]",
    ]);
    expect(
      redactValue({ nested: { nested: { nested: { nested: { value: 1 } } } } }),
    ).toEqual({
      nested: {
        nested: {
          nested: {
            nested: {
              value: "[TRUNCATED_DEPTH]",
            },
          },
        },
      },
    });
    expect(redactValue(Symbol("safe"))).toBe("Symbol(safe)");
  });
});

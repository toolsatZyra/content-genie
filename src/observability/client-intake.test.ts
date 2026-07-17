import { describe, expect, it } from "vitest";

import {
  ClientDiagnosticIntakeError,
  DiagnosticRateLimiter,
  MAX_CLIENT_DIAGNOSTIC_BYTES,
  readBoundedDiagnosticJson,
  validateClientDiagnosticHeaders,
} from "@/observability/client-intake";

function headers(overrides: Record<string, string> = {}): Headers {
  return new Headers({
    "content-type": "application/json",
    origin: "https://genie.example",
    "sec-fetch-site": "same-origin",
    ...overrides,
  });
}

describe("client diagnostic intake", () => {
  it("requires a same-origin JSON or beacon request", () => {
    expect(() =>
      validateClientDiagnosticHeaders(
        headers(),
        "https://genie.example/api/diagnostics/client",
      ),
    ).not.toThrow();
    expect(() =>
      validateClientDiagnosticHeaders(
        headers({ origin: "https://attacker.example" }),
        "https://genie.example/api/diagnostics/client",
      ),
    ).toThrow(ClientDiagnosticIntakeError);
    expect(() =>
      validateClientDiagnosticHeaders(
        headers({ "content-type": "application/xml" }),
        "https://genie.example/api/diagnostics/client",
      ),
    ).toThrow("content type");
    expect(() =>
      validateClientDiagnosticHeaders(
        headers({ "sec-fetch-site": "cross-site" }),
        "https://genie.example/api/diagnostics/client",
      ),
    ).toThrow("same-origin");
    expect(() =>
      validateClientDiagnosticHeaders(
        headers(),
        "http://internal-host:3000/api/diagnostics/client",
        "https://genie.example",
      ),
    ).not.toThrow();
  });

  it("rejects declared and streamed oversized bodies", async () => {
    expect(() =>
      validateClientDiagnosticHeaders(
        headers({ "content-length": String(MAX_CLIENT_DIAGNOSTIC_BYTES + 1) }),
        "https://genie.example/api/diagnostics/client",
      ),
    ).toThrow("byte limit");

    const body = JSON.stringify({ value: "x".repeat(MAX_CLIENT_DIAGNOSTIC_BYTES) });
    await expect(
      readBoundedDiagnosticJson(
        new Request("https://genie.example", { body, method: "POST" }),
      ),
    ).rejects.toThrow("byte limit");
  });

  it("parses bounded bodies and limits each client bucket", async () => {
    await expect(
      readBoundedDiagnosticJson(
        new Request("https://genie.example", {
          body: JSON.stringify({ event: "app.client_error" }),
          method: "POST",
        }),
      ),
    ).resolves.toEqual({ event: "app.client_error" });

    const limiter = new DiagnosticRateLimiter(2, 1_000, 2);
    expect(limiter.consume("client", 0)).toBe(true);
    expect(limiter.consume("client", 1)).toBe(true);
    expect(limiter.consume("client", 2)).toBe(false);
    expect(limiter.consume("client", 1_001)).toBe(true);

    const bounded = new DiagnosticRateLimiter(1, 1_000, 1);
    expect(bounded.consume("first", 0)).toBe(true);
    expect(bounded.consume("second", 1)).toBe(true);
  });

  it("rejects an absent request body", async () => {
    await expect(
      readBoundedDiagnosticJson(
        new Request("https://genie.example", { method: "POST" }),
      ),
    ).rejects.toThrow("body is required");
  });
});

import { describe, expect, it } from "vitest";

import {
  createCorrelationId,
  isCorrelationId,
  readCorrelationId,
} from "@/observability/correlation";

describe("correlation identifiers", () => {
  it("creates typed, valid identifiers", () => {
    const id = createCorrelationId("request");
    expect(id).toMatch(/^request_/);
    expect(isCorrelationId(id)).toBe(true);
  });

  it("accepts only bounded identifiers from headers", () => {
    expect(readCorrelationId(new Headers({ "x-request-id": "request_12345678" }))).toBe(
      "request_12345678",
    );
    expect(readCorrelationId(new Headers({ "x-request-id": "bad" }))).toBeNull();
    expect(isCorrelationId(null)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { isDefinitiveMutationStatus, readCommandResponse } from "./client";

describe("command mutation retry semantics", () => {
  it("preserves the idempotency attempt for retryable server outcomes", async () => {
    expect(isDefinitiveMutationStatus(503)).toBe(false);
    await expect(
      readCommandResponse(
        Response.json({ message: "Outcome unknown.", ok: false }, { status: 503 }),
        "fallback",
      ),
    ).rejects.toMatchObject({ definitive: false, status: 503 });
  });

  it("treats explicit domain conflicts as definitive", async () => {
    expect(isDefinitiveMutationStatus(409)).toBe(true);
    await expect(
      readCommandResponse(
        Response.json({ message: "Stale version.", ok: false }, { status: 409 }),
        "fallback",
      ),
    ).rejects.toMatchObject({ definitive: true, status: 409 });
  });
});

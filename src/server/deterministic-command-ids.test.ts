import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { deterministicCommandUuid } from "./deterministic-command-ids";

describe("deterministic command UUID", () => {
  it("is stable, scoped, versioned, and variant-correct", () => {
    const first = deterministicCommandUuid("world-lock", "workspace", "key");
    expect(first).toBe(deterministicCommandUuid("world-lock", "workspace", "key"));
    expect(first).not.toBe(
      deterministicCommandUuid("world-lock", "workspace", "other"),
    );
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

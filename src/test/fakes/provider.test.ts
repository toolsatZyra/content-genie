import { describe, expect, it } from "vitest";

import { FakeProvider } from "@/test/fakes/provider";

describe("fake provider", () => {
  it("returns the same result without repeating an idempotent call", async () => {
    const provider = new FakeProvider();
    const request = {
      idempotencyKey: "episode-1-shot-2-attempt-1",
      operation: "generate_video" as const,
      promptHash: "sha256:fixture",
    };

    const first = await provider.execute(request);
    const duplicate = await provider.execute(request);

    expect(duplicate).toEqual(first);
    expect(provider.calls).toHaveLength(1);
  });
});

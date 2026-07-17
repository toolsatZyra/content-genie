import { describe, expect, it } from "vitest";

import {
  DeterministicUuids,
  FixedClock,
  InMemoryObjectStore,
  SequentialIds,
} from "@/test/fakes/deterministic";

describe("deterministic test primitives", () => {
  it("keeps time and IDs reproducible", () => {
    const clock = new FixedClock(new Date("2026-07-17T00:00:00.000Z"));
    const ids = new SequentialIds();

    expect(clock.now().toISOString()).toBe("2026-07-17T00:00:00.000Z");
    expect(ids.next("request")).toBe("request_000001");
    expect(ids.next("request")).toBe("request_000002");
  });

  it("generates deterministic RFC 4122-shaped UUIDs", () => {
    const ids = new DeterministicUuids();
    expect(ids.next("ignored")).toBe("00000000-0000-4000-8000-000000000001");
    expect(ids.next("ignored")).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("copies bytes at the object-store boundary", () => {
    const store = new InMemoryObjectStore();
    const source = new Uint8Array([1, 2, 3]);
    store.put("workspace/episode/file", source);
    source[0] = 9;

    const stored = store.get("workspace/episode/file");
    expect(stored).toEqual(new Uint8Array([1, 2, 3]));
    if (stored) stored[1] = 8;
    expect(store.get("workspace/episode/file")).toEqual(new Uint8Array([1, 2, 3]));
  });
});

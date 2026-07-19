import { describe, expect, it } from "vitest";

import { retainIdempotencyAttempt } from "./idempotency";

describe("retained mutation idempotency", () => {
  it("reuses a key only for an identical payload fingerprint", () => {
    let sequence = 0;
    const createKey = () => `attempt-${++sequence}`;
    const first = retainIdempotencyAttempt(null, '{"script":"one"}', createKey);
    const retry = retainIdempotencyAttempt(first, '{"script":"one"}', createKey);
    const changed = retainIdempotencyAttempt(first, '{"script":"two"}', createKey);

    expect(retry).toBe(first);
    expect(changed).toEqual({
      fingerprint: '{"script":"two"}',
      key: "attempt-2",
    });
  });
});

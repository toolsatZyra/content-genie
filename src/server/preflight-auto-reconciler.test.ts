import { describe, expect, it } from "vitest";

import {
  narrationRunIdempotencyKey,
  narrationRunNeedsSuccessor,
  planRunIdempotencyKey,
} from "@/server/preflight-auto-reconciler";

describe("Preflight auto-reconciliation", () => {
  it("creates successors only for terminal narration runs", () => {
    expect(narrationRunNeedsSuccessor("failed")).toBe(true);
    expect(narrationRunNeedsSuccessor("canceled")).toBe(true);
    expect(narrationRunNeedsSuccessor("superseded")).toBe(true);
    expect(narrationRunNeedsSuccessor("queued")).toBe(false);
    expect(narrationRunNeedsSuccessor("waiting_external")).toBe(false);
    expect(narrationRunNeedsSuccessor("succeeded")).toBe(false);
  });

  it("derives a bounded new idempotency key from the terminal run identity", () => {
    const base = {
      configurationCandidateId: "830c078b-4aa3-4c02-a066-83f508ba8a49",
      sourceReviewPacketId: "7ba18541-1d10-5942-b517-c7619d46f763",
    };
    const first = narrationRunIdempotencyKey(base);
    const retry = narrationRunIdempotencyKey({
      ...base,
      supersededRunId: "be9f3aa7-8f3c-406d-9c8f-dfc0120e68c7",
    });

    expect(retry).not.toBe(first);
    expect(retry.length).toBeLessThanOrEqual(127);
    expect(retry).toMatch(/:retry:[a-f0-9]{16}$/u);
  });

  it("derives a fresh plan identity after a terminal plan attempt", () => {
    const base = {
      configurationCandidateId: "830c078b-4aa3-4c02-a066-83f508ba8a49",
      masterClockVersionId: "bcdbabc2-326b-59a7-ba20-a38fb052c155",
    };
    const first = planRunIdempotencyKey(base);
    const retry = planRunIdempotencyKey({
      ...base,
      supersededRunId: "000a0ec6-a2cc-40c9-86eb-9bf74ecf2e53",
    });

    expect(retry).not.toBe(first);
    expect(retry.length).toBeLessThanOrEqual(127);
    expect(retry).toMatch(/:retry:[a-f0-9]{16}$/u);
  });
});

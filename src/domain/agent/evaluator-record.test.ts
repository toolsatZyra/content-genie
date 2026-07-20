import { describe, expect, it } from "vitest";

import {
  EVALUATOR_SCHEMA_VERSION,
  EvaluatorRecordError,
  parseEvaluatorRecord,
} from "./evaluator-record";

const planHash = "a".repeat(64);
const evidenceId = "10000000-0000-4000-8000-000000000001";

describe("plan evaluator record", () => {
  it("accepts a plan-bound strict record", () => {
    expect(
      parseEvaluatorRecord(
        {
          findings: [],
          planHash,
          schemaVersion: EVALUATOR_SCHEMA_VERSION,
          score: 96,
          verdict: "pass",
        },
        planHash,
        [evidenceId],
      ).verdict,
    ).toBe("pass");
  });

  it("fails closed on stale hashes, unknown evidence, and averaged blockers", () => {
    const blocked = {
      findings: [
        {
          code: "PLAN_BLOCKER",
          evidenceVersionId: evidenceId,
          reason: "Reference graph is stale.",
          severity: "blocker",
        },
      ],
      planHash,
      schemaVersion: EVALUATOR_SCHEMA_VERSION,
      score: 90,
      verdict: "pass",
    };
    expect(() => parseEvaluatorRecord(blocked, "b".repeat(64), [evidenceId])).toThrow(
      EvaluatorRecordError,
    );
    expect(() => parseEvaluatorRecord(blocked, planHash, [])).toThrow(
      EvaluatorRecordError,
    );
    expect(() => parseEvaluatorRecord(blocked, planHash, [evidenceId])).toThrow(
      "contradicts",
    );
  });
});

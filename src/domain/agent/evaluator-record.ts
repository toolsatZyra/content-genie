const sha256Pattern = /^[a-f0-9]{64}$/u;
const codePattern = /^[A-Z][A-Z0-9_]{2,63}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const EVALUATOR_SCHEMA_VERSION = "genie.plan-evaluator.v1";

export type EvaluatorRecord = Readonly<{
  findings: readonly Readonly<{
    code: string;
    evidenceVersionId: string;
    reason: string;
    severity: "info" | "warning" | "blocker";
  }>[];
  planHash: string;
  score: number;
  schemaVersion: typeof EVALUATOR_SCHEMA_VERSION;
  verdict: "pass" | "block" | "indeterminate";
}>;

export class EvaluatorRecordError extends Error {
  override readonly name = "EvaluatorRecordError";
}

function exact(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

export function parseEvaluatorRecord(
  value: unknown,
  expectedPlanHash: string,
  allowedEvidenceVersionIds: readonly string[],
): EvaluatorRecord {
  if (!sha256Pattern.test(expectedPlanHash)) {
    throw new EvaluatorRecordError("Expected plan hash is invalid.");
  }
  if (!exact(value, ["findings", "planHash", "schemaVersion", "score", "verdict"])) {
    throw new EvaluatorRecordError("Evaluator record is not exact.");
  }
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== EVALUATOR_SCHEMA_VERSION ||
    input.planHash !== expectedPlanHash ||
    !Number.isSafeInteger(input.score) ||
    (input.score as number) < 0 ||
    (input.score as number) > 100 ||
    !["pass", "block", "indeterminate"].includes(String(input.verdict)) ||
    !Array.isArray(input.findings) ||
    input.findings.length > 64
  ) {
    throw new EvaluatorRecordError("Evaluator record is invalid.");
  }
  const findings = input.findings.map((finding) => {
    if (!exact(finding, ["code", "evidenceVersionId", "reason", "severity"])) {
      throw new EvaluatorRecordError("Evaluator finding is not exact.");
    }
    const item = finding as Record<string, unknown>;
    if (
      typeof item.code !== "string" ||
      !codePattern.test(item.code) ||
      typeof item.evidenceVersionId !== "string" ||
      !uuidPattern.test(item.evidenceVersionId) ||
      !allowedEvidenceVersionIds.includes(item.evidenceVersionId.toLowerCase()) ||
      typeof item.reason !== "string" ||
      item.reason.trim().length < 1 ||
      item.reason.length > 2_000 ||
      !["info", "warning", "blocker"].includes(String(item.severity))
    ) {
      throw new EvaluatorRecordError("Evaluator finding is invalid.");
    }
    return Object.freeze({
      code: item.code,
      evidenceVersionId: item.evidenceVersionId.toLowerCase(),
      reason: item.reason.trim(),
      severity: item.severity as "info" | "warning" | "blocker",
    });
  });
  if (
    (input.verdict === "pass" &&
      findings.some((finding) => finding.severity === "blocker")) ||
    (input.verdict === "block" &&
      !findings.some((finding) => finding.severity === "blocker"))
  ) {
    throw new EvaluatorRecordError("Evaluator verdict contradicts its findings.");
  }
  return Object.freeze({
    findings: Object.freeze(findings),
    planHash: expectedPlanHash,
    schemaVersion: EVALUATOR_SCHEMA_VERSION,
    score: input.score as number,
    verdict: input.verdict as EvaluatorRecord["verdict"],
  });
}

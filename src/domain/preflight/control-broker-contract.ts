const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const PREFLIGHT_CONTROL_SCHEMA_VERSION = "genie.preflight-control.v1";

export type PreflightControlOperation =
  "dispatch" | "execute" | "externalize" | "fail" | "finalize";

export type PreflightControlRequest = Readonly<{
  operation: PreflightControlOperation;
  preflightRunId: string;
  schemaVersion: typeof PREFLIGHT_CONTROL_SCHEMA_VERSION;
  stageAttemptId: string | null;
  stageRunId: string | null;
}>;

export class PreflightControlContractError extends Error {
  override readonly name = "PreflightControlContractError";
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new PreflightControlContractError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function parsePreflightControlRequest(rawBody: string): PreflightControlRequest {
  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    throw new PreflightControlContractError("Control request JSON is invalid.");
  }
  const keys = [
    "operation",
    "preflightRunId",
    "schemaVersion",
    "stageAttemptId",
    "stageRunId",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new PreflightControlContractError("Control request is not exact.");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== PREFLIGHT_CONTROL_SCHEMA_VERSION) {
    throw new PreflightControlContractError("Control schema is unsupported.");
  }
  if (
    !["dispatch", "execute", "externalize", "fail", "finalize"].includes(
      String(input.operation),
    )
  ) {
    throw new PreflightControlContractError("Control operation is invalid.");
  }
  const operation = input.operation as PreflightControlOperation;
  const stageBound =
    operation === "execute" || operation === "externalize" || operation === "fail";
  if (
    stageBound !== (input.stageAttemptId !== null) ||
    stageBound !== (input.stageRunId !== null)
  ) {
    throw new PreflightControlContractError(
      "Control stage authority shape is invalid.",
    );
  }
  return Object.freeze({
    operation,
    preflightRunId: uuid(input.preflightRunId, "preflightRunId"),
    schemaVersion: PREFLIGHT_CONTROL_SCHEMA_VERSION,
    stageAttemptId:
      input.stageAttemptId === null
        ? null
        : uuid(input.stageAttemptId, "stageAttemptId"),
    stageRunId: input.stageRunId === null ? null : uuid(input.stageRunId, "stageRunId"),
  });
}

export const PREFLIGHT_CONTROL_MAX_BODY_BYTES = 2_048;

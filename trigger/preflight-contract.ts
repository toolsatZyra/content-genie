import type { TaskOptions } from "@trigger.dev/sdk/v3";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export const PREFLIGHT_TASK_SCHEMA_VERSION = "genie.preflight-task.v1";

export type PreflightTaskEnvelope = Readonly<{
  authorityEpoch: number;
  capabilityGrantId: string | null;
  fencingToken: number;
  inputManifestId: string;
  inputManifestSha256: string;
  preflightRunId: string;
  schemaVersion: typeof PREFLIGHT_TASK_SCHEMA_VERSION;
  stageAttemptId: string;
  stageRunId: string;
  workspaceId: string;
}>;

export class PreflightTaskContractError extends Error {
  override readonly name = "PreflightTaskContractError";
}

function isExactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new PreflightTaskContractError(`${field} must be a UUID.`);
  }
  return value.toLowerCase();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new PreflightTaskContractError(`${field} must be a positive integer.`);
  }
  return value as number;
}

export function parsePreflightTaskEnvelope(value: unknown): PreflightTaskEnvelope {
  const keys = [
    "authorityEpoch",
    "capabilityGrantId",
    "fencingToken",
    "inputManifestId",
    "inputManifestSha256",
    "preflightRunId",
    "schemaVersion",
    "stageAttemptId",
    "stageRunId",
    "workspaceId",
  ] as const;
  if (!isExactObject(value, keys)) {
    throw new PreflightTaskContractError("Preflight task envelope is not exact.");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== PREFLIGHT_TASK_SCHEMA_VERSION) {
    throw new PreflightTaskContractError("Preflight task schema is unsupported.");
  }
  if (
    typeof input.inputManifestSha256 !== "string" ||
    !sha256Pattern.test(input.inputManifestSha256)
  ) {
    throw new PreflightTaskContractError("inputManifestSha256 is invalid.");
  }
  if (
    input.capabilityGrantId !== null &&
    (typeof input.capabilityGrantId !== "string" ||
      !uuidPattern.test(input.capabilityGrantId))
  ) {
    throw new PreflightTaskContractError("capabilityGrantId is invalid.");
  }
  return Object.freeze({
    authorityEpoch: positiveInteger(input.authorityEpoch, "authorityEpoch"),
    capabilityGrantId:
      input.capabilityGrantId === null
        ? null
        : (input.capabilityGrantId as string).toLowerCase(),
    fencingToken: positiveInteger(input.fencingToken, "fencingToken"),
    inputManifestId: uuid(input.inputManifestId, "inputManifestId"),
    inputManifestSha256: input.inputManifestSha256,
    preflightRunId: uuid(input.preflightRunId, "preflightRunId"),
    schemaVersion: PREFLIGHT_TASK_SCHEMA_VERSION,
    stageAttemptId: uuid(input.stageAttemptId, "stageAttemptId"),
    stageRunId: uuid(input.stageRunId, "stageRunId"),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
  });
}

type TriggerJsonSchema = NonNullable<
  TaskOptions<"genie-preflight-contract">["jsonSchema"]
>;

export const PREFLIGHT_TASK_JSON_SCHEMA: TriggerJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "authorityEpoch",
    "capabilityGrantId",
    "fencingToken",
    "inputManifestId",
    "inputManifestSha256",
    "preflightRunId",
    "schemaVersion",
    "stageAttemptId",
    "stageRunId",
    "workspaceId",
  ],
  properties: {
    authorityEpoch: { type: "integer", minimum: 1 },
    capabilityGrantId: {
      anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
    },
    fencingToken: { type: "integer", minimum: 1 },
    inputManifestId: { type: "string", format: "uuid" },
    inputManifestSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    preflightRunId: { type: "string", format: "uuid" },
    schemaVersion: { const: PREFLIGHT_TASK_SCHEMA_VERSION },
    stageAttemptId: { type: "string", format: "uuid" },
    stageRunId: { type: "string", format: "uuid" },
    workspaceId: { type: "string", format: "uuid" },
  },
};

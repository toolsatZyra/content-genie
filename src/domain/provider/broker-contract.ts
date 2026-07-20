const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;

export const PROVIDER_BROKER_SCHEMA_VERSION = "genie.provider-broker-request.v1";
export const PROVIDER_BROKER_MAX_BODY_BYTES = 32 * 1024;
export const microProviderOperations = [
  "gen_image",
  "edit_image",
  "gen_speech",
  "align_speech",
] as const;

export type MicroProviderOperation = (typeof microProviderOperations)[number];

export type ProviderBrokerRequest = Readonly<{
  authorityEpoch: number;
  capabilityGrantId: string;
  fencingToken: number;
  inputManifestId: string;
  inputManifestSha256: string;
  operation: MicroProviderOperation;
  preflightRunId: string;
  providerRequestId: string;
  quoteLineId: string;
  schemaVersion: typeof PROVIDER_BROKER_SCHEMA_VERSION;
  stageAttemptId: string;
  stageRunId: string;
  workspaceId: string;
}>;

export class ProviderBrokerContractError extends Error {
  override readonly name = "ProviderBrokerContractError";
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
    throw new ProviderBrokerContractError(`${field} is invalid.`);
  }
  return value.toLowerCase();
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ProviderBrokerContractError(`${field} is invalid.`);
  }
  return value as number;
}

export function parseProviderBrokerRequest(rawBody: string): ProviderBrokerRequest {
  if (Buffer.byteLength(rawBody, "utf8") > PROVIDER_BROKER_MAX_BODY_BYTES) {
    throw new ProviderBrokerContractError("Provider broker request is too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new ProviderBrokerContractError("Provider broker JSON is malformed.");
  }
  const keys = [
    "authorityEpoch",
    "capabilityGrantId",
    "fencingToken",
    "inputManifestId",
    "inputManifestSha256",
    "operation",
    "preflightRunId",
    "providerRequestId",
    "quoteLineId",
    "schemaVersion",
    "stageAttemptId",
    "stageRunId",
    "workspaceId",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new ProviderBrokerContractError("Provider broker request is not exact.");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== PROVIDER_BROKER_SCHEMA_VERSION) {
    throw new ProviderBrokerContractError("Provider broker schema is unsupported.");
  }
  if (!microProviderOperations.includes(input.operation as MicroProviderOperation)) {
    throw new ProviderBrokerContractError("Provider operation is not allowlisted.");
  }
  if (
    typeof input.inputManifestSha256 !== "string" ||
    !sha256Pattern.test(input.inputManifestSha256)
  ) {
    throw new ProviderBrokerContractError("inputManifestSha256 is invalid.");
  }
  return Object.freeze({
    authorityEpoch: positiveInteger(input.authorityEpoch, "authorityEpoch"),
    capabilityGrantId: uuid(input.capabilityGrantId, "capabilityGrantId"),
    fencingToken: positiveInteger(input.fencingToken, "fencingToken"),
    inputManifestId: uuid(input.inputManifestId, "inputManifestId"),
    inputManifestSha256: input.inputManifestSha256,
    operation: input.operation as MicroProviderOperation,
    preflightRunId: uuid(input.preflightRunId, "preflightRunId"),
    providerRequestId: uuid(input.providerRequestId, "providerRequestId"),
    quoteLineId: uuid(input.quoteLineId, "quoteLineId"),
    schemaVersion: PROVIDER_BROKER_SCHEMA_VERSION,
    stageAttemptId: uuid(input.stageAttemptId, "stageAttemptId"),
    stageRunId: uuid(input.stageRunId, "stageRunId"),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
  });
}

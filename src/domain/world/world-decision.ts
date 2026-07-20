import { createHash } from "node:crypto";

export type WorldDecisionKind = "accept" | "regenerate";
export type WorldEntityKind = "character" | "location";

export interface WorldDecisionInput {
  readonly candidateVersionId: string;
  readonly configurationCandidateId: string;
  readonly decision: WorldDecisionKind;
  readonly entityId: string;
  readonly entityKind: WorldEntityKind;
  readonly episodeId: string;
  readonly expectedSelectionVersion: number;
  readonly revisedPromptText: string | null;
  readonly workspaceId: string;
}

export class WorldDecisionContractError extends Error {
  override readonly name = "WorldDecisionContractError";
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseWorldDecisionInput(value: unknown): WorldDecisionInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WorldDecisionContractError("World decision must be an object.");
  }
  const row = value as Record<string, unknown>;
  const expected = [
    "candidateVersionId",
    "configurationCandidateId",
    "decision",
    "entityId",
    "entityKind",
    "episodeId",
    "expectedSelectionVersion",
    "revisedPromptText",
    "workspaceId",
  ].sort();
  const actual = Object.keys(row).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new WorldDecisionContractError("World decision is not exact.");
  }
  for (const field of [
    "candidateVersionId",
    "configurationCandidateId",
    "entityId",
    "episodeId",
    "workspaceId",
  ] as const) {
    if (typeof row[field] !== "string" || !uuid.test(row[field])) {
      throw new WorldDecisionContractError(`${field} must be a UUID.`);
    }
  }
  if (row.entityKind !== "character" && row.entityKind !== "location") {
    throw new WorldDecisionContractError("entityKind is unsupported.");
  }
  if (row.decision !== "accept" && row.decision !== "regenerate") {
    throw new WorldDecisionContractError("decision is unsupported.");
  }
  if (
    !Number.isInteger(row.expectedSelectionVersion) ||
    Number(row.expectedSelectionVersion) < 1
  ) {
    throw new WorldDecisionContractError("expectedSelectionVersion must be positive.");
  }
  const revisedPromptText = row.revisedPromptText;
  if (
    (row.decision === "regenerate" &&
      (typeof revisedPromptText !== "string" ||
        revisedPromptText.length < 1 ||
        revisedPromptText.length > 16_000)) ||
    (row.decision === "accept" && revisedPromptText !== null)
  ) {
    throw new WorldDecisionContractError(
      "revisedPromptText does not match the decision.",
    );
  }
  return row as unknown as WorldDecisionInput;
}

export function prepareWorldDecision(input: WorldDecisionInput): Readonly<{
  requestHash: string;
  revisedPromptSha256: string | null;
}> {
  return {
    requestHash: createHash("sha256")
      .update(JSON.stringify(input), "utf8")
      .digest("hex"),
    revisedPromptSha256:
      input.revisedPromptText === null
        ? null
        : createHash("sha256").update(input.revisedPromptText, "utf8").digest("hex"),
  };
}

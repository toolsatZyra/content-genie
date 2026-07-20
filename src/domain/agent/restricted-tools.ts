import { createHash } from "node:crypto";

import { canonicalJson } from "@/security/command-envelope";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const restrictedToolNames = [
  "source.extract",
  "cultural.triage",
  "world.prompt",
  "story.plan",
  "shot.plan",
  "edd.plan",
  "plan.evaluate",
] as const;

export type RestrictedToolName = (typeof restrictedToolNames)[number];

export type TrustedAgentScope = Readonly<{
  allowedObjectIds: readonly string[];
  configurationCandidateId: string;
  episodeId: string;
  policyVersionId: string;
  scriptRevisionId: string;
  sourceVersionIds: readonly string[];
  workspaceId: string;
}>;

export type AuthorizedReadOnlyToolCall = Readonly<{
  arguments: Readonly<Record<string, unknown>>;
  auditHash: string;
  classification: "read_only";
  limits: Readonly<{
    maximumCostMinor: 0;
    maximumDurationMs: 30_000;
    maximumFanOut: 32;
    maximumResultBytes: 131_072;
  }>;
  scope: TrustedAgentScope;
  tool: RestrictedToolName;
}>;

export class RestrictedToolError extends Error {
  override readonly name = "RestrictedToolError";
}

const prohibitedAuthorityKeys = new Set([
  "approval",
  "budget",
  "command",
  "credentials",
  "endpoint",
  "environment",
  "export",
  "filesystem",
  "headers",
  "http",
  "model",
  "path",
  "provider",
  "publish",
  "role",
  "secret",
  "shell",
  "sql",
  "token",
  "url",
  "workspaceId",
]);

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function assertUuid(value: string, field: string): void {
  if (!uuidPattern.test(value)) {
    throw new RestrictedToolError(`${field} is not a UUID.`);
  }
}

function assertTrustedScope(scope: TrustedAgentScope): void {
  for (const [field, value] of Object.entries({
    configurationCandidateId: scope.configurationCandidateId,
    episodeId: scope.episodeId,
    policyVersionId: scope.policyVersionId,
    scriptRevisionId: scope.scriptRevisionId,
    workspaceId: scope.workspaceId,
  })) {
    assertUuid(value, field);
  }
  if (scope.allowedObjectIds.length > 128 || scope.sourceVersionIds.length > 64) {
    throw new RestrictedToolError("Trusted scope exceeds its object limits.");
  }
  for (const id of [...scope.allowedObjectIds, ...scope.sourceVersionIds]) {
    assertUuid(id, "scope object ID");
  }
}

function assertNoAuthorityKeys(value: unknown, depth = 0): void {
  if (depth > 4) throw new RestrictedToolError("Tool arguments are too deeply nested.");
  if (Array.isArray(value)) {
    if (value.length > 32) throw new RestrictedToolError("Tool fan-out is too large.");
    for (const entry of value) assertNoAuthorityKeys(entry, depth + 1);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (prohibitedAuthorityKeys.has(key)) {
      throw new RestrictedToolError(`Tool arguments cannot contain ${key}.`);
    }
    assertNoAuthorityKeys(entry, depth + 1);
  }
}

function strings(
  value: unknown,
  field: string,
  maximumEntries: number,
  maximumLength: number,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > maximumEntries ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        entry.trim().length < 1 ||
        entry.length > maximumLength,
    )
  ) {
    throw new RestrictedToolError(`${field} is invalid.`);
  }
  return Object.freeze(value.map((entry) => entry.trim()));
}

function text(value: unknown, field: string, maximumLength: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > maximumLength
  ) {
    throw new RestrictedToolError(`${field} is invalid.`);
  }
  return value.trim();
}

function objectId(value: unknown, scope: TrustedAgentScope, field: string): string {
  const id = text(value, field, 36).toLowerCase();
  assertUuid(id, field);
  if (!scope.allowedObjectIds.includes(id) && !scope.sourceVersionIds.includes(id)) {
    throw new RestrictedToolError(`${field} is outside the trusted scope.`);
  }
  return id;
}

function parseArguments(
  tool: RestrictedToolName,
  value: unknown,
  scope: TrustedAgentScope,
): Readonly<Record<string, unknown>> {
  assertNoAuthorityKeys(value);
  switch (tool) {
    case "source.extract":
      if (!exactObject(value, ["questions"])) {
        throw new RestrictedToolError("source.extract arguments are not exact.");
      }
      return Object.freeze({
        questions: strings(
          (value as Record<string, unknown>).questions,
          "questions",
          16,
          500,
        ),
      });
    case "cultural.triage":
      if (!exactObject(value, ["claims"])) {
        throw new RestrictedToolError("cultural.triage arguments are not exact.");
      }
      return Object.freeze({
        claims: strings((value as Record<string, unknown>).claims, "claims", 32, 1_000),
      });
    case "world.prompt": {
      if (!exactObject(value, ["brief", "entityKind", "targetId"])) {
        throw new RestrictedToolError("world.prompt arguments are not exact.");
      }
      const input = value as Record<string, unknown>;
      if (input.entityKind !== "character" && input.entityKind !== "location") {
        throw new RestrictedToolError("entityKind is invalid.");
      }
      return Object.freeze({
        brief: text(input.brief, "brief", 4_000),
        entityKind: input.entityKind,
        targetId: objectId(input.targetId, scope, "targetId"),
      });
    }
    case "story.plan":
      if (!exactObject(value, ["objective"])) {
        throw new RestrictedToolError("story.plan arguments are not exact.");
      }
      return Object.freeze({
        objective: text(
          (value as Record<string, unknown>).objective,
          "objective",
          4_000,
        ),
      });
    case "shot.plan":
      if (!exactObject(value, ["storyPlanVersionId"])) {
        throw new RestrictedToolError("shot.plan arguments are not exact.");
      }
      return Object.freeze({
        storyPlanVersionId: objectId(
          (value as Record<string, unknown>).storyPlanVersionId,
          scope,
          "storyPlanVersionId",
        ),
      });
    case "edd.plan":
      if (!exactObject(value, ["shotPlanVersionId"])) {
        throw new RestrictedToolError("edd.plan arguments are not exact.");
      }
      return Object.freeze({
        shotPlanVersionId: objectId(
          (value as Record<string, unknown>).shotPlanVersionId,
          scope,
          "shotPlanVersionId",
        ),
      });
    case "plan.evaluate":
      if (!exactObject(value, ["planVersionId", "rubricVersionId"])) {
        throw new RestrictedToolError("plan.evaluate arguments are not exact.");
      }
      return Object.freeze({
        planVersionId: objectId(
          (value as Record<string, unknown>).planVersionId,
          scope,
          "planVersionId",
        ),
        rubricVersionId: objectId(
          (value as Record<string, unknown>).rubricVersionId,
          scope,
          "rubricVersionId",
        ),
      });
  }
}

export function authorizeReadOnlyToolCall(
  scope: TrustedAgentScope,
  proposal: unknown,
): AuthorizedReadOnlyToolCall {
  assertTrustedScope(scope);
  if (!exactObject(proposal, ["arguments", "tool"])) {
    throw new RestrictedToolError("Tool proposal is not exact.");
  }
  const input = proposal as Record<string, unknown>;
  if (!restrictedToolNames.includes(input.tool as RestrictedToolName)) {
    throw new RestrictedToolError("Tool is not allowlisted.");
  }
  const tool = input.tool as RestrictedToolName;
  const args = parseArguments(tool, input.arguments, scope);
  const serialized = canonicalJson({ args, scope, tool });
  if (Buffer.byteLength(serialized, "utf8") > 32_768) {
    throw new RestrictedToolError("Authorized tool envelope is too large.");
  }
  return Object.freeze({
    arguments: args,
    auditHash: createHash("sha256").update(serialized).digest("hex"),
    classification: "read_only",
    limits: Object.freeze({
      maximumCostMinor: 0,
      maximumDurationMs: 30_000,
      maximumFanOut: 32,
      maximumResultBytes: 131_072,
    }),
    scope: Object.freeze({ ...scope }),
    tool,
  });
}

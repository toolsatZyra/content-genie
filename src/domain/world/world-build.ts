const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const WORLD_BUILD_MAX_BODY_BYTES = 2_048;

export type WorldBuildRequest = Readonly<{
  configurationCandidateId: string;
  episodeId: string;
  workspaceId: string;
}>;

export class WorldBuildContractError extends Error {
  override readonly name = "WorldBuildContractError";
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new WorldBuildContractError(`${field} is invalid.`);
  }
  return value.toLowerCase();
}

export function parseWorldBuildRequest(rawBody: string): WorldBuildRequest {
  let value: unknown;
  try {
    value = JSON.parse(rawBody) as unknown;
  } catch {
    throw new WorldBuildContractError("World build JSON is invalid.");
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !==
      ["configurationCandidateId", "episodeId", "workspaceId"].sort().join(",")
  ) {
    throw new WorldBuildContractError("World build request is not exact.");
  }
  const input = value as Record<string, unknown>;
  return Object.freeze({
    configurationCandidateId: uuid(
      input.configurationCandidateId,
      "configurationCandidateId",
    ),
    episodeId: uuid(input.episodeId, "episodeId"),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
  });
}

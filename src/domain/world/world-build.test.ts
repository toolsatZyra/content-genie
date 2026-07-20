import { describe, expect, it } from "vitest";

import { parseWorldBuildRequest, WorldBuildContractError } from "./world-build";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

describe("world build request", () => {
  it("accepts only the exact episode/configuration/workspace scope", () => {
    expect(
      parseWorldBuildRequest(
        JSON.stringify({
          configurationCandidateId: id("1"),
          episodeId: id("2"),
          workspaceId: id("3"),
        }),
      ),
    ).toEqual({
      configurationCandidateId: id("1"),
      episodeId: id("2"),
      workspaceId: id("3"),
    });
  });

  it("rejects model-selected controls and additional fields", () => {
    for (const value of [
      { configurationCandidateId: id("1"), episodeId: id("2") },
      {
        configurationCandidateId: id("1"),
        episodeId: id("2"),
        taskId: "attacker-task",
        workspaceId: id("3"),
      },
    ]) {
      expect(() => parseWorldBuildRequest(JSON.stringify(value))).toThrow(
        WorldBuildContractError,
      );
    }
  });
});

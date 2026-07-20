import { describe, expect, it } from "vitest";

import {
  parseWorldDecisionInput,
  prepareWorldDecision,
  WorldDecisionContractError,
} from "./world-decision";

const input = {
  candidateVersionId: "10000000-0000-4000-8000-000000000001",
  configurationCandidateId: "10000000-0000-4000-8000-000000000002",
  decision: "regenerate",
  entityId: "10000000-0000-4000-8000-000000000003",
  entityKind: "character",
  episodeId: "10000000-0000-4000-8000-000000000004",
  expectedSelectionVersion: 2,
  revisedPromptText: "Keep Shiva's calm gaze and exact blue-grey skin tone.",
  workspaceId: "10000000-0000-4000-8000-000000000005",
} as const;

describe("World decision contract", () => {
  it("parses and hashes an exact regeneration", () => {
    const parsed = parseWorldDecisionInput(input);
    expect(prepareWorldDecision(parsed).requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(prepareWorldDecision(parsed).revisedPromptSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([
    { ...input, extra: true },
    { ...input, expectedSelectionVersion: 0 },
    { ...input, decision: "accept", revisedPromptText: input.revisedPromptText },
    { ...input, decision: "regenerate", revisedPromptText: null },
  ])("rejects malformed input %#", (value) => {
    expect(() => parseWorldDecisionInput(value)).toThrow(WorldDecisionContractError);
  });
});

import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ agent: vi.fn() }));

vi.mock("@/server/ledgered-openai-agent", () => ({
  runLedgeredOpenAiStructuredAgent: mocks.agent,
}));

import { extractWorldFromLockedScript } from "./world-extraction-agent";

const authority = {
  configurationCandidateId: "10000000-0000-4000-8000-000000000004",
  episodeId: "10000000-0000-4000-8000-000000000003",
  policyVersionId: "10000000-0000-4000-8000-000000000007",
  preflightRunId: "10000000-0000-4000-8000-000000000006",
  scriptRevisionId: "10000000-0000-4000-8000-000000000002",
  stageAttemptId: "10000000-0000-4000-8000-000000000009",
  trustedScopeHash: "a".repeat(64),
  workspaceId: "10000000-0000-4000-8000-000000000001",
} as const;

const extraction = {
  ambiguities: [],
  characters: [
    {
      canonicalKey: "shiva",
      continuityRole: "primary",
      culturalNotes: ["Preserve Shaiva iconography."],
      displayName: "Bhagwan Shiva",
      forms: [
        {
          agePresentation: "ageless adult",
          cameraAngle: "slightly low eye line",
          clothingAndJewellery: "tiger-skin drape and rudraksha beads",
          continuityDirectives: ["same face", "same crescent placement"],
          displayName: "Meditating Shiva",
          emotionalBaseline: "serene compassion",
          environment: "a quiet ledge on Mount Kailash",
          facialIdentity: "oval face, calm deep-set eyes, straight nose",
          formKey: "meditating",
          framing: "three-quarter full body portrait",
          hairAndHeadwear: "high matted jata with crescent moon",
          lightingMode: "soft predawn blue with warm divine rim light",
          physicalDescription: "tall balanced build, ash-blue complexion",
          sacredAttributes: ["trident", "crescent moon", "serpent at neck"],
          subjectPose: "seated in stable meditation with hands at rest",
        },
      ],
    },
  ],
  culturalReviewNotes: ["Regional Shaiva retellings are acceptable."],
  locations: [
    {
      architectureAndEra: "timeless Himalayan sacred landscape",
      cameraAngle: "low wide perspective",
      canonicalKey: "mount-kailash-ledge",
      continuityDirectives: ["same ridge silhouette"],
      displayName: "Mount Kailash ledge",
      environmentDescription: "snowy sacred mountain ledge above cloud layers",
      framing: "wide vertical establishing frame",
      lightingMode: "predawn blue with first warm rays",
      namedTemple: false,
      realPlaceName: null,
      realWorldSubjectKind: "none",
      researchRequired: false,
      sacredDetails: ["small undisturbed meditation platform"],
      timeAndAtmosphere: "still predawn air with subtle drifting mist",
    },
  ],
  schemaVersion: "genie.world-extraction.v1",
  scopeSignals: {
    containsDialogue: false,
    narrationOnly: true,
    requiresLipSync: false,
  },
  storyContext: {
    era: "mythic sacred time",
    primaryTradition: "Shaiva",
    regionalContext: null,
  },
} as const;

describe("ledgered World Extraction", () => {
  beforeEach(() => vi.resetAllMocks());

  it("authorizes the exact script-bound model call before accepting extraction", async () => {
    const script = "शिव कैलाश पर ध्यान में स्थित थे।";
    const scriptSha256 = createHash("sha256").update(script).digest("hex");
    mocks.agent.mockResolvedValue({
      output: extraction,
      requestHash: "b".repeat(64),
      responseId: "resp_world",
      responseRequestId: "req_world",
    });

    const result = await extractWorldFromLockedScript({
      authority,
      script,
      scriptSha256,
    });

    expect(result.extraction.scopeSignals.narrationOnly).toBe(true);
    expect(result.inputHash).toBe(scriptSha256);
    expect(mocks.agent).toHaveBeenCalledTimes(1);
    expect(mocks.agent.mock.calls[0]?.[0]).toEqual({
      ...authority,
      maximumFanOut: 1,
      sourceSetHash: scriptSha256,
      toolName: "source.extract",
    });
    expect(mocks.agent.mock.calls[0]?.[1]).toMatchObject({
      maxOutputTokens: 12_000,
      model: "gpt-5.6-sol",
      schemaName: "genie_world_extraction",
    });
  });

  it("performs no model call when exact script bytes do not match", async () => {
    await expect(
      extractWorldFromLockedScript({
        authority,
        script: "immutable script",
        scriptSha256: "0".repeat(64),
      }),
    ).rejects.toThrow("exact script bytes");
    expect(mocks.agent).not.toHaveBeenCalled();
  });
});

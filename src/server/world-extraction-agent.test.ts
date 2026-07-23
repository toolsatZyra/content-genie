import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ agent: vi.fn() }));

vi.mock("@/server/ledgered-openai-agent", () => ({
  runLedgeredOpenAiStructuredAgent: mocks.agent,
}));

import {
  extractWorldFromLockedScript,
  WORLD_EXTRACTION_JSON_SCHEMA,
} from "./world-extraction-agent";

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
          identityManifest: {
            allowedTransitions: [],
            deity: {
              arms: [
                {
                  armId: "left-1",
                  handId: "left-hand-1",
                  ordinal: 1,
                  side: "left",
                },
                {
                  armId: "right-1",
                  handId: "right-hand-1",
                  ordinal: 1,
                  side: "right",
                },
              ],
              handObjectAssignments: [
                {
                  assignmentKind: "weapon",
                  handId: "left-hand-1",
                  objectKey: "trident",
                },
                {
                  assignmentKind: "empty",
                  handId: "right-hand-1",
                  objectKey: null,
                },
              ],
              vahana: { key: null, status: "none" },
              weapons: [{ key: "trident", required: true }],
            },
            dignity: {
              prohibited: ["caricature", "sexualized depiction"],
              required: ["serene compassion"],
            },
            form: {
              rules: {
                prohibited: ["identity drift", "anatomy drift"],
                required: [
                  "tall balanced build, ash-blue complexion",
                  "oval face, calm deep-set eyes, straight nose",
                  "high matted jata with crescent moon",
                  "same face",
                  "same crescent placement",
                ],
              },
              topology: {
                armCount: 2,
                handCount: 2,
                headCount: 1,
                legCount: 2,
              },
            },
            identity: {
              canonicalName: "Bhagwan Shiva",
              characterKey: "shiva",
              essentialAttributes: [
                "trident",
                "crescent moon",
                "rudraksha beads",
                "serpent at neck",
              ],
              formKey: "meditating",
              formName: "Meditating Shiva",
            },
            isDeity: true,
            ornaments: [
              {
                key: "crescent-moon",
                placement: "in the matted hair",
                required: true,
              },
              {
                key: "rudraksha",
                placement: "around the neck",
                required: true,
              },
              {
                key: "serpent",
                placement: "coiled at the neck",
                required: true,
              },
            ],
            schemaVersion: "genie-character-identity-manifest.v2",
            skin: {
              formRules: ["ageless adult", "ash-blue divine adult form"],
              toneRules: ["ash-blue complexion"],
            },
            wardrobe: {
              prohibited: ["modern clothing"],
              required: ["tiger-skin drape and rudraksha beads"],
            },
          },
          lightingMode: "soft predawn blue with warm divine rim light",
          physicalDescription: "tall balanced build, ash-blue complexion",
          sacredAttributes: [
            {
              depictionKind: "weapon",
              description: "trident",
              key: "trident",
              required: true,
            },
            {
              depictionKind: "ornament",
              description: "crescent moon",
              key: "crescent-moon",
              required: true,
            },
            {
              depictionKind: "ornament",
              description: "rudraksha beads",
              key: "rudraksha",
              required: true,
            },
            {
              depictionKind: "ornament",
              description: "serpent at neck",
              key: "serpent",
              required: true,
            },
          ],
          subjectPose: "seated in meditation, left hand holding the trident",
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
  props: [
    {
      cameraAngle: "slightly low three-quarter object view",
      canonicalKey: "shivas-pinaka-bow",
      continuityDirectives: ["same silhouette and fittings"],
      continuityRole: "primary",
      culturalNotes: ["Preserve Pinaka as Shiva's sacred bow."],
      displayName: "Shiva's Pinaka bow",
      environment: "neutral dark studio field",
      framing: "complete isolated object reference",
      lightingMode: "soft museum-style rim and fill light",
      materialAndFinish: "ancient dark wood and sacred metal fittings",
      sacredOrFunctionalDetails: ["recurved limbs", "Shaiva carvings"],
      visualDescription: "monumental sacred bow with a divine profile",
    },
  ],
  schemaVersion: "genie.world-extraction.v3",
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
      maximumFanOut: 2,
      sourceSetHash: scriptSha256,
      toolName: "source.extract",
    });
    expect(mocks.agent.mock.calls[0]?.[1]).toMatchObject({
      maxOutputTokens: 12_000,
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      schemaName: "genie_world_extraction",
    });
  });

  it("repairs one structurally inconsistent identity manifest within the same fenced attempt", async () => {
    const script = "Vishnu entered the cave after the battle.";
    const scriptSha256 = createHash("sha256").update(script).digest("hex");
    const form = extraction.characters[0].forms[0];
    const deity = form.identityManifest.deity;
    if (!deity) throw new Error("The fixture must contain a deity manifest.");
    const inconsistentExtraction = {
      ...extraction,
      characters: [
        {
          ...extraction.characters[0],
          forms: [
            {
              ...form,
              identityManifest: {
                ...form.identityManifest,
                deity: {
                  ...deity,
                  weapons: [{ key: "unassigned-bow", required: true }],
                },
              },
            },
          ],
        },
      ],
    };
    mocks.agent
      .mockResolvedValueOnce({
        output: inconsistentExtraction,
        requestHash: "e".repeat(64),
        responseId: "resp_world_invalid",
        responseRequestId: "req_world_invalid",
      })
      .mockResolvedValueOnce({
        output: extraction,
        requestHash: "f".repeat(64),
        responseId: "resp_world_repaired",
        responseRequestId: "req_world_repaired",
      });

    const result = await extractWorldFromLockedScript({
      authority,
      script,
      scriptSha256,
    });

    expect(result.responseId).toBe("resp_world_repaired");
    expect(result.modelRequestHash).toBe("f".repeat(64));
    expect(mocks.agent).toHaveBeenCalledTimes(2);
    expect(mocks.agent.mock.calls[1]?.[0]).toMatchObject({
      maximumFanOut: 2,
      stageAttemptId: authority.stageAttemptId,
      toolName: "source.extract",
    });
    expect(mocks.agent.mock.calls[1]?.[1]).toMatchObject({
      input: expect.stringContaining(
        "VALIDATION_FAILURE_CODE=character_identity_manifest_cross_binding",
      ),
      instructions: expect.stringContaining("deity.weapons must equal the exact set"),
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

  it("uses only structured-output schema keywords accepted by the provider", () => {
    const serialized = JSON.stringify(WORLD_EXTRACTION_JSON_SCHEMA);
    expect(serialized).not.toContain('"uniqueItems"');
    expect(serialized).toContain('"prop"');
    expect(serialized).toContain("Never use formKey");
  });

  it("defines quoted prose as selected-narrator delivery rather than lip-sync", async () => {
    const script = 'Janaka announced: "Sita will marry Rama."';
    const scriptSha256 = createHash("sha256").update(script).digest("hex");
    mocks.agent.mockResolvedValue({
      output: extraction,
      requestHash: "c".repeat(64),
      responseId: "resp_quote",
      responseRequestId: "req_quote",
    });

    await extractWorldFromLockedScript({ authority, script, scriptSha256 });

    expect(mocks.agent.mock.calls[0]?.[1]).toMatchObject({
      instructions: expect.stringContaining(
        "Quoted speech inside narrator-read prose is therefore still narrationOnly true",
      ),
    });
  });

  it("keeps generically named sacred props usable without inventing iconography", async () => {
    const script = "Rama lifted Shiva's great bow.";
    const scriptSha256 = createHash("sha256").update(script).digest("hex");
    mocks.agent.mockResolvedValue({
      output: extraction,
      requestHash: "d".repeat(64),
      responseId: "resp_generic_prop",
      responseRequestId: "req_generic_prop",
    });

    await extractWorldFromLockedScript({ authority, script, scriptSha256 });

    expect(mocks.agent.mock.calls[0]?.[1]).toMatchObject({
      instructions: expect.stringContaining(
        "The absence of a more specific name is not a blocking ambiguity",
      ),
    });
  });
});

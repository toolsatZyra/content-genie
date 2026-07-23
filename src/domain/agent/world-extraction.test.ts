import { describe, expect, it } from "vitest";

import {
  compileCharacterAnchorPrompt,
  compileLocationAnchorPrompt,
  compilePropAnchorPrompt,
  parseWorldExtraction,
  WORLD_EXTRACTION_SCHEMA_VERSION,
  WorldExtractionError,
} from "./world-extraction";
import { DEFAULT_LOOK_ID, findLook } from "@/domain/look/look-registry";

const extraction = {
  ambiguities: [],
  characters: [
    {
      canonicalKey: "shiva",
      continuityRole: "primary",
      culturalNotes: ["Respect Shaiva iconography and avoid caricature."],
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
      continuityDirectives: ["same bow silhouette", "same material and carvings"],
      continuityRole: "primary",
      culturalNotes: ["Treat Pinaka as Shiva's sacred bow, never generic weaponry."],
      displayName: "Shiva's Pinaka bow",
      environment: "neutral dark studio field",
      framing: "complete isolated object reference",
      lightingMode: "soft museum-style rim and fill light",
      materialAndFinish: "ancient dark wood, sacred metal fittings",
      sacredOrFunctionalDetails: ["distinctive recurved limbs", "Shaiva carvings"],
      visualDescription: "monumental sacred bow with an unmistakable divine profile",
    },
  ],
  schemaVersion: WORLD_EXTRACTION_SCHEMA_VERSION,
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

describe("world extraction contract", () => {
  it("accepts an exact grounded world and compiles the locked look as paragraph two", () => {
    const parsed = parseWorldExtraction(extraction);
    const look = findLook(DEFAULT_LOOK_ID)!;
    const prompt = compileCharacterAnchorPrompt(
      parsed.characters[0]!,
      parsed.characters[0]!.forms[0]!,
      look,
    );
    const blocks = prompt.prompt.split("\n\n");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("Bhagwan Shiva");
    expect(blocks[0]).toContain(
      "Exact immutable anatomy: 1 head(s), 2 arm(s), 2 hand(s), 2 leg(s)",
    );
    expect(blocks[0]).toContain("left hand 1 performs or holds exactly weapon trident");
    expect(blocks[0]).toContain("rudraksha beads around the neck");
    expect(blocks[0]).toContain(
      "Never depict these manifest-prohibited features: modern clothing",
    );
    expect(blocks[0]).toContain("Single self-contained still image only");
    expect(blocks[0]).toContain("no sequence, montage, split frame");
    expect(blocks[1]).toBe(look.lockedLookBlock);
    expect(prompt.negativePrompt).toContain(look.negativePolicy.promptTail);
    expect(prompt.negativePrompt).toContain(
      "Character-manifest exclusions: modern clothing; identity drift",
    );
  });

  it("blocks a named temple until photographic references are verified", () => {
    const parsed = parseWorldExtraction({
      ...extraction,
      locations: [
        {
          ...extraction.locations[0],
          displayName: "Kashi Vishwanath Temple",
          namedTemple: true,
          realPlaceName: "Shri Kashi Vishwanath Temple, Varanasi",
          realWorldSubjectKind: "temple",
          researchRequired: true,
        },
      ],
    });
    const look = findLook(DEFAULT_LOOK_ID)!;
    expect(() => compileLocationAnchorPrompt(parsed.locations[0]!, look)).toThrow(
      "verified photographic references",
    );
    expect(
      compileLocationAnchorPrompt(parsed.locations[0]!, look, true).prompt,
    ).toContain(look.lockedLookBlock);
  });

  it("extracts a story-significant sacred prop and compiles an isolated continuity anchor", () => {
    const parsed = parseWorldExtraction(extraction);
    const look = findLook(DEFAULT_LOOK_ID)!;
    const prompt = compilePropAnchorPrompt(parsed.props[0]!, look);
    expect(prompt.prompt).toContain("Shiva's Pinaka bow");
    expect(prompt.prompt).toContain("without a person holding it");
    expect(prompt.prompt).toContain("no sequence, montage, split frame");
    expect(prompt.prompt.split("\n\n")[1]).toBe(look.lockedLookBlock);
  });

  it("requires public photographic evidence for named festivals and preserves people", () => {
    const parsed = parseWorldExtraction({
      ...extraction,
      locations: [
        {
          ...extraction.locations[0],
          displayName: "Durga Puja",
          realPlaceName: "Durga Puja",
          realWorldSubjectKind: "festival",
          researchRequired: true,
        },
      ],
    });
    const look = findLook(DEFAULT_LOOK_ID)!;
    expect(() => compileLocationAnchorPrompt(parsed.locations[0]!, look)).toThrow(
      "verified photographic references",
    );
    const prompt = compileLocationAnchorPrompt(parsed.locations[0]!, look, true).prompt;
    expect(prompt).toContain("documentary reference plate");
    expect(prompt).toContain("authentic setting, actions, dress, objects");
    expect(prompt).toContain("Single self-contained still image only");
    expect(prompt).not.toContain("No people");
  });

  it("rejects duplicate world keys, unbound ambiguity keys, and guessed temple metadata", () => {
    for (const value of [
      {
        ...extraction,
        locations: [{ ...extraction.locations[0], canonicalKey: "shiva" }],
      },
      {
        ...extraction,
        ambiguities: [
          {
            affectedKeys: ["unknown"],
            blocksGeneration: true,
            description: "Unknown identity.",
            kind: "identity",
          },
        ],
      },
      {
        ...extraction,
        locations: [
          {
            ...extraction.locations[0],
            realPlaceName: "A guessed temple",
          },
        ],
      },
    ]) {
      expect(() => parseWorldExtraction(value)).toThrow(WorldExtractionError);
    }
  });

  it("preserves launch-scope failures instead of forcing a pass", () => {
    const parsed = parseWorldExtraction({
      ...extraction,
      scopeSignals: {
        containsDialogue: true,
        narrationOnly: false,
        requiresLipSync: true,
      },
    });
    expect(parsed.scopeSignals).toEqual({
      containsDialogue: true,
      narrationOnly: false,
      requiresLipSync: true,
    });
  });

  it("preserves explicit unusual deity topology without a two-or-four-arm default", () => {
    const baseForm = extraction.characters[0].forms[0];
    const arms = Array.from({ length: 8 }, (_, index) => {
      const side = index < 4 ? ("left" as const) : ("right" as const);
      const ordinal = (index % 4) + 1;
      return {
        armId: `${side}-${ordinal}`,
        handId: `${side}-hand-${ordinal}`,
        ordinal,
        side,
      };
    });
    const parsed = parseWorldExtraction({
      ...extraction,
      characters: [
        {
          ...extraction.characters[0],
          forms: [
            {
              ...baseForm,
              identityManifest: {
                ...baseForm.identityManifest,
                deity: {
                  arms,
                  handObjectAssignments: arms.map(({ handId }, index) =>
                    index === 0
                      ? {
                          assignmentKind: "weapon",
                          handId,
                          objectKey: "trident",
                        }
                      : {
                          assignmentKind: "empty",
                          handId,
                          objectKey: null,
                        },
                  ),
                  vahana: { key: null, status: "none" },
                  weapons: [{ key: "trident", required: true }],
                },
                form: {
                  ...baseForm.identityManifest.form,
                  topology: {
                    armCount: 8,
                    handCount: 8,
                    headCount: 3,
                    legCount: 2,
                  },
                },
              },
            },
          ],
        },
      ],
    });
    expect(parsed.characters[0]!.forms[0]!.identityManifest.form.topology).toEqual({
      armCount: 8,
      handCount: 8,
      headCount: 3,
      legCount: 2,
    });
    const prompt = compileCharacterAnchorPrompt(
      parsed.characters[0]!,
      parsed.characters[0]!.forms[0]!,
      findLook(DEFAULT_LOOK_ID)!,
    );
    expect(prompt.prompt).toContain(
      "Exact immutable anatomy: 3 head(s), 8 arm(s), 8 hand(s), 2 leg(s)",
    );
    expect(prompt.negativePrompt).toContain("identity drift");
  });

  it("normalizes manifest text and rejects identity manifests bound to another form", () => {
    const baseForm = extraction.characters[0].forms[0];
    const normalized = parseWorldExtraction({
      ...extraction,
      characters: [
        {
          ...extraction.characters[0],
          forms: [
            {
              ...baseForm,
              emotionalBaseline: "se\u0301rene compassion",
              identityManifest: {
                ...baseForm.identityManifest,
                dignity: {
                  ...baseForm.identityManifest.dignity,
                  required: ["se\u0301rene compassion"],
                },
              },
            },
          ],
        },
      ],
    });
    expect(normalized.characters[0]!.forms[0]!.emotionalBaseline).toBe(
      "sérene compassion",
    );

    expect(() =>
      parseWorldExtraction({
        ...extraction,
        characters: [
          {
            ...extraction.characters[0],
            forms: [
              {
                ...baseForm,
                identityManifest: {
                  ...baseForm.identityManifest,
                  identity: {
                    ...baseForm.identityManifest.identity,
                    characterKey: "another-character",
                  },
                },
              },
            ],
          },
        ],
      }),
    ).toThrow("not bound");
  });

  it("rejects a required manifest feature omitted from the rendered sacred attributes", () => {
    const baseForm = extraction.characters[0].forms[0];
    expect(() =>
      parseWorldExtraction({
        ...extraction,
        characters: [
          {
            ...extraction.characters[0],
            forms: [
              {
                ...baseForm,
                sacredAttributes: baseForm.sacredAttributes.filter(
                  (attribute) => attribute.key !== "trident",
                ),
              },
            ],
          },
        ],
      }),
    ).toThrow("omit a required identityManifest feature");
  });
});

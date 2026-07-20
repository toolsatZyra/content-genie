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
    expect(blocks[0]).toContain("Single self-contained still image only");
    expect(blocks[0]).toContain("no sequence, montage, split frame");
    expect(blocks[1]).toBe(look.lockedLookBlock);
    expect(prompt.negativePrompt).toBe(look.negativePolicy.promptTail);
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
});

import { describe, expect, it } from "vitest";

import {
  buildCharacterIdentityManifest,
  postgresJsonbText,
} from "@/server/world-anchor-provider";

const form = {
  agePresentation: "Ageless adult",
  cameraAngle: "Eye level",
  clothingAndJewellery: "Yellow pitambara and gold jewellery",
  continuityDirectives: ["Keep crown and complexion exact"],
  displayName: "Divine form",
  emotionalBaseline: "Serene authority",
  environment: "Mythic cave",
  facialIdentity: "Serene oval face",
  formKey: "divine-form",
  framing: "Medium full",
  hairAndHeadwear: "Dark hair under a gold crown",
  identityManifest: {
    allowedTransitions: [],
    deity: {
      arms: [
        { armId: "left-1", handId: "left-hand-1", ordinal: 1, side: "left" },
        { armId: "left-2", handId: "left-hand-2", ordinal: 2, side: "left" },
        { armId: "right-1", handId: "right-hand-1", ordinal: 1, side: "right" },
        { armId: "right-2", handId: "right-hand-2", ordinal: 2, side: "right" },
      ],
      handObjectAssignments: [
        {
          assignmentKind: "attribute",
          handId: "left-hand-1",
          objectKey: "shankha",
        },
        {
          assignmentKind: "attribute",
          handId: "left-hand-2",
          objectKey: "lotus",
        },
        {
          assignmentKind: "weapon",
          handId: "right-hand-1",
          objectKey: "chakra",
        },
        {
          assignmentKind: "weapon",
          handId: "right-hand-2",
          objectKey: "gada",
        },
      ],
      vahana: { key: null, status: "none" },
      weapons: [
        { key: "chakra", required: true },
        { key: "gada", required: true },
      ],
    },
    dignity: {
      prohibited: ["caricature", "sexualized depiction"],
      required: ["Serene authority"],
    },
    form: {
      rules: {
        prohibited: ["identity drift", "anatomy drift"],
        required: [
          "Four-armed blue-toned divine adult",
          "Serene oval face",
          "Dark hair under a gold crown",
          "Keep crown and complexion exact",
        ],
      },
      topology: { armCount: 4, handCount: 4, headCount: 1, legCount: 2 },
    },
    identity: {
      canonicalName: "भगवान विष्णु",
      characterKey: "vishnu",
      essentialAttributes: [
        "Vaishnava tilak",
        "Blue-gold aura",
        "conch shell",
        "lotus",
        "Sudarshana chakra",
        "gada",
        "gold crown",
      ],
      formKey: "divine-form",
      formName: "Divine form",
    },
    isDeity: true,
    ornaments: [{ key: "gold-crown", placement: "on the head", required: true }],
    schemaVersion: "genie-character-identity-manifest.v2",
    skin: {
      formRules: ["Ageless adult", "ageless divine adult"],
      toneRules: ["blue-toned complexion"],
    },
    wardrobe: {
      prohibited: ["modern clothing"],
      required: ["Yellow pitambara and gold jewellery"],
    },
  },
  lightingMode: "Blue-gold rim light",
  physicalDescription: "Four-armed blue-toned divine adult",
  sacredAttributes: [
    {
      depictionKind: "form_feature",
      description: "Vaishnava tilak",
      key: "vaishnava-tilak",
      required: true,
    },
    {
      depictionKind: "form_feature",
      description: "Blue-gold aura",
      key: "blue-gold-aura",
      required: true,
    },
    {
      depictionKind: "held_attribute",
      description: "conch shell",
      key: "shankha",
      required: true,
    },
    {
      depictionKind: "held_attribute",
      description: "lotus",
      key: "lotus",
      required: true,
    },
    {
      depictionKind: "weapon",
      description: "Sudarshana chakra",
      key: "chakra",
      required: true,
    },
    {
      depictionKind: "weapon",
      description: "gada",
      key: "gada",
      required: true,
    },
    {
      depictionKind: "ornament",
      description: "gold crown",
      key: "gold-crown",
      required: true,
    },
  ],
  subjectPose: "Upright blessing pose",
} as const;

const character = {
  canonicalKey: "vishnu",
  continuityRole: "primary",
  culturalNotes: ["Respect Vaishnava iconography"],
  displayName: "भगवान विष्णु",
  forms: [form],
} as const;

describe("world anchor provider serialization", () => {
  it("matches PostgreSQL jsonb::text key ordering and spacing", () => {
    expect(
      postgresJsonbText({
        characterKey: "y",
        continuityRole: "p",
        culturalNotes: [],
        form: { displayName: "f", formKey: "k" },
        schemaVersion: "x",
      }),
    ).toBe(
      '{"form": {"formKey": "k", "displayName": "f"}, "characterKey": "y", "culturalNotes": [], "schemaVersion": "x", "continuityRole": "p"}',
    );
  });

  it("keeps Unicode content byte-exact while sorting keys by UTF-8 length", () => {
    expect(postgresJsonbText({ aa: "कृष्ण", b: true })).toBe(
      '{"b": true, "aa": "कृष्ण"}',
    );
  });

  it("builds the closed v2 identity manifest used by character promotion", () => {
    const manifest = buildCharacterIdentityManifest(character, form);
    expect(Object.keys(manifest).sort()).toEqual(
      [
        "allowedTransitions",
        "deity",
        "dignity",
        "form",
        "identity",
        "isDeity",
        "ornaments",
        "schemaVersion",
        "skin",
        "wardrobe",
      ].sort(),
    );
    expect(manifest).toMatchObject({
      deity: {
        arms: [
          { armId: "left-1", handId: "left-hand-1", ordinal: 1, side: "left" },
          { armId: "left-2", handId: "left-hand-2", ordinal: 2, side: "left" },
          {
            armId: "right-1",
            handId: "right-hand-1",
            ordinal: 1,
            side: "right",
          },
          {
            armId: "right-2",
            handId: "right-hand-2",
            ordinal: 2,
            side: "right",
          },
        ],
        vahana: { key: null, status: "none" },
        weapons: [
          { key: "chakra", required: true },
          { key: "gada", required: true },
        ],
      },
      form: {
        topology: { armCount: 4, handCount: 4, headCount: 1, legCount: 2 },
      },
      identity: {
        canonicalName: "भगवान विष्णु",
        characterKey: "vishnu",
        formKey: "divine-form",
        formName: "Divine form",
      },
      isDeity: true,
      schemaVersion: "genie-character-identity-manifest.v2",
    });
  });

  it("sets deity to null for a character without divine identity signals", () => {
    const nonDivine = buildCharacterIdentityManifest(
      { ...character, canonicalKey: "mura", displayName: "Mura" },
      {
        ...form,
        displayName: "Warrior",
        identityManifest: {
          ...form.identityManifest,
          deity: null,
          identity: {
            ...form.identityManifest.identity,
            canonicalName: "Mura",
            characterKey: "mura",
            formName: "Warrior",
          },
          isDeity: false,
        },
        sacredAttributes: [],
      },
    );
    expect(nonDivine).toMatchObject({
      deity: null,
      isDeity: false,
      schemaVersion: "genie-character-identity-manifest.v2",
    });
  });
});

import { compileImagePrompt, type LookDefinition } from "@/domain/look/look-registry";
import {
  parseCharacterIdentityManifest,
  type CharacterIdentityManifest,
} from "@/domain/agent/character-identity-manifest";

export const WORLD_EXTRACTION_SCHEMA_VERSION = "genie.world-extraction.v3";

type ContinuityRole = "incidental" | "primary" | "supporting";
export type RealWorldSubjectKind = "festival" | "none" | "ritual" | "temple";
export type SacredAttributeKind =
  "form_feature" | "held_attribute" | "ornament" | "vahana" | "weapon";

export type ExtractedSacredAttribute = Readonly<{
  depictionKind: SacredAttributeKind;
  description: string;
  key: string;
  required: boolean;
}>;

export type ExtractedCharacterForm = Readonly<{
  agePresentation: string;
  cameraAngle: string;
  clothingAndJewellery: string;
  continuityDirectives: readonly string[];
  displayName: string;
  emotionalBaseline: string;
  environment: string;
  facialIdentity: string;
  formKey: string;
  framing: string;
  hairAndHeadwear: string;
  identityManifest: CharacterIdentityManifest;
  lightingMode: string;
  physicalDescription: string;
  sacredAttributes: readonly ExtractedSacredAttribute[];
  subjectPose: string;
}>;

export type ExtractedCharacter = Readonly<{
  canonicalKey: string;
  continuityRole: ContinuityRole;
  culturalNotes: readonly string[];
  displayName: string;
  forms: readonly ExtractedCharacterForm[];
}>;

export type ExtractedLocation = Readonly<{
  architectureAndEra: string;
  cameraAngle: string;
  canonicalKey: string;
  continuityDirectives: readonly string[];
  displayName: string;
  environmentDescription: string;
  framing: string;
  lightingMode: string;
  namedTemple: boolean;
  realPlaceName: string | null;
  realWorldSubjectKind: RealWorldSubjectKind;
  researchRequired: boolean;
  sacredDetails: readonly string[];
  timeAndAtmosphere: string;
}>;

export type ExtractedProp = Readonly<{
  cameraAngle: string;
  canonicalKey: string;
  continuityDirectives: readonly string[];
  continuityRole: ContinuityRole;
  culturalNotes: readonly string[];
  displayName: string;
  environment: string;
  framing: string;
  lightingMode: string;
  materialAndFinish: string;
  sacredOrFunctionalDetails: readonly string[];
  visualDescription: string;
}>;

export type WorldExtraction = Readonly<{
  ambiguities: readonly Readonly<{
    affectedKeys: readonly string[];
    blocksGeneration: boolean;
    description: string;
    kind: "cultural" | "identity" | "location" | "prop" | "scope";
  }>[];
  characters: readonly ExtractedCharacter[];
  culturalReviewNotes: readonly string[];
  locations: readonly ExtractedLocation[];
  props: readonly ExtractedProp[];
  schemaVersion: typeof WORLD_EXTRACTION_SCHEMA_VERSION;
  scopeSignals: Readonly<{
    containsDialogue: boolean;
    narrationOnly: boolean;
    requiresLipSync: boolean;
  }>;
  storyContext: Readonly<{
    era: string;
    primaryTradition: string;
    regionalContext: string | null;
  }>;
}>;

export class WorldExtractionError extends Error {
  override readonly name = "WorldExtractionError";
}

const canonicalKeyPattern = /^[a-z0-9][a-z0-9_.-]{1,99}$/u;

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function text(value: unknown, label: string, maximum = 1_000): string {
  const normalized = typeof value === "string" ? value.trim().normalize("NFC") : null;
  if (
    normalized === null ||
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(normalized)
  ) {
    throw new WorldExtractionError(`${label} is invalid.`);
  }
  return normalized;
}

function key(value: unknown, label: string): string {
  const result = text(value, label, 100);
  if (!canonicalKeyPattern.test(result)) {
    throw new WorldExtractionError(`${label} is invalid.`);
  }
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new WorldExtractionError(`${label} is invalid.`);
  }
  return value;
}

function textArray(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength = 500,
): readonly string[] {
  if (!Array.isArray(value) || value.length > maximumItems) {
    throw new WorldExtractionError(`${label} is invalid.`);
  }
  const values = value.map((item, index) =>
    text(item, `${label}[${index}]`, maximumLength),
  );
  if (new Set(values).size !== values.length) {
    throw new WorldExtractionError(`${label} contains duplicates.`);
  }
  return Object.freeze(values);
}

function parseSacredAttributes(
  value: unknown,
  label: string,
): readonly ExtractedSacredAttribute[] {
  if (!Array.isArray(value) || value.length > 16) {
    throw new WorldExtractionError(`${label} is invalid.`);
  }
  const values = value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!exactObject(item, ["depictionKind", "description", "key", "required"])) {
      throw new WorldExtractionError(`${itemLabel} is not exact.`);
    }
    const input = item as Record<string, unknown>;
    const depictionKind = String(input.depictionKind);
    if (
      !["form_feature", "held_attribute", "ornament", "vahana", "weapon"].includes(
        depictionKind,
      )
    ) {
      throw new WorldExtractionError(`${itemLabel}.depictionKind is invalid.`);
    }
    return Object.freeze({
      depictionKind: depictionKind as SacredAttributeKind,
      description: text(input.description, `${itemLabel}.description`, 500),
      key: key(input.key, `${itemLabel}.key`),
      required: boolean(input.required, `${itemLabel}.required`),
    });
  });
  if (new Set(values.map((item) => item.key)).size !== values.length) {
    throw new WorldExtractionError(`${label} contains duplicate keys.`);
  }
  return Object.freeze(values);
}

function validateFormIdentityBinding(
  form: ExtractedCharacterForm,
  label: string,
): void {
  const manifest = form.identityManifest;
  const requiredFormRules = new Set(manifest.form.rules.required);
  const requiredWardrobe = new Set(manifest.wardrobe.required);
  const skinFormRules = new Set(manifest.skin.formRules);
  const requiredDignity = new Set(manifest.dignity.required);
  const essentialAttributes = new Set(manifest.identity.essentialAttributes);
  if (
    !requiredWardrobe.has(form.clothingAndJewellery) ||
    !skinFormRules.has(form.agePresentation) ||
    !requiredDignity.has(form.emotionalBaseline) ||
    ![
      form.physicalDescription,
      form.facialIdentity,
      form.hairAndHeadwear,
      ...form.continuityDirectives,
    ].every((rule) => requiredFormRules.has(rule))
  ) {
    throw new WorldExtractionError(
      `${label} identityManifest contradicts its visible identity fields.`,
    );
  }
  const assignments = manifest.deity?.handObjectAssignments ?? [];
  const weapons = new Set(manifest.deity?.weapons.map((item) => item.key) ?? []);
  const ornaments = new Set(manifest.ornaments.map((item) => item.key));
  const sacredBindings = new Set(
    form.sacredAttributes.map(
      (attribute) => `${attribute.depictionKind}:${attribute.key}`,
    ),
  );
  for (const attribute of form.sacredAttributes) {
    if (!essentialAttributes.has(attribute.description)) {
      throw new WorldExtractionError(
        `${label} identityManifest omits a sacred attribute.`,
      );
    }
    const assigned = assignments.some(
      (item) =>
        item.objectKey === attribute.key &&
        ((attribute.depictionKind === "weapon" && item.assignmentKind === "weapon") ||
          (attribute.depictionKind === "held_attribute" &&
            item.assignmentKind === "attribute")),
    );
    const bound =
      attribute.depictionKind === "form_feature" ||
      (attribute.depictionKind === "weapon" &&
        weapons.has(attribute.key) &&
        assigned) ||
      (attribute.depictionKind === "held_attribute" && assigned) ||
      (attribute.depictionKind === "ornament" && ornaments.has(attribute.key)) ||
      (attribute.depictionKind === "vahana" &&
        manifest.deity?.vahana.status === "specified" &&
        manifest.deity.vahana.key === attribute.key);
    if (!bound) {
      throw new WorldExtractionError(
        `${label} identityManifest misbinds a sacred attribute.`,
      );
    }
  }
  const requiredBindings = [
    ...(manifest.deity?.weapons
      .filter((item) => item.required)
      .map((item) => `weapon:${item.key}`) ?? []),
    ...assignments.flatMap((item) =>
      item.objectKey !== null && ["attribute", "weapon"].includes(item.assignmentKind)
        ? [
            `${
              item.assignmentKind === "attribute" ? "held_attribute" : "weapon"
            }:${item.objectKey}`,
          ]
        : [],
    ),
    ...manifest.ornaments
      .filter((item) => item.required)
      .map((item) => `ornament:${item.key}`),
    ...(manifest.deity?.vahana.status === "specified"
      ? [`vahana:${manifest.deity.vahana.key}`]
      : []),
  ];
  if (requiredBindings.some((binding) => !sacredBindings.has(binding))) {
    throw new WorldExtractionError(
      `${label} sacredAttributes omit a required identityManifest feature.`,
    );
  }
}

function parseCharacterForm(value: unknown, label: string): ExtractedCharacterForm {
  const keys = [
    "agePresentation",
    "cameraAngle",
    "clothingAndJewellery",
    "continuityDirectives",
    "displayName",
    "emotionalBaseline",
    "environment",
    "facialIdentity",
    "formKey",
    "framing",
    "hairAndHeadwear",
    "identityManifest",
    "lightingMode",
    "physicalDescription",
    "sacredAttributes",
    "subjectPose",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new WorldExtractionError(`${label} is not exact.`);
  }
  const input = value as Record<string, unknown>;
  const result = Object.freeze({
    agePresentation: text(input.agePresentation, `${label}.agePresentation`, 240),
    cameraAngle: text(input.cameraAngle, `${label}.cameraAngle`, 240),
    clothingAndJewellery: text(
      input.clothingAndJewellery,
      `${label}.clothingAndJewellery`,
      800,
    ),
    continuityDirectives: textArray(
      input.continuityDirectives,
      `${label}.continuityDirectives`,
      12,
    ),
    displayName: text(input.displayName, `${label}.displayName`, 200),
    emotionalBaseline: text(input.emotionalBaseline, `${label}.emotionalBaseline`, 240),
    environment: text(input.environment, `${label}.environment`, 400),
    facialIdentity: text(input.facialIdentity, `${label}.facialIdentity`, 800),
    formKey: key(input.formKey, `${label}.formKey`),
    framing: text(input.framing, `${label}.framing`, 240),
    hairAndHeadwear: text(input.hairAndHeadwear, `${label}.hairAndHeadwear`, 600),
    identityManifest: parseCharacterIdentityManifest(input.identityManifest),
    lightingMode: text(input.lightingMode, `${label}.lightingMode`, 240),
    physicalDescription: text(
      input.physicalDescription,
      `${label}.physicalDescription`,
      800,
    ),
    sacredAttributes: parseSacredAttributes(
      input.sacredAttributes,
      `${label}.sacredAttributes`,
    ),
    subjectPose: text(input.subjectPose, `${label}.subjectPose`, 400),
  });
  validateFormIdentityBinding(result, label);
  return result;
}

function parseCharacter(value: unknown, index: number): ExtractedCharacter {
  const label = `characters[${index}]`;
  if (
    !exactObject(value, [
      "canonicalKey",
      "continuityRole",
      "culturalNotes",
      "displayName",
      "forms",
    ])
  ) {
    throw new WorldExtractionError(`${label} is not exact.`);
  }
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.forms) || input.forms.length < 1 || input.forms.length > 6) {
    throw new WorldExtractionError(`${label}.forms is invalid.`);
  }
  if (!["incidental", "primary", "supporting"].includes(String(input.continuityRole))) {
    throw new WorldExtractionError(`${label}.continuityRole is invalid.`);
  }
  const forms = input.forms.map((form, formIndex) =>
    parseCharacterForm(form, `${label}.forms[${formIndex}]`),
  );
  if (new Set(forms.map((form) => form.formKey)).size !== forms.length) {
    throw new WorldExtractionError(`${label}.forms contains duplicate keys.`);
  }
  const canonicalKey = key(input.canonicalKey, `${label}.canonicalKey`);
  const displayName = text(input.displayName, `${label}.displayName`, 200);
  for (const form of forms) {
    if (
      form.identityManifest.identity.characterKey !== canonicalKey ||
      form.identityManifest.identity.canonicalName !== displayName ||
      form.identityManifest.identity.formKey !== form.formKey ||
      form.identityManifest.identity.formName !== form.displayName
    ) {
      throw new WorldExtractionError(
        `${label} identityManifest is not bound to its character form.`,
      );
    }
  }
  return Object.freeze({
    canonicalKey,
    continuityRole: input.continuityRole as ContinuityRole,
    culturalNotes: textArray(input.culturalNotes, `${label}.culturalNotes`, 12),
    displayName,
    forms: Object.freeze(forms),
  });
}

function parseLocation(value: unknown, index: number): ExtractedLocation {
  const label = `locations[${index}]`;
  const keys = [
    "architectureAndEra",
    "cameraAngle",
    "canonicalKey",
    "continuityDirectives",
    "displayName",
    "environmentDescription",
    "framing",
    "lightingMode",
    "namedTemple",
    "realPlaceName",
    "realWorldSubjectKind",
    "researchRequired",
    "sacredDetails",
    "timeAndAtmosphere",
  ] as const;
  const legacyKeys = keys.filter((item) => item !== "realWorldSubjectKind");
  if (!exactObject(value, keys) && !exactObject(value, legacyKeys)) {
    throw new WorldExtractionError(`${label} is not exact.`);
  }
  const input = value as Record<string, unknown>;
  const namedTemple = boolean(input.namedTemple, `${label}.namedTemple`);
  const researchRequired = boolean(input.researchRequired, `${label}.researchRequired`);
  const realPlaceName =
    input.realPlaceName === null
      ? null
      : text(input.realPlaceName, `${label}.realPlaceName`, 300);
  const realWorldSubjectKind =
    input.realWorldSubjectKind === undefined
      ? namedTemple
        ? "temple"
        : "none"
      : String(input.realWorldSubjectKind);
  if (
    !["festival", "none", "ritual", "temple"].includes(realWorldSubjectKind) ||
    (realWorldSubjectKind === "none" &&
      (namedTemple || realPlaceName !== null || researchRequired)) ||
    (realWorldSubjectKind === "temple" &&
      (!namedTemple || !realPlaceName || !researchRequired)) ||
    (["festival", "ritual"].includes(realWorldSubjectKind) &&
      (namedTemple || !realPlaceName || !researchRequired))
  ) {
    throw new WorldExtractionError(`${label} real-world evidence binding is invalid.`);
  }
  return Object.freeze({
    architectureAndEra: text(
      input.architectureAndEra,
      `${label}.architectureAndEra`,
      800,
    ),
    cameraAngle: text(input.cameraAngle, `${label}.cameraAngle`, 240),
    canonicalKey: key(input.canonicalKey, `${label}.canonicalKey`),
    continuityDirectives: textArray(
      input.continuityDirectives,
      `${label}.continuityDirectives`,
      12,
    ),
    displayName: text(input.displayName, `${label}.displayName`, 240),
    environmentDescription: text(
      input.environmentDescription,
      `${label}.environmentDescription`,
      1_000,
    ),
    framing: text(input.framing, `${label}.framing`, 240),
    lightingMode: text(input.lightingMode, `${label}.lightingMode`, 240),
    namedTemple,
    realPlaceName,
    realWorldSubjectKind: realWorldSubjectKind as RealWorldSubjectKind,
    researchRequired,
    sacredDetails: textArray(input.sacredDetails, `${label}.sacredDetails`, 16),
    timeAndAtmosphere: text(input.timeAndAtmosphere, `${label}.timeAndAtmosphere`, 500),
  });
}

function parseProp(value: unknown, index: number): ExtractedProp {
  const label = `props[${index}]`;
  const keys = [
    "cameraAngle",
    "canonicalKey",
    "continuityDirectives",
    "continuityRole",
    "culturalNotes",
    "displayName",
    "environment",
    "framing",
    "lightingMode",
    "materialAndFinish",
    "sacredOrFunctionalDetails",
    "visualDescription",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new WorldExtractionError(`${label} is not exact.`);
  }
  const input = value as Record<string, unknown>;
  if (!["incidental", "primary", "supporting"].includes(String(input.continuityRole))) {
    throw new WorldExtractionError(`${label}.continuityRole is invalid.`);
  }
  return Object.freeze({
    cameraAngle: text(input.cameraAngle, `${label}.cameraAngle`, 240),
    canonicalKey: key(input.canonicalKey, `${label}.canonicalKey`),
    continuityDirectives: textArray(
      input.continuityDirectives,
      `${label}.continuityDirectives`,
      12,
    ),
    continuityRole: input.continuityRole as ContinuityRole,
    culturalNotes: textArray(input.culturalNotes, `${label}.culturalNotes`, 12),
    displayName: text(input.displayName, `${label}.displayName`, 240),
    environment: text(input.environment, `${label}.environment`, 400),
    framing: text(input.framing, `${label}.framing`, 240),
    lightingMode: text(input.lightingMode, `${label}.lightingMode`, 240),
    materialAndFinish: text(input.materialAndFinish, `${label}.materialAndFinish`, 800),
    sacredOrFunctionalDetails: textArray(
      input.sacredOrFunctionalDetails,
      `${label}.sacredOrFunctionalDetails`,
      16,
    ),
    visualDescription: text(
      input.visualDescription,
      `${label}.visualDescription`,
      1_000,
    ),
  });
}

export function parseWorldExtraction(value: unknown): WorldExtraction {
  const keys = [
    "ambiguities",
    "characters",
    "culturalReviewNotes",
    "locations",
    "props",
    "schemaVersion",
    "scopeSignals",
    "storyContext",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new WorldExtractionError("World extraction is not exact.");
  }
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== WORLD_EXTRACTION_SCHEMA_VERSION) {
    throw new WorldExtractionError("World extraction schema is unsupported.");
  }
  if (
    !Array.isArray(input.characters) ||
    input.characters.length < 1 ||
    input.characters.length > 16
  ) {
    throw new WorldExtractionError("World extraction characters are invalid.");
  }
  if (
    !Array.isArray(input.locations) ||
    input.locations.length < 1 ||
    input.locations.length > 12
  ) {
    throw new WorldExtractionError("World extraction locations are invalid.");
  }
  if (!Array.isArray(input.props) || input.props.length > 12) {
    throw new WorldExtractionError("World extraction props are invalid.");
  }
  const characters = input.characters.map(parseCharacter);
  const locations = input.locations.map(parseLocation);
  const props = input.props.map(parseProp);
  const worldKeys = [
    ...characters.map((item) => item.canonicalKey),
    ...locations.map((item) => item.canonicalKey),
    ...props.map((item) => item.canonicalKey),
  ];
  if (new Set(worldKeys).size !== worldKeys.length) {
    throw new WorldExtractionError("World extraction contains duplicate keys.");
  }
  if (
    !exactObject(input.scopeSignals, [
      "containsDialogue",
      "narrationOnly",
      "requiresLipSync",
    ]) ||
    !exactObject(input.storyContext, ["era", "primaryTradition", "regionalContext"])
  ) {
    throw new WorldExtractionError("World extraction context is invalid.");
  }
  const scope = input.scopeSignals as Record<string, unknown>;
  const story = input.storyContext as Record<string, unknown>;
  if (!Array.isArray(input.ambiguities) || input.ambiguities.length > 16) {
    throw new WorldExtractionError("World extraction ambiguities are invalid.");
  }
  const ambiguities = input.ambiguities.map((item, index) => {
    const label = `ambiguities[${index}]`;
    if (
      !exactObject(item, ["affectedKeys", "blocksGeneration", "description", "kind"])
    ) {
      throw new WorldExtractionError(`${label} is not exact.`);
    }
    const record = item as Record<string, unknown>;
    if (
      !["cultural", "identity", "location", "prop", "scope"].includes(
        String(record.kind),
      )
    ) {
      throw new WorldExtractionError(`${label}.kind is invalid.`);
    }
    const affectedKeys = textArray(
      record.affectedKeys,
      `${label}.affectedKeys`,
      16,
      100,
    );
    if (affectedKeys.some((affectedKey) => !worldKeys.includes(affectedKey))) {
      throw new WorldExtractionError(`${label}.affectedKeys is unbound.`);
    }
    return Object.freeze({
      affectedKeys,
      blocksGeneration: boolean(record.blocksGeneration, `${label}.blocksGeneration`),
      description: text(record.description, `${label}.description`, 1_000),
      kind: record.kind as "cultural" | "identity" | "location" | "prop" | "scope",
    });
  });
  return Object.freeze({
    ambiguities: Object.freeze(ambiguities),
    characters: Object.freeze(characters),
    culturalReviewNotes: textArray(
      input.culturalReviewNotes,
      "culturalReviewNotes",
      20,
      1_000,
    ),
    locations: Object.freeze(locations),
    props: Object.freeze(props),
    schemaVersion: WORLD_EXTRACTION_SCHEMA_VERSION,
    scopeSignals: Object.freeze({
      containsDialogue: boolean(
        scope.containsDialogue,
        "scopeSignals.containsDialogue",
      ),
      narrationOnly: boolean(scope.narrationOnly, "scopeSignals.narrationOnly"),
      requiresLipSync: boolean(scope.requiresLipSync, "scopeSignals.requiresLipSync"),
    }),
    storyContext: Object.freeze({
      era: text(story.era, "storyContext.era", 300),
      primaryTradition: text(
        story.primaryTradition,
        "storyContext.primaryTradition",
        300,
      ),
      regionalContext:
        story.regionalContext === null
          ? null
          : text(story.regionalContext, "storyContext.regionalContext", 300),
    }),
  });
}

function promptText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

const STANDALONE_IMAGE_CONTRACT =
  "Single self-contained still image only. Render only this visible composition; no sequence, montage, split frame, before-and-after, prior image, next image, or off-frame event. ";

export function compileCharacterAnchorPrompt(
  character: ExtractedCharacter,
  form: ExtractedCharacterForm,
  look: LookDefinition,
): Readonly<{ negativePrompt: string; prompt: string }> {
  const manifest = form.identityManifest;
  const topology = manifest.form.topology;
  const sacredDescriptions = new Map(
    form.sacredAttributes.map((attribute) => [attribute.key, attribute.description]),
  );
  const armsByHand = new Map(
    manifest.deity?.arms.map((arm) => [arm.handId, arm]) ?? [],
  );
  const handMap =
    manifest.deity?.handObjectAssignments
      .map((assignment) => {
        const arm = armsByHand.get(assignment.handId);
        const handLabel = arm ? `${arm.side} hand ${arm.ordinal}` : assignment.handId;
        if (assignment.assignmentKind === "empty") {
          return `${handLabel} visibly empty`;
        }
        const object =
          sacredDescriptions.get(assignment.objectKey ?? "") ??
          assignment.objectKey ??
          assignment.assignmentKind;
        return `${handLabel} performs or holds exactly ${assignment.assignmentKind} ${object}`;
      })
      .join("; ") || "no divine hand assignment";
  const requiredOrnaments =
    manifest.ornaments
      .filter((ornament) => ornament.required)
      .map(
        (ornament) =>
          `${sacredDescriptions.get(ornament.key) ?? ornament.key} ${ornament.placement}`,
      )
      .join("; ") || "none";
  const requiredRules = [
    ...manifest.identity.essentialAttributes,
    ...manifest.skin.formRules,
    ...manifest.skin.toneRules,
    ...manifest.wardrobe.required,
    ...manifest.form.rules.required,
    ...manifest.dignity.required,
  ];
  const prohibitedRules = [
    ...manifest.wardrobe.prohibited,
    ...manifest.form.rules.prohibited,
    ...manifest.dignity.prohibited,
  ];
  const frame = promptText(
    `Vertical 9:16 canonical character anchor for ${character.displayName}, ${form.displayName}. ` +
      `Pose and action: ${form.subjectPose}. Framing: ${form.framing}. Camera: ${form.cameraAngle}. ` +
      `Lighting: ${form.lightingMode}. Environment: ${form.environment}. ` +
      `Exact immutable anatomy: ${topology.headCount} head(s), ${topology.armCount} arm(s), ${topology.handCount} hand(s), ${topology.legCount} leg(s). ` +
      `Exact hand map: ${handMap}. Required ornaments and placement: ${requiredOrnaments}. ` +
      `Unchanging identity: ${form.agePresentation}; ${form.physicalDescription}; ${form.facialIdentity}; ` +
      `${form.hairAndHeadwear}; ${form.clothingAndJewellery}. Sacred attributes: ` +
      `${
        form.sacredAttributes
          .map(
            (attribute) =>
              `${attribute.description} [${attribute.depictionKind}:${attribute.key}]`,
          )
          .join("; ") || "none specified"
      }. Emotional baseline: ${form.emotionalBaseline}. ` +
      `Continuity locks: ${form.continuityDirectives.join("; ") || "preserve every stated identity feature"}. ` +
      `Manifest-required visible rules: ${[...new Set(requiredRules)].join("; ")}. ` +
      `Never depict these manifest-prohibited features: ${[...new Set(prohibitedRules)].join("; ") || "none"}. ` +
      STANDALONE_IMAGE_CONTRACT +
      `Respectful Hindu devotional-film depiction, anatomically coherent, no typography, no watermark.`,
  );
  return Object.freeze({
    negativePrompt: promptText(
      `${look.negativePolicy.promptTail} Character-manifest exclusions: ${
        [...new Set(prohibitedRules)].join("; ") || "none"
      }.`,
    ),
    prompt: compileImagePrompt(frame, look),
  });
}

export function compileLocationAnchorPrompt(
  location: ExtractedLocation,
  look: LookDefinition,
  templeReferencesVerified = false,
): Readonly<{ negativePrompt: string; prompt: string }> {
  if (location.researchRequired && !templeReferencesVerified) {
    throw new WorldExtractionError(
      "A real-world subject requires verified photographic references before generation.",
    );
  }
  const populatedRealWorldSubject = ["festival", "ritual"].includes(
    location.realWorldSubjectKind,
  );
  const frame = promptText(
    `Vertical 9:16 ${populatedRealWorldSubject ? "canonical documentary reference plate" : "empty canonical location anchor"} for ${location.displayName}. ` +
      `Environment: ${location.environmentDescription}. Architecture and era: ${location.architectureAndEra}. ` +
      `Sacred details: ${location.sacredDetails.join("; ") || "none specified"}. ` +
      `Time and atmosphere: ${location.timeAndAtmosphere}. Framing: ${location.framing}. ` +
      `Camera: ${location.cameraAngle}. Lighting: ${location.lightingMode}. ` +
      `Continuity locks: ${location.continuityDirectives.join("; ") || "preserve all architectural and spatial features"}. ` +
      (populatedRealWorldSubject
        ? `Use the supplied public photographs as factual visual evidence for the documented ${location.realWorldSubjectKind}; preserve authentic setting, actions, dress, objects, and spatial relationships while avoiding identifiable-face invention. `
        : "No people. ") +
      STANDALONE_IMAGE_CONTRACT +
      `Respectful Hindu devotional-film depiction, historically coherent, no typography, no watermark.`,
  );
  return Object.freeze({
    negativePrompt: look.negativePolicy.promptTail,
    prompt: compileImagePrompt(frame, look),
  });
}

export function compilePropAnchorPrompt(
  prop: ExtractedProp,
  look: LookDefinition,
): Readonly<{ negativePrompt: string; prompt: string }> {
  const frame = promptText(
    `Vertical 9:16 canonical prop anchor for ${prop.displayName}. ` +
      `Object identity: ${prop.visualDescription}. Materials and finish: ${prop.materialAndFinish}. ` +
      `Sacred or functional details: ${prop.sacredOrFunctionalDetails.join("; ") || "none specified"}. ` +
      `Environment: ${prop.environment}. Framing: ${prop.framing}. Camera: ${prop.cameraAngle}. ` +
      `Lighting: ${prop.lightingMode}. Continuity locks: ` +
      `${prop.continuityDirectives.join("; ") || "preserve silhouette, scale, material and ornament exactly"}. ` +
      `Show the object clearly without a person holding it. ` +
      STANDALONE_IMAGE_CONTRACT +
      `Respectful Hindu devotional-film depiction, ` +
      `historically coherent, anatomically irrelevant, no typography, no watermark.`,
  );
  return Object.freeze({
    negativePrompt: look.negativePolicy.promptTail,
    prompt: compileImagePrompt(frame, look),
  });
}

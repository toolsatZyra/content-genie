import { compileImagePrompt, type LookDefinition } from "@/domain/look/look-registry";

export const WORLD_EXTRACTION_SCHEMA_VERSION = "genie.world-extraction.v2";

type ContinuityRole = "incidental" | "primary" | "supporting";
export type RealWorldSubjectKind = "festival" | "none" | "ritual" | "temple";

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
  lightingMode: string;
  physicalDescription: string;
  sacredAttributes: readonly string[];
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
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
  ) {
    throw new WorldExtractionError(`${label} is invalid.`);
  }
  return value.trim();
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
    "lightingMode",
    "physicalDescription",
    "sacredAttributes",
    "subjectPose",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new WorldExtractionError(`${label} is not exact.`);
  }
  const input = value as Record<string, unknown>;
  return Object.freeze({
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
    lightingMode: text(input.lightingMode, `${label}.lightingMode`, 240),
    physicalDescription: text(
      input.physicalDescription,
      `${label}.physicalDescription`,
      800,
    ),
    sacredAttributes: textArray(
      input.sacredAttributes,
      `${label}.sacredAttributes`,
      16,
    ),
    subjectPose: text(input.subjectPose, `${label}.subjectPose`, 400),
  });
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
  return Object.freeze({
    canonicalKey: key(input.canonicalKey, `${label}.canonicalKey`),
    continuityRole: input.continuityRole as ContinuityRole,
    culturalNotes: textArray(input.culturalNotes, `${label}.culturalNotes`, 12),
    displayName: text(input.displayName, `${label}.displayName`, 200),
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

export function compileCharacterAnchorPrompt(
  character: ExtractedCharacter,
  form: ExtractedCharacterForm,
  look: LookDefinition,
): Readonly<{ negativePrompt: string; prompt: string }> {
  const frame = promptText(
    `Vertical 9:16 canonical character anchor for ${character.displayName}, ${form.displayName}. ` +
      `Pose and action: ${form.subjectPose}. Framing: ${form.framing}. Camera: ${form.cameraAngle}. ` +
      `Lighting: ${form.lightingMode}. Environment: ${form.environment}. ` +
      `Unchanging identity: ${form.agePresentation}; ${form.physicalDescription}; ${form.facialIdentity}; ` +
      `${form.hairAndHeadwear}; ${form.clothingAndJewellery}. Sacred attributes: ` +
      `${form.sacredAttributes.join("; ") || "none specified"}. Emotional baseline: ${form.emotionalBaseline}. ` +
      `Continuity locks: ${form.continuityDirectives.join("; ") || "preserve every stated identity feature"}. ` +
      `Respectful Hindu devotional-film depiction, anatomically coherent, no typography, no watermark.`,
  );
  return Object.freeze({
    negativePrompt: look.negativePolicy.promptTail,
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
      `Show the object clearly without a person holding it. Respectful Hindu devotional-film depiction, ` +
      `historically coherent, anatomically irrelevant, no typography, no watermark.`,
  );
  return Object.freeze({
    negativePrompt: look.negativePolicy.promptTail,
    prompt: compileImagePrompt(frame, look),
  });
}

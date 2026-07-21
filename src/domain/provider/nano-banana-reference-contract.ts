const endpointByOperation = Object.freeze({
  edit_image: "fal-ai/nano-banana-2/edit",
  gen_image: "fal-ai/nano-banana-2",
} as const);

export const NANO_BANANA_MAX_REFERENCE_IMAGES = 14;
export const NANO_BANANA_MAX_PROMPT_CHARACTERS = 16_000;

export type NanoBananaReferenceRole =
  | "character_identity"
  | "continuity_state"
  | "location_geometry"
  | "prop_identity"
  | "real_world_evidence"
  | "style_reference";

const referenceRoles = new Set<NanoBananaReferenceRole>([
  "character_identity",
  "continuity_state",
  "location_geometry",
  "prop_identity",
  "real_world_evidence",
  "style_reference",
]);

export type NanoBananaReferenceInput = Readonly<{
  assetVersionId: string;
  imageUrl: string;
  purpose: string;
  role: NanoBananaReferenceRole;
}>;

export type NanoBananaReferenceBinding = Readonly<{
  assetVersionId: string;
  atToken: string;
  imageToken: string;
  ordinal: number;
  purpose: string;
  role: NanoBananaReferenceRole;
}>;

export type NanoBananaReferenceContract = Readonly<{
  bindings: readonly NanoBananaReferenceBinding[];
  endpoint: (typeof endpointByOperation)[keyof typeof endpointByOperation];
  imageUrls: readonly string[];
  operation: keyof typeof endpointByOperation;
  prompt: string;
  systemPrompt: string | null;
}>;

export class NanoBananaReferenceContractError extends Error {
  override readonly name = "NanoBananaReferenceContractError";
}

const referenceTokenPattern = /(?:@Image|\bImage\s+)(\d+)\b/giu;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") {
    throw new NanoBananaReferenceContractError(`${label} must be text.`);
  }
  const normalized = value.replace(/\r\n?/gu, "\n").trim();
  if (normalized.length < 1 || normalized.length > maximum) {
    throw new NanoBananaReferenceContractError(`${label} is outside its bounds.`);
  }
  return normalized;
}

function referenceOrdinals(value: string): readonly number[] {
  return Object.freeze(
    [...value.matchAll(referenceTokenPattern)].map((match) => Number(match[1])),
  );
}

function assertNoManualReferenceTokens(value: string, label: string): void {
  if (referenceOrdinals(value).length > 0) {
    throw new NanoBananaReferenceContractError(
      `${label} must not contain manually numbered image references.`,
    );
  }
}

function assertHttpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new NanoBananaReferenceContractError(`${label} must be an absolute URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new NanoBananaReferenceContractError(
      `${label} must be a fragment-free HTTPS URL.`,
    );
  }
  return url.toString();
}

function expectedBindingLine(binding: NanoBananaReferenceBinding): string {
  return `Image ${binding.ordinal} / @Image${binding.ordinal} [${binding.role}]: ${binding.purpose}`;
}

function assertPromptBindings(
  text: string,
  bindings: readonly NanoBananaReferenceBinding[],
  label: string,
): void {
  const validOrdinals = new Set(bindings.map(({ ordinal }) => ordinal));
  const observedOrdinals = referenceOrdinals(text);
  for (const ordinal of observedOrdinals) {
    if (!validOrdinals.has(ordinal)) {
      throw new NanoBananaReferenceContractError(
        `${label} contains an unbound Image ${ordinal} token.`,
      );
    }
  }
  for (const binding of bindings) {
    const line = expectedBindingLine(binding);
    if (text.split(line).length - 1 !== 1) {
      throw new NanoBananaReferenceContractError(
        `${label} must explicitly bind Image ${binding.ordinal} exactly once.`,
      );
    }
  }
}

export function assertNanoBananaReferenceContract(
  contract: NanoBananaReferenceContract,
): void {
  const expectedOperation =
    contract.imageUrls.length === 0 ? "gen_image" : "edit_image";
  if (
    contract.operation !== expectedOperation ||
    contract.endpoint !== endpointByOperation[expectedOperation]
  ) {
    throw new NanoBananaReferenceContractError(
      "Nano Banana endpoint routing does not match its references.",
    );
  }
  if (
    contract.imageUrls.length !== contract.bindings.length ||
    contract.bindings.length > NANO_BANANA_MAX_REFERENCE_IMAGES
  ) {
    throw new NanoBananaReferenceContractError(
      "Nano Banana attachments and bindings are not one-to-one.",
    );
  }
  if (contract.prompt.length > NANO_BANANA_MAX_PROMPT_CHARACTERS) {
    throw new NanoBananaReferenceContractError("Nano Banana prompt is too long.");
  }
  if (
    contract.systemPrompt !== null &&
    contract.systemPrompt.length > NANO_BANANA_MAX_PROMPT_CHARACTERS
  ) {
    throw new NanoBananaReferenceContractError(
      "Nano Banana system prompt is too long.",
    );
  }

  if (contract.bindings.length === 0) {
    if (
      contract.systemPrompt !== null ||
      referenceOrdinals(contract.prompt).length > 0
    ) {
      throw new NanoBananaReferenceContractError(
        "A text-to-image request contains reference-only instructions.",
      );
    }
    return;
  }

  if (!contract.systemPrompt) {
    throw new NanoBananaReferenceContractError(
      "A reference edit requires an ordered system prompt.",
    );
  }
  const assetIds = new Set<string>();
  const imageUrls = new Set<string>();
  for (const [index, binding] of contract.bindings.entries()) {
    const ordinal = index + 1;
    if (
      !uuidPattern.test(binding.assetVersionId) ||
      !referenceRoles.has(binding.role) ||
      binding.ordinal !== ordinal ||
      binding.imageToken !== `Image ${ordinal}` ||
      binding.atToken !== `@Image${ordinal}`
    ) {
      throw new NanoBananaReferenceContractError(
        "Nano Banana reference ordinals are not contiguous and ordered.",
      );
    }
    const canonicalUrl = assertHttpsUrl(
      contract.imageUrls[index]!,
      `Reference ${ordinal} image URL`,
    );
    if (canonicalUrl !== contract.imageUrls[index]) {
      throw new NanoBananaReferenceContractError(
        "Nano Banana reference URLs are not canonical.",
      );
    }
    if (
      assetIds.has(binding.assetVersionId) ||
      imageUrls.has(contract.imageUrls[index]!)
    ) {
      throw new NanoBananaReferenceContractError(
        "Nano Banana reference attachments must be unique.",
      );
    }
    assetIds.add(binding.assetVersionId);
    imageUrls.add(contract.imageUrls[index]!);
  }
  assertPromptBindings(contract.prompt, contract.bindings, "The user prompt");
  assertPromptBindings(contract.systemPrompt, contract.bindings, "The system prompt");
}

export function compileNanoBananaReferenceContract(
  input: Readonly<{
    allowIntentionalSplitScreen?: boolean;
    compositionPrompt: string;
    references: readonly NanoBananaReferenceInput[];
  }>,
): NanoBananaReferenceContract {
  const compositionPrompt = boundedText(
    input.compositionPrompt,
    "Nano Banana composition prompt",
    NANO_BANANA_MAX_PROMPT_CHARACTERS,
  );
  assertNoManualReferenceTokens(compositionPrompt, "Nano Banana composition prompt");
  if (input.references.length > NANO_BANANA_MAX_REFERENCE_IMAGES) {
    throw new NanoBananaReferenceContractError(
      `Nano Banana accepts at most ${NANO_BANANA_MAX_REFERENCE_IMAGES} reference images.`,
    );
  }
  if (input.references.length === 0) {
    const contract = Object.freeze({
      bindings: Object.freeze([]),
      endpoint: endpointByOperation.gen_image,
      imageUrls: Object.freeze([]),
      operation: "gen_image" as const,
      prompt: compositionPrompt,
      systemPrompt: null,
    });
    assertNanoBananaReferenceContract(contract);
    return contract;
  }

  const bindings = input.references.map((reference, index) => {
    if (!uuidPattern.test(reference.assetVersionId)) {
      throw new NanoBananaReferenceContractError(
        `Reference ${index + 1} asset version is invalid.`,
      );
    }
    if (!referenceRoles.has(reference.role)) {
      throw new NanoBananaReferenceContractError(
        `Reference ${index + 1} role is invalid.`,
      );
    }
    const purpose = boundedText(
      reference.purpose,
      `Reference ${index + 1} purpose`,
      1_000,
    );
    assertNoManualReferenceTokens(purpose, `Reference ${index + 1} purpose`);
    const ordinal = index + 1;
    return Object.freeze({
      assetVersionId: reference.assetVersionId,
      atToken: `@Image${ordinal}`,
      imageToken: `Image ${ordinal}`,
      ordinal,
      purpose,
      role: reference.role,
    });
  });
  const imageUrls = input.references.map((reference, index) =>
    assertHttpsUrl(reference.imageUrl, `Reference ${index + 1} image URL`),
  );
  const mapping = bindings.map(expectedBindingLine).join("\n");
  const splitScreenPolicy = input.allowIntentionalSplitScreen
    ? "Do not reproduce the references as a contact sheet or accidental collage. A deliberate two-state split-screen composition is allowed only because the composition paragraph explicitly requires it."
    : "Do not reproduce the references as panels, a contact sheet, collage, or split screen.";
  const systemPrompt =
    `The reference images are supplied in image_urls order. The two labels on each line name the same ordered attachment. Use every image only for its stated purpose. ${splitScreenPolicy}\n\n` +
    mapping;
  const paragraphBreak = compositionPrompt.indexOf("\n\n");
  const prompt =
    paragraphBreak < 0
      ? `Reference bindings (in image_urls order):\n${mapping}\n${compositionPrompt}`
      : `Reference bindings (in image_urls order):\n${mapping}\n${compositionPrompt.slice(0, paragraphBreak)}${compositionPrompt.slice(paragraphBreak)}`;
  if (
    prompt.length > NANO_BANANA_MAX_PROMPT_CHARACTERS ||
    systemPrompt.length > NANO_BANANA_MAX_PROMPT_CHARACTERS
  ) {
    throw new NanoBananaReferenceContractError(
      "Compiled Nano Banana reference instructions are too long.",
    );
  }
  const contract = Object.freeze({
    bindings: Object.freeze(bindings),
    endpoint: endpointByOperation.edit_image,
    imageUrls: Object.freeze(imageUrls),
    operation: "edit_image" as const,
    prompt,
    systemPrompt,
  });
  assertNanoBananaReferenceContract(contract);
  return contract;
}

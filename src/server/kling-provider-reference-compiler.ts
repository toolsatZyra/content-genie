import "server-only";

const MAXIMUM_PROMPT_LENGTH = 2_500;
const MAXIMUM_URL_LENGTH = 2_048;
const MAXIMUM_KLING_3_ELEMENTS = 4;
const MAXIMUM_ELEMENT_REFERENCE_IMAGES = 3;

const imageTokenPattern = /@Image\d+\b/u;
const elementTokenPattern = /@Element(\d+)\b/gu;
const kling25Durations = new Set(["5", "10"]);
const kling3Durations = new Set(
  Array.from({ length: 13 }, (_, index) => String(index + 3)),
);

export type KlingProviderModel = "kling-2.5-pro" | "kling-3-pro";

export type KlingProviderDuration = Readonly<{
  duration: string;
  requestedDurationMs: number;
  retainedDurationMs: number;
  totalHandleDurationMs: number;
}>;

export type Kling25ImageToVideoPayload = Readonly<{
  cfg_scale: number;
  duration: "5" | "10";
  image_url: string;
  negative_prompt: string;
  prompt: string;
  tail_image_url?: string;
}>;

export type Kling3ImageElement = Readonly<{
  frontalImageUrl: string;
  referenceImageUrls?: readonly string[];
}>;

export type Kling3ImageToVideoPayload = Readonly<{
  cfg_scale: number;
  duration:
    "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "14" | "15";
  elements?: readonly Readonly<{
    frontal_image_url: string;
    reference_image_urls?: readonly string[];
  }>[];
  end_image_url?: string;
  generate_audio: false;
  negative_prompt: string;
  prompt: string;
  start_image_url: string;
}>;

export class KlingProviderReferenceCompilerError extends Error {
  override readonly name = "KlingProviderReferenceCompilerError";
}

function boundedText(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.length > MAXIMUM_PROMPT_LENGTH ||
    value.includes("\0")
  ) {
    throw new KlingProviderReferenceCompilerError(`${field} is invalid.`);
  }
  return value;
}

function providerUrl(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAXIMUM_URL_LENGTH
  ) {
    throw new KlingProviderReferenceCompilerError(`${field} is invalid.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new KlingProviderReferenceCompilerError(`${field} is invalid.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !url.hostname
  ) {
    throw new KlingProviderReferenceCompilerError(`${field} is invalid.`);
  }
  return url.toString();
}

function cfgScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new KlingProviderReferenceCompilerError("cfgScale is invalid.");
  }
  return value;
}

function safeMilliseconds(value: unknown, field: string, allowZero: boolean): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < (allowZero ? 0 : 1) ||
    (value as number) > 30_000
  ) {
    throw new KlingProviderReferenceCompilerError(`${field} is invalid.`);
  }
  return value as number;
}

export function selectKlingProviderDuration(
  input: Readonly<{
    model: KlingProviderModel;
    retainedDurationMs: number;
    totalHandleDurationMs?: number;
  }>,
): KlingProviderDuration {
  if (input.model !== "kling-2.5-pro" && input.model !== "kling-3-pro") {
    throw new KlingProviderReferenceCompilerError("model is invalid.");
  }
  const retainedDurationMs = safeMilliseconds(
    input.retainedDurationMs,
    "retainedDurationMs",
    false,
  );
  const totalHandleDurationMs = safeMilliseconds(
    input.totalHandleDurationMs ?? 0,
    "totalHandleDurationMs",
    true,
  );
  const requiredDurationMs = retainedDurationMs + totalHandleDurationMs;
  const supportedDurations =
    input.model === "kling-2.5-pro"
      ? [5_000, 10_000]
      : Array.from({ length: 13 }, (_, index) => 3_000 + index * 1_000);
  const requestedDurationMs = supportedDurations.find(
    (duration) => duration >= requiredDurationMs,
  );
  if (requestedDurationMs === undefined) {
    throw new KlingProviderReferenceCompilerError(
      `${input.model} cannot cover the retained shot and edit handles.`,
    );
  }
  return Object.freeze({
    duration: String(requestedDurationMs / 1_000),
    requestedDurationMs,
    retainedDurationMs,
    totalHandleDurationMs,
  });
}

function negativePrompt(value: string | undefined): string {
  return boundedText(value ?? "blur, distort, and low quality", "negativePrompt");
}

export function compileKling25ImageToVideoPayload(
  input: Readonly<{
    cfgScale?: number;
    duration: "5" | "10";
    imageUrl: string;
    negativePrompt?: string;
    prompt: string;
    tailImageUrl?: string;
  }>,
): Kling25ImageToVideoPayload {
  const prompt = boundedText(input.prompt, "prompt");
  if (imageTokenPattern.test(prompt) || elementTokenPattern.test(prompt)) {
    throw new KlingProviderReferenceCompilerError(
      "Kling 2.5 start and tail frames are implicit and cannot use reference tokens.",
    );
  }
  elementTokenPattern.lastIndex = 0;
  if (!kling25Durations.has(input.duration)) {
    throw new KlingProviderReferenceCompilerError("Kling 2.5 duration is invalid.");
  }
  const payload: {
    cfg_scale: number;
    duration: "5" | "10";
    image_url: string;
    negative_prompt: string;
    prompt: string;
    tail_image_url?: string;
  } = {
    cfg_scale: cfgScale(input.cfgScale ?? 0.5),
    duration: input.duration,
    image_url: providerUrl(input.imageUrl, "imageUrl"),
    negative_prompt: negativePrompt(input.negativePrompt),
    prompt,
  };
  if (input.tailImageUrl !== undefined) {
    payload.tail_image_url = providerUrl(input.tailImageUrl, "tailImageUrl");
  }
  return Object.freeze(payload);
}

function exactElementTokens(prompt: string, elementCount: number): void {
  if (imageTokenPattern.test(prompt)) {
    throw new KlingProviderReferenceCompilerError(
      "Kling 3 does not bind custom elements with @Image tokens.",
    );
  }
  imageTokenPattern.lastIndex = 0;
  const tokens = new Set<number>();
  for (const match of prompt.matchAll(elementTokenPattern)) {
    const tokenNumber = Number(match[1]);
    if (match[0] !== `@Element${tokenNumber}`) {
      throw new KlingProviderReferenceCompilerError(
        "Kling 3 element tokens are not canonical.",
      );
    }
    tokens.add(tokenNumber);
  }
  const expected = Array.from({ length: elementCount }, (_, index) => index + 1);
  if (tokens.size !== expected.length || expected.some((value) => !tokens.has(value))) {
    throw new KlingProviderReferenceCompilerError(
      "Kling 3 element attachments and @Element tokens do not match exactly.",
    );
  }
}

export function compileKling3ImageToVideoPayload(
  input: Readonly<{
    cfgScale?: number;
    duration: Kling3ImageToVideoPayload["duration"];
    elements?: readonly Kling3ImageElement[];
    endImageUrl?: string;
    negativePrompt?: string;
    prompt: string;
    startImageUrl: string;
  }>,
): Kling3ImageToVideoPayload {
  const prompt = boundedText(input.prompt, "prompt");
  if (!kling3Durations.has(input.duration)) {
    throw new KlingProviderReferenceCompilerError("Kling 3 duration is invalid.");
  }
  const elements = input.elements ?? [];
  if (elements.length > MAXIMUM_KLING_3_ELEMENTS) {
    throw new KlingProviderReferenceCompilerError("Kling 3 elements exceed policy.");
  }
  exactElementTokens(prompt, elements.length);
  const compiledElements = elements.map((element, elementIndex) => {
    const referenceImageUrls = element.referenceImageUrls ?? [];
    if (referenceImageUrls.length > MAXIMUM_ELEMENT_REFERENCE_IMAGES) {
      throw new KlingProviderReferenceCompilerError(
        `Kling 3 Element${elementIndex + 1} references exceed policy.`,
      );
    }
    const compiled: {
      frontal_image_url: string;
      reference_image_urls?: readonly string[];
    } = {
      frontal_image_url: providerUrl(
        element.frontalImageUrl,
        `Element${elementIndex + 1} frontalImageUrl`,
      ),
    };
    if (referenceImageUrls.length > 0) {
      compiled.reference_image_urls = Object.freeze(
        referenceImageUrls.map((url, referenceIndex) =>
          providerUrl(
            url,
            `Element${elementIndex + 1} referenceImageUrls[${referenceIndex}]`,
          ),
        ),
      );
    }
    return Object.freeze(compiled);
  });
  const payload: {
    cfg_scale: number;
    duration: Kling3ImageToVideoPayload["duration"];
    elements?: readonly (typeof compiledElements)[number][];
    end_image_url?: string;
    generate_audio: false;
    negative_prompt: string;
    prompt: string;
    start_image_url: string;
  } = {
    cfg_scale: cfgScale(input.cfgScale ?? 0.5),
    duration: input.duration,
    generate_audio: false,
    negative_prompt: negativePrompt(input.negativePrompt),
    prompt,
    start_image_url: providerUrl(input.startImageUrl, "startImageUrl"),
  };
  if (input.endImageUrl !== undefined) {
    payload.end_image_url = providerUrl(input.endImageUrl, "endImageUrl");
  }
  if (compiledElements.length > 0) {
    payload.elements = Object.freeze(compiledElements);
  }
  return Object.freeze(payload);
}

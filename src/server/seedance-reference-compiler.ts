const SEEDANCE_MINIMUM_SECONDS = 4;
const SEEDANCE_MAXIMUM_SECONDS = 15;

export type SeedanceDurationSeconds =
  "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "14" | "15";

export type SeedanceDurationPlan = Readonly<{
  editorialDurationMs: number;
  generationDurationMs: number;
  headHandleMs: number;
  providerDuration: SeedanceDurationSeconds;
  providerDurationMs: number;
  requiresSegmentation: boolean;
  tailHandleMs: number;
}>;

export type SeedanceReferenceInput = Readonly<{
  assetVersionId: string | null;
  role: string;
  url: string;
}>;

export type SeedanceReferenceBinding = Readonly<{
  assetVersionId: string | null;
  field: "audio_urls" | "image_urls" | "video_urls";
  index: number;
  role: string;
  token: `@${"Audio" | "Image" | "Video"}${number}`;
  url: string;
}>;

export type SeedanceCompilerOptions = Readonly<{
  aspectRatio?: "auto" | "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
  bitrateMode?: "high" | "standard";
  editorialDurationMs: number;
  generateAudio?: boolean;
  headHandleMs?: number;
  prompt: string;
  resolution?: "480p" | "720p" | "1080p" | "4k";
  tailHandleMs?: number;
}>;

export class SeedanceReferenceCompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedanceReferenceCompilerError";
  }
}

function finiteInteger(value: number, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new SeedanceReferenceCompilerError(
      `${label} must be a safe integer of at least ${minimum}.`,
    );
  }
  return value;
}

function boundedText(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SeedanceReferenceCompilerError(`${label} must not be empty.`);
  }
  if (value.length > 16_000) {
    throw new SeedanceReferenceCompilerError(
      `${label} exceeds the provider compiler limit.`,
    );
  }
  return value;
}

function secureUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new SeedanceReferenceCompilerError(`${label} is not a valid URL.`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new SeedanceReferenceCompilerError(
      `${label} must be an uncredentialed HTTPS URL without a fragment.`,
    );
  }
  return parsed.toString();
}

export function compileSeedanceDuration(input: {
  editorialDurationMs: number;
  headHandleMs?: number;
  tailHandleMs?: number;
}): SeedanceDurationPlan {
  const editorialDurationMs = finiteInteger(
    input.editorialDurationMs,
    "The editorial duration",
    1,
  );
  const headHandleMs = finiteInteger(input.headHandleMs ?? 0, "The head handle", 0);
  const tailHandleMs = finiteInteger(input.tailHandleMs ?? 0, "The tail handle", 0);
  const generationDurationMs = editorialDurationMs + headHandleMs + tailHandleMs;
  if (!Number.isSafeInteger(generationDurationMs)) {
    throw new SeedanceReferenceCompilerError(
      "The requested generation duration is outside the safe integer range.",
    );
  }
  const quantumSeconds = Math.ceil(generationDurationMs / 1_000);
  const providerSeconds = Math.min(
    SEEDANCE_MAXIMUM_SECONDS,
    Math.max(SEEDANCE_MINIMUM_SECONDS, quantumSeconds),
  );

  return Object.freeze({
    editorialDurationMs,
    generationDurationMs,
    headHandleMs,
    providerDuration: String(providerSeconds) as SeedanceDurationSeconds,
    providerDurationMs: providerSeconds * 1_000,
    requiresSegmentation: generationDurationMs > SEEDANCE_MAXIMUM_SECONDS * 1_000,
    tailHandleMs,
  });
}

function compileTiming(options: SeedanceCompilerOptions): SeedanceDurationPlan {
  const timing = compileSeedanceDuration(options);
  if (timing.requiresSegmentation) {
    throw new SeedanceReferenceCompilerError(
      "A single Seedance request cannot cover the editorial duration and handles.",
    );
  }
  return timing;
}

function referencedTokens(prompt: string): readonly string[] {
  if (/\[(Image|Video|Audio)[0-9]+\]/iu.test(prompt)) {
    throw new SeedanceReferenceCompilerError(
      "Seedance reference prompts must use @ImageN, @VideoN, and @AudioN tokens.",
    );
  }
  const tokens: string[] = [];
  for (const match of prompt.matchAll(/@(Image|Video|Audio)([0-9]+)\b/giu)) {
    const modality = match[1];
    const ordinal = match[2];
    if (!modality || !ordinal) continue;
    const canonical = `@${modality[0]!.toUpperCase()}${modality.slice(1).toLowerCase()}${ordinal}`;
    if (match[0] !== canonical) {
      throw new SeedanceReferenceCompilerError(
        `Seedance reference token ${match[0]} must be written as ${canonical}.`,
      );
    }
    tokens.push(canonical);
  }
  return tokens;
}

function noReferenceTokens(prompt: string): void {
  const tokens = referencedTokens(prompt);
  if (tokens.length > 0) {
    throw new SeedanceReferenceCompilerError(
      "Seedance image-to-video prompts must not contain reference-to-video tokens.",
    );
  }
}

function compileReferenceList(
  values: readonly SeedanceReferenceInput[],
  modality: "Audio" | "Image" | "Video",
  field: SeedanceReferenceBinding["field"],
  maximum: number,
): readonly SeedanceReferenceBinding[] {
  if (values.length > maximum) {
    throw new SeedanceReferenceCompilerError(
      `Seedance accepts at most ${maximum} ${modality.toLowerCase()} references.`,
    );
  }
  return Object.freeze(
    values.map((value, index) =>
      Object.freeze({
        assetVersionId: value.assetVersionId,
        field,
        index,
        role: boundedText(value.role, `${modality} reference role ${index + 1}`),
        token: `@${modality}${index + 1}` as const,
        url: secureUrl(value.url, `${modality} reference ${index + 1}`),
      }),
    ),
  );
}

function sharedPayload(options: SeedanceCompilerOptions, timing: SeedanceDurationPlan) {
  return {
    aspect_ratio: options.aspectRatio ?? "9:16",
    bitrate_mode: options.bitrateMode ?? "standard",
    duration: timing.providerDuration,
    generate_audio: options.generateAudio ?? false,
    prompt: boundedText(options.prompt, "The Seedance prompt"),
    resolution: options.resolution ?? "720p",
  } as const;
}

export function compileSeedanceImageToVideo(
  options: SeedanceCompilerOptions & {
    endFrame?: SeedanceReferenceInput;
    startFrame: SeedanceReferenceInput;
  },
) {
  const timing = compileTiming(options);
  const prompt = boundedText(options.prompt, "The Seedance prompt");
  noReferenceTokens(prompt);
  const startUrl = secureUrl(options.startFrame.url, "The Seedance start frame");
  const endUrl = options.endFrame
    ? secureUrl(options.endFrame.url, "The Seedance end frame")
    : null;
  const bindings = Object.freeze([
    Object.freeze({
      assetVersionId: options.startFrame.assetVersionId,
      field: "image_url" as const,
      role: "start_frame" as const,
      url: startUrl,
    }),
    ...(options.endFrame
      ? [
          Object.freeze({
            assetVersionId: options.endFrame.assetVersionId,
            field: "end_image_url" as const,
            role: "end_frame" as const,
            url: endUrl!,
          }),
        ]
      : []),
  ]);
  return Object.freeze({
    bindings,
    endpoint: "bytedance/seedance-2.0/image-to-video" as const,
    payload: Object.freeze({
      ...sharedPayload(options, timing),
      ...(endUrl ? { end_image_url: endUrl } : {}),
      image_url: startUrl,
    }),
    timing,
  });
}

export function compileSeedanceReferenceToVideo(
  options: SeedanceCompilerOptions & {
    audioReferences?: readonly SeedanceReferenceInput[];
    imageReferences?: readonly SeedanceReferenceInput[];
    videoReferences?: readonly SeedanceReferenceInput[];
  },
) {
  const timing = compileTiming(options);
  const prompt = boundedText(options.prompt, "The Seedance prompt");
  const images = compileReferenceList(
    options.imageReferences ?? [],
    "Image",
    "image_urls",
    9,
  );
  const videos = compileReferenceList(
    options.videoReferences ?? [],
    "Video",
    "video_urls",
    3,
  );
  const audios = compileReferenceList(
    options.audioReferences ?? [],
    "Audio",
    "audio_urls",
    3,
  );
  const bindings = Object.freeze([...images, ...videos, ...audios]);
  if (bindings.length === 0) {
    throw new SeedanceReferenceCompilerError(
      "Seedance reference-to-video requires at least one reference.",
    );
  }
  if (bindings.length > 12) {
    throw new SeedanceReferenceCompilerError(
      "Seedance accepts at most 12 references across all modalities.",
    );
  }
  if (audios.length > 0 && images.length === 0 && videos.length === 0) {
    throw new SeedanceReferenceCompilerError(
      "Seedance audio references require an image or video reference.",
    );
  }

  const expected = new Set<string>(bindings.map(({ token }) => token));
  const actual = new Set(referencedTokens(prompt));
  const missing = [...expected].filter((token) => !actual.has(token));
  const unattached = [...actual].filter((token) => !expected.has(token));
  if (missing.length > 0 || unattached.length > 0) {
    throw new SeedanceReferenceCompilerError(
      `Seedance prompt/reference mismatch. Missing: ${missing.join(", ") || "none"}. Unattached: ${unattached.join(", ") || "none"}.`,
    );
  }

  return Object.freeze({
    bindings,
    endpoint: "bytedance/seedance-2.0/reference-to-video" as const,
    payload: Object.freeze({
      ...sharedPayload(options, timing),
      ...(audios.length > 0 ? { audio_urls: audios.map(({ url }) => url) } : {}),
      ...(images.length > 0 ? { image_urls: images.map(({ url }) => url) } : {}),
      ...(videos.length > 0 ? { video_urls: videos.map(({ url }) => url) } : {}),
    }),
    timing,
  });
}

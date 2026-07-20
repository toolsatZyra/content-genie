import "server-only";

import { createHash } from "node:crypto";

import {
  microProviderOperations,
  type MicroProviderOperation,
} from "@/domain/provider/broker-contract";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const modelPattern =
  /^[A-Za-z0-9][A-Za-z0-9_.-]{1,80}(?:\/[A-Za-z0-9][A-Za-z0-9_.-]{0,80}){0,4}$/u;

export type ProviderDispatchManifest = Readonly<{
  aggregateVersion: number;
  correlationId: string;
  credentialSecretRef: "ELEVENLABS_API_KEY" | "FAL_KEY";
  endpointKey: string;
  expectedCostMinor: number;
  inputManifestHash: string;
  maximumCostMinor: number;
  modelKey: string;
  operation: MicroProviderOperation;
  payload: Readonly<Record<string, unknown>>;
  payloadSchemaVersion: string;
  provider: "elevenlabs" | "fal";
  providerRequestId: string;
  workspaceId: string;
}>;

export type ProviderAdapterResult =
  | Readonly<{
      externalJobId: string;
      kind: "async";
      responseHash: string;
    }>
  | Readonly<{
      alignment: SpeechAlignment;
      audioSha256: string;
      bytes: Buffer;
      contentType: "audio/mpeg";
      externalJobId: string;
      kind: "quarantine_bytes";
      responseHash: string;
      targetAssetId: string;
    }>;

export type SpeechAlignment = Readonly<{
  characterEndTimesSeconds: readonly number[];
  characters: readonly string[];
  characterStartTimesSeconds: readonly number[];
}>;

export type ProviderAdapterSecrets = Readonly<{
  elevenLabsApiKey: string;
  falKey: string;
  falWebhookBaseUrl: string;
  referenceImageHosts: readonly string[];
}>;

export class ProviderAdapterError extends Error {
  override readonly name = "ProviderAdapterError";

  constructor(
    message: string,
    readonly disposition: "retryable" | "terminal" | "unknown" = "terminal",
    readonly safeClass = "provider.policy_rejected",
  ) {
    super(message);
  }
}

function providerHttpError(provider: "elevenlabs" | "fal", status: number) {
  const disposition =
    status === 429
      ? "retryable"
      : status === 408 || status >= 500
        ? "unknown"
        : "terminal";
  return new ProviderAdapterError(
    `${provider} request failed with ${status}.`,
    disposition,
    `${provider}.http_${status}`,
  );
}

function exactObject(value: unknown, keys: readonly string[]): value is object {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new ProviderAdapterError(`${field} is invalid.`);
  }
  return value.toLowerCase();
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maximum) {
    throw new ProviderAdapterError(`${field} is invalid.`);
  }
  return value;
}

function finiteNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ProviderAdapterError(`${field} is invalid.`);
  }
  return value;
}

export function parseProviderDispatchManifest(
  value: unknown,
): ProviderDispatchManifest {
  const keys = [
    "aggregateVersion",
    "correlationId",
    "credentialSecretRef",
    "endpointKey",
    "expectedCostMinor",
    "inputManifestHash",
    "maximumCostMinor",
    "modelKey",
    "operation",
    "payload",
    "payloadSchemaVersion",
    "provider",
    "providerRequestId",
    "workspaceId",
  ] as const;
  if (!exactObject(value, keys)) {
    throw new ProviderAdapterError("Provider dispatch manifest is not exact.");
  }
  const input = value as Record<string, unknown>;
  if (
    (input.provider !== "fal" && input.provider !== "elevenlabs") ||
    (input.credentialSecretRef !== "FAL_KEY" &&
      input.credentialSecretRef !== "ELEVENLABS_API_KEY") ||
    (input.provider === "fal" && input.credentialSecretRef !== "FAL_KEY") ||
    (input.provider === "elevenlabs" &&
      input.credentialSecretRef !== "ELEVENLABS_API_KEY") ||
    typeof input.modelKey !== "string" ||
    !modelPattern.test(input.modelKey) ||
    typeof input.endpointKey !== "string" ||
    !/^[a-z][a-z0-9_.-]{2,100}$/u.test(input.endpointKey) ||
    typeof input.payloadSchemaVersion !== "string" ||
    !/^[a-z0-9_.-]{3,100}$/u.test(input.payloadSchemaVersion) ||
    !microProviderOperations.includes(input.operation as MicroProviderOperation) ||
    typeof input.inputManifestHash !== "string" ||
    !sha256Pattern.test(input.inputManifestHash) ||
    !Number.isSafeInteger(input.aggregateVersion) ||
    (input.aggregateVersion as number) < 1 ||
    !Number.isSafeInteger(input.expectedCostMinor) ||
    (input.expectedCostMinor as number) < 0 ||
    !Number.isSafeInteger(input.maximumCostMinor) ||
    (input.maximumCostMinor as number) < (input.expectedCostMinor as number) ||
    !input.payload ||
    typeof input.payload !== "object" ||
    Array.isArray(input.payload)
  ) {
    throw new ProviderAdapterError("Provider dispatch manifest is invalid.");
  }
  return Object.freeze({
    aggregateVersion: input.aggregateVersion as number,
    correlationId: uuid(input.correlationId, "correlationId"),
    credentialSecretRef: input.credentialSecretRef,
    endpointKey: input.endpointKey,
    expectedCostMinor: input.expectedCostMinor as number,
    inputManifestHash: input.inputManifestHash,
    maximumCostMinor: input.maximumCostMinor as number,
    modelKey: input.modelKey,
    operation: input.operation as MicroProviderOperation,
    payload: Object.freeze({ ...(input.payload as Record<string, unknown>) }),
    payloadSchemaVersion: input.payloadSchemaVersion,
    provider: input.provider,
    providerRequestId: uuid(input.providerRequestId, "providerRequestId"),
    workspaceId: uuid(input.workspaceId, "workspaceId"),
  });
}

function falPayload(
  manifest: ProviderDispatchManifest,
  referenceImageHosts: readonly string[],
): Record<string, unknown> {
  const secretsReferenceHosts = new Set(
    referenceImageHosts.map((host) => host.toLowerCase()),
  );
  const sharedKeys = [
    "aspectRatio",
    "enableWebSearch",
    "limitGenerations",
    "numImages",
    "outputFormat",
    "prompt",
    "resolution",
    "safetyTolerance",
    "targetAssetId",
    "thinkingLevel",
  ] as const;
  const generation =
    manifest.provider === "fal" &&
    manifest.operation === "gen_image" &&
    manifest.modelKey === "fal-ai/nano-banana-2" &&
    manifest.payloadSchemaVersion === "genie.fal-nano-banana-2.v1" &&
    exactObject(manifest.payload, sharedKeys);
  const edit =
    manifest.provider === "fal" &&
    manifest.operation === "edit_image" &&
    manifest.modelKey === "fal-ai/nano-banana-2/edit" &&
    manifest.payloadSchemaVersion === "genie.fal-nano-banana-2-edit.v1" &&
    exactObject(manifest.payload, [...sharedKeys, "imageUrls"]);
  if (!generation && !edit) {
    throw new ProviderAdapterError("FAL image payload is invalid.");
  }
  const payload = manifest.payload as Record<string, unknown>;
  if (
    payload.aspectRatio !== "9:16" ||
    payload.enableWebSearch !== false ||
    payload.limitGenerations !== true ||
    payload.outputFormat !== "png" ||
    payload.numImages !== 1 ||
    payload.resolution !== "2K" ||
    payload.safetyTolerance !== "2" ||
    payload.thinkingLevel !== "high"
  ) {
    throw new ProviderAdapterError("FAL image payload policy is invalid.");
  }
  uuid(payload.targetAssetId, "targetAssetId");
  const body: Record<string, unknown> = {
    aspect_ratio: "9:16",
    enable_web_search: false,
    limit_generations: true,
    num_images: 1,
    output_format: "png",
    prompt: boundedText(payload.prompt, "prompt", 16_000),
    resolution: "2K",
    safety_tolerance: "2",
    thinking_level: "high",
  };
  if (edit) {
    const imageUrls = payload.imageUrls;
    if (!Array.isArray(imageUrls) || imageUrls.length < 1 || imageUrls.length > 4) {
      throw new ProviderAdapterError("FAL image references are invalid.");
    }
    body.image_urls = imageUrls.map((value) => {
      if (typeof value !== "string" || value.length > 2_048) {
        throw new ProviderAdapterError("FAL image reference is invalid.");
      }
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new ProviderAdapterError("FAL image reference is invalid.");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.hash ||
        !secretsReferenceHosts.has(url.hostname.toLowerCase()) ||
        !url.pathname.startsWith("/storage/v1/object/sign/workspace-media/")
      ) {
        throw new ProviderAdapterError("FAL image reference is outside policy.");
      }
      return url.toString();
    });
  }
  return body;
}

function elevenLabsPayload(manifest: ProviderDispatchManifest): {
  body: Record<string, unknown>;
  targetAssetId: string;
  voiceId: string;
} {
  if (
    manifest.provider !== "elevenlabs" ||
    manifest.operation !== "gen_speech" ||
    !exactObject(manifest.payload, [
      "modelId",
      "outputFormat",
      "targetAssetId",
      "text",
      "voiceId",
      "voiceSettings",
    ])
  ) {
    throw new ProviderAdapterError("ElevenLabs speech payload is invalid.");
  }
  const payload = manifest.payload as Record<string, unknown>;
  if (
    payload.outputFormat !== "mp3_44100_128" ||
    typeof payload.voiceId !== "string" ||
    !/^[A-Za-z0-9]{20}$/u.test(payload.voiceId) ||
    !exactObject(payload.voiceSettings, [
      "similarityBoost",
      "stability",
      "style",
      "useSpeakerBoost",
    ])
  ) {
    throw new ProviderAdapterError("ElevenLabs speech policy is invalid.");
  }
  const settings = payload.voiceSettings as Record<string, unknown>;
  if (typeof settings.useSpeakerBoost !== "boolean") {
    throw new ProviderAdapterError("ElevenLabs speaker boost is invalid.");
  }
  return {
    body: {
      model_id: boundedText(payload.modelId, "modelId", 100),
      text: boundedText(payload.text, "text", 20_000),
      voice_settings: {
        similarity_boost: finiteNumber(
          settings.similarityBoost,
          "similarityBoost",
          0,
          1,
        ),
        stability: finiteNumber(settings.stability, "stability", 0, 1),
        style: finiteNumber(settings.style, "style", 0, 1),
        use_speaker_boost: settings.useSpeakerBoost,
      },
    },
    targetAssetId: uuid(payload.targetAssetId, "targetAssetId"),
    voiceId: payload.voiceId,
  };
}

function parseSpeechAlignment(value: unknown, exactText: string): SpeechAlignment {
  if (
    !exactObject(value, [
      "character_end_times_seconds",
      "character_start_times_seconds",
      "characters",
    ])
  ) {
    throw new ProviderAdapterError(
      "ElevenLabs alignment is not exact.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  const alignment = value as Record<string, unknown>;
  const characters = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  if (
    !Array.isArray(characters) ||
    !Array.isArray(starts) ||
    !Array.isArray(ends) ||
    characters.length < 1 ||
    characters.length > 20_000 ||
    characters.length !== starts.length ||
    characters.length !== ends.length ||
    characters.some(
      (character) => typeof character !== "string" || character.length < 1,
    ) ||
    characters.join("") !== exactText
  ) {
    throw new ProviderAdapterError(
      "ElevenLabs alignment does not cover the exact narration text.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  let previousStart = -1;
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index];
    const end = ends[index];
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start ||
      start < previousStart ||
      end > 1_800
    ) {
      throw new ProviderAdapterError(
        "ElevenLabs alignment timing is invalid.",
        "unknown",
        "elevenlabs.accept_response_invalid",
      );
    }
    previousStart = start;
  }
  return Object.freeze({
    characterEndTimesSeconds: Object.freeze([...(ends as number[])]),
    characters: Object.freeze([...(characters as string[])]),
    characterStartTimesSeconds: Object.freeze([...(starts as number[])]),
  });
}

async function boundedResponseBytes(response: Response, maximumBytes: number) {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      throw new ProviderAdapterError("Provider response length is invalid.");
    }
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    bytes.length > maximumBytes ||
    (declared !== null && bytes.length !== Number(declared))
  ) {
    throw new ProviderAdapterError("Provider response exceeded its byte contract.");
  }
  return bytes;
}

export async function submitProviderAdapter(
  manifestValue: unknown,
  secrets: ProviderAdapterSecrets,
  fetchImplementation: typeof fetch = fetch,
): Promise<ProviderAdapterResult> {
  const manifest = parseProviderDispatchManifest(manifestValue);
  if (manifest.provider === "fal") {
    if (secrets.falKey.length < 16) {
      throw new ProviderAdapterError("FAL credential is unavailable.");
    }
    const body = falPayload(manifest, secrets.referenceImageHosts);
    let submitUrl: URL;
    try {
      const callback = new URL(
        `${secrets.falWebhookBaseUrl}/${manifest.providerRequestId}`,
      );
      if (
        callback.protocol !== "https:" ||
        callback.username ||
        callback.password ||
        callback.hash ||
        !callback.pathname.endsWith(
          `/api/internal/provider-webhooks/fal/${manifest.providerRequestId}`,
        )
      ) {
        throw new TypeError("invalid callback");
      }
      submitUrl = new URL(`https://queue.fal.run/${manifest.modelKey}`);
      submitUrl.searchParams.set("fal_webhook", callback.toString());
    } catch {
      throw new ProviderAdapterError("FAL webhook configuration is invalid.");
    }
    const response = await fetchImplementation(submitUrl, {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Key ${secrets.falKey}`,
        "Content-Type": "application/json",
        "X-Genie-Correlation-Id": manifest.correlationId,
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw providerHttpError("fal", response.status);
    }
    let bytes: Buffer;
    try {
      bytes = await boundedResponseBytes(response, 64 * 1024);
    } catch {
      throw new ProviderAdapterError(
        "FAL accepted response violated its byte contract.",
        "unknown",
        "fal.accept_response_invalid",
      );
    }
    let output: unknown;
    try {
      output = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new ProviderAdapterError(
        "FAL accepted response JSON is invalid.",
        "unknown",
        "fal.accept_response_invalid",
      );
    }
    if (
      !output ||
      typeof output !== "object" ||
      Array.isArray(output) ||
      typeof (output as Record<string, unknown>).request_id !== "string" ||
      !/^[A-Za-z0-9_-]{6,200}$/u.test(
        (output as Record<string, unknown>).request_id as string,
      )
    ) {
      throw new ProviderAdapterError(
        "FAL accepted response is missing its job identity.",
        "unknown",
        "fal.accept_response_invalid",
      );
    }
    const externalJobId = (output as Record<string, unknown>).request_id as string;
    return Object.freeze({
      externalJobId,
      kind: "async",
      responseHash: createHash("sha256").update(bytes).digest("hex"),
    });
  }

  if (secrets.elevenLabsApiKey.length < 16) {
    throw new ProviderAdapterError("ElevenLabs credential is unavailable.");
  }
  const speech = elevenLabsPayload(manifest);
  const response = await fetchImplementation(
    `https://api.elevenlabs.io/v1/text-to-speech/${speech.voiceId}/with-timestamps?output_format=mp3_44100_128`,
    {
      body: JSON.stringify(speech.body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "xi-api-key": secrets.elevenLabsApiKey,
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    throw providerHttpError("elevenlabs", response.status);
  }
  if (response.headers.get("content-type")?.split(";", 1)[0] !== "application/json") {
    throw new ProviderAdapterError(
      "ElevenLabs accepted response has an invalid media type.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  let responseBytes: Buffer;
  try {
    responseBytes = await boundedResponseBytes(response, 36 * 1024 * 1024);
  } catch {
    throw new ProviderAdapterError(
      "ElevenLabs accepted response violated its byte contract.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  let output: unknown;
  try {
    output = JSON.parse(responseBytes.toString("utf8"));
  } catch {
    throw new ProviderAdapterError(
      "ElevenLabs accepted response JSON is invalid.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  if (!exactObject(output, ["alignment", "audio_base64", "normalized_alignment"])) {
    throw new ProviderAdapterError(
      "ElevenLabs accepted response is malformed.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  const outputRecord = output as Record<string, unknown>;
  const audioBase64 = outputRecord.audio_base64;
  if (
    typeof audioBase64 !== "string" ||
    audioBase64.length > 35 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(audioBase64)
  ) {
    throw new ProviderAdapterError(
      "ElevenLabs accepted response is malformed.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  const bytes = Buffer.from(audioBase64, "base64");
  const mp3MagicPass =
    bytes.subarray(0, 3).toString("ascii") === "ID3" ||
    (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
  if (bytes.length < 64 || bytes.length > 25 * 1024 * 1024 || !mp3MagicPass) {
    throw new ProviderAdapterError(
      "ElevenLabs audio bytes are invalid.",
      "unknown",
      "elevenlabs.accept_response_invalid",
    );
  }
  const alignment = parseSpeechAlignment(
    outputRecord.alignment,
    manifest.payload.text as string,
  );
  return Object.freeze({
    alignment,
    audioSha256: createHash("sha256").update(bytes).digest("hex"),
    bytes,
    contentType: "audio/mpeg",
    externalJobId: `sync-${manifest.correlationId}`,
    kind: "quarantine_bytes",
    responseHash: createHash("sha256").update(responseBytes).digest("hex"),
    targetAssetId: speech.targetAssetId,
  });
}

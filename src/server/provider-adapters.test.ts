import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { submitProviderAdapter } from "./provider-adapters";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const narrationSource = "Shiva";
const narrationControl = "[curious] ";
const narrationDelivery = `${narrationControl}SHIVA!`;
const narrationMap = [
  ...Array.from(narrationControl, () => null),
  ...Array.from(narrationSource, (_, index) => index),
  null,
];
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

function manifest(provider: "fal" | "elevenlabs") {
  return {
    aggregateVersion: 2,
    correlationId: id("1"),
    credentialSecretRef: provider === "fal" ? "FAL_KEY" : "ELEVENLABS_API_KEY",
    endpointKey: provider === "fal" ? "fal.queue.submit" : "elevenlabs.tts.sync",
    expectedCostMinor: 25,
    inputManifestHash: "a".repeat(64),
    maximumCostMinor: 25,
    modelKey: provider === "fal" ? "fal-ai/nano-banana-2" : "eleven_v3",
    operation: provider === "fal" ? "gen_image" : "gen_speech",
    payload:
      provider === "fal"
        ? {
            aspectRatio: "9:16",
            enableWebSearch: false,
            limitGenerations: true,
            numImages: 1,
            outputFormat: "png",
            prompt: "Cinematic image of Shiva, respectful devotional realism.",
            resolution: "2K",
            safetyTolerance: "2",
            targetAssetId: id("2"),
            thinkingLevel: "high",
          }
        : {
            deliveryMap: narrationMap,
            deliveryTextSha256: hash(narrationDelivery),
            modelId: "eleven_v3",
            outputFormat: "mp3_44100_128",
            sourceText: narrationSource,
            sourceTextSha256: hash(narrationSource),
            targetAssetId: id("2"),
            text: narrationDelivery,
            voiceId: "b0oby86k6n7Uh5LZcOBR",
            voiceSettings: {
              similarityBoost: 0.82,
              stability: 0.5,
              style: 0,
              useSpeakerBoost: true,
            },
          },
    payloadSchemaVersion:
      provider === "fal" ? "genie.fal-nano-banana-2.v1" : "genie.tts.v1",
    provider,
    providerRequestId: id("3"),
    workspaceId: id("4"),
  };
}

const secrets = {
  elevenLabsApiKey: "eleven-secret-value-for-test",
  falKey: "fal-secret-value-for-test",
  falWebhookBaseUrl:
    "https://content-genie-three.vercel.app/api/internal/provider-webhooks/fal",
  referenceImageHosts: ["preview.supabase.co"],
};

describe("narrow provider adapters", () => {
  it("submits an allowlisted FAL image job and retains only the job identity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          request_id: "fal_job_123456",
          response_url: "https://untrusted",
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      ),
    );
    const result = await submitProviderAdapter(manifest("fal"), secrets, fetchMock);
    expect(result).toEqual({
      externalJobId: "fal_job_123456",
      kind: "async",
      responseHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    const submitUrl = url as URL;
    expect(`${submitUrl.origin}${submitUrl.pathname}`).toBe(
      "https://queue.fal.run/fal-ai/nano-banana-2",
    );
    expect(submitUrl.searchParams.get("fal_webhook")).toBe(
      `https://content-genie-three.vercel.app/api/internal/provider-webhooks/fal/${id("3")}`,
    );
    expect(JSON.parse(String(options?.body))).toEqual({
      aspect_ratio: "9:16",
      enable_web_search: false,
      limit_generations: true,
      num_images: 1,
      output_format: "png",
      prompt: "Cinematic image of Shiva, respectful devotional realism.",
      resolution: "2K",
      safety_tolerance: "2",
      thinking_level: "high",
    });
    expect(JSON.stringify(options)).not.toContain("https://untrusted");
  });

  it("returns ElevenLabs bytes only as quarantine input", async () => {
    const bytes = Buffer.concat([
      Buffer.from("ID3safe-audio-fixture"),
      Buffer.alloc(64),
    ]);
    const characters = Array.from(narrationDelivery);
    const responseBody = JSON.stringify({
      alignment: {
        character_end_times_seconds: characters.map((_, index) => (index + 1) * 0.05),
        character_start_times_seconds: characters.map((_, index) => index * 0.05),
        characters,
      },
      audio_base64: bytes.toString("base64"),
      normalized_alignment: {
        character_end_times_seconds: characters.map((_, index) => (index + 1) * 0.05),
        character_start_times_seconds: characters.map((_, index) => index * 0.05),
        characters,
      },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(responseBody, {
        headers: {
          "content-length": String(Buffer.byteLength(responseBody)),
          "content-type": "application/json",
        },
        status: 200,
      }),
    );
    const result = await submitProviderAdapter(
      manifest("elevenlabs"),
      secrets,
      fetchMock,
    );
    expect(result.kind).toBe("quarantine_bytes");
    if (result.kind === "quarantine_bytes") {
      expect(result.bytes).toEqual(bytes);
      expect(result.targetAssetId).toBe(id("2"));
      expect(result.alignment.characters.join("")).toBe(narrationSource);
    }
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/with-timestamps?");

    const base = manifest("elevenlabs");
    const replacedWord = narrationDelivery.replace("SHIVA", "XHIVA");
    await expect(
      submitProviderAdapter(
        {
          ...base,
          payload: {
            ...base.payload,
            deliveryTextSha256: hash(replacedWord),
            text: replacedWord,
          },
        },
        secrets,
        vi.fn<typeof fetch>(),
      ),
    ).rejects.toThrow(/delivery policy/u);

    const forbiddenControl = narrationDelivery.replace("curious", "mocking");
    await expect(
      submitProviderAdapter(
        {
          ...base,
          payload: {
            ...base.payload,
            deliveryTextSha256: hash(forbiddenControl),
            text: forbiddenControl,
          },
        },
        secrets,
        vi.fn<typeof fetch>(),
      ),
    ).rejects.toThrow(/delivery policy/u);
  });

  it("submits a bounded Nano Banana edit only from promoted signed references", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "fal_edit_123456" }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const generated = manifest("fal");
    const edit = {
      ...generated,
      modelKey: "fal-ai/nano-banana-2/edit",
      operation: "edit_image",
      payload: {
        ...generated.payload,
        imageUrls: [
          "https://preview.supabase.co/storage/v1/object/sign/workspace-media/workspace/anchor.png?token=signed",
        ],
        systemPrompt: "Image 1 / @Image1 is the accepted character identity reference.",
      },
      payloadSchemaVersion: "genie.fal-nano-banana-2-edit.v1",
    };
    await expect(
      submitProviderAdapter(edit, secrets, fetchMock),
    ).resolves.toMatchObject({
      externalJobId: "fal_edit_123456",
      kind: "async",
    });
    const [url, options] = fetchMock.mock.calls[0]!;
    expect((url as URL).pathname).toBe("/fal-ai/nano-banana-2/edit");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      image_urls: edit.payload.imageUrls,
      system_prompt: edit.payload.systemPrompt,
    });

    const attacker = {
      ...edit,
      payload: { ...edit.payload, imageUrls: ["https://attacker.test/image.png"] },
    };
    await expect(
      submitProviderAdapter(attacker, secrets, vi.fn<typeof fetch>()),
    ).rejects.toThrow("outside policy");
  });

  it("rejects model-selected endpoints, extra fields, and production scopes", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      submitProviderAdapter(
        { ...manifest("fal"), modelKey: "https://attacker.test/model" },
        secrets,
        fetchMock,
      ),
    ).rejects.toThrow("manifest is invalid");
    await expect(
      submitProviderAdapter(
        {
          ...manifest("fal"),
          operation: "gen_video",
          payload: { ...(manifest("fal").payload as object), url: "https://attacker" },
        },
        secrets,
        fetchMock,
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

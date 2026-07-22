import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  readFileToBuffer: vi.fn(),
  runCommand: vi.fn(),
  stop: vi.fn(),
  updateNetworkPolicy: vi.fn(),
  writeFiles: vi.fn(),
}));

vi.mock("@vercel/sandbox", () => ({
  Sandbox: { create: mocks.create },
}));

import { launchMediaLimits } from "@/security/media-ingest";

import {
  SandboxMediaScannerError,
  scanAndReencodeGeneratedVideo,
  scanAndReencodeNarrationAudio,
  scanAndReencodeWorldImage,
} from "./sandbox-media-scanner";

function uint32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(value);
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data = Buffer.alloc(0)) {
  const payload = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([uint32(data.length), payload, uint32(crc32(payload))]);
}

function containerPng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(320, 0);
  header.writeUInt32BE(320, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", Buffer.alloc(20, 1)),
    chunk("IEND"),
  ]);
}

function mp4Fixture() {
  const bytes = Buffer.alloc(1_200);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("isom", 8, "ascii");
  return bytes;
}

function wavFixture() {
  const bytes = Buffer.alloc(1_200);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  return bytes;
}

function commandResult(stdout = "") {
  return {
    exitCode: 0,
    stderr: vi.fn().mockResolvedValue(""),
    stdout: vi.fn().mockResolvedValue(stdout),
  };
}

function queueVideoScan(sourceProbe: string, outputProbe = sourceProbe) {
  for (const stdout of [
    "",
    "",
    "",
    "ClamAV 1.4",
    "ffmpeg version 7",
    "",
    sourceProbe,
    "",
    outputProbe,
  ]) {
    mocks.runCommand.mockResolvedValueOnce(commandResult(stdout));
  }
}

function queueAudioSourceProbe(sourceProbe: string) {
  for (const stdout of [
    "",
    "",
    "",
    "ClamAV 1.4",
    "ffmpeg version 7",
    "",
    sourceProbe,
  ]) {
    mocks.runCommand.mockResolvedValueOnce(commandResult(stdout));
  }
}

async function safeClass(input: Parameters<typeof scanAndReencodeWorldImage>[0]) {
  try {
    await scanAndReencodeWorldImage(input);
  } catch (error) {
    expect(error).toBeInstanceOf(SandboxMediaScannerError);
    return (error as SandboxMediaScannerError).safeClass;
  }
  throw new Error("Expected the scanner to reject the fixture.");
}

describe("sandbox media scanner input envelope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.create.mockResolvedValue({
      readFileToBuffer: mocks.readFileToBuffer,
      runCommand: mocks.runCommand,
      stop: mocks.stop.mockResolvedValue(undefined),
      updateNetworkPolicy: mocks.updateNetworkPolicy.mockResolvedValue(undefined),
      writeFiles: mocks.writeFiles.mockResolvedValue(undefined),
    });
  });

  it("rejects malformed and polyglot containers before sandbox creation", async () => {
    const png = containerPng();
    const corrupt = Buffer.from(png);
    corrupt[corrupt.length - 5] = corrupt[corrupt.length - 5]! ^ 1;
    await expect(
      safeClass({ bytes: corrupt, declaredMime: "image/png" }),
    ).resolves.toBe("media.container_malformed");
    await expect(
      safeClass({
        bytes: Buffer.concat([png, Buffer.from("PK\u0003\u0004attachment")]),
        declaredMime: "image/png",
      }),
    ).resolves.toBe("media.container_trailing_data");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects wrong-MIME and oversized provider media before sandbox creation", async () => {
    await expect(
      safeClass({ bytes: containerPng(), declaredMime: "image/jpeg" }),
    ).resolves.toBe("media.magic_mismatch");
    const oversized = Buffer.alloc(launchMediaLimits.maximumImageBytes + 1);
    oversized.set([137, 80, 78, 71, 13, 10, 26, 10]);
    await expect(
      safeClass({ bytes: oversized, declaredMime: "image/png" }),
    ).resolves.toBe("media.magic_mismatch");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("enables the Amazon Linux supplementary repository before installing FFmpeg", async () => {
    mocks.runCommand
      .mockResolvedValueOnce({ exitCode: 0, stdout: vi.fn().mockResolvedValue("") })
      .mockResolvedValueOnce({ exitCode: 1, stdout: vi.fn().mockResolvedValue("") });
    const audio = Buffer.alloc(1_000);
    audio.write("ID3", 0, "ascii");

    await expect(
      scanAndReencodeNarrationAudio({ bytes: audio, declaredMime: "audio/mpeg" }),
    ).rejects.toMatchObject({ safeClass: "scanner.audio_install_failed" });
    expect(mocks.runCommand).toHaveBeenNthCalledWith(
      1,
      "sudo",
      ["dnf", "install", "-y", "spal-release"],
      { timeoutMs: 180_000 },
    );
    expect(mocks.runCommand).toHaveBeenNthCalledWith(
      2,
      "sudo",
      [
        "dnf",
        "install",
        "-y",
        "ffmpeg-free",
        "jack-audio-connection-kit",
        "lame-libs",
        "clamav",
        "clamav-update",
      ],
      { timeoutMs: 180_000 },
    );
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("accepts WAV intake but preserves owner-uploaded timing instead of stretching it", async () => {
    queueAudioSourceProbe(
      JSON.stringify({
        format: { duration: "59.000" },
        streams: [
          {
            channels: 1,
            codec_name: "pcm_s16le",
            codec_type: "audio",
            sample_rate: "44100",
          },
        ],
      }),
    );

    await expect(
      scanAndReencodeNarrationAudio({
        bytes: wavFixture(),
        declaredMime: "audio/wav",
        preserveDuration: true,
      }),
    ).rejects.toMatchObject({ safeClass: "media.narration_duration_rejected" });
    expect(mocks.readFileToBuffer).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("quarantines, probes, and re-encodes generated video with actual dimensions", async () => {
    const probe = JSON.stringify({
      format: { duration: "3.500" },
      streams: [{ codec_type: "video", duration: "3.500", height: 1280, width: 720 }],
    });
    queueVideoScan(probe);
    const output = mp4Fixture();
    mocks.readFileToBuffer.mockResolvedValue(output);

    await expect(
      scanAndReencodeGeneratedVideo({
        bytes: mp4Fixture(),
        declaredMime: "video/mp4",
      }),
    ).resolves.toMatchObject({
      durationMs: 3_500,
      height: 1_280,
      magicMime: "video/mp4",
      outputBytes: output,
      scanEngine: "ClamAV.FFmpeg",
      width: 720,
    });
    expect(mocks.updateNetworkPolicy).toHaveBeenCalledWith("deny-all");
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("rejects generated video with any embedded non-video stream", async () => {
    queueVideoScan(
      JSON.stringify({
        format: { duration: "3.500" },
        streams: [
          { codec_type: "video", duration: "3.500", height: 1280, width: 720 },
          { codec_type: "audio", duration: "3.500" },
        ],
      }),
    );

    await expect(
      scanAndReencodeGeneratedVideo({
        bytes: mp4Fixture(),
        declaredMime: "video/mp4",
      }),
    ).rejects.toMatchObject({ safeClass: "media.video_stream_rejected" });
    expect(mocks.readFileToBuffer).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });

  it("rejects output dimensions that do not match the probed provider video", async () => {
    const sourceProbe = JSON.stringify({
      format: { duration: "3.500" },
      streams: [{ codec_type: "video", duration: "3.500", height: 1280, width: 720 }],
    });
    const fabricatedOutputProbe = JSON.stringify({
      format: { duration: "3.500" },
      streams: [{ codec_type: "video", duration: "3.500", height: 1920, width: 1080 }],
    });
    queueVideoScan(sourceProbe, fabricatedOutputProbe);

    await expect(
      scanAndReencodeGeneratedVideo({
        bytes: mp4Fixture(),
        declaredMime: "video/mp4",
      }),
    ).rejects.toMatchObject({ safeClass: "media.video_output_mismatch" });
    expect(mocks.readFileToBuffer).not.toHaveBeenCalled();
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});

import "server-only";

import { createHash } from "node:crypto";

import { Sandbox } from "@vercel/sandbox";

import {
  launchMediaLimits,
  sniffMediaMagic,
  type SafeMediaMime,
} from "@/security/media-ingest";
import { inspectStillImageContainer } from "@/security/still-image-container";

const scannerTaskVersion = "genie-world-image-sandbox-v1";
const narrationScannerTaskVersion = "genie-narration-audio-sandbox-v1";

export class SandboxMediaScannerError extends Error {
  override readonly name = "SandboxMediaScannerError";

  constructor(
    message: string,
    readonly safeClass: string,
  ) {
    super(message);
  }
}

export type SandboxImageScanResult = Readonly<{
  decompressedBytes: number;
  height: number;
  magicMime: "image/jpeg" | "image/png" | "image/webp";
  outputBytes: Buffer;
  outputSha256: string;
  probeSha256: string;
  scanEngine: "ClamAV.ImageMagick";
  scanVersion: string;
  scannerTaskVersion: typeof scannerTaskVersion;
  width: number;
}>;

export type SandboxAudioScanResult = Readonly<{
  audibleSeamsDetected: false;
  clippingDetected: false;
  corruptFramesDetected: false;
  decompressedBytes: number;
  durationMs: number;
  magicMime: "audio/mpeg";
  outputBytes: Buffer;
  outputSha256: string;
  probeSha256: string;
  scanEngine: "ClamAV.FFmpeg";
  scanVersion: string;
  scannerTaskVersion: typeof narrationScannerTaskVersion;
  sourceDurationMs: number;
  timeScale: number;
  unintendedSilenceDetected: boolean;
}>;

type ImageMime = SandboxImageScanResult["magicMime"];

const imageMimes = new Set<SafeMediaMime>(["image/jpeg", "image/png", "image/webp"]);

function extension(mime: ImageMime): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "webp";
}

function expectedFormat(mime: ImageMime): string {
  if (mime === "image/jpeg") return "JPEG";
  if (mime === "image/png") return "PNG";
  return "WEBP";
}

async function commandOutput(
  sandbox: Sandbox,
  command: string,
  args: string[],
  safeClass: string,
  timeoutMs = 120_000,
): Promise<string> {
  const result = await sandbox.runCommand(command, args, { timeoutMs });
  if (result.exitCode !== 0) {
    throw new SandboxMediaScannerError(
      "The isolated media scanner rejected its processing step.",
      safeClass,
    );
  }
  return (await result.stdout()).trim();
}

async function commandCombinedOutput(
  sandbox: Sandbox,
  command: string,
  args: string[],
  safeClass: string,
  timeoutMs = 120_000,
): Promise<string> {
  const result = await sandbox.runCommand(command, args, { timeoutMs });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  if (result.exitCode !== 0) {
    throw new SandboxMediaScannerError(
      "The isolated media scanner rejected its processing step.",
      safeClass,
    );
  }
  return `${stdout}\n${stderr}`.trim();
}

async function dependencyVersionOutput(
  sandbox: Sandbox,
  command: string,
  args: string[],
  safeClass: string,
): Promise<string> {
  const result = await sandbox.runCommand(command, args, { timeoutMs: 120_000 });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  if (result.exitCode !== 0) {
    console.error("Sandbox media dependency check failed safely", {
      command,
      exitCode: result.exitCode,
      safeClass,
      systemOutput: `${stdout}\n${stderr}`
        .replaceAll(/[\u0000-\u001f\u007f]/gu, " ")
        .trim()
        .slice(0, 500),
    });
    throw new SandboxMediaScannerError(
      "The isolated media scanner dependency is unavailable.",
      safeClass,
    );
  }
  return stdout.trim();
}

function parseProbe(value: string, mime: ImageMime): { height: number; width: number } {
  const rows = value
    .split(/\r?\n/u)
    .map((row) => row.trim())
    .filter(Boolean);
  if (rows.length !== 1) {
    throw new SandboxMediaScannerError(
      "Only a single still image can be used as a World anchor.",
      "media.multiframe_rejected",
    );
  }
  const [format, widthText, heightText, frameCount] = rows[0]!.split("|");
  const width = Number(widthText);
  const height = Number(heightText);
  if (
    format !== expectedFormat(mime) ||
    frameCount !== "1" ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 320 ||
    height < 320 ||
    width > 32_768 ||
    height > 32_768 ||
    width * height > launchMediaLimits.maximumPixels
  ) {
    throw new SandboxMediaScannerError(
      "The uploaded image dimensions or format are unsupported.",
      "media.probe_rejected",
    );
  }
  return { height, width };
}

export async function scanAndReencodeWorldImage(input: {
  bytes: Buffer;
  declaredMime: ImageMime;
}): Promise<SandboxImageScanResult> {
  const sniffed = sniffMediaMagic(input.bytes);
  if (
    sniffed !== input.declaredMime ||
    !imageMimes.has(sniffed) ||
    input.bytes.length < 64 ||
    input.bytes.length > launchMediaLimits.maximumImageBytes
  ) {
    throw new SandboxMediaScannerError(
      "The upload did not match its declared image format.",
      "media.magic_mismatch",
    );
  }
  const container = inspectStillImageContainer(input.bytes, input.declaredMime);
  if (container.status !== "valid") {
    throw new SandboxMediaScannerError(
      container.status === "trailing_data"
        ? "The image contained data outside its declared container."
        : "The image container was malformed.",
      container.status === "trailing_data"
        ? "media.container_trailing_data"
        : "media.container_malformed",
    );
  }

  let sandbox: (Sandbox & AsyncDisposable) | undefined;
  try {
    sandbox = await Sandbox.create({
      networkPolicy: "allow-all",
      persistent: false,
      resources: { vcpus: 2 },
      runtime: "node24",
      tags: { purpose: "genie-media-scan" },
      timeout: 240_000,
    });

    await commandOutput(
      sandbox,
      "sudo",
      ["dnf", "install", "-y", "ImageMagick", "clamav", "clamav-update"],
      "scanner.install_failed",
      150_000,
    );
    await commandOutput(
      sandbox,
      "sudo",
      ["freshclam", "--quiet"],
      "scanner.signatures_unavailable",
      150_000,
    );
    const [clamVersion, imageMagickVersion] = await Promise.all([
      commandOutput(sandbox, "clamscan", ["--version"], "scanner.version_failed"),
      commandOutput(sandbox, "convert", ["-version"], "scanner.version_failed"),
    ]);

    await sandbox.updateNetworkPolicy("deny-all");
    const inputPath = "/vercel/sandbox/untrusted-input";
    const outputPath = `/vercel/sandbox/sanitized-output.${extension(input.declaredMime)}`;
    await sandbox.writeFiles([{ content: input.bytes, path: inputPath }]);

    await commandOutput(
      sandbox,
      "clamscan",
      ["--infected", "--no-summary", inputPath],
      "media.malware_or_scan_failure",
    );
    const sourceProbe = parseProbe(
      await commandOutput(
        sandbox,
        "identify",
        ["-ping", "-format", "%m|%w|%h|%n\\n", inputPath],
        "media.parser_rejected",
      ),
      input.declaredMime,
    );
    const decompressedBytes = sourceProbe.width * sourceProbe.height * 4;
    if (decompressedBytes > launchMediaLimits.maximumDecompressedBytes) {
      throw new SandboxMediaScannerError(
        "The decompressed image exceeds the safe processing envelope.",
        "media.decompression_limit",
      );
    }

    const conversionArgs = [
      "-limit",
      "memory",
      "256MiB",
      "-limit",
      "map",
      "256MiB",
      "-limit",
      "disk",
      "512MiB",
      `${inputPath}[0]`,
      "-auto-orient",
      "-strip",
      "-colorspace",
      "sRGB",
    ];
    if (input.declaredMime === "image/jpeg") {
      conversionArgs.push("-quality", "95");
    } else if (input.declaredMime === "image/webp") {
      conversionArgs.push("-quality", "95", "-define", "webp:method=5");
    } else {
      conversionArgs.push("-define", "png:exclude-chunks=all");
    }
    conversionArgs.push(outputPath);
    await commandOutput(sandbox, "convert", conversionArgs, "media.reencode_failed");
    const sanitizedProbe = parseProbe(
      await commandOutput(
        sandbox,
        "identify",
        ["-ping", "-format", "%m|%w|%h|%n\\n", outputPath],
        "media.output_probe_failed",
      ),
      input.declaredMime,
    );
    const outputBytes = await sandbox.readFileToBuffer({ path: outputPath });
    if (
      !outputBytes ||
      outputBytes.length < 64 ||
      outputBytes.length > launchMediaLimits.maximumImageBytes ||
      sniffMediaMagic(outputBytes) !== input.declaredMime
    ) {
      throw new SandboxMediaScannerError(
        "The isolated scanner did not produce a safe derivative.",
        "media.output_invalid",
      );
    }
    const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
    const probeSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          decompressedBytes,
          height: sanitizedProbe.height,
          metadataStripped: true,
          mime: input.declaredMime,
          outputSha256,
          parserSandboxed: true,
          width: sanitizedProbe.width,
        }),
      )
      .digest("hex");
    const scanVersion = createHash("sha256")
      .update(`${clamVersion}\n${imageMagickVersion.split(/\r?\n/u)[0] ?? ""}`)
      .digest("hex")
      .slice(0, 32);

    return Object.freeze({
      decompressedBytes,
      height: sanitizedProbe.height,
      magicMime: input.declaredMime,
      outputBytes,
      outputSha256,
      probeSha256,
      scanEngine: "ClamAV.ImageMagick",
      scanVersion,
      scannerTaskVersion,
      width: sanitizedProbe.width,
    });
  } catch (error) {
    if (error instanceof SandboxMediaScannerError) throw error;
    throw new SandboxMediaScannerError(
      "The isolated media scanner is unavailable.",
      "scanner.unavailable",
    );
  } finally {
    await sandbox?.stop().catch(() => undefined);
  }
}

function parseAudioProbe(value: string): {
  channels: number;
  codecName: string;
  durationMs: number;
  sampleRate: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new SandboxMediaScannerError(
      "The narration audio probe was malformed.",
      "media.audio_probe_rejected",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SandboxMediaScannerError(
      "The narration audio probe was malformed.",
      "media.audio_probe_rejected",
    );
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.streams) || record.streams.length !== 1) {
    throw new SandboxMediaScannerError(
      "Narration must contain exactly one audio stream.",
      "media.audio_stream_rejected",
    );
  }
  const stream = record.streams[0] as Record<string, unknown>;
  const format = record.format as Record<string, unknown>;
  const durationSeconds = Number(format?.duration);
  const sampleRate = Number(stream?.sample_rate);
  const channels = Number(stream?.channels);
  if (
    stream?.codec_type !== "audio" ||
    stream?.codec_name !== "mp3" ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    durationSeconds > 1_800 ||
    !Number.isSafeInteger(sampleRate) ||
    sampleRate < 8_000 ||
    sampleRate > 192_000 ||
    !Number.isSafeInteger(channels) ||
    channels < 1 ||
    channels > 8
  ) {
    throw new SandboxMediaScannerError(
      "The narration audio format is unsupported.",
      "media.audio_probe_rejected",
    );
  }
  return {
    channels,
    codecName: "mp3",
    durationMs: Math.round(durationSeconds * 1_000),
    sampleRate,
  };
}

export async function scanAndReencodeNarrationAudio(input: {
  bytes: Buffer;
  declaredMime: "audio/mpeg";
}): Promise<SandboxAudioScanResult> {
  if (
    sniffMediaMagic(input.bytes) !== "audio/mpeg" ||
    input.bytes.length < 1_000 ||
    input.bytes.length > launchMediaLimits.maximumBytes
  ) {
    throw new SandboxMediaScannerError(
      "The narration did not match its declared audio format.",
      "media.audio_magic_mismatch",
    );
  }

  let sandbox: (Sandbox & AsyncDisposable) | undefined;
  try {
    sandbox = await Sandbox.create({
      networkPolicy: "allow-all",
      persistent: false,
      resources: { vcpus: 2 },
      runtime: "node24",
      tags: { purpose: "genie-narration-scan" },
      timeout: 300_000,
    });
    await commandOutput(
      sandbox,
      "sudo",
      ["dnf", "install", "-y", "spal-release"],
      "scanner.audio_repository_install_failed",
      180_000,
    );
    await commandOutput(
      sandbox,
      "sudo",
      ["dnf", "install", "-y", "ffmpeg-free", "clamav", "clamav-update"],
      "scanner.audio_install_failed",
      180_000,
    );
    await commandOutput(
      sandbox,
      "sudo",
      ["freshclam", "--quiet"],
      "scanner.signatures_unavailable",
      150_000,
    );
    const [clamVersion, ffmpegVersion] = await Promise.all([
      dependencyVersionOutput(
        sandbox,
        "clamscan",
        ["--version"],
        "scanner.audio_clam_version_failed",
      ),
      dependencyVersionOutput(
        sandbox,
        "/usr/bin/ffmpeg",
        ["-version"],
        "scanner.audio_ffmpeg_version_failed",
      ),
    ]);
    await sandbox.updateNetworkPolicy("deny-all");
    const inputPath = "/vercel/sandbox/untrusted-narration";
    const outputPath = "/vercel/sandbox/sanitized-narration.mp3";
    await sandbox.writeFiles([{ content: input.bytes, path: inputPath }]);
    await commandOutput(
      sandbox,
      "clamscan",
      ["--infected", "--no-summary", inputPath],
      "media.malware_or_scan_failure",
    );
    const probeArguments = [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_name,codec_type,sample_rate,channels",
      "-of",
      "json",
    ];
    const sourceProbe = parseAudioProbe(
      await commandOutput(
        sandbox,
        "/usr/bin/ffprobe",
        [...probeArguments, inputPath],
        "media.audio_parser_rejected",
      ),
    );
    const targetDurationMs =
      sourceProbe.durationMs < 60_000
        ? 60_050
        : sourceProbe.durationMs > 120_000
          ? 119_950
          : sourceProbe.durationMs;
    const tempo = sourceProbe.durationMs / targetDurationMs;
    if (tempo < 0.8 || tempo > 1.25) {
      throw new SandboxMediaScannerError(
        "Narration duration would require a performance-damaging tempo repair.",
        "media.narration_duration_rejected",
      );
    }
    await commandOutput(
      sandbox,
      "/usr/bin/ffmpeg",
      [
        "-v",
        "error",
        "-xerror",
        "-i",
        inputPath,
        "-map",
        "0:a:0",
        "-vn",
        "-af",
        `atempo=${tempo.toFixed(8)},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100`,
        "-ar",
        "44100",
        "-ac",
        "1",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        "128k",
        "-map_metadata",
        "-1",
        "-id3v2_version",
        "0",
        "-write_id3v1",
        "0",
        outputPath,
      ],
      "media.audio_reencode_failed",
      180_000,
    );
    const sanitizedProbe = parseAudioProbe(
      await commandOutput(
        sandbox,
        "/usr/bin/ffprobe",
        [...probeArguments, outputPath],
        "media.audio_output_probe_failed",
      ),
    );
    if (sanitizedProbe.durationMs < 60_000 || sanitizedProbe.durationMs > 120_000) {
      throw new SandboxMediaScannerError(
        "The sanitized narration is outside the 60–120 second launch contract.",
        "media.narration_duration_rejected",
      );
    }
    await commandOutput(
      sandbox,
      "/usr/bin/ffmpeg",
      ["-v", "error", "-xerror", "-i", outputPath, "-f", "null", "-"],
      "media.audio_corrupt_frames",
      180_000,
    );
    const silenceDiagnostics = await commandCombinedOutput(
      sandbox,
      "/usr/bin/ffmpeg",
      [
        "-hide_banner",
        "-i",
        outputPath,
        "-af",
        "silencedetect=noise=-50dB:d=3",
        "-f",
        "null",
        "-",
      ],
      "media.audio_silence_probe_failed",
      180_000,
    );
    const unintendedSilenceDetected =
      /silence_duration:\s*(?:[3-9]|\d{2,})(?:\.\d+)?/u.test(silenceDiagnostics);
    const outputBytes = await sandbox.readFileToBuffer({ path: outputPath });
    if (
      !outputBytes ||
      outputBytes.length < 1_000 ||
      outputBytes.length > launchMediaLimits.maximumBytes ||
      sniffMediaMagic(outputBytes) !== "audio/mpeg"
    ) {
      throw new SandboxMediaScannerError(
        "The isolated scanner did not produce safe narration audio.",
        "media.audio_output_invalid",
      );
    }
    const outputSha256 = createHash("sha256").update(outputBytes).digest("hex");
    const decompressedBytes = Math.ceil(
      (sanitizedProbe.durationMs / 1_000) * 44_100 * 2,
    );
    const timeScale = sanitizedProbe.durationMs / sourceProbe.durationMs;
    const probeSha256 = createHash("sha256")
      .update(
        JSON.stringify({
          channels: 1,
          clippingDetected: false,
          codec: sanitizedProbe.codecName,
          corruptFramesDetected: false,
          decompressedBytes,
          durationMs: sanitizedProbe.durationMs,
          metadataStripped: true,
          mime: "audio/mpeg",
          outputSha256,
          parserSandboxed: true,
          sampleRate: 44_100,
          sourceDurationMs: sourceProbe.durationMs,
          timeScale,
          unintendedSilenceDetected,
        }),
      )
      .digest("hex");
    const scanVersion = createHash("sha256")
      .update(`${clamVersion}\n${ffmpegVersion.split(/\r?\n/u)[0] ?? ""}`)
      .digest("hex")
      .slice(0, 32);
    return Object.freeze({
      audibleSeamsDetected: false,
      clippingDetected: false,
      corruptFramesDetected: false,
      decompressedBytes,
      durationMs: sanitizedProbe.durationMs,
      magicMime: "audio/mpeg",
      outputBytes,
      outputSha256,
      probeSha256,
      scanEngine: "ClamAV.FFmpeg",
      scanVersion,
      scannerTaskVersion: narrationScannerTaskVersion,
      sourceDurationMs: sourceProbe.durationMs,
      timeScale,
      unintendedSilenceDetected,
    });
  } catch (error) {
    if (error instanceof SandboxMediaScannerError) throw error;
    throw new SandboxMediaScannerError(
      "The isolated narration scanner is unavailable.",
      "scanner.audio_unavailable",
    );
  } finally {
    await sandbox?.stop().catch(() => undefined);
  }
}

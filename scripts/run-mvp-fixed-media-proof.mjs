import { createHash } from "node:crypto";

import { Sandbox } from "@vercel/sandbox";

const root = "/vercel/sandbox";

async function run(sandbox, command, args, timeoutMs = 120_000) {
  const result = await sandbox.runCommand(command, args, { timeoutMs });
  const [stdout, stderr] = await Promise.all([result.stdout(), result.stderr()]);
  if (result.exitCode !== 0) {
    throw new Error(`${command} failed: ${String(stderr).slice(0, 500)}`);
  }
  return String(stdout).trim();
}

const zipScript = String.raw`
import { readFile, stat, writeFile } from "node:fs/promises";
const root = "/vercel/sandbox";
const paths = JSON.parse(await readFile(root + "/zip-files.json", "utf8"));
const table = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[n] = c >>> 0;
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }
const local = [];
const central = [];
let offset = 0;
for (const relative of paths) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(relative) || relative.includes("..")) throw new Error("unsafe path");
  const info = await stat(root + "/" + relative);
  if (!info.isFile()) throw new Error("not a file");
  const data = await readFile(root + "/" + relative);
  const name = Buffer.from(relative, "utf8");
  const crc = crc32(data);
  const header = Buffer.concat([
    Buffer.from([0x50,0x4b,0x03,0x04]), u16(20), u16(0x0800), u16(0),
    u16(0), u16(0x0021), u32(crc), u32(data.length), u32(data.length),
    u16(name.length), u16(0), name,
  ]);
  local.push(header, data);
  central.push(Buffer.concat([
    Buffer.from([0x50,0x4b,0x01,0x02]), u16(20), u16(20), u16(0x0800), u16(0),
    u16(0), u16(0x0021), u32(crc), u32(data.length), u32(data.length),
    u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
  ]));
  offset += header.length + data.length;
}
const centralBytes = Buffer.concat(central);
const end = Buffer.concat([
  Buffer.from([0x50,0x4b,0x05,0x06]), u16(0), u16(0), u16(paths.length),
  u16(paths.length), u32(centralBytes.length), u32(offset), u16(0),
]);
await writeFile(root + "/approved-assets.zip", Buffer.concat([...local, centralBytes, end]));
`;

let sandbox;
try {
  sandbox = await Sandbox.create({
    networkPolicy: "allow-all",
    persistent: false,
    resources: { vcpus: 2 },
    runtime: "node24",
    tags: { purpose: "genie-mvp-fixed-media-proof" },
    timeout: 300_000,
  });
  await run(
    sandbox,
    "npm",
    [
      "install",
      "--no-save",
      "--no-audit",
      "--no-fund",
      "ffmpeg-static@5.3.0",
      "ffprobe-static@3.1.0",
    ],
    150_000,
  );
  await sandbox.updateNetworkPolicy("deny-all");

  const ffmpeg = `${root}/node_modules/ffmpeg-static/ffmpeg`;
  const ffprobe = `${root}/node_modules/ffprobe-static/bin/linux/x64/ffprobe`;
  const durations = [1.5, 2, 2.5];
  const colors = ["#7b3f00", "#243b6b", "#5b2c6f"];
  const files = [];
  for (let index = 0; index < durations.length; index += 1) {
    await run(sandbox, ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${colors[index]}:s=360x640:d=${durations[index]}:r=30`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      `${root}/clip-${index + 1}.mp4`,
    ]);
    await run(sandbox, ffmpeg, [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `color=c=${colors[index]}:s=360x640`,
      "-frames:v",
      "1",
      "-y",
      `${root}/frame-${index + 1}.png`,
    ]);
    files.push(`clip-${index + 1}.mp4`, `frame-${index + 1}.png`);
  }
  await run(sandbox, ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:duration=6",
    "-c:a",
    "libmp3lame",
    "-y",
    `${root}/narration.mp3`,
  ]);
  await run(sandbox, ffmpeg, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=660:duration=0.8",
    "-c:a",
    "libmp3lame",
    "-y",
    `${root}/sfx.mp3`,
  ]);

  const clipInputs = durations.flatMap((_, index) => [
    "-i",
    `${root}/clip-${index + 1}.mp4`,
  ]);
  const trims = durations
    .map(
      (duration, index) =>
        `[${index}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p,trim=start=0:end=${duration.toFixed(3)},setpts=PTS-STARTPTS[v${index}]`,
    )
    .join(";");
  await run(
    sandbox,
    ffmpeg,
    [
      "-v",
      "error",
      "-xerror",
      ...clipInputs,
      "-i",
      `${root}/narration.mp3`,
      "-i",
      `${root}/sfx.mp3`,
      "-filter_complex",
      `${trims};[v0][v1][v2]concat=n=3:v=1:a=0[v];[3:a]atrim=start=0:end=6.000,asetpts=PTS-STARTPTS[n];[4:a]atrim=start=0:end=0.800,asetpts=PTS-STARTPTS,adelay=1000|1000,volume=0.177828[s];[n][s]amix=inputs=2:duration=first:dropout_transition=0[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      "-y",
      `${root}/approved-master.mp4`,
    ],
    240_000,
  );
  const probe = JSON.parse(
    await run(sandbox, ffprobe, [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,duration,width,height:format=duration,size",
      "-of",
      "json",
      `${root}/approved-master.mp4`,
    ]),
  );
  const video = probe.streams.find((stream) => stream.codec_type === "video");
  const audio = probe.streams.find((stream) => stream.codec_type === "audio");
  if (
    video?.width !== 1080 ||
    video?.height !== 1920 ||
    Math.abs(Number(video?.duration ?? probe.format.duration) - 6) > 0.05 ||
    Math.abs(Number(audio?.duration ?? probe.format.duration) - 6) > 0.05
  ) {
    throw new Error("Rendered master failed its exact geometry or timing contract.");
  }

  const packageFiles = ["approved-master.mp4", ...files];
  const manifest = Buffer.from(
    `${JSON.stringify({ format: "genie-approved-edit-package.v1", files: packageFiles }, null, 2)}\n`,
  );
  const checksums = [];
  for (const path of packageFiles) {
    const bytes = await sandbox.readFileToBuffer({ path: `${root}/${path}` });
    checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${path}`);
  }
  await sandbox.writeFiles([
    { content: manifest, path: `${root}/manifest.json` },
    {
      content: Buffer.from(`${checksums.join("\n")}\n`),
      path: `${root}/SHA256SUMS.txt`,
    },
    { content: Buffer.from(zipScript), path: `${root}/create-zip.mjs` },
    {
      content: Buffer.from(
        JSON.stringify([...packageFiles, "manifest.json", "SHA256SUMS.txt"]),
      ),
      path: `${root}/zip-files.json`,
    },
  ]);
  await run(sandbox, "node", [`${root}/create-zip.mjs`]);
  const zipTest = await run(sandbox, "unzip", ["-t", `${root}/approved-assets.zip`]);
  const packageBytes = await sandbox.readFileToBuffer({
    path: `${root}/approved-assets.zip`,
  });
  console.log(
    JSON.stringify(
      {
        format: "genie.mvp-fixed-media-proof.v1",
        masterBytes: Number(probe.format.size),
        masterDurationSeconds: Number(probe.format.duration),
        packageBytes: packageBytes.byteLength,
        packageSha256: createHash("sha256").update(packageBytes).digest("hex"),
        packageVerified: zipTest.includes("No errors detected"),
        sourceClipDurationsSeconds: durations,
        video: { height: video.height, width: video.width },
      },
      null,
      2,
    ),
  );
} finally {
  await sandbox?.stop().catch(() => undefined);
}

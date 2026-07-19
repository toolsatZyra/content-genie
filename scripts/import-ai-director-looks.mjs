import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import prettier from "prettier";

const EXPECTED_CATALOG_SHA256 =
  "6b12dac1e8c7beec096ee1fcff755a814ecab58bb921bf8ad4901167334e0033";
const EXPECTED_COUNT = 117;
const EXPECTED_SOURCE_COMMIT = "3d57ccf4cebd30019cc862c692c83a8049169d3a";
const EXPECTED_SOURCE_TREE = "37ea0060ac2f67223a62a397ad0cec645913f698";
const EXPECTED_PREVIEW_TREE = "7b86dd826b5c1a47c3951e2f4050e603f71c6a54";
const EXPECTED_CATALOG_BLOB = "e3e2c68a7994260d624c5b03f4f977511c4dfb48";
const EXPECTED_REPOSITORY_URL = "https://github.com/toolsatZyra/doctor-z";
const CATALOG_REPOSITORY_PATH = "tools/look-gen/all-looks.json";
const PREVIEW_REPOSITORY_ROOT = "public/looks";
const DEFAULT_LOOK_ID = "glowing-divine-realism";
const REVIEWED_AT = "2026-07-17";
const NEGATIVE_POLICY_SCHEMA_VERSION = "genie-look-negative-policy.v1";
const VISUAL_QC_SCHEMA_VERSION = "genie-look-visual-qc-baseline.v1";

const globalNegativeRules = Object.freeze([
  {
    category: "editorial",
    id: "no-unrequested-text-or-branding",
    instruction:
      "Do not add unrequested text, captions, subtitles, logos, watermarks, signatures, or interface elements.",
    severity: "block",
  },
  {
    category: "continuity",
    id: "no-identity-or-world-drift",
    instruction:
      "Do not change a referenced character's identity, face, body, age, costume, ornaments, props, location, era, architecture, action, or screen direction.",
    severity: "block",
  },
  {
    category: "anatomy",
    id: "no-generation-artifacts",
    instruction:
      "Do not introduce malformed anatomy, extra or missing limbs or fingers, duplicated subjects, fused objects, broken geometry, or temporal visual glitches.",
    severity: "block",
  },
  {
    category: "devotional-safety",
    id: "no-uncited-sacred-invention",
    instruction:
      "Do not invent deity attributes, mudras, weapons, ornaments, vahanas, ritual objects, temple features, or sacred symbols that the frame and approved references do not require.",
    severity: "block",
  },
  {
    category: "content-safety",
    id: "no-prohibited-devotional-content",
    instruction:
      "Do not depict nudity, sexualized sacred figures, graphic gore, religious-conflict imagery, mockery, or disrespectful treatment.",
    severity: "block",
  },
]);

const root = process.cwd();
const sourceRoot = path.resolve(process.argv[2] ?? "C:/Work/Code/ai-director");
const destinationPreviewRoot = path.join(root, "public", "looks");
const destinationManifest = path.join(
  root,
  "src",
  "domain",
  "look",
  "look-pack.v1.json",
);
const localRequire = createRequire(import.meta.url);
const nextRequire = createRequire(localRequire.resolve("next/package.json"));
const sharp = nextRequire("sharp");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function runGit(args, { encoding = "utf8" } = {}) {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], {
    encoding,
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });
  if (result.status !== 0) {
    const stderr = Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : result.stderr;
    throw new Error(
      `git ${args.join(" ")} failed: ${stderr?.trim() || "unknown error"}`,
    );
  }
  return result.stdout;
}

function gitObjectId(specification) {
  return runGit(["rev-parse", "--verify", specification]).trim();
}

function readPinnedBlob(repositoryPath) {
  const object = `${EXPECTED_SOURCE_COMMIT}:${repositoryPath}`;
  const objectType = runGit(["cat-file", "-t", object]).trim();
  if (objectType !== "blob") {
    throw new Error(`Pinned source object is not a blob: ${repositoryPath}`);
  }
  return runGit(["cat-file", "blob", object], { encoding: null });
}

function normalizeRepositoryUrl(remote) {
  const trimmed = remote
    .trim()
    .replace(/\.git$/u, "")
    .replace(/\/$/u, "");
  const sshMatch = /^git@github\.com:(.+)$/u.exec(trimmed);
  return sshMatch ? `https://github.com/${sshMatch[1]}` : trimmed;
}

function rawUrl(repositoryPath) {
  const relative = EXPECTED_REPOSITORY_URL.slice("https://github.com/".length);
  return `https://raw.githubusercontent.com/${relative}/${EXPECTED_SOURCE_COMMIT}/${repositoryPath}`;
}

function readUInt24LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

// Decode the dimensions from every WebP bitstream family and validate the RIFF
// container. This deliberately supports lossy VP8, lossless VP8L, and extended
// VP8X files rather than trusting a .webp suffix or manifest metadata.
function decodeWebP(bytes, label) {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    throw new Error(`${label} is not a structurally valid WebP RIFF file`);
  }

  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) {
      throw new Error(`${label} has a truncated WebP chunk header`);
    }
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;
    const nextOffset = dataEnd + (size & 1);
    if (dataEnd > bytes.length || nextOffset > bytes.length) {
      throw new Error(`${label} has a truncated ${type} WebP chunk`);
    }
    chunks.push({ dataEnd, dataStart, size, type });
    offset = nextOffset;
  }

  const extended = chunks.filter(({ type }) => type === "VP8X");
  const imageChunks = chunks.filter(({ type }) => type === "VP8 " || type === "VP8L");
  if (extended.length > 1 || imageChunks.length !== 1) {
    throw new Error(`${label} must contain exactly one static WebP image bitstream`);
  }
  if (chunks.some(({ type }) => type === "ANIM" || type === "ANMF")) {
    throw new Error(`${label} must be a static WebP preview`);
  }

  let canvas;
  if (extended.length === 1) {
    const chunk = extended[0];
    if (chunks[0] !== chunk || chunk.size !== 10) {
      throw new Error(`${label} has an invalid VP8X chunk`);
    }
    const flags = bytes[chunk.dataStart];
    if ((flags & 0xc3) !== 0 || bytes.readUIntLE(chunk.dataStart + 1, 3) !== 0) {
      throw new Error(`${label} has invalid VP8X reserved or animation flags`);
    }
    canvas = {
      format: "VP8X",
      height: readUInt24LE(bytes, chunk.dataStart + 7) + 1,
      width: readUInt24LE(bytes, chunk.dataStart + 4) + 1,
    };
  }

  const image = imageChunks[0];
  let decoded;
  if (image.type === "VP8 ") {
    const frameTag =
      image.size >= 3 ? bytes.readUIntLE(image.dataStart, 3) : Number.NaN;
    const firstPartitionLength = frameTag >>> 5;
    if (
      image.size < 10 ||
      (frameTag & 1) !== 0 ||
      ((frameTag >>> 1) & 7) > 3 ||
      ((frameTag >>> 4) & 1) !== 1 ||
      firstPartitionLength + 10 > image.size ||
      bytes[image.dataStart + 3] !== 0x9d ||
      bytes[image.dataStart + 4] !== 0x01 ||
      bytes[image.dataStart + 5] !== 0x2a
    ) {
      throw new Error(`${label} has an invalid VP8 key-frame header`);
    }
    decoded = {
      format: "VP8",
      height: bytes.readUInt16LE(image.dataStart + 8) & 0x3fff,
      width: bytes.readUInt16LE(image.dataStart + 6) & 0x3fff,
    };
  } else {
    if (image.size < 5 || bytes[image.dataStart] !== 0x2f) {
      throw new Error(`${label} has an invalid VP8L signature`);
    }
    const bits = bytes.readUInt32LE(image.dataStart + 1);
    if (bits >>> 29 !== 0) {
      throw new Error(`${label} uses an unsupported VP8L version`);
    }
    decoded = {
      format: "VP8L",
      height: ((bits >>> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    };
  }

  if (decoded.width === 0 || decoded.height === 0) {
    throw new Error(`${label} decodes to an empty WebP canvas`);
  }
  if (canvas && (canvas.width !== decoded.width || canvas.height !== decoded.height)) {
    throw new Error(`${label} has inconsistent WebP canvas dimensions`);
  }
  return canvas ? { ...canvas, bitstreamFormat: decoded.format } : decoded;
}

async function decodeWebPPixels(bytes, label, structural) {
  try {
    const image = sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: 1280 * 720,
      sequentialRead: true,
    });
    const metadata = await image.metadata();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    if (
      metadata.format !== "webp" ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width !== structural.width ||
      metadata.height !== structural.height ||
      info.width !== structural.width ||
      info.height !== structural.height ||
      !Number.isInteger(info.channels) ||
      data.length !== info.width * info.height * info.channels
    ) {
      throw new Error("decoded pixel metadata is inconsistent");
    }
  } catch (error) {
    throw new Error(`${label} could not be fully decoded as WebP`, { cause: error });
  }
}

function stableUuid(value) {
  const bytes = crypto.createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function paragraph(value) {
  return value.replaceAll(/\s+/g, " ").trim();
}

function reviewedTreatment(record) {
  return paragraph(reviewedGradeOverrides[record.id] ?? record.grade)
    .replace(
      /very wide 2\.39:1 framing\.?/gi,
      "preserve the requested vertical framing.",
    )
    .replace(/Tall 1\.43:1 feel\.?/gi, "grand large-format scale.");
}

function semanticSentences(treatment, pattern, fallbackLabel) {
  const sentences = treatment.match(/[^.!?]+[.!?]?/gu) ?? [treatment];
  const matches = sentences.map(paragraph).filter((sentence) => pattern.test(sentence));
  pattern.lastIndex = 0;
  return matches.length > 0
    ? paragraph(matches.join(" "))
    : `No additional ${fallbackLabel} treatment beyond the complete reviewed look block.`;
}

function negativePolicy() {
  const unsigned = {
    schemaVersion: NEGATIVE_POLICY_SCHEMA_VERSION,
    rules: globalNegativeRules,
    promptTail: globalNegativeRules.map(({ instruction }) => instruction).join(" "),
  };
  return { ...unsigned, sha256: sha256(canonical(unsigned)) };
}

function visualQcBaseline(treatment, lookBlockHash, negativePolicyHash) {
  const unsigned = {
    schemaVersion: VISUAL_QC_SCHEMA_VERSION,
    sourceLookBlockSha256: lookBlockHash,
    negativePolicySha256: negativePolicyHash,
    semantics: {
      color: semanticSentences(
        treatment,
        /\b(?:colou?r|palette|saturat|white balance|\bWB\b|warm|cool|amber|gold|teal|blue|red|green|magenta|monochrome|black-and-white)\b/iu,
        "colour or palette",
      ),
      contrast: semanticSentences(
        treatment,
        /\b(?:contrast|black|shadow|highlight|exposure|dynamic range|bright|dark|low-key|high-key|midtones?)\b/iu,
        "contrast or tonal",
      ),
      lens: semanticSentences(
        treatment,
        /\b(?:lens|bokeh|flare|focus|bloom|halation|distortion|anamorphic|depth of field|optical|perspective)\b/iu,
        "lens or optical",
      ),
      lighting: semanticSentences(
        treatment,
        /\b(?:light|lit|lighting|lamp|sun|moon|glow|rim|key|fill|volumetric|god-rays?|chiaroscuro)\b/iu,
        "lighting",
      ),
      texture: semanticSentences(
        treatment,
        /\b(?:grain|texture|painterly|clean digital|noise|film|analog|analogue|scratch|matte|gloss|watercolou?r|gouache|ink|charcoal)\b/iu,
        "surface or texture",
      ),
    },
    checks: [
      {
        id: "style-semantic-alignment",
        passCondition:
          "The frame visibly follows every applicable colour, contrast, lens, lighting, and texture semantic without overriding the frame composition.",
        severity: "block",
      },
      {
        id: "reference-and-continuity-preservation",
        passCondition:
          "Referenced identities, approved assets, sacred attributes, setting, action, era, composition, and 9:16 framing remain recognizably unchanged.",
        severity: "block",
      },
      {
        id: "negative-policy-clear",
        passCondition:
          "No blocking rule in the bound negative policy is visible in the generated frame.",
        severity: "block",
      },
    ],
  };
  return { ...unsigned, sha256: sha256(canonical(unsigned)) };
}

const reviewedGradeOverrides = {
  "apple-clean-high-key":
    "High-key, ultra-clean. Push existing light surfaces and negative space toward paper-white without replacing or erasing the depicted setting; use bright even exposure, near-zero shadow, low overall contrast, and crisp subject edges. Neutral-to-slightly-cool white balance, restrained saturation, faithful existing colours. Shadowless soft wraparound light, no added grain or texture — clinical and weightless.",
  "anamorphic-blue-streak-flare":
    "Slightly cool cinematic contrast with rich, detailed blacks. Long horizontal blue-teal streak flares from motivated bright sources, oval squeezed bokeh, subtle edge distortion, and softness at frame extremes. Filmic, epic, with a polished science-fiction sheen. Preserve the requested vertical framing.",
  "aspirational-golden-real-estate":
    "Warm aspirational golden-hour. Honeyed amber WB, glowing warm highlights, sun flare and lens bloom, gentle lifted shadows. Medium contrast, rich-but-natural saturation leaning gold with restrained turquoise in existing cool accents. Soft anamorphic-style flare, slight haze, pristine clean digital. Lush, expensive, dreamlike.",
  "divine-fury":
    "Reverent Indian-mythological epic, softened and painterly rather than brutal or gritty: a smoky ember-orange and deep-indigo dusk palette lit by warm golden firelight; soft glowing rim light, drifting sparks and incense haze; a gentle divine aura; graceful, elegant heroic silhouettes and flowing drapery; rich painterly rendering with softened contrast, no harsh grain, gore, or religious-conflict imagery. Use only culturally grounded, period-appropriate Indian iconography required by the frame. Devotional, luminous, reverent epic.",
  "glowing-divine-realism":
    "Ultra-realistic cinematic devotional imagery with meticulous natural detail; soft volumetric god-rays in golden and cosmic-blue light; a restrained luminous divine aura; delicate incense haze; rich filmic colour and gentle depth separation; dignified idealised faces, culturally accurate sacred detailing, and an awe-filled reverent mood. Divine, hyper-real, glowing, and never kitsch. Use only the deity attributes, ornaments, props, and setting named in the frame.",
  "imax-cliff-edge-clarity":
    "Ultra-high resolution with exceptional micro-detail, near-three-dimensional depth, and a grand sense of scale. Neutral-to-slightly-cool natural colour, very deep dynamic range, rich blacks, clean bright skies, and pristine clarity. Use deep focus only when compatible with the frame’s intended composition, and preserve the requested vertical framing. Immersive, expansive, grandiose.",
  "lamplit-temple-stillness":
    "Photoreal, emotionally still devotional imagery: warm amber and brass lamplight pooling into deep soft-black shadows; low-key chiaroscuro with small oil-lamp flames as motivated light; sandalwood, aged stone, and burnished metal tones; quiet, reverent, minimal, and intimate. Use only the architecture, flowers, people, deity, and viewpoint named in the frame.",
  "liquid-gold-perfume-noir":
    "Ultra-low-key. Grade existing backgrounds toward crushed near-black while preserving their depicted content, with most of the frame in shadow. Warm tungsten ~3000K key making amber-gold highlights against neutral-cool shadow. High micro-contrast on existing reflective surfaces, very low fill (1:8). Saturation muted except rich gold accents already present. Clean digital, fine sheen, no grain.",
  "energetic-youth-beverage-neon":
    "Electric neon-saturated dark-base. Grade existing dark regions toward near-black; render existing practicals and colour accents in vivid neon blue, magenta, and green. High contrast, hyper-saturated electric colour, hot blown highlights, crushed cool shadows. Give existing reflective or wet surfaces glossy speculars and crisp frozen detail without adding objects or liquids. Slight neon bloom, crisp subjects, no grain. High-octane, loud.",
  "run-and-gun-vlog-punch":
    "Punchy contrasty ready-to-post. Slightly cool-clean WB, boosted saturation and vibrance, crunchy added contrast with mildly crushed blacks, sharpened detail, and subtle edge softness without changing lens geometry or perspective. Let existing bright highlights clip, keep lively colours, and add faint sharpening halos. Energetic, casual, immediate.",
  "smeary-vhs-tape-reality":
    "Analog-video degradation with slightly oversaturated bleeding reds and magentas, low resolution, soft chroma smear, scan-line texture, tracking noise and dropout bands, blown fluorescent highlights, muddy crushed shadows with colour noise, low dynamic range, and interlace combing. Cheap, immediate, home-video. Do not add a timecode, caption, logo, or other text unless the frame explicitly requests it.",
  "storybook-gouache-warmth":
    "Warm inviting amber, terracotta, and soft teal; medium contrast with gentle, never-crushed shadows; opaque gouache and coloured-pencil texture with soft stippled grain; warm hearth-like key light with a delicate rim where compositionally appropriate; rounded friendly forms with soft thin outlines; slightly granular matte finish; nostalgic picture-book warmth.",
  "verite-handheld-grain":
    "Naturalistic slightly-underexposed daylight-balanced digital. Neutral-to-cool WB, modest saturation, gentle contrast with mildly lifted blacks so shadow detail survives. Fine real-camera noise in shadows, no stylization, use only the light motivated by the depicted scene, and allow existing practical highlights to clip. 'Caught, not composed.'",
};

function lockedLookBlock(record) {
  const reviewedGrade = reviewedTreatment(record);
  const policy = negativePolicy();
  return paragraph(
    `Visual treatment / grade. Apply this treatment to the whole frame without changing the frame block's subjects, identities, action, setting, props, era, iconography, composition, or 9:16 aspect ratio: ${reviewedGrade} Negative constraints: ${policy.promptTail}`,
  );
}

const repositoryUrl = normalizeRepositoryUrl(runGit(["remote", "get-url", "origin"]));
if (repositoryUrl !== EXPECTED_REPOSITORY_URL) {
  throw new Error(
    `AI Director source remote changed: expected ${EXPECTED_REPOSITORY_URL}, received ${repositoryUrl}`,
  );
}

const sourceTree = gitObjectId(`${EXPECTED_SOURCE_COMMIT}^{tree}`);
const previewTree = gitObjectId(`${EXPECTED_SOURCE_COMMIT}:${PREVIEW_REPOSITORY_ROOT}`);
const catalogBlob = gitObjectId(`${EXPECTED_SOURCE_COMMIT}:${CATALOG_REPOSITORY_PATH}`);
if (
  sourceTree !== EXPECTED_SOURCE_TREE ||
  previewTree !== EXPECTED_PREVIEW_TREE ||
  catalogBlob !== EXPECTED_CATALOG_BLOB
) {
  throw new Error("AI Director pinned Git tree or catalog blob changed");
}

const catalogBytes = readPinnedBlob(CATALOG_REPOSITORY_PATH);
const catalogHash = sha256(catalogBytes);
if (catalogHash !== EXPECTED_CATALOG_SHA256) {
  throw new Error(
    `AI Director catalog hash changed: expected ${EXPECTED_CATALOG_SHA256}, received ${catalogHash}`,
  );
}

const source = JSON.parse(catalogBytes.toString("utf8"));
if (!Array.isArray(source) || source.length !== EXPECTED_COUNT) {
  throw new Error(`Expected ${EXPECTED_COUNT} look rows`);
}
const ids = new Set(source.map(({ id }) => id));
if (ids.size !== EXPECTED_COUNT || !ids.has(DEFAULT_LOOK_ID)) {
  throw new Error("Look IDs are not unique or the mythology default is missing");
}

fs.mkdirSync(destinationPreviewRoot, { recursive: true });
fs.mkdirSync(path.dirname(destinationManifest), { recursive: true });

const looks = [];
for (const record of source) {
  const previewName = `${record.id}.webp`;
  const previewRepositoryPath = `${PREVIEW_REPOSITORY_ROOT}/${previewName}`;
  const previewDestination = path.join(destinationPreviewRoot, previewName);
  const previewBlob = gitObjectId(`${EXPECTED_SOURCE_COMMIT}:${previewRepositoryPath}`);
  const previewBytes = readPinnedBlob(previewRepositoryPath);
  const decodedPreview = decodeWebP(previewBytes, previewName);
  await decodeWebPPixels(previewBytes, previewName, decodedPreview);
  if (decodedPreview.width !== 1280 || decodedPreview.height !== 720) {
    throw new Error(
      `${previewName} must decode to 1280x720, received ${decodedPreview.width}x${decodedPreview.height}`,
    );
  }
  fs.writeFileSync(previewDestination, previewBytes);
  const policy = negativePolicy();
  const treatment = reviewedTreatment(record);
  const deterministicLookBlock = lockedLookBlock(record);
  const lookBlockHash = sha256(deterministicLookBlock);
  looks.push({
    id: record.id,
    versionId: stableUuid(`genie-look:${record.id}:v1`),
    name: record.name,
    family: record.family,
    feel: record.feel,
    modes: record.modes,
    lockedLookBlock: deterministicLookBlock,
    lockedLookBlockSha256: lookBlockHash,
    negativePolicy: policy,
    preview: {
      height: 720,
      path: `/looks/${previewName}`,
      sha256: sha256(previewBytes),
      webpBitstreamFormat: decodedPreview.bitstreamFormat ?? decodedPreview.format,
      width: 1280,
    },
    provenance: {
      creativeReview: "genie-deterministic-tail-v1",
      internalRightsBasis: "owner-authorized same-company internal use",
      reviewedAt: REVIEWED_AT,
      sourceCatalogSha256: catalogHash,
      sourceCommit: EXPECTED_SOURCE_COMMIT,
      sourcePreviewBlobSha1: previewBlob,
      sourcePreviewPath: previewRepositoryPath,
      sourcePreviewRawUrl: rawUrl(previewRepositoryPath),
      sourcePromptSha256: sha256(record.prompt),
      sourceRecordSha256: sha256(canonical(record)),
    },
    visualQcBaseline: visualQcBaseline(treatment, lookBlockHash, policy.sha256),
  });
}

const manifest = {
  schemaVersion: "genie-look-pack.v1",
  packId: "ai-director-curated-looks",
  packVersion: 1,
  defaultLookId: DEFAULT_LOOK_ID,
  familyOrder: [
    "Indian Mythology & Devotion",
    "Cinematic Eras & Film Stock",
    "Genre Worlds",
    "Indian Cinema",
    "World Cinema",
    "Advertising & Commercial",
    "Documentary & Real",
    "Animation & Illustration",
    "Mood & Experimental",
  ],
  importedFrom: {
    catalogBlobSha1: catalogBlob,
    catalogPath: CATALOG_REPOSITORY_PATH,
    catalogRawUrl: rawUrl(CATALOG_REPOSITORY_PATH),
    catalogSha256: catalogHash,
    commitUrl: `${EXPECTED_REPOSITORY_URL}/commit/${EXPECTED_SOURCE_COMMIT}`,
    previewTreePath: PREVIEW_REPOSITORY_ROOT,
    previewTreeSha1: previewTree,
    repositoryUrl: EXPECTED_REPOSITORY_URL,
    sourceCommit: EXPECTED_SOURCE_COMMIT,
    sourceTreeSha1: sourceTree,
  },
  looks,
};

fs.writeFileSync(
  destinationManifest,
  await prettier.format(JSON.stringify(manifest), { parser: "json" }),
);
console.log(
  `Imported ${looks.length} looks and previews into ${path.relative(root, destinationManifest)}`,
);

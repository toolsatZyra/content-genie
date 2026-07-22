import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { detectHighConfidenceSecrets } from "./secret-patterns.mjs";

const root = process.cwd();
const sourceRoots = ["src", "trigger", "proxy.ts", "next.config.ts"];
const textExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const violations = [];

const secretNames = [
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "FAL_ADMIN_KEY",
  "FAL_KEY",
  "GENIE_COMMAND_HMAC_SECRET",
  "GENIE_DIAGNOSTIC_HASH_KEY",
  "GENIE_BROKER_CLIENT_SIGNING_PRIVATE_KEY",
  "GENIE_CAPABILITY_SIGNING_PRIVATE_KEY",
  "GOOGLE_GENAI_API_KEY",
  "OPENAI_API_KEY",
  "SARVAM_API_KEY",
  "SUPABASE_DB_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TRIGGER_SECRET_KEY",
];

function* walk(path) {
  if (!existsSync(path)) {
    return;
  }
  const entries = readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = join(path, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absolute);
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      yield absolute;
    }
  }
}

const git = spawnSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
);
if (git.error) throw git.error;
if (git.status !== 0) throw new Error("Unable to inventory repository files.");

const binaryExtensions = new Set([
  ".docx",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".mp4",
  ".pdf",
  ".png",
  ".webm",
  ".xlsx",
  ".zip",
]);
for (const path of git.stdout.split("\0").filter(Boolean)) {
  const absolute = join(root, path);
  if (
    !existsSync(absolute) ||
    statSync(absolute).size > 5_000_000 ||
    binaryExtensions.has(extname(path).toLowerCase())
  ) {
    continue;
  }
  const matches = detectHighConfidenceSecrets(readFileSync(absolute, "utf8"));
  for (const match of matches) {
    violations.push(`${path}: possible hardcoded ${match}`);
  }
}

for (const sourceRoot of sourceRoots) {
  const absoluteRoot = join(root, sourceRoot);
  const files =
    existsSync(absoluteRoot) && !extname(absoluteRoot)
      ? walk(absoluteRoot)
      : [absoluteRoot];

  for (const file of files) {
    if (!existsSync(file)) continue;
    const path = relative(root, file).replaceAll("\\", "/");
    const contents = readFileSync(file, "utf8");
    const isClient =
      contents.startsWith('"use client"') || contents.startsWith("'use client'");

    if (contents.includes("@sentry/") || contents.includes("Sentry.")) {
      violations.push(`${path}: Sentry is excluded by product contract`);
    }

    if (isClient) {
      for (const secretName of secretNames) {
        if (contents.includes(secretName)) {
          violations.push(`${path}: client module references ${secretName}`);
        }
      }
      if (
        contents.includes("@/config/server-env") ||
        contents.includes("../config/server-env")
      ) {
        violations.push(`${path}: client module imports the server environment`);
      }
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Security source scan failed:\n${violations.join("\n")}`);
}

console.log("PASS source boundary and high-confidence repository secret scan");

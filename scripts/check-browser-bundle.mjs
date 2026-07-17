import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { serverOnlyVariables } from "./server-only-variables.mjs";

const root = process.cwd();
const browserRoots = [
  {
    directory: join(root, ".next", "static"),
    accepts: () => true,
  },
  {
    directory: join(root, ".next", "server", "app"),
    accepts: (file) =>
      [".html", ".meta", ".rsc"].includes(extname(file)) ||
      file.endsWith("_client-reference-manifest.js"),
  },
];
const explicitBrowserArtifacts = [
  ".next/app-build-manifest.json",
  ".next/build-manifest.json",
  ".next/react-loadable-manifest.json",
];
const browserExtensions = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".meta",
  ".mjs",
  ".rsc",
  ".txt",
]);
const forbidden = [
  "GENIE_SERVER_SECRET_CANARY_6f78ddf9f50c4e519a447fb713a4c476",
  ...serverOnlyVariables,
];

function* walk(directory, accepts) {
  if (!existsSync(directory)) {
    throw new Error(`Expected browser build directory is missing: ${directory}`);
  }

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absolute, accepts);
    } else if (
      entry.isFile() &&
      browserExtensions.has(extname(entry.name)) &&
      accepts(absolute)
    ) {
      yield absolute;
    }
  }
}

function* walkAllFiles(directory) {
  if (!existsSync(directory)) {
    throw new Error(`Expected build directory is missing: ${directory}`);
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walkAllFiles(absolute);
    } else if (entry.isFile()) {
      yield absolute;
    }
  }
}

function inspect(file, inspected, violations, tokens = forbidden) {
  const contents = readFileSync(file, "utf8");
  inspected.push({
    bytes: statSync(file).size,
    digest: createHash("sha256").update(contents).digest("hex"),
    path: relative(root, file).replaceAll("\\", "/"),
  });

  for (const token of tokens) {
    if (contents.includes(token)) {
      violations.push(`${relative(root, file)} contains forbidden token ${token}`);
    }
  }
}

function inspectCanary(file, inspected, violations) {
  const contents = readFileSync(file);
  inspected.push({
    bytes: contents.length,
    digest: createHash("sha256").update(contents).digest("hex"),
    path: relative(root, file).replaceAll("\\", "/"),
  });
  if (contents.includes(Buffer.from(forbidden[0]))) {
    violations.push(`${relative(root, file)} contains the seeded server canary`);
  }
}

const inspected = [];
const violations = [];
const canaryInspected = [];

for (const browserRoot of browserRoots) {
  for (const file of walk(browserRoot.directory, browserRoot.accepts)) {
    inspect(file, inspected, violations);
  }
}
for (const path of explicitBrowserArtifacts) {
  const file = join(root, path);
  if (existsSync(file)) inspect(file, inspected, violations);
}
for (const file of walkAllFiles(join(root, ".next"))) {
  inspectCanary(file, canaryInspected, violations);
}

if (inspected.length === 0) {
  throw new Error("No browser artifacts were inspected.");
}
if (canaryInspected.length === 0) {
  throw new Error("No complete-build canary artifacts were inspected.");
}

if (violations.length > 0) {
  throw new Error(`Browser bundle secret scan failed:\n${violations.join("\n")}`);
}

const bytes = inspected.reduce((total, file) => total + file.bytes, 0);
console.log(
  `PASS browser secret and complete-build canary scan (${inspected.length} browser files, ${canaryInspected.length} build files, ${bytes} browser bytes)`,
);

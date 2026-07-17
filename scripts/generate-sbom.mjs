import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.cwd(), ".tmp", "artifacts");
const output = join(directory, "sbom.cdx.json");
mkdirSync(directory, { recursive: true });

const pnpmCli = process.env.npm_execpath;
const command = pnpmCli
  ? process.execPath
  : process.platform === "win32"
    ? "pnpm.cmd"
    : "pnpm";
const pnpmArgs = [
  "sbom",
  "--sbom-format",
  "cyclonedx",
  "--sbom-spec-version",
  "1.6",
  "--sbom-type",
  "application",
  "--out",
  output,
];
const args = pnpmCli ? [pnpmCli, ...pnpmArgs] : pnpmArgs;
const result = spawnSync(command, args, {
  encoding: "utf8",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(result.stderr || "pnpm SBOM generation failed");
}

const sbom = JSON.parse(readFileSync(output, "utf8"));
if (
  sbom.bomFormat !== "CycloneDX" ||
  sbom.specVersion !== "1.6" ||
  !Array.isArray(sbom.components) ||
  sbom.components.length === 0
) {
  throw new Error("Generated SBOM is not a populated CycloneDX 1.6 document.");
}

console.log(`PASS CycloneDX SBOM (${sbom.components.length} components): ${output}`);

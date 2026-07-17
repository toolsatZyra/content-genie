import { readFileSync } from "node:fs";

const expected =
  "77c4ae9ab734eed310854d35f6d626531f69090d:docs/implementation-plan.md:generic-api-key:497";
const entries = readFileSync(".gitleaksignore", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (entries.length !== 1 || entries[0] !== expected) {
  throw new Error("Gitleaks ignore must contain only the reviewed prose fingerprint.");
}

const prose = readFileSync("docs/implementation-plan.md", "utf8")
  .split(/\r?\n/)
  .slice(490, 500)
  .join(" ");
if (!prose.includes("wrong-project keys") || !prose.includes("wrong audience")) {
  throw new Error(
    "Reviewed Gitleaks prose context changed; re-review the fingerprint.",
  );
}

console.log("PASS Gitleaks ignore is limited to one reviewed historical prose finding");

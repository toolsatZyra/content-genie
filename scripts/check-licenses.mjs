import { spawnSync } from "node:child_process";

import { evaluateProductionLicenses } from "./license-policy.mjs";

const pnpmCli = process.env.npm_execpath;
const command = pnpmCli
  ? process.execPath
  : process.platform === "win32"
    ? "pnpm.cmd"
    : "pnpm";
const args = pnpmCli
  ? [pnpmCli, "licenses", "list", "--json", "--prod"]
  : ["licenses", "list", "--json", "--prod"];
const result = spawnSync(command, args, {
  encoding: "utf8",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(result.stderr || "pnpm license inventory failed");
}

const inventory = JSON.parse(result.stdout);
const { packages, rejected } = evaluateProductionLicenses(inventory);
if (rejected.length > 0) {
  throw new Error(
    `Unapproved production dependency licenses:\n${rejected
      .map(({ license, packages: names }) => `${license}: ${names.join(", ")}`)
      .join("\n")}`,
  );
}

console.log(`PASS production license policy (${packages} package records)`);

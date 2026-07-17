import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const scanner = fileURLToPath(new URL("./check-browser-bundle.mjs", import.meta.url));
const canary = "GENIE_SERVER_SECRET_CANARY_6f78ddf9f50c4e519a447fb713a4c476";

for (const mutation of [
  join(process.cwd(), ".next", "server", "app", "__genie-secret-negative.rsc"),
  join(process.cwd(), ".next", "server", "__genie-secret-negative.js"),
  join(process.cwd(), ".next", "__genie-secret-negative"),
]) {
  try {
    writeFileSync(mutation, canary, "utf8");
    const rejected = spawnSync(process.execPath, [scanner], {
      encoding: "utf8",
    });
    if (rejected.status === 0) {
      throw new Error(`Build secret mutation was not rejected: ${mutation}`);
    }
  } finally {
    rmSync(mutation, { force: true });
  }
}

const clean = spawnSync(process.execPath, [scanner], {
  encoding: "utf8",
});
if (clean.error) throw clean.error;
if (clean.status !== 0) {
  throw new Error(clean.stderr || "Clean browser bundle scan failed.");
}
process.stdout.write(clean.stdout);
console.log("PASS browser payload and server-build scanner negative-control mutations");

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertProductionRuntime } from "./runtime-environment-policy.mjs";

assertProductionRuntime(process.env);

const candidates = [
  resolve(process.cwd(), "server.js"),
  resolve(process.cwd(), ".next", "standalone", "server.js"),
];
const serverEntry = candidates.find((candidate) => existsSync(candidate));
if (!serverEntry) {
  throw new Error("Standalone production server entry is missing.");
}

await import(pathToFileURL(serverEntry).href);

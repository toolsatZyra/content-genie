import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { analyzePhase1Migrations } from "./rls-policy.mjs";

const root = process.cwd();
const directory = join(root, "supabase", "migrations");
const files = readdirSync(directory)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const sources = files.map((file) => ({
  file,
  sql: readFileSync(join(directory, file), "utf8"),
}));
const report = analyzePhase1Migrations(sources);

if (report.errors.length > 0) {
  throw new Error(`Phase 1 database policy failed:\n${report.errors.join("\n")}`);
}

console.log(
  `PASS Phase 1 migration policy (${files.length} migrations, ${report.publicTables.length} exposed tables)`,
);

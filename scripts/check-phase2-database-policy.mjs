import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  analyzePhase2Migrations,
  analyzePhase2PgTapSource,
} from "./phase2-database-policy.mjs";

const root = process.cwd();
const directory = join(root, "supabase", "migrations");
const files = readdirSync(directory)
  .filter((file) => file.endsWith(".sql") && file.includes("_phase2_"))
  .sort();
const sources = files.map((file) => ({
  file,
  sql: readFileSync(join(directory, file), "utf8"),
}));
const report = analyzePhase2Migrations(sources);
const pgTapReport = analyzePhase2PgTapSource(
  readFileSync(
    join(root, "supabase", "tests", "phase2_zero_spend_foundation.test.sql"),
    "utf8",
  ),
);

const errors = [...report.errors, ...pgTapReport.errors];
if (errors.length > 0) {
  throw new Error(`Phase 2 database policy failed:\n${errors.join("\n")}`);
}

console.log(
  `PASS Phase 2 zero-spend migration policy (${files.length} migrations, ${report.publicTables.length} exposed tables)`,
);

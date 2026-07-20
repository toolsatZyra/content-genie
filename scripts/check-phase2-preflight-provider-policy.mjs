import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  analyzePreflightProviderMigrations,
  analyzePreflightProviderPgTap,
  selectPreflightProviderMigrations,
} from "./phase2-preflight-provider-policy.mjs";

const root = process.cwd();
const migrations = join(root, "supabase", "migrations");
const files = selectPreflightProviderMigrations(
  readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort(),
);
const report = analyzePreflightProviderMigrations(
  files.map((file) => ({
    file,
    sql: readFileSync(join(migrations, file), "utf8"),
  })),
);
const pgTapReport = analyzePreflightProviderPgTap(
  readFileSync(
    join(root, "supabase", "tests", "phase2_preflight_provider_ingest.test.sql"),
    "utf8",
  ),
);
const errors = [...report.errors, ...pgTapReport.errors];
if (errors.length > 0) {
  throw new Error(`Phase 2 preflight/provider policy failed:\n${errors.join("\n")}`);
}
console.log(
  `PASS Phase 2 preflight/provider policy (${files.length} migrations, ${report.exposedTables.length} exposed tables)`,
);

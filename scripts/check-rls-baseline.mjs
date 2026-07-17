import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const migrations = join(process.cwd(), "supabase", "migrations");
const sqlFiles = existsSync(migrations)
  ? readdirSync(migrations).filter((file) => file.endsWith(".sql"))
  : [];

if (sqlFiles.length > 0) {
  throw new Error(
    "Phase 0 RLS baseline cannot certify migrations; use the Phase 1 policy harness.",
  );
}

console.log("PASS Phase 0 RLS baseline (no application tables or migrations)");

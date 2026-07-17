import { spawnSync } from "node:child_process";

if (process.env.GENIE_DATABASE_HARNESS_ACTIVE !== "1") {
  console.log("SKIP live database tests (isolated Supabase harness is not active)");
  process.exit(0);
}

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (const args of [
  ["exec", "supabase", "test", "db", "supabase/tests", "--local"],
  [
    "exec",
    "supabase",
    "db",
    "lint",
    "--local",
    "--schema",
    "public,private,audit",
    "--level",
    "error",
    "--fail-on",
    "error",
  ],
]) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Live database command failed: ${args.join(" ")}`);
  }
}

console.log("PASS live Supabase pgTAP and database lint");

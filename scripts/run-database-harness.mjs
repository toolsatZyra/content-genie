import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  assertEphemeralBranchDatabase,
  requireManagedBranchEnvironment,
} from "./database-harness-policy.mjs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(options.failureMessage ?? `${command} exited unsuccessfully.`);
  }
  return result.stdout ?? "";
}

function dockerAvailable() {
  const docker = process.platform === "win32" ? "docker.exe" : "docker";
  const result = spawnSync(docker, ["info"], {
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
}

function findString(value, acceptedKeys) {
  if (!value || typeof value !== "object") return null;
  for (const [key, nested] of Object.entries(value)) {
    if (acceptedKeys.has(key.toLowerCase()) && typeof nested === "string") {
      return nested;
    }
    const found = findString(nested, acceptedKeys);
    if (found) return found;
  }
  return null;
}

async function runManagedBranchHarness() {
  const { productionProjectRef } = requireManagedBranchEnvironment(process.env);
  const branchName = `genie-ci-${randomUUID().slice(0, 12)}`;
  let branchId = null;

  try {
    const created = JSON.parse(
      run(
        pnpm,
        [
          "exec",
          "supabase",
          "branches",
          "create",
          branchName,
          "--project-ref",
          productionProjectRef,
          "--output",
          "json",
          "--yes",
        ],
        { capture: true, failureMessage: "Could not create isolated Supabase branch." },
      ),
    );
    branchId =
      findString(created, new Set(["id", "branch_id"])) ??
      findString(created, new Set(["name"]));
    if (!branchId) throw new Error("Supabase branch creation returned no branch ID.");

    let databaseUrl = null;
    for (let attempt = 0; attempt < 60 && !databaseUrl; attempt += 1) {
      const details = JSON.parse(
        run(
          pnpm,
          [
            "exec",
            "supabase",
            "branches",
            "get",
            branchId,
            "--project-ref",
            productionProjectRef,
            "--output",
            "json",
          ],
          {
            capture: true,
            failureMessage: "Could not inspect Supabase preview branch.",
          },
        ),
      );
      databaseUrl = findString(
        details,
        new Set(["postgres_url_non_pooling", "postgres_url"]),
      );
      if (!databaseUrl) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
    if (!databaseUrl) throw new Error("Supabase preview branch did not become ready.");
    assertEphemeralBranchDatabase(databaseUrl, process.env.SUPABASE_DB_URL);

    run(
      pnpm,
      [
        "exec",
        "supabase",
        "db",
        "push",
        "--db-url",
        databaseUrl,
        "--include-all",
        "--yes",
      ],
      { failureMessage: "Could not apply migrations to isolated Supabase branch." },
    );
    run(pnpm, ["test:rls"]);
    console.log("PASS managed ephemeral Supabase branch database harness");
  } finally {
    if (branchId) {
      run(
        pnpm,
        [
          "exec",
          "supabase",
          "branches",
          "delete",
          branchId,
          "--project-ref",
          productionProjectRef,
          "--yes",
        ],
        { failureMessage: "Could not clean up isolated Supabase branch." },
      );
    }
  }
}

if (dockerAvailable()) {
  try {
    run(pnpm, ["db:start:test"]);
    run(pnpm, ["db:reset:test"]);
    run(pnpm, ["test:rls"]);
    console.log("PASS local Docker Supabase database harness");
  } finally {
    run(pnpm, ["db:stop:test"]);
  }
} else {
  await runManagedBranchHarness();
}

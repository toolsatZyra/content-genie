import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import {
  assertEphemeralBranchDatabase,
  requireManagedBranchEnvironment,
} from "./database-harness-policy.mjs";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.allowFailure) return "";
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

function parseJsonOutput(value) {
  const objectStart = value.indexOf("{");
  const arrayStart = value.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  if (starts.length === 0) throw new Error("Supabase CLI returned no JSON payload.");
  const start = Math.min(...starts);
  const end = value.lastIndexOf(value[start] === "{" ? "}" : "]");
  if (end < start) throw new Error("Supabase CLI returned incomplete JSON.");
  return JSON.parse(value.slice(start, end + 1));
}

function remoteDatabaseProof(databaseUrl, pass) {
  run(
    pnpm,
    ["exec", "supabase", "test", "db", "supabase/tests", "--db-url", databaseUrl],
    { failureMessage: `Remote pgTAP ${pass} failed.` },
  );
  run(
    pnpm,
    [
      "exec",
      "supabase",
      "db",
      "lint",
      "--db-url",
      databaseUrl,
      "--schema",
      "public,private,audit",
      "--level",
      "error",
      "--fail-on",
      "error",
    ],
    { failureMessage: `Remote schema lint ${pass} failed.` },
  );
}

async function runManagedBranchHarness() {
  const { productionProjectRef } = requireManagedBranchEnvironment(process.env);
  const branchName = `genie-ci-${randomUUID().slice(0, 12)}`;
  let branchId = null;

  try {
    const created = parseJsonOutput(
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
      const detailOutput = run(
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
          allowFailure: true,
          capture: true,
        },
      );
      if (!detailOutput.trim()) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        continue;
      }
      const details = parseJsonOutput(detailOutput);
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
        "reset",
        "--db-url",
        databaseUrl,
        "--no-seed",
        "--yes",
      ],
      {
        failureMessage:
          "Could not fresh-apply migrations to the isolated Supabase branch.",
      },
    );
    remoteDatabaseProof(databaseUrl, "after fresh apply");

    run(
      pnpm,
      [
        "exec",
        "supabase",
        "db",
        "reset",
        "--db-url",
        databaseUrl,
        "--no-seed",
        "--yes",
      ],
      { failureMessage: "Could not replay migrations on the isolated branch." },
    );
    remoteDatabaseProof(databaseUrl, "after reset and forward replay");

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
        "--dry-run",
      ],
      { failureMessage: "Migration replay left unapplied forward work." },
    );
    run(node, [
      "scripts/run-phase1-forward-rollback-drill.mjs",
      "--db-url",
      databaseUrl,
      "--branch-ref",
      branchId,
      "--production-project-ref",
      productionProjectRef,
    ]);
    run(pnpm, ["test:rls"]);
    console.log(
      "PASS managed ephemeral Supabase branch fresh apply, reset, replay, pgTAP and lint",
    );
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
    process.env.GENIE_DATABASE_HARNESS_ACTIVE = "1";
    run(pnpm, ["test:rls"]);
    run(pnpm, ["db:reset:test"]);
    run(pnpm, ["test:rls"]);
    run(node, ["scripts/run-phase1-forward-rollback-drill.mjs", "--local"]);
    console.log("PASS local Docker Supabase fresh apply and replay database harness");
  } finally {
    run(pnpm, ["db:stop:test"]);
  }
} else {
  await runManagedBranchHarness();
}

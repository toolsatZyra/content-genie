import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;
const productionProjectRef = process.env.SUPABASE_PROJECT_REF?.trim();
if (!productionProjectRef) {
  throw new Error("SUPABASE_PROJECT_REF is required for the isolated live suite.");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(options.failureMessage ?? `${command} exited unsuccessfully.`);
  }
  return result.stdout ?? "";
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

function branchValue(details, name) {
  return (
    details[name] ??
    findString(details, new Set([name.toLowerCase()])) ??
    findString(details, new Set([name.toLowerCase().replaceAll("_", "")]))
  );
}

const branchName = `genie-live-${randomUUID().slice(0, 12)}`;
let branchId = null;
let outcome = "failed";
const startedAt = new Date().toISOString();

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
      { capture: true, failureMessage: "Could not create the live-suite branch." },
    ),
  );
  branchId =
    findString(created, new Set(["id", "branch_id"])) ??
    findString(created, new Set(["name"]));
  if (!branchId) throw new Error("Supabase returned no live-suite branch ID.");

  let details = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    details = JSON.parse(
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
        { capture: true },
      ),
    );
    if (
      branchValue(details, "SUPABASE_URL") &&
      branchValue(details, "SUPABASE_ANON_KEY") &&
      branchValue(details, "SUPABASE_SERVICE_ROLE_KEY") &&
      branchValue(details, "POSTGRES_URL")
    ) {
      break;
    }
    details = null;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!details) throw new Error("The live-suite branch did not become ready.");

  const supabaseUrl = branchValue(details, "SUPABASE_URL");
  const branchProjectRef = new URL(supabaseUrl).hostname.split(".")[0];
  if (!branchProjectRef || branchProjectRef === productionProjectRef) {
    throw new Error("The live suite refuses a production-equal Supabase URL.");
  }
  const databaseUrl = branchValue(details, "POSTGRES_URL").replace(":6543/", ":5432/");
  run(pnpm, [
    "exec",
    "supabase",
    "db",
    "push",
    "--db-url",
    databaseUrl,
    "--include-all",
    "--yes",
  ]);

  const liveEnvironment = {
    ...process.env,
    GENIE_LIVE_SUPABASE_ANON_KEY: branchValue(details, "SUPABASE_ANON_KEY"),
    GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY: branchValue(
      details,
      "SUPABASE_SERVICE_ROLE_KEY",
    ),
    GENIE_LIVE_SUPABASE_URL: supabaseUrl,
  };
  run(node, ["scripts/phase1-live-harness.mjs"], {
    env: liveEnvironment,
    failureMessage: "Phase 1 live setup and authorization probes failed.",
  });
  const credentials = JSON.parse(
    await readFile(".tmp/phase1-live-credentials.json", "utf8"),
  );
  run(pnpm, ["exec", "playwright", "test", "--config=playwright.live.config.ts"], {
    env: {
      ...liveEnvironment,
      GENIE_LIVE_TEST_EMAIL: credentials.email,
      GENIE_LIVE_TEST_OBJECT_PATH: credentials.objectPath,
      GENIE_LIVE_TEST_OUTSIDER_EMAIL: credentials.outsiderEmail,
      GENIE_LIVE_TEST_PASSWORD: credentials.password,
      GENIE_LIVE_TEST_PROJECT_REF: branchProjectRef,
    },
    failureMessage: "Phase 1 authenticated live-browser journey failed.",
  });
  outcome = "passed";
} finally {
  let cleanup = "not-created";
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
      { failureMessage: "Could not delete the isolated live-suite branch." },
    );
    cleanup = "branch-deleted";
  }
  await mkdir(".tmp/artifacts", { recursive: true });
  await writeFile(
    ".tmp/artifacts/phase1-live-suite.json",
    JSON.stringify(
      {
        branchName,
        cleanup,
        finishedAt: new Date().toISOString(),
        outcome,
        startedAt,
      },
      null,
      2,
    ),
  );
}

console.log("PASS isolated Phase 1 live suite; preview branch deleted");

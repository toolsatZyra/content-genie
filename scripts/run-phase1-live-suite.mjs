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

function branchValue(details, name) {
  return (
    details[name] ??
    findString(details, new Set([name.toLowerCase()])) ??
    findString(details, new Set([name.toLowerCase().replaceAll("_", "")]))
  );
}

async function waitForSupabaseApi(supabaseUrl, anonKey) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
        headers: { apikey: anonKey },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return attempt;
    } catch {
      // A new preview hostname can exist in branch metadata before DNS and
      // the Auth gateway are reachable. The bounded readiness loop owns that
      // provisioning state instead of leaking it into product assertions.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("The live-suite Supabase Auth API did not become ready.");
}

const branchName = `genie-live-${randomUUID().slice(0, 12)}`;
let branchId = null;
let apiReadinessAttempts = 0;
let forwardRollback = "not-run";
let outcome = "failed";
const startedAt = new Date().toISOString();

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
      { capture: true, failureMessage: "Could not create the live-suite branch." },
    ),
  );
  branchId =
    findString(created, new Set(["id", "branch_id"])) ??
    findString(created, new Set(["name"]));
  if (!branchId) throw new Error("Supabase returned no live-suite branch ID.");

  let details = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
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
      { allowFailure: true, capture: true },
    );
    if (!detailOutput.trim()) {
      details = null;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      continue;
    }
    details = parseJsonOutput(detailOutput);
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
    "reset",
    "--db-url",
    databaseUrl,
    "--no-seed",
    "--yes",
  ]);
  run(
    node,
    [
      "scripts/run-phase1-forward-rollback-drill.mjs",
      "--db-url",
      databaseUrl,
      "--branch-ref",
      branchProjectRef,
      "--production-project-ref",
      productionProjectRef,
    ],
    { failureMessage: "Disposable branch forward-rollback drill failed." },
  );
  forwardRollback = "passed";
  apiReadinessAttempts = await waitForSupabaseApi(
    supabaseUrl,
    branchValue(details, "SUPABASE_ANON_KEY"),
  );
  const liveEnvironment = {
    ...process.env,
    // Newly reset Supabase preview branches do not attach the Realtime
    // replication tenant reliably. Realtime isolation is a separate live gate
    // against the long-lived preview project; every other boundary remains
    // isolated here and the whole branch is deleted in finally.
    GENIE_LIVE_SKIP_REALTIME: "1",
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
  run(node, ["scripts/run-isolated-next-dev.mjs", "4176"], {
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
        apiReadinessAttempts,
        branchName,
        cleanup,
        finishedAt: new Date().toISOString(),
        forwardRollback,
        outcome,
        startedAt,
      },
      null,
      2,
    ),
  );
}

console.log("PASS isolated Phase 1 live suite; preview branch deleted");

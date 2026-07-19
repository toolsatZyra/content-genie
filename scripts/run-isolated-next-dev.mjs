import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve, sep } from "node:path";

const root = process.cwd();
const port = process.argv[2]?.trim();
if (!/^[1-9][0-9]{2,4}$/.test(port ?? "")) {
  throw new Error("An explicit local port is required.");
}

const temporaryRoot = resolve(root, ".tmp", "isolated-next");
const runtimeDirectory = resolve(temporaryRoot, String(process.pid));
if (!runtimeDirectory.startsWith(`${temporaryRoot}${sep}`)) {
  throw new Error("The isolated Next runtime escaped the temporary root.");
}

const required = [
  "GENIE_LIVE_SUPABASE_URL",
  "GENIE_LIVE_SUPABASE_ANON_KEY",
  "GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY",
  "GENIE_LIVE_TEST_EMAIL",
  "GENIE_LIVE_TEST_EPISODE_ID",
  "GENIE_LIVE_TEST_OBJECT_PATH",
  "GENIE_LIVE_TEST_OUTSIDER_EMAIL",
  "GENIE_LIVE_TEST_PASSWORD",
  "GENIE_LIVE_TEST_PROJECT_REF",
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for live validation`);
}

rmSync(runtimeDirectory, { force: true, recursive: true });
mkdirSync(runtimeDirectory, { recursive: true });

for (const directory of ["public", "src"]) {
  const source = join(root, directory);
  if (existsSync(source)) {
    cpSync(source, join(runtimeDirectory, directory), { recursive: true });
  }
}
for (const file of [
  "next-env.d.ts",
  "next.config.ts",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "postcss.config.mjs",
  "tsconfig.json",
]) {
  cpSync(join(root, file), join(runtimeDirectory, file));
}
const require = createRequire(import.meta.url);
const nextExecutable = require.resolve("next/dist/bin/next");
const playwrightExecutable = require.resolve("@playwright/test/cli");

const inheritedRuntimeEnvironment = new Set([
  "ALLUSERSPROFILE",
  "APPDATA",
  "CI",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "OS",
  "PATH",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "PUBLIC",
  "SHELL",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "USERDOMAIN",
  "USERNAME",
  "USERPROFILE",
  "WINDIR",
]);

function operatingSystemEnvironment(source) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined && inheritedRuntimeEnvironment.has(name.toUpperCase()),
    ),
  );
}

const playwrightEnvironmentNames = new Set([
  "GENIE_LIVE_SUPABASE_ANON_KEY",
  "GENIE_LIVE_SUPABASE_URL",
  "GENIE_LIVE_TEST_EMAIL",
  "GENIE_LIVE_TEST_EPISODE_ID",
  "GENIE_LIVE_TEST_OBJECT_PATH",
  "GENIE_LIVE_TEST_OUTSIDER_EMAIL",
  "GENIE_LIVE_TEST_PASSWORD",
]);

function liveTestEnvironment(source) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) => value !== undefined && playwrightEnvironmentNames.has(name),
    ),
  );
}

async function cleanup() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      rmSync(runtimeDirectory, {
        force: true,
        recursive: true,
      });
      if (!existsSync(runtimeDirectory)) return;
    } catch (error) {
      const retryable =
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["EBUSY", "ENOTEMPTY", "EPERM"].includes(String(error.code));
      if (!retryable || attempt === 20) throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("The isolated Next runtime was not removed.");
}

const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [nextExecutable, "dev", "--webpack", "-H", "127.0.0.1", "-p", port],
  {
    cwd: runtimeDirectory,
    env: {
      ...operatingSystemEnvironment(process.env),
      GENIE_ENABLE_EXPORT: "false",
      GENIE_ENABLE_FINAL_APPROVAL: "false",
      GENIE_ENABLE_PROVIDER_SPEND: "false",
      GENIE_ENABLE_RENDER: "false",
      GENIE_ENVIRONMENT: "preview",
      NEXT_PUBLIC_APP_URL: baseUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.GENIE_LIVE_SUPABASE_ANON_KEY,
      NEXT_PUBLIC_SUPABASE_URL: process.env.GENIE_LIVE_SUPABASE_URL,
      SUPABASE_PROJECT_REF: "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_TEST_PROJECT_REF: process.env.GENIE_LIVE_TEST_PROJECT_REF,
    },
    shell: false,
    stdio: "inherit",
  },
);
let serverError = null;
server.once("error", (error) => {
  serverError = error;
});

async function waitForServer() {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    if (serverError) throw serverError;
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error("The isolated Next server exited before it became ready.");
    }
    try {
      const response = await fetch(baseUrl, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // A cold isolated Next compile can take tens of seconds on Windows.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The isolated Next server did not become ready.");
}

function stopServer() {
  if (server.exitCode !== null || server.signalCode !== null || !server.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
    });
  } else {
    server.kill("SIGTERM");
  }
}

function runPlaywright() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [playwrightExecutable, "test", "--config=playwright.live.config.ts"],
      {
        cwd: root,
        env: {
          ...operatingSystemEnvironment(process.env),
          ...liveTestEnvironment(process.env),
          GENIE_LIVE_BASE_URL: baseUrl,
        },
        shell: false,
        stdio: "inherit",
      },
    );
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `Live Playwright exited unsuccessfully (${signal ?? `code ${code ?? 1}`}).`,
        ),
      );
    });
  });
}

try {
  await waitForServer();
  await runPlaywright();
} finally {
  stopServer();
  await cleanup();
}

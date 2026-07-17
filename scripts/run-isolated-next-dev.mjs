import { spawn } from "node:child_process";
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
function cleanup() {
  try {
    rmSync(runtimeDirectory, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  } catch {
    // The runtime is already contained in .tmp; a transient Windows file lock
    // may defer deletion without polluting or changing the source tree.
  }
}

const child = spawn(
  process.execPath,
  [nextExecutable, "dev", "--webpack", "-H", "127.0.0.1", "-p", port],
  {
    cwd: runtimeDirectory,
    env: process.env,
    shell: false,
    stdio: "inherit",
  },
);

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}
process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

child.once("error", (error) => {
  cleanup();
  throw error;
});
child.once("exit", (code, signal) => {
  cleanup();
  if (signal) {
    process.exit(0);
    return;
  }
  process.exitCode = code ?? 1;
});

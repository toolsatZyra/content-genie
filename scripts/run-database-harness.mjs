import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const node = process.execPath;

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

function dockerAvailable() {
  const docker = process.platform === "win32" ? "docker.exe" : "docker";
  const result = spawnSync(docker, ["info"], {
    encoding: "utf8",
    stdio: "ignore",
  });
  return result.status === 0;
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
  throw new Error(
    "The local database harness requires Docker. Managed disposable proof must run through the exact-identity trusted live branch controller.",
  );
}

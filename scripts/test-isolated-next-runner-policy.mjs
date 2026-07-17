import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function assertContract({ config, packageSource, runner, suite }) {
  const errors = [];
  for (const required of [
    /runtimeDirectory\.startsWith\(`\$\{temporaryRoot\}\$\{sep\}`\)/,
    /try\s*\{\s*await waitForServer\(\);\s*await runPlaywright\(\);\s*\}\s*finally\s*\{\s*stopServer\(\);\s*cleanup\(\);\s*\}/s,
    /taskkill\.exe[\s\S]*"\/T"[\s\S]*"\/F"/,
    /rmSync\(runtimeDirectory,[\s\S]*maxRetries:\s*10/s,
    /const playwrightExecutable = require\.resolve\("@playwright\/test\/cli"\)/,
  ]) {
    if (!required.test(runner)) {
      errors.push(`isolated runner contract is missing ${required}`);
    }
  }
  if (/shell:\s*true/.test(runner)) {
    errors.push("isolated runner must not use a command shell");
  }
  if (/\bwebServer\s*:/.test(config)) {
    errors.push("Playwright must not own the isolated server lifecycle");
  }
  if (!/GENIE_LIVE_BASE_URL/.test(config)) {
    errors.push("Playwright must consume the parent-owned isolated base URL");
  }
  if (!/run\(node,\s*\["scripts\/run-isolated-next-dev\.mjs",\s*"4176"\]/.test(suite)) {
    errors.push("the disposable live suite bypasses the parent-owned runner");
  }
  if (
    !/"test:live:phase1:existing":\s*"node scripts\/run-isolated-next-dev\.mjs 4176"/.test(
      packageSource,
    )
  ) {
    errors.push("the persistent-preview command bypasses the isolated runner");
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
}

const safe = {
  config: read("playwright.live.config.ts"),
  packageSource: read("package.json"),
  runner: read("scripts/run-isolated-next-dev.mjs"),
  suite: read("scripts/run-phase1-live-suite.mjs"),
};
assertContract(safe);

for (const mutation of [
  {
    ...safe,
    runner: safe.runner.replace("} finally {", "}\nif (false) {"),
  },
  {
    ...safe,
    runner: safe.runner.replace('"taskkill.exe"', '"taskkill-disabled.exe"'),
  },
  {
    ...safe,
    config: `${safe.config}\nconst unsafe = { webServer: { command: "unsafe" } };`,
  },
  {
    ...safe,
    suite: safe.suite.replace(
      'run(node, ["scripts/run-isolated-next-dev.mjs", "4176"], {',
      'run(node, ["unsafe-direct-playwright"], {',
    ),
  },
]) {
  let rejected = false;
  try {
    assertContract(mutation);
  } catch {
    rejected = true;
  }
  if (!rejected) {
    throw new Error("An unsafe isolated Next lifecycle mutation was accepted.");
  }
}

console.log("PASS isolated Next parent-owned lifecycle and negative controls");

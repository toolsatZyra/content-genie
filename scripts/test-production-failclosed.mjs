import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { assertProductionRuntime } from "./runtime-environment-policy.mjs";
import { serverOnlyVariables } from "./server-only-variables.mjs";

const valid = {
  GENIE_ENABLE_EXPORT: "false",
  GENIE_ENABLE_FINAL_APPROVAL: "false",
  GENIE_ENABLE_PROVIDER_SPEND: "false",
  GENIE_ENABLE_RENDER: "false",
  GENIE_ENVIRONMENT: "production",
  NEXT_PUBLIC_APP_URL: "https://genie.example",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-value",
  NEXT_PUBLIC_SUPABASE_URL: "https://test-project.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "server-authority",
};
assertProductionRuntime(valid);
for (const mutation of [
  { ...valid, GENIE_ENABLE_RENDER: "sometimes" },
  { ...valid, NEXT_PUBLIC_APP_URL: "" },
  { ...valid, SUPABASE_SERVICE_ROLE_KEY: "" },
  {
    ...valid,
    GENIE_ENABLE_PROVIDER_SPEND: "true",
    SUPABASE_SERVICE_ROLE_KEY: "",
    TRIGGER_SECRET_KEY: "",
  },
  {
    ...valid,
    SUPABASE_PROJECT_REF: "same",
    SUPABASE_TEST_PROJECT_REF: "same",
  },
]) {
  let rejected = false;
  try {
    assertProductionRuntime(mutation);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsafe production policy mutation was accepted.");
}

const environment = { ...process.env };
for (const name of serverOnlyVariables) environment[name] = "";
Object.assign(environment, {
  GENIE_ENABLE_EXPORT: "false",
  GENIE_ENABLE_FINAL_APPROVAL: "false",
  GENIE_ENABLE_PROVIDER_SPEND: "false",
  GENIE_ENABLE_RENDER: "false",
  GENIE_ENVIRONMENT: "production",
  NEXT_PUBLIC_APP_URL: "",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  NEXT_PUBLIC_SUPABASE_URL: "",
  NODE_ENV: "production",
  PORT: "4175",
});

const child = spawn(
  process.execPath,
  [fileURLToPath(new URL("./start-production.mjs", import.meta.url))],
  {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (chunk) => {
  output += String(chunk);
});
child.stderr.on("data", (chunk) => {
  output += String(chunk);
});

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    child.kill();
    reject(
      new Error("Invalid production runtime stayed alive instead of failing boot."),
    );
  }, 15_000);
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});

if (result === 0) {
  throw new Error("Invalid production runtime exited successfully.");
}
if (!output.includes("Production runtime contract failed")) {
  throw new Error("Production boot failed for an unexpected reason.");
}
console.log("PASS invalid production environment fails closed during server boot");

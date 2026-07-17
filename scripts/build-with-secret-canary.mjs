import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { serverOnlyVariables } from "./server-only-variables.mjs";

export const SECRET_CANARY =
  "GENIE_SERVER_SECRET_CANARY_6f78ddf9f50c4e519a447fb713a4c476";

const environment = { ...process.env };
for (const name of serverOnlyVariables) environment[name] = SECRET_CANARY;
Object.assign(environment, {
  GENIE_BUILD_SECRET_CANARY: SECRET_CANARY,
  GENIE_ENABLE_EXPORT: "false",
  GENIE_ENABLE_FINAL_APPROVAL: "false",
  GENIE_ENABLE_PROVIDER_SPEND: "false",
  GENIE_ENABLE_RENDER: "false",
  GENIE_ENVIRONMENT: "test",
  NEXT_PUBLIC_APP_URL: "http://127.0.0.1:4173",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-test-value",
  NEXT_PUBLIC_SUPABASE_URL: "https://test-project.invalid",
  SUPABASE_PROJECT_REF: "",
  SUPABASE_TEST_PROJECT_REF: "",
});

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");
const result = spawnSync(process.execPath, [nextCli, "build"], {
  env: environment,
  encoding: "utf8",
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exitCode = result.status ?? 1;

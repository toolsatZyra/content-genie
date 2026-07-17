import { defineConfig, devices } from "@playwright/test";

const required = [
  "GENIE_LIVE_SUPABASE_URL",
  "GENIE_LIVE_SUPABASE_ANON_KEY",
  "GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY",
  "GENIE_LIVE_TEST_EMAIL",
  "GENIE_LIVE_TEST_OBJECT_PATH",
  "GENIE_LIVE_TEST_OUTSIDER_EMAIL",
  "GENIE_LIVE_TEST_PASSWORD",
  "GENIE_LIVE_TEST_PROJECT_REF",
] as const;
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required for live validation`);
}

export default defineConfig({
  testDir: "./tests/live",
  timeout: 60_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4176",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm exec next dev --webpack -H 127.0.0.1 -p 4176",
    env: {
      ...process.env,
      GENIE_ENABLE_EXPORT: "false",
      GENIE_ENABLE_FINAL_APPROVAL: "false",
      GENIE_ENABLE_PROVIDER_SPEND: "false",
      GENIE_ENABLE_RENDER: "false",
      GENIE_ENVIRONMENT: "preview",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:4176",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.GENIE_LIVE_SUPABASE_ANON_KEY!,
      NEXT_PUBLIC_SUPABASE_URL: process.env.GENIE_LIVE_SUPABASE_URL!,
      SUPABASE_PROJECT_REF: "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.GENIE_LIVE_SUPABASE_SERVICE_ROLE_KEY!,
      SUPABASE_TEST_PROJECT_REF: process.env.GENIE_LIVE_TEST_PROJECT_REF!,
    },
    port: 4176,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

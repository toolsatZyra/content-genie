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
  expect: { timeout: 20_000 },
  testDir: "./tests/live",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.GENIE_LIVE_BASE_URL ?? "http://127.0.0.1:4176",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});

import { defineConfig, devices } from "@playwright/test";

import { safeTestEnvironment } from "./tests/safe-test-environment";

export default defineConfig({
  testDir: "./tests/production",
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "pnpm start:test",
    env: safeTestEnvironment({
      GENIE_ENVIRONMENT: "production",
      NEXT_PUBLIC_APP_URL: "http://127.0.0.1:4174",
    }),
    port: 4174,
    reuseExistingServer: false,
    stderr: "pipe",
    stdout: "pipe",
    timeout: 60_000,
  },
});

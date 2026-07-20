import { defineConfig } from "@trigger.dev/sdk/v3";

const project = process.env.TRIGGER_PROJECT_REF?.trim();

export default defineConfig({
  project: project || "proj_genie_control_unconfigured",
  dirs: ["./trigger"],
  logLevel: "info",
  maxDuration: 600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 2_000,
      maxTimeoutInMs: 30_000,
      randomize: true,
    },
  },
});

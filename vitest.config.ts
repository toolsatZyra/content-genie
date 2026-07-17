import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./tests/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    coverage: {
      enabled: false,
      include: [
        "src/config/env-core.ts",
        "src/observability/client-intake.ts",
        "src/observability/correlation.ts",
        "src/observability/redaction.ts",
        "src/observability/schema.ts",
        "src/test/fakes/*.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          environment: "node",
          include: ["src/**/*.test.ts"],
          name: "unit",
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          name: "integration",
        },
      },
    ],
    reporters: ["default"],
    restoreMocks: true,
  },
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  EnvironmentContractError,
  parseServerEnvironment,
} from "../../src/config/env-core";

const root = process.cwd();

describe("Phase 0 architecture boundaries", () => {
  it("has no publishing adapter or Sentry dependency", () => {
    const packageJson = readFileSync(join(root, "package.json"), "utf8");
    expect(packageJson).not.toContain("@sentry/");
    expect(packageJson).not.toContain("publish-adapter");
    expect(packageJson).not.toContain("social-publish");
  });

  it("denies production Supabase state in managed test execution", () => {
    expect(() =>
      parseServerEnvironment({
        GENIE_ENVIRONMENT: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://prod123.supabase.co",
        SUPABASE_PROJECT_REF: "prod123",
        SUPABASE_SERVICE_ROLE_KEY: "production-shaped-service-key",
        SUPABASE_TEST_PROJECT_REF: "test456",
      }),
    ).toThrow(EnvironmentContractError);
  });

  it("accepts an explicitly isolated managed test project", () => {
    const parsed = parseServerEnvironment({
      GENIE_ENVIRONMENT: "test",
      NEXT_PUBLIC_SUPABASE_URL: "https://test456.supabase.co",
      SUPABASE_PROJECT_REF: "prod123",
      SUPABASE_TEST_PROJECT_REF: "test456",
    });

    expect(parsed.public.supabaseUrl).toBe("https://test456.supabase.co");
    expect(parsed.enableProviderSpend).toBe(false);
  });
});

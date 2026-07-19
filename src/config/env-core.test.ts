import { describe, expect, it } from "vitest";

import {
  EnvironmentContractError,
  parsePublicEnvironment,
  parseServerEnvironment,
} from "@/config/env-core";

describe("environment contract", () => {
  it("keeps consequential gates off by default", () => {
    const environment = parseServerEnvironment({
      GENIE_ENVIRONMENT: "development",
    });

    expect(environment.enableExport).toBe(false);
    expect(environment.enableFinalApproval).toBe(false);
    expect(environment.enableProviderSpend).toBe(false);
    expect(environment.enableRender).toBe(false);
    expect(environment.commandHmacSecret).toBeNull();
    expect(environment.supabaseServiceRoleKey).toBeNull();
  });

  it("keeps the command HMAC authority separate from the Supabase authority", () => {
    const environment = parseServerEnvironment({
      GENIE_COMMAND_HMAC_SECRET: "dedicated-command-secret",
      SUPABASE_SERVICE_ROLE_KEY: "database-authority",
    });

    expect(environment.commandHmacSecret).toBe("dedicated-command-secret");
    expect(environment.supabaseServiceRoleKey).toBe("database-authority");
  });

  it("defaults NODE_ENV production to the production contract", () => {
    expect(() =>
      parseServerEnvironment({
        NODE_ENV: "production",
      }),
    ).toThrow("production/final approval requires");
  });

  it("requires the trusted Storage signer in production", () => {
    expect(() =>
      parseServerEnvironment({
        GENIE_ENVIRONMENT: "production",
        NEXT_PUBLIC_APP_URL: "https://genie.example",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
        NEXT_PUBLIC_SUPABASE_URL: "https://prod-ref.supabase.co",
      }),
    ).toThrow("production and consequential feature gates require");
  });

  it("rejects a production-shaped project in preview", () => {
    expect(() =>
      parseServerEnvironment({
        GENIE_ENVIRONMENT: "preview",
        NEXT_PUBLIC_SUPABASE_URL: "https://production-ref.supabase.co",
        SUPABASE_PROJECT_REF: "production-ref",
        SUPABASE_TEST_PROJECT_REF: "test-ref",
      }),
    ).toThrow(EnvironmentContractError);
  });

  it("rejects shared production and test refs", () => {
    expect(() =>
      parseServerEnvironment({
        GENIE_ENVIRONMENT: "test",
        SUPABASE_PROJECT_REF: "same-project",
        SUPABASE_TEST_PROJECT_REF: "same-project",
      }),
    ).toThrow("SUPABASE_TEST_PROJECT_REF must not equal SUPABASE_PROJECT_REF");
  });

  it("parses only browser-safe public values", () => {
    expect(
      parsePublicEnvironment({
        NEXT_PUBLIC_APP_URL: "https://genie.example/",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-value",
        NEXT_PUBLIC_SUPABASE_URL: "https://test-ref.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: "must-not-appear",
      }),
    ).toEqual({
      appUrl: "https://genie.example",
      supabaseAnonKey: "publishable-value",
      supabaseUrl: "https://test-ref.supabase.co",
    });
  });

  it("rejects malformed flags, environments, and public URLs", () => {
    expect(() =>
      parseServerEnvironment({
        GENIE_ENABLE_EXPORT: "yes",
        GENIE_ENVIRONMENT: "staging",
        NEXT_PUBLIC_APP_URL: "ftp://example.invalid",
        NEXT_PUBLIC_SUPABASE_URL: "not a URL",
      }),
    ).toThrow(EnvironmentContractError);
  });

  it("rejects the wrong explicit test project and missing authority secrets", () => {
    expect(() =>
      parseServerEnvironment({
        GENIE_ENABLE_PROVIDER_SPEND: "true",
        GENIE_ENVIRONMENT: "test",
        NEXT_PUBLIC_SUPABASE_URL: "https://other-ref.supabase.co",
        SUPABASE_TEST_PROJECT_REF: "test-ref",
      }),
    ).toThrow("preview/test Supabase URL must match");
  });

  it("accepts an explicitly complete production runtime", () => {
    expect(
      parseServerEnvironment({
        GENIE_ENABLE_EXPORT: "true",
        GENIE_ENABLE_FINAL_APPROVAL: "true",
        GENIE_ENABLE_PROVIDER_SPEND: "true",
        GENIE_ENABLE_RENDER: "true",
        GENIE_ENVIRONMENT: "production",
        NEXT_PUBLIC_APP_URL: "https://genie.example",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
        NEXT_PUBLIC_SUPABASE_URL: "https://prod-ref.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "server-authority",
        TRIGGER_SECRET_KEY: "trigger-authority",
      }),
    ).toMatchObject({
      enableExport: true,
      enableFinalApproval: true,
      enableProviderSpend: true,
      enableRender: true,
      environment: "production",
    });
  });
});

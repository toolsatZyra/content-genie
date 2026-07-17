import serverOnlyNames from "../config/server-only-variables.json";

export function safeTestEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment = Object.fromEntries(serverOnlyNames.map((name) => [name, ""]));
  return {
    ...environment,
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
    ...overrides,
  };
}

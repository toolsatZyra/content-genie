export function requireManagedBranchEnvironment(source) {
  const accessToken = source.SUPABASE_ACCESS_TOKEN?.trim();
  const productionProjectRef = source.SUPABASE_PROJECT_REF?.trim();
  const testProjectRef = source.SUPABASE_TEST_PROJECT_REF?.trim();
  if (!accessToken || !productionProjectRef) {
    throw new Error(
      "Managed database fallback requires SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.",
    );
  }
  if (testProjectRef && testProjectRef === productionProjectRef) {
    throw new Error("Managed database fallback refuses a production-equal test ref.");
  }
  return Object.freeze({ accessToken, productionProjectRef });
}

export function assertEphemeralBranchDatabase(
  branchDatabaseUrl,
  productionDatabaseUrl,
) {
  const branch = new URL(branchDatabaseUrl);
  if (branch.protocol !== "postgres:" && branch.protocol !== "postgresql:") {
    throw new Error("Preview branch did not return a PostgreSQL URL.");
  }
  if (productionDatabaseUrl && branchDatabaseUrl === productionDatabaseUrl) {
    throw new Error("Managed database fallback refuses the production database URL.");
  }
}

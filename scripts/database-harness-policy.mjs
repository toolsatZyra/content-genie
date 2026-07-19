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

function databaseIdentity(url) {
  return [
    decodeURIComponent(url.username).toLowerCase(),
    url.hostname.toLowerCase(),
    url.pathname.toLowerCase(),
  ].join("|");
}

export function assertEphemeralBranchDatabase(
  branchDatabaseUrl,
  productionDatabaseUrl,
  expectedBranchProjectRef,
  productionProjectRef,
) {
  const branch = new URL(branchDatabaseUrl);
  if (branch.protocol !== "postgres:" && branch.protocol !== "postgresql:") {
    throw new Error("Preview branch did not return a PostgreSQL URL.");
  }
  const branchIdentity = databaseIdentity(branch);
  if (
    expectedBranchProjectRef &&
    (!/^[a-z0-9]{20}$/.test(expectedBranchProjectRef) ||
      !branchIdentity.includes(expectedBranchProjectRef))
  ) {
    throw new Error("Preview database URL is not bound to the created branch ref.");
  }
  if (
    productionProjectRef &&
    (/^[a-z0-9]{20}$/.test(productionProjectRef) === false ||
      branchIdentity.includes(productionProjectRef))
  ) {
    throw new Error("Preview database URL resolves to the production project ref.");
  }
  if (productionDatabaseUrl) {
    const production = new URL(productionDatabaseUrl);
    if (
      branch.href === production.href ||
      branchIdentity === databaseIdentity(production)
    ) {
      throw new Error("Managed database fallback refuses the production database URL.");
    }
  }
}

export function assertDatabaseIdentityChallenge({
  directRows,
  expectedNonce,
  productionRows,
}) {
  if (
    typeof expectedNonce !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      expectedNonce,
    )
  ) {
    throw new Error("Database identity challenge nonce is not a UUID v4.");
  }
  if (
    !Array.isArray(directRows) ||
    directRows.length !== 1 ||
    directRows[0]?.challenge_nonce !== expectedNonce
  ) {
    throw new Error(
      "The exact PostgreSQL connection did not return the branch identity challenge.",
    );
  }
  if (
    !Array.isArray(productionRows) ||
    productionRows.length !== 1 ||
    productionRows[0]?.challenge_present !== false
  ) {
    throw new Error(
      "The database identity challenge is missing a production-exclusion proof.",
    );
  }
}

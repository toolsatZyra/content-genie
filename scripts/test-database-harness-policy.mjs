import {
  assertEphemeralBranchDatabase,
  requireManagedBranchEnvironment,
} from "./database-harness-policy.mjs";

const safe = requireManagedBranchEnvironment({
  SUPABASE_ACCESS_TOKEN: "test-token",
  SUPABASE_PROJECT_REF: "production-parent",
  SUPABASE_TEST_PROJECT_REF: "separate-test",
});
if (safe.productionProjectRef !== "production-parent") {
  throw new Error("Managed branch policy did not preserve the parent ref.");
}

for (const source of [
  {},
  { SUPABASE_ACCESS_TOKEN: "test-token" },
  {
    SUPABASE_ACCESS_TOKEN: "test-token",
    SUPABASE_PROJECT_REF: "same",
    SUPABASE_TEST_PROJECT_REF: "same",
  },
]) {
  let rejected = false;
  try {
    requireManagedBranchEnvironment(source);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsafe managed branch environment was accepted.");
}

assertEphemeralBranchDatabase(
  "postgresql://branch.invalid/postgres",
  "postgresql://production.invalid/postgres",
);
for (const [branch, production] of [
  ["https://branch.invalid", ""],
  [
    "postgresql://production.invalid/postgres",
    "postgresql://production.invalid/postgres",
  ],
]) {
  let rejected = false;
  try {
    assertEphemeralBranchDatabase(branch, production);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsafe managed branch database URL was accepted.");
}

console.log("PASS local/managed database harness isolation negative controls");

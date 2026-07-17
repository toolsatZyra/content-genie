import {
  buildForwardRollbackSteps,
  validateForwardRollbackTarget,
} from "./run-phase1-forward-rollback-drill.mjs";

const steps = buildForwardRollbackSteps("phase1_forward_rollback_policy_test");
if (
  steps.map(({ label }) => label).join("|") !==
  [
    "baseline forward migration",
    "candidate forward migration",
    "compensating forward migration",
    "forward-rollback contract assertion",
  ].join("|")
) {
  throw new Error("Forward-rollback steps are missing or reordered.");
}
const sql = steps.map(({ sql: statement }) => statement).join("\n");
for (const forbidden of [
  /\bdb\s+reset\b/i,
  /\bmigration\s+down\b/i,
  /\bdrop\s+database\b/i,
  /\bsupabase_migrations\b/i,
]) {
  if (forbidden.test(sql)) {
    throw new Error(`Forward-rollback drill contains forbidden behavior: ${forbidden}`);
  }
}

validateForwardRollbackTarget(
  { mode: "local" },
  { GENIE_DATABASE_HARNESS_ACTIVE: "1" },
);
for (const [target, environment] of [
  [{ mode: "local" }, {}],
  [
    {
      branchRef: "same-ref",
      databaseUrl: "postgresql://branch.invalid/postgres",
      mode: "remote",
      productionProjectRef: "same-ref",
    },
    {},
  ],
  [
    {
      branchRef: "branch-ref",
      databaseUrl: "https://branch.invalid",
      mode: "remote",
      productionProjectRef: "production-ref",
    },
    {},
  ],
]) {
  let rejected = false;
  try {
    validateForwardRollbackTarget(target, environment);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsafe forward-rollback target was accepted.");
}

validateForwardRollbackTarget(
  {
    branchRef: "branch-ref",
    databaseUrl: "postgresql://branch.invalid/postgres",
    mode: "remote",
    productionProjectRef: "production-ref",
  },
  { SUPABASE_DB_URL: "postgresql://production.invalid/postgres" },
);

console.log("PASS Phase 1 forward-rollback drill policy and negative controls");

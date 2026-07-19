import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  assertDatabaseIdentityChallenge,
  assertEphemeralBranchDatabase,
  requireManagedBranchEnvironment,
} from "./database-harness-policy.mjs";

const challengeNonce = "d73d7118-ae4a-4c7f-9760-48a8995569b8";
assertDatabaseIdentityChallenge({
  directRows: [{ challenge_nonce: challengeNonce }],
  expectedNonce: challengeNonce,
  productionRows: [{ challenge_present: false }],
});
for (const challenge of [
  {
    directRows: [{ challenge_nonce: "1632ace1-df4c-482a-a165-b570c4cf03aa" }],
    expectedNonce: challengeNonce,
    productionRows: [{ challenge_present: false }],
  },
  {
    directRows: [{ challenge_nonce: challengeNonce }],
    expectedNonce: challengeNonce,
    productionRows: [{ challenge_present: true }],
  },
  {
    directRows: [],
    expectedNonce: challengeNonce,
    productionRows: [{ challenge_present: false }],
  },
]) {
  let rejected = false;
  try {
    assertDatabaseIdentityChallenge(challenge);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsafe database identity challenge was accepted.");
}

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

const branchRef = "abcdefghijklmnopqrst";
const productionRef = "zyxwvutsrqponmlkjihg";
assertEphemeralBranchDatabase(
  `postgresql://postgres.${branchRef}:secret@pooler.supabase.com/postgres`,
  `postgresql://postgres.${productionRef}:secret@pooler.supabase.com/postgres`,
  branchRef,
  productionRef,
);
for (const [branch, production, expectedRef, parentRef] of [
  ["https://branch.invalid", "", undefined, undefined],
  [
    `postgresql://postgres.${productionRef}:secret@pooler.supabase.com/postgres`,
    `postgresql://postgres.${productionRef}:secret@pooler.supabase.com/postgres`,
    productionRef,
    productionRef,
  ],
  [
    `postgresql://postgres.${productionRef}:secret@pooler.supabase.com/postgres`,
    "",
    branchRef,
    productionRef,
  ],
  [
    `postgresql://postgres.${branchRef}:secret@pooler.supabase.com/postgres`,
    "",
    branchRef,
    branchRef,
  ],
]) {
  let rejected = false;
  try {
    assertEphemeralBranchDatabase(branch, production, expectedRef, parentRef);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Unsafe managed branch database URL was accepted.");
}

const harnessSource = readFileSync(
  new URL("./run-database-harness.mjs", import.meta.url),
  "utf8",
);
const directProofSource = readFileSync(
  new URL("./run-remote-database-proof.mjs", import.meta.url),
  "utf8",
);
for (const required of [
  "The local database harness requires Docker",
  "exact-identity trusted live branch controller",
]) {
  if (!harnessSource.includes(required)) {
    throw new Error(`Local database harness boundary is missing: ${required}`);
  }
}
for (const forbidden of [
  "runManagedBranchHarness",
  '"branches",\n          "create"',
  '"branches",\n            "delete"',
]) {
  if (harnessSource.includes(forbidden)) {
    throw new Error(`Unsafe managed fallback remains in local harness: ${forbidden}`);
  }
}
for (const required of [
  "Standalone remote database proof is disabled",
  "exact-identity trusted live controller",
]) {
  if (!directProofSource.includes(required)) {
    throw new Error(`Retired remote proof boundary is missing: ${required}`);
  }
}
for (const forbidden of ["GENIE_REMOTE_DATABASE_URL", "postgres", "sql.unsafe"]) {
  if (directProofSource.includes(forbidden)) {
    throw new Error(`Retired remote proof still accepts execution input: ${forbidden}`);
  }
}
const retiredProof = spawnSync(
  process.execPath,
  [fileURLToPath(new URL("./run-remote-database-proof.mjs", import.meta.url))],
  { encoding: "utf8", env: {} },
);
if (
  retiredProof.status === 0 ||
  !retiredProof.stderr.includes("Standalone remote database proof is disabled")
) {
  throw new Error("Retired remote proof did not fail closed when executed.");
}

console.log("PASS local database and managed-proof isolation negative controls");

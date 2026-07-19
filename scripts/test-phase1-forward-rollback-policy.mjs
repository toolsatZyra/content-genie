import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildForwardRollbackSteps,
  operatingSystemEnvironment,
  runForwardRollbackQuery,
  validateForwardRollbackTarget,
} from "./run-phase1-forward-rollback-drill.mjs";
import {
  isTransientCliFailureOutput,
  isTransientDatabaseFailureOutput,
  isTransientManagementStatus,
  isTransientReadinessStatus,
  isTransientTransportError,
} from "./transient-failure-policy.mjs";

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
for (const required of [
  /create table if not exists/i,
  /add column if not exists candidate_marker/i,
  /add column if not exists compensated_at/i,
  /where not \('candidate' = any\(forward_history\)\)/i,
  /where not \('compensating' = any\(forward_history\)\)/i,
]) {
  if (!required.test(sql)) {
    throw new Error(`Forward-rollback retry idempotence is missing: ${required}`);
  }
}
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
      mode: "remote",
      productionProjectRef: "same-ref",
    },
    {},
  ],
  [
    {
      branchRef: "branch-ref",
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

const branchRef = "abcdefghijklmnopqrst";
const productionRef = "zyxwvutsrqponmlkjihg";
const pgpassDirectory = mkdtempSync(join(tmpdir(), "genie-pgpass-policy-"));
const pgpassFile = join(pgpassDirectory, ".pgpass");
writeFileSync(
  pgpassFile,
  `pooler.supabase.com:5432:postgres:postgres.${branchRef}:secret\n`,
  { encoding: "utf8", mode: 0o600 },
);
const remoteTarget = {
  branchRef,
  mode: "remote",
  productionProjectRef: productionRef,
};
const remoteEnvironment = {
  GENIE_EPHEMERAL_DB_TARGET: `postgresql://postgres.${branchRef}@pooler.supabase.com:5432/postgres?sslmode=require`,
  GENIE_EPHEMERAL_DB_IDENTITY_VERIFIED: branchRef,
  PATH: "test-path",
  PGPASSFILE: pgpassFile,
};
validateForwardRollbackTarget(remoteTarget, remoteEnvironment);
for (const unsafeEnvironment of [
  {
    ...remoteEnvironment,
    GENIE_EPHEMERAL_DB_TARGET: `postgresql://postgres.${branchRef}:secret@pooler.supabase.com:5432/postgres?sslmode=require`,
  },
  {
    ...remoteEnvironment,
    GENIE_EPHEMERAL_DB_TARGET: `postgresql://postgres.${branchRef}@pooler.supabase.com:5432/postgres?sslmode=disable`,
  },
  {
    ...remoteEnvironment,
    GENIE_EPHEMERAL_DB_TARGET: `postgresql://postgres.${branchRef}@pooler.supabase.com:5432/postgres?sslmode=require&password=secret`,
  },
  { ...remoteEnvironment, PGPASSFILE: join(pgpassDirectory, "missing") },
]) {
  assert.throws(() => validateForwardRollbackTarget(remoteTarget, unsafeEnvironment));
}

assert.deepEqual(
  operatingSystemEnvironment({
    NODE_EXTRA_CA_CERTS: "ca.pem",
    PATH: "test-path",
    SUPABASE_ACCESS_TOKEN: "must-not-enter-child",
    SUPABASE_DB_URL: "must-not-enter-child",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-enter-child",
  }),
  { NODE_EXTRA_CA_CERTS: "ca.pem", PATH: "test-path" },
);

for (const deterministicOutput of [
  "ERROR: syntax error at or near probe",
  'ERROR: unrecognized configuration parameter "statement_timeout_policy"',
  'ERROR: relation "private.dns_cache" does not exist',
  'ERROR: relation "private.EAI_AGAIN" does not exist',
  'ERROR: relation "private.ECONNRESET" does not exist',
  'could not translate host name "dns.invalid" to address: Name or service not known',
  "ERROR: connection reset by peer (SQLSTATE P0001)",
  "TypeError: fetch failed",
]) {
  let deterministicAttempts = 0;
  let deterministicRejected = false;
  try {
    runForwardRollbackQuery(
      remoteTarget,
      { label: "deterministic probe" },
      "probe.sql",
      {
        emit: () => {},
        environment: remoteEnvironment,
        pause: () => {
          throw new Error("A deterministic database failure must not be retried.");
        },
        spawn: (command, args, options) => {
          deterministicAttempts += 1;
          assert.equal(command, process.execPath);
          assert.match(args[0], /node_modules[\\/]supabase[\\/]dist[\\/]supabase\.js$/);
          assert.deepEqual(args.slice(1, 3), ["db", "query"]);
          assert.equal(options.shell, false);
          assert.notEqual(options.env, process.env);
          assert.equal(args.includes("secret"), false);
          assert.equal(
            args.some((argument) => argument.includes("secret@")),
            false,
          );
          assert.deepEqual(
            args.slice(args.indexOf("--db-url"), args.indexOf("--db-url") + 2),
            ["--db-url", remoteEnvironment.GENIE_EPHEMERAL_DB_TARGET],
          );
          assert.equal(options.env.PGPASSFILE, pgpassFile);
          assert.equal(options.env.GENIE_EPHEMERAL_DB_TARGET, undefined);
          for (const forbidden of [
            "SUPABASE_ACCESS_TOKEN",
            "SUPABASE_DB_URL",
            "SUPABASE_PROJECT_REF",
            "SUPABASE_SERVICE_ROLE_KEY",
          ]) {
            assert.equal(options.env[forbidden], undefined);
          }
          return { status: 1, stderr: deterministicOutput, stdout: "" };
        },
      },
    );
  } catch {
    deterministicRejected = true;
  }
  if (!deterministicRejected || deterministicAttempts !== 1) {
    throw new Error(
      `Deterministic forward-rollback failure was retried: ${deterministicOutput}`,
    );
  }
  if (isTransientDatabaseFailureOutput(deterministicOutput)) {
    throw new Error(
      `Broad retry classifier accepted deterministic text: ${deterministicOutput}`,
    );
  }
}

for (const transientOutput of [
  "connection reset by peer",
  "connect ECONNREFUSED 127.0.0.1:5432",
  "failed to connect to postgres: effect/sql/SqlError: PgClient: Connection timed out",
  "getaddrinfo EAI_AGAIN db.example.test",
  "the database system is starting up",
  "ERROR: cannot connect now (SQLSTATE 57P03)",
]) {
  let transientAttempts = 0;
  runForwardRollbackQuery(remoteTarget, { label: "transient probe" }, "probe.sql", {
    emit: () => {},
    environment: remoteEnvironment,
    pause: () => {},
    spawn: () => {
      transientAttempts += 1;
      return transientAttempts === 1
        ? { status: 1, stderr: transientOutput, stdout: "" }
        : { status: 0, stderr: "", stdout: "" };
    },
  });
  if (transientAttempts !== 2) {
    throw new Error(`Transient failure did not receive one retry: ${transientOutput}`);
  }
}

assert.equal(isTransientTransportError(new TypeError("fetch failed")), false);
assert.equal(
  isTransientTransportError(
    Object.assign(new TypeError("fetch failed"), { cause: { code: "EAI_AGAIN" } }),
  ),
  true,
);
assert.equal(
  isTransientTransportError(
    Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
  ),
  true,
);
assert.equal(isTransientManagementStatus(401), false);
assert.equal(isTransientManagementStatus(503), true);
assert.equal(
  isTransientCliFailureOutput("Supabase API returned HTTP status 503"),
  true,
);
assert.equal(
  isTransientCliFailureOutput("Supabase API returned HTTP status 401"),
  false,
);
assert.equal(isTransientCliFailureOutput("failed to get branch: TransportError"), true);
assert.equal(isTransientCliFailureOutput("unrelated TransportError"), false);
assert.equal(
  isTransientCliFailureOutput(
    "Timeout while shutting down PostHog. Some events may not have been sent.",
  ),
  true,
);
for (const deterministicWithTransientNoise of [
  "ERROR: domain invariant failed (SQLSTATE P0001)\nTimeout while shutting down PostHog. Some events may not have been sent.",
  "ERROR: domain invariant failed (SQLSTATE P0001)\nSupabase API returned HTTP status 503",
]) {
  assert.equal(isTransientCliFailureOutput(deterministicWithTransientNoise), false);
}
assert.equal(isTransientReadinessStatus(404), true);
assert.equal(isTransientReadinessStatus(403), false);

rmSync(pgpassDirectory, { force: true, recursive: true });

console.log("PASS Phase 1 forward-rollback drill policy and negative controls");

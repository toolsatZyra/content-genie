import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isTransientDatabaseFailureOutput } from "./transient-failure-policy.mjs";

const node = process.execPath;
const supabaseCli = resolve("node_modules", "supabase", "dist", "supabase.js");

const inheritedRuntimeEnvironment = new Set([
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "OS",
  "PATH",
  "PATHEXT",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
]);

export function operatingSystemEnvironment(source) {
  return Object.fromEntries(
    Object.entries(source).filter(
      ([name, value]) =>
        value !== undefined && inheritedRuntimeEnvironment.has(name.toUpperCase()),
    ),
  );
}

export function buildForwardRollbackSteps(probeName) {
  if (!/^[a-z][a-z0-9_]+$/.test(probeName)) {
    throw new Error("Forward-rollback probe name must be a safe SQL identifier.");
  }
  const table = `private.${probeName}`;
  return [
    {
      label: "baseline forward migration",
      sql: `
        do $drill$
        begin
          execute $statement$
            create table if not exists ${table} (
              id boolean primary key default true check (id),
              contract_state text not null,
              stable_payload text not null,
              compensation_version integer not null default 0,
              forward_history text[] not null default array['baseline']::text[]
            )
          $statement$;
          execute $statement$
            insert into ${table} (contract_state, stable_payload)
            values ('baseline', 'stable')
            on conflict (id) do nothing
          $statement$;
        end
        $drill$;
      `,
    },
    {
      label: "candidate forward migration",
      sql: `
        do $drill$
        begin
          execute $statement$
            alter table ${table} add column if not exists candidate_marker text
          $statement$;
          execute $statement$
            update ${table}
            set contract_state = 'candidate',
                stable_payload = 'candidate-value',
                candidate_marker = 'candidate-applied',
                forward_history = forward_history || 'candidate'::text
            where not ('candidate' = any(forward_history))
          $statement$;
        end
        $drill$;
      `,
    },
    {
      label: "compensating forward migration",
      sql: `
        do $drill$
        begin
          execute $statement$
            alter table ${table} add column if not exists compensated_at timestamptz
          $statement$;
          execute $statement$
            update ${table}
            set contract_state = 'baseline',
                stable_payload = 'stable',
                candidate_marker = null,
                compensation_version = 1,
                compensated_at = statement_timestamp(),
                forward_history = forward_history || 'compensating'::text
            where not ('compensating' = any(forward_history))
          $statement$;
        end
        $drill$;
      `,
    },
    {
      label: "forward-rollback contract assertion",
      sql: `
        do $drill$
        declare
          probe ${table}%rowtype;
        begin
          select * into strict probe from ${table} where id;
          if probe.contract_state <> 'baseline'
            or probe.stable_payload <> 'stable'
            or probe.candidate_marker is not null
            or probe.compensation_version <> 1
            or probe.compensated_at is null
            or probe.forward_history <> array['baseline', 'candidate', 'compensating']::text[]
          then
            raise exception 'forward-rollback compensation did not restore the stable contract';
          end if;
        end
        $drill$;
      `,
    },
  ];
}

export function validateForwardRollbackTarget(target, environment = process.env) {
  if (target.mode === "local") {
    if (environment.GENIE_DATABASE_HARNESS_ACTIVE !== "1") {
      throw new Error(
        "Local forward-rollback drill requires the isolated database harness sentinel.",
      );
    }
    return;
  }
  if (!target.branchRef || !target.productionProjectRef) {
    throw new Error(
      "Remote forward-rollback drill requires branch and production refs.",
    );
  }
  if (target.branchRef === target.productionProjectRef) {
    throw new Error("Forward-rollback drill refuses a production-equal project ref.");
  }
  if (environment.GENIE_EPHEMERAL_DB_IDENTITY_VERIFIED !== target.branchRef) {
    throw new Error("Forward-rollback drill requires the parent identity proof.");
  }
  if (!environment.PGPASSFILE || !existsSync(environment.PGPASSFILE)) {
    throw new Error(
      "Forward-rollback drill requires an isolated PostgreSQL password file.",
    );
  }
  const databaseTarget = new URL(environment.GENIE_EPHEMERAL_DB_TARGET ?? "");
  if (
    (databaseTarget.protocol !== "postgres:" &&
      databaseTarget.protocol !== "postgresql:") ||
    !databaseTarget.username ||
    databaseTarget.password ||
    !databaseTarget.hostname ||
    databaseTarget.pathname === "/" ||
    !["require", "verify-ca", "verify-full"].includes(
      databaseTarget.searchParams.get("sslmode"),
    ) ||
    [...databaseTarget.searchParams.keys()].some((key) => key !== "sslmode") ||
    !environment.GENIE_EPHEMERAL_DB_TARGET.includes(target.branchRef)
  ) {
    throw new Error("Forward-rollback drill requires a passwordless branch target.");
  }
}

function parseArguments(argv) {
  if (argv.includes("--local")) return { mode: "local" };
  const value = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1]?.trim() : undefined;
  };
  return {
    branchRef: value("--branch-ref"),
    mode: "remote",
    productionProjectRef: value("--production-project-ref"),
  };
}

export function runForwardRollbackQuery(
  target,
  step,
  sqlPath,
  {
    emit = (result) => {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    },
    pause = (milliseconds) =>
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds),
    environment = process.env,
    spawn = spawnSync,
  } = {},
) {
  const targetArguments =
    target.mode === "local"
      ? ["--local"]
      : ["--db-url", environment.GENIE_EPHEMERAL_DB_TARGET];
  const maximumAttempts = target.mode === "remote" ? 3 : 1;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const result = spawn(
      node,
      [supabaseCli, "db", "query", ...targetArguments, "--file", sqlPath],
      {
        encoding: "utf8",
        env:
          target.mode === "local"
            ? operatingSystemEnvironment(environment)
            : {
                ...operatingSystemEnvironment(environment),
                PGPASSFILE: environment.PGPASSFILE,
              },
        shell: false,
        stdio: "pipe",
      },
    );
    if (result.error) throw result.error;
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0) {
      emit(result);
      return;
    }
    const transient = isTransientDatabaseFailureOutput(output);
    if (!transient || attempt === maximumAttempts) {
      emit(result);
      throw new Error(
        `${step.label} failed after ${attempt} attempt(s) (${transient ? "transient retry budget exhausted" : "non-transient database failure"}).`,
      );
    }
    pause(2_000);
  }
}

export function runForwardRollbackDrill(target) {
  validateForwardRollbackTarget(target);
  const probeName = `phase1_forward_rollback_${randomUUID().replaceAll("-", "")}`;
  const tempDirectory = mkdtempSync(join(tmpdir(), "genie-forward-rollback-"));
  try {
    for (const [index, step] of buildForwardRollbackSteps(probeName).entries()) {
      const sqlPath = join(tempDirectory, `${index + 1}.sql`);
      writeFileSync(sqlPath, step.sql, { encoding: "utf8", mode: 0o600 });
      runForwardRollbackQuery(target, step, sqlPath);
    }
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
  console.log(
    JSON.stringify({
      forwardMigrations: ["baseline", "candidate", "compensating"],
      outcome: "passed",
      target: target.mode === "local" ? "isolated-local" : "disposable-branch",
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runForwardRollbackDrill(parseArguments(process.argv.slice(2)));
}

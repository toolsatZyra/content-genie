import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

export const PHASE2_CANDIDATE_MIGRATION_INVENTORY_PATH =
  "scripts/phase2-candidate-migrations.v1.json";

const migrationPathPattern = /^supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql$/u;
const phase2MigrationPathPattern =
  /^supabase\/migrations\/\d{14}_phase2_[a-z0-9_]+\.sql$/u;

function exactKeys(value, keys) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

export function candidateMigrationVersion(path) {
  const match = migrationPathPattern.exec(path);
  assert.ok(match, `Invalid candidate migration path: ${path}`);
  return match[1];
}

export async function loadPhase2CandidateMigrationInventory(workspace = resolve(".")) {
  const inventoryPath = resolve(workspace, PHASE2_CANDIDATE_MIGRATION_INVENTORY_PATH);
  const inventory = JSON.parse(await readFile(inventoryPath, "utf8"));
  assert.ok(
    exactKeys(inventory, ["migrations", "schemaVersion"]),
    "Candidate migration inventory has an open schema.",
  );
  assert.equal(
    inventory.schemaVersion,
    "genie-phase2-candidate-migrations.v1",
    "Candidate migration inventory schema drifted.",
  );
  assert.ok(
    Array.isArray(inventory.migrations) && inventory.migrations.length > 0,
    "Candidate migration inventory is empty.",
  );

  const migrations = inventory.migrations.map((path) => {
    assert.equal(typeof path, "string", "Candidate migration path must be a string.");
    candidateMigrationVersion(path);
    return path;
  });
  assert.deepEqual(
    migrations,
    [...migrations].sort(),
    "Candidate migration inventory is not in exact filename order.",
  );
  assert.equal(
    new Set(migrations).size,
    migrations.length,
    "Candidate migration inventory contains duplicate paths.",
  );
  assert.equal(
    new Set(migrations.map(candidateMigrationVersion)).size,
    migrations.length,
    "Candidate migration inventory contains duplicate versions.",
  );

  for (const path of migrations) {
    const stat = await lstat(resolve(workspace, path));
    assert.ok(
      stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
      `Candidate migration is not one regular file: ${path}`,
    );
  }

  const discoveredPhase2Migrations = (
    await readdir(resolve(workspace, "supabase/migrations"))
  )
    .filter((name) => /^\d{14}_phase2_[a-z0-9_]+\.sql$/u.test(name))
    .map((name) => `supabase/migrations/${name}`)
    .sort();
  assert.deepEqual(
    migrations.filter((path) => phase2MigrationPathPattern.test(path)),
    discoveredPhase2Migrations,
    "Candidate migration inventory does not contain the exact Phase 2 migration set.",
  );

  return Object.freeze(migrations);
}

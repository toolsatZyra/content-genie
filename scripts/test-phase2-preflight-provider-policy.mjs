import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  analyzePreflightProviderMigrations,
  analyzePreflightProviderPgTap,
  selectPreflightProviderMigrations,
} from "./phase2-preflight-provider-policy.mjs";

const directory = join(process.cwd(), "supabase", "migrations");
const sources = selectPreflightProviderMigrations(
  readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort(),
).map((file) => ({ file, sql: readFileSync(join(directory, file), "utf8") }));

assert.deepEqual(analyzePreflightProviderMigrations(sources).errors, []);
const pgTap = readFileSync(
  join(process.cwd(), "supabase", "tests", "phase2_preflight_provider_ingest.test.sql"),
  "utf8",
);
assert.deepEqual(analyzePreflightProviderPgTap(pgTap).errors, []);

const mutate = (needle, replacement) => {
  let changed = false;
  const mutated = sources.map((source) => {
    if (changed || !source.sql.includes(needle)) return source;
    changed = true;
    return { ...source, sql: source.sql.replace(needle, replacement) };
  });
  assert.ok(changed, `mutation target is absent: ${needle}`);
  return mutated;
};

for (const [index, mutation] of [
  mutate("alter table public.assets force row level security;", ""),
  mutate("create policy assets_member_select", "create view assets_member_select"),
  mutate(
    "security definer\nset search_path = ''",
    "security definer\nset search_path = 'public'",
  ),
  mutate("maximum_cost_minor = 0", "maximum_cost_minor <= 5000"),
  mutate(
    "exact_amount := ceil(new.quantity * capability.unit_price_minor)::bigint",
    "exact_amount := 0",
  ),
  mutate("account.workspace_id <> quote.workspace_id", "false"),
  mutate(
    "create unique index provider_request_one_retry_child_uq",
    "create index provider_request_one_retry_child_uq",
  ),
  mutate(
    "create or replace function private.broker_key_is_usable(",
    "create or replace function private.broker_key_is_disabled(",
  ),
  mutate("v.environment = p_environment", "v.environment <> p_environment"),
  mutate("o.user_metadata ->> 'sha256' = new.content_sha256", "true"),
  mutate(
    "create index provider_requests_attempt_fk_idx",
    "create view provider_requests_attempt_fk_idx",
  ),
  mutate("provider output fetch evidence changed", "provider output fetch accepted"),
  mutate("provider_output_candidate_id uuid", "provider_output_candidate_id text"),
  mutate("asset media kind binding is invalid", "asset media kind accepted"),
  mutate("control assertion replayed", "control assertion accepted"),
  mutate("world extraction replay differs", "world extraction replay accepted"),
  mutate(
    "expected_width is null or expected_width between 1 and 32768",
    "expected_width between 1 and 32768",
  ),
].entries()) {
  assert.ok(
    analyzePreflightProviderMigrations(mutation).errors.length > 0,
    `preflight/provider mutation ${index} must be rejected`,
  );
}

assert.ok(analyzePreflightProviderMigrations([...sources].reverse()).errors.length > 0);
assert.ok(analyzePreflightProviderMigrations(sources.slice(1)).errors.length > 0);
assert.ok(
  analyzePreflightProviderMigrations(
    sources.map((source) =>
      source.file.endsWith("phase2_preflight_provider_ingest_hardening.sql")
        ? {
            ...source,
            sql: `${source.sql}\ncreate or replace function public.command_create_micro_quote() returns void language sql as $$ select $$;`,
          }
        : source,
    ),
  ).errors.some((error) => error.includes("rewritten")),
);
assert.ok(
  analyzePreflightProviderPgTap(pgTap.replace("select plan(100);", "select plan(99);"))
    .errors.length > 0,
);

console.log("PASS Phase 2 preflight/provider policy negative controls");

const expectedMigrationSuffixes = [
  "phase1_extensions_schemas.sql",
  "phase1_identity_workspace.sql",
  "phase1_series_episode.sql",
  "phase1_commands_events.sql",
  "phase1_work_notifications.sql",
  "phase1_diagnostics_audit.sql",
  "phase1_rls_grants_indexes.sql",
  "phase1_storage_policies.sql",
  "phase1_diagnostic_ingest.sql",
];

const collect = (pattern, value) =>
  [...value.matchAll(pattern)].map((match) => match[1]);

export function analyzePhase1Migrations(sources) {
  const errors = [];
  const filenames = sources.map(({ file }) => file);
  const sql = sources.map(({ sql: value }) => value).join("\n");
  const normalized = sql.replaceAll(/\s+/g, " ");

  if (
    filenames.length !== expectedMigrationSuffixes.length ||
    expectedMigrationSuffixes.some(
      (suffix, index) => !filenames[index]?.endsWith(suffix),
    )
  ) {
    errors.push("the ordered Phase 1 migration set is incomplete or reordered");
  }

  const publicTables = [
    ...new Set(collect(/create table public\.([a-z0-9_]+)/g, sql)),
  ].sort();
  if (publicTables.length === 0) errors.push("no public tables were discovered");

  for (const table of publicTables) {
    if (
      !normalized.includes(`alter table public.${table} enable row level security;`)
    ) {
      errors.push(`public.${table} does not enable RLS`);
    }
    if (
      !new RegExp(`create policy [a-z0-9_]+ on public\\.${table}\\b`).test(normalized)
    ) {
      errors.push(`public.${table} has no explicit RLS policy`);
    }
  }

  const selectGrant = normalized.match(/grant select on (.+?) to authenticated;/)?.[1];
  for (const table of publicTables) {
    if (!selectGrant?.includes(`public.${table}`)) {
      errors.push(`public.${table} lacks an explicit authenticated select grant`);
    }
  }

  for (const required of [
    "revoke all on all tables in schema public from anon, authenticated;",
    "revoke all on all tables in schema private from public, anon, authenticated;",
    "revoke all on all tables in schema audit from public, anon, authenticated;",
    "revoke all on all functions in schema public from public, anon, authenticated;",
    "grant usage on schema private to authenticated;",
  ]) {
    if (!normalized.includes(required)) errors.push(`missing boundary: ${required}`);
  }

  for (const functionChunk of sql.split(/create or replace function /i).slice(1)) {
    if (
      /\bsecurity definer\b/i.test(functionChunk) &&
      !/\bset search_path = ''/i.test(functionChunk.split(/\$\$;/, 1)[0] ?? "")
    ) {
      const name = functionChunk.match(/^([a-z0-9_.]+)/i)?.[1] ?? "unknown";
      errors.push(`SECURITY DEFINER ${name} lacks an empty search_path`);
    }
  }

  for (const forbidden of [
    "raw_user_meta_data",
    "using (true)",
    "with check (true)",
    "to anon",
  ]) {
    if (normalized.toLowerCase().includes(forbidden)) {
      errors.push(`forbidden authorization pattern: ${forbidden}`);
    }
  }

  for (const required of [
    "foreign key (workspace_id, active_release_id, id)",
    "foreign key (workspace_id, pinned_series_release_id, series_id)",
    "foreign key (workspace_id, pinned_continuity_version_id, series_id)",
    "foreign key (workspace_id, episode_id, series_id)",
    "private.is_current_session_allowed",
    "pg_advisory_xact_lock",
    "work_leases_one_active_uq",
    "command_receipts_workspace_actor_idx",
    "audit_events_immutable",
    "workspace_private_member_select",
    "workspace-private",
    "workspace-exports",
    "record_client_diagnostic",
    "to service_role",
  ]) {
    if (!normalized.includes(required)) {
      errors.push(`missing Phase 1 invariant: ${required}`);
    }
  }

  return { errors, publicTables };
}

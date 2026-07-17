import assert from "node:assert/strict";

import { analyzePhase1Migrations } from "./rls-policy.mjs";

const filenames = [
  "0001_phase1_extensions_schemas.sql",
  "0002_phase1_identity_workspace.sql",
  "0003_phase1_series_episode.sql",
  "0004_phase1_commands_events.sql",
  "0005_phase1_work_notifications.sql",
  "0006_phase1_diagnostics_audit.sql",
  "0007_phase1_rls_grants_indexes.sql",
  "0008_phase1_storage_policies.sql",
  "0009_phase1_diagnostic_ingest.sql",
  "0010_phase1_adversarial_corrections.sql",
  "0011_phase1_realtime_event_publication.sql",
];
const fixture = `
create table public.sample (id uuid);
alter table public.sample enable row level security;
create policy sample_select on public.sample for select to authenticated using (id is not null);
revoke all on all tables in schema public from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all tables in schema audit from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema private to authenticated;
grant select on public.sample to authenticated;
create or replace function private.safe() returns boolean language sql security definer set search_path = '' as $$ select true $$;
select 'foreign key (workspace_id, active_release_id, id)';
select 'foreign key (workspace_id, pinned_series_release_id, series_id)';
select 'foreign key (workspace_id, pinned_continuity_version_id, series_id)';
select 'foreign key (workspace_id, episode_id, series_id)';
select 'private.is_current_session_allowed';
select 'pg_advisory_xact_lock';
select 'work_leases_one_active_uq';
select 'command_receipts_workspace_actor_idx';
select 'audit_events_immutable';
select 'workspace_private_member_select';
select 'workspace-private';
select 'workspace-exports';
select 'record_client_diagnostic';
select 'to service_role';
select 'memberships_deactivation_guard';
select 'invitations_reject_active_member';
select 'alter publication supabase_realtime add table public.domain_events';
`;
const source = filenames.map((file, index) => ({
  file,
  sql: index === 6 ? fixture : "-- migration",
}));

assert.deepEqual(analyzePhase1Migrations(source).errors, []);

for (const mutation of [
  fixture.replace("alter table public.sample enable row level security;", ""),
  fixture.replace(
    "create policy sample_select on public.sample for select to authenticated using (id is not null);",
    "",
  ),
  fixture.replace("grant select on public.sample to authenticated;", ""),
  fixture.replace("set search_path = ''", ""),
  `${fixture}\nselect 'raw_user_meta_data';`,
  `${fixture}\ncreate policy bad on public.sample to anon using (id is not null);`,
]) {
  const mutated = source.map((item, index) => ({
    ...item,
    sql: index === 6 ? mutation : item.sql,
  }));
  assert.ok(analyzePhase1Migrations(mutated).errors.length > 0);
}

console.log("PASS Phase 1 RLS policy positive and negative-control mutations");

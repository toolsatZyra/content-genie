export const expectedMigrationSuffixes = [
  "phase2_scripts_and_sidecars.sql",
  "phase2_script_coordinate_hardening.sql",
  "phase2_looks_voices_and_config.sql",
  "phase2_0011_look_seed_01.sql",
  "phase2_0011_look_seed_02.sql",
  "phase2_0011_look_seed_03.sql",
  "phase2_0011_look_seed_04.sql",
  "phase2_0011_look_pack_provenance_correction.sql",
  "phase2_voice_canary_fail_closed.sql",
  "phase2_script_coordinate_v2_forward.sql",
  "phase2_look_policy_baselines.sql",
  "phase2_live_broker_control_plane.sql",
  "phase2_episode_release_eligibility.sql",
  "phase2_checkpoint_adversarial_hardening.sql",
  "phase2_release_creative_identity_truth.sql",
  "phase2_uploaded_script_and_rubric_foundation.sql",
  "phase2_script_rubric_foundation.sql",
  "phase2_script_rubric_fk_index.sql",
];

const expectedTables = [
  "episode_configuration_candidates",
  "look_packs",
  "look_version_availability",
  "look_versions",
  "script_annotations",
  "script_lock_events",
  "script_revisions",
  "script_rubric_runs",
  "voice_version_availability",
  "voice_versions",
];

export function analyzePhase2PgTapSource(source) {
  const errors = [];
  if (/\bas\s+offset\s*\(/iu.test(source)) {
    errors.push("the Phase 2 pgTAP source uses reserved OFFSET as a table alias");
  }
  const serviceRoleSwitches =
    source.match(/set\s+local\s+role\s+service_role\s*;/giu) ?? [];
  const guardedServiceRoleSwitches =
    source.match(
      /select\s+set_config\s*\(\s*'request\.jwt\.claim\.role'\s*,\s*'service_role'\s*,\s*true\s*\)\s*;\s*set\s+local\s+role\s+service_role\s*;/giu,
    ) ?? [];
  if (serviceRoleSwitches.length !== guardedServiceRoleSwitches.length) {
    errors.push(
      "every Phase 2 pgTAP service-role switch must set auth.role() authority explicitly",
    );
  }
  return { errors };
}

export function analyzePhase2Migrations(sources) {
  const errors = [];
  const filenames = sources.map(({ file }) => file);
  const sql = sources.map(({ sql: value }) => value).join("\n");
  const normalized = sql.replaceAll(/\s+/g, " ");
  const scriptCoordinateMigrations = sources.filter(
    ({ file }) =>
      file.endsWith("phase2_scripts_and_sidecars.sql") ||
      file.endsWith("phase2_script_coordinate_hardening.sql") ||
      file.endsWith("phase2_script_coordinate_v2_forward.sql"),
  );
  const scriptCoordinateHardeningMigrations = sources.filter(
    ({ file }) =>
      file.endsWith("phase2_script_coordinate_hardening.sql") ||
      file.endsWith("phase2_script_coordinate_v2_forward.sql"),
  );

  if (
    filenames.length !== expectedMigrationSuffixes.length ||
    expectedMigrationSuffixes.some(
      (suffix, index) => !filenames[index]?.endsWith(suffix),
    )
  ) {
    errors.push("the ordered Phase 2 zero-spend migration set is incomplete");
  }

  const terminalCheckpointMigration = sources.find(({ file }) =>
    file.endsWith("phase2_checkpoint_adversarial_hardening.sql"),
  );
  const terminalCheckpointNormalized = terminalCheckpointMigration?.sql.replaceAll(
    /\s+/g,
    " ",
  );
  for (const required of [
    "add column narrator_gender public.narrator_gender not null default 'male'",
    "add column voice_version_id uuid not null default 'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f'",
    "add constraint series_releases_voice_identity_fk foreign key (voice_version_id, narrator_gender) references public.voice_versions(id, gender) on delete restrict;",
    "create or replace function private.guard_episode_pinned_voice()",
    "and availability.status <> 'withdrawn' where release.id = new.pinned_series_release_id",
    "create trigger episodes_pinned_voice_guard before insert or update of pinned_series_release_id, workspace_id, series_id",
    "create or replace function private.create_configuration_for_script_revision()",
    "series_row.active_release_id = release.id",
    "release_status.status = 'active'",
    "look_availability.status = 'active'",
    "voice_availability.status <> 'withdrawn'",
    "release.series_id = inherited_series_id",
    "create or replace function private.guard_configuration_creative_mutation()",
    "episode_state <> 'world_setup'",
    "create trigger episode_configuration_creative_mutation_guard before update of narrator_gender, voice_version_id, voice_confirmed_by, voice_confirmed_at, look_version_id, look_confirmed_by, look_confirmed_at",
  ]) {
    if (!terminalCheckpointNormalized?.includes(required)) {
      errors.push(`terminal checkpoint hardening migration is missing: ${required}`);
    }
  }

  const creativeIdentityTruthMigration = sources.find(({ file }) =>
    file.endsWith("phase2_release_creative_identity_truth.sql"),
  );
  const creativeIdentityTruthNormalized =
    creativeIdentityTruthMigration?.sql.replaceAll(/\s+/g, " ");
  for (const required of [
    "add column creative_identity_schema_version smallint not null default 0",
    "alter column narrator_gender drop not null",
    "alter column voice_version_id drop not null",
    "set narrator_gender = null, voice_version_id = null where creative_identity_schema_version = 0",
    "alter column creative_identity_schema_version set default 1",
    "creative_identity_schema_version = 1 and look_version_id is not null and narrator_gender is not null and voice_version_id is not null",
    "create or replace function private.guard_series_release_creative_identity()",
    "create trigger series_release_creative_identity_guard before insert or update of creative_identity_schema_version, look_version_id, narrator_gender, voice_version_id",
    "release.creative_identity_schema_version = 1",
    "active Series release creative identity is unavailable",
  ]) {
    if (!creativeIdentityTruthNormalized?.includes(required)) {
      errors.push(`creative identity truth migration is missing: ${required}`);
    }
  }

  const actualTables = [
    ...new Set(
      [...sql.matchAll(/create table public\.([a-z0-9_]+)/g)].map((match) => match[1]),
    ),
  ].sort();
  if (
    actualTables.length !== expectedTables.length ||
    actualTables.some((table, index) => table !== expectedTables[index])
  ) {
    errors.push("the Phase 2 zero-spend public table inventory changed");
  }

  for (const table of expectedTables) {
    for (const required of [
      `alter table public.${table} enable row level security;`,
      `alter table public.${table} force row level security;`,
      `revoke all on table public.${table} from public, anon, authenticated;`,
      `grant select on table public.${table} to authenticated;`,
    ]) {
      if (!normalized.includes(required)) {
        errors.push(`public.${table} is missing boundary: ${required}`);
      }
    }
    if (
      !new RegExp(`create policy [a-z0-9_]+ on public\\.${table}\\b`).test(normalized)
    ) {
      errors.push(`public.${table} has no explicit RLS policy`);
    }
  }

  const expectedReadPolicies = new Map([
    [
      "script_revisions",
      "create policy script_revisions_read_active_workspace on public.script_revisions for select to authenticated using (private.is_current_session_allowed(workspace_id));",
    ],
    [
      "script_lock_events",
      "create policy script_lock_events_read_active_workspace on public.script_lock_events for select to authenticated using (private.is_current_session_allowed(workspace_id));",
    ],
    [
      "script_annotations",
      "create policy script_annotations_read_active_workspace on public.script_annotations for select to authenticated using (private.is_current_session_allowed(workspace_id));",
    ],
    [
      "script_rubric_runs",
      "create policy script_rubric_runs_read_active_workspace on public.script_rubric_runs for select to authenticated using (private.is_current_session_allowed(workspace_id));",
    ],
    [
      "voice_versions",
      "create policy voice_versions_read_active_member on public.voice_versions for select to authenticated using (private.has_current_active_membership());",
    ],
    [
      "voice_version_availability",
      "create policy voice_version_availability_read_active_member on public.voice_version_availability for select to authenticated using (private.has_current_active_membership());",
    ],
    [
      "look_versions",
      "create policy look_versions_read_active_member on public.look_versions for select to authenticated using (private.has_current_active_membership());",
    ],
    [
      "look_version_availability",
      "create policy look_version_availability_read_active_member on public.look_version_availability for select to authenticated using (private.has_current_active_membership());",
    ],
    [
      "look_packs",
      "create policy look_packs_read_active_member on public.look_packs for select to authenticated using (private.has_current_active_membership());",
    ],
    [
      "episode_configuration_candidates",
      "create policy episode_configuration_read_active_workspace on public.episode_configuration_candidates for select to authenticated using (private.is_current_session_allowed(workspace_id));",
    ],
  ]);
  for (const [table, policy] of expectedReadPolicies) {
    if (!normalized.includes(policy)) {
      errors.push(`public.${table} has a weakened or unexpected RLS predicate`);
    }
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

  for (const command of [
    "attest_script_coordinate_map",
    "revoke_script_coordinate_attestation",
    "command_lock_episode_script",
    "command_lock_episode_script_v2",
    "command_record_script_rubric_run",
    "command_select_episode_voice",
    "command_select_episode_look",
    "command_set_voice_version_availability",
    "command_withdraw_voice_version",
    "command_withdraw_look_version",
    "command_create_episode",
    "command_claim_live_broker_request",
    "command_record_live_broker_created",
    "command_record_live_broker_state",
    "command_reconcile_live_broker_cancellation",
    "get_live_broker_lifecycle",
  ]) {
    if (
      !normalized.includes(`revoke all on function public.${command}(`) ||
      !normalized.includes(`grant execute on function public.${command}(`)
    ) {
      errors.push(`${command} lacks an explicit revoke-then-grant boundary`);
    }
  }

  for (const required of [
    "script_revisions_immutable",
    "script_lock_events_immutable",
    "script_annotations_immutable",
    "verify_script_coordinate_map_envelope",
    "script_coordinate_attestations",
    "script_coordinate_attestations_request_idx",
    "create index script_coordinate_attestations_request_idx",
    "verify_text_coordinate_index",
    "verify_nonnegative_integer_tuple",
    "revoke_script_coordinate_attestation",
    "invalid script attestation identity",
    "insert into private.script_coordinate_attestations ( id, workspace_id",
    "values ( p_attestation_id, p_workspace_id",
    "trusted coordinate-map attestation required",
    "coordinate_map_verifier",
    "script_size_policy_version",
    "script_revisions_insert_size_policy",
    "enforce_script_revision_insert_size_policy",
    "script_revision_creates_configuration",
    "script_lock_events_workspace_episode_idx",
    "script_lock_events_workspace_episode_script_idx",
    "script_annotations_workspace_episode_script_idx",
    "look_versions_pack_idx",
    "voice_version_availability_status_idx",
    "look_version_availability_status_idx",
    "episode_configuration_workspace_script_idx",
    "episode_configuration_voice_idx",
    "episode_configuration_look_idx",
    "episode_configuration_selected_by_idx",
    "raw_utf8 = convert_to(raw_text, 'UTF8')",
    "coordinate_map_verifier = 'postgres-structural-v2'",
    "coordinate_map ?& array['v','c','r','p','s']",
    "octet_length(p_raw_utf8) > 8192",
    "create or replace function private.decode_uploaded_script_source_v1(",
    "add column if not exists original_source_bytes bytea",
    "add constraint script_revisions_source_envelope_v1_check",
    "create trigger script_revisions_uploaded_source",
    "genie-uploaded-script-decoder.v1",
    "uploaded script source does not match decoded text",
    "octet_length(original_source_bytes) between 1 and 24576",
    "original_source_sha256 = encode(extensions.digest(original_source_bytes, 'sha256'), 'hex')",
    "perform pg_catalog.set_config('genie.uploaded_script_source', '', true)",
    "script_rubric_runs_source_unchanged_ck",
    "script_rubric_runs_immutable",
    "genie.script-rubric-run.v1",
    "advisory_only boolean not null default true check (advisory_only)",
    "create or replace function private.validate_script_rubric_payload_v1(",
    "gate ->> 'effect' <> 'advisory'",
    "completed advisory script rubric is required before planning",
    "add column script_rubric_run_id uuid",
    "create trigger preflight_runs_bind_script_rubric",
    "create index preflight_runs_script_rubric_run_fk_idx",
    "script_size_policy_version = 1",
    "octet_length(raw_utf8) between 8193 and 65536",
    "pg_column_size(p_coordinate_map) > 8388608",
    "pack_version = 1",
    "where v.gender = 'male'",
    "glowing-divine-realism",
    "pending_authenticated_canary",
    "create table private.live_broker_request_nonces",
    "create table private.live_broker_lifecycles",
    "live_broker_request_nonces_immutable",
    "live broker nonce replayed",
    "live broker signer rate limit exceeded",
    "pg_catalog.hashtextextended('live-broker:' || p_sandbox_name, 0)",
    "create_lease_expires_at <= statement_timestamp()",
    "lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit",
    "live broker deletion tombstone is terminal",
    "voice_availability_events_no_unattested_verification",
    "voice verification requires an authenticated provider receipt",
    "select a.status into selected_voice_status from public.voice_versions v join public.voice_version_availability a on a.voice_version_id = v.id where v.id = p_voice_version_id and v.gender = p_narrator_gender for update of a;",
    "select a.status into selected_look_status from public.look_versions l join public.look_version_availability a on a.look_version_id = l.id where l.id = p_look_version_id for update of a;",
  ]) {
    if (!normalized.includes(required)) {
      errors.push(`missing Phase 2 zero-spend invariant: ${required}`);
    }
  }

  const selectionAvailabilityLocks = normalized.match(/for update of a;/g) ?? [];
  if (selectionAvailabilityLocks.length !== 2) {
    errors.push("voice and look selection must each lock the exact availability row");
  }

  for (const { file, sql: scriptSql } of scriptCoordinateMigrations) {
    const scriptNormalized = scriptSql.replaceAll(/\s+/g, " ");
    for (const required of [
      "create or replace function private.verify_nonnegative_integer_tuple(",
      "(p_coordinate_map -> 'v')::text <> '2'",
      "p_coordinate_map ?& array['v','c','r','p','s']",
      "jsonb_array_length(p_coordinate_map -> 'r') <> 3",
      "jsonb_array_length(p_coordinate_map -> 'p') <> 3",
      "pg_column_size(p_coordinate_map) > 8388608",
    ]) {
      if (!scriptNormalized.includes(required)) {
        errors.push(`${file} is missing compact coordinate-map invariant: ${required}`);
      }
    }
  }

  const terminalCoordinateMigration = sources.find(({ file }) =>
    file.endsWith("phase2_script_coordinate_v2_forward.sql"),
  );
  const terminalCoordinateNormalized = terminalCoordinateMigration?.sql.replaceAll(
    /\s+/g,
    " ",
  );
  for (const required of [
    "drop function if exists public.attest_script_coordinate_map( uuid,uuid,uuid,text,text,text,jsonb,jsonb );",
    "create or replace function public.attest_script_coordinate_map( p_attestation_id uuid",
    "p_attestation_id::text !~",
    "values ( p_attestation_id, p_workspace_id",
    "legacy_constraint_names constant text[]",
    "script_revisions_check5",
    "predecessor_constraint_names constant text[]",
    "script_revisions_coordinate_map_semantics_v1_check",
    "script_revisions_runtime_evidence_shape_v2_check",
    "array['script_revisions_size_policy_version_check']",
  ]) {
    if (!terminalCoordinateNormalized?.includes(required)) {
      errors.push(`terminal coordinate migration is missing: ${required}`);
    }
  }

  const terminalEpisodeMigration = sources.find(({ file }) =>
    file.endsWith("phase2_episode_release_eligibility.sql"),
  );
  const terminalEpisodeNormalized = terminalEpisodeMigration?.sql.replaceAll(
    /\s+/g,
    " ",
  );
  for (const required of [
    "drop constraint if exists series_release_continuity_fk;",
    "foreign key (workspace_id, continuity_state_version_id, series_id) references public.continuity_state_versions (workspace_id, id, series_id) match simple on delete restrict;",
    "create or replace function public.command_create_episode(",
    "r.workspace_id = p_workspace_id and r.series_id = p_series_id;",
    "current_release_status is distinct from 'active'",
    "current_look_status is distinct from 'active'",
    "continuity.workspace_id = p_workspace_id and continuity.series_id = p_series_id;",
    "revoke all on function public.command_create_episode(",
    "grant execute on function public.command_create_episode(",
  ]) {
    if (!terminalEpisodeNormalized?.includes(required)) {
      errors.push(`terminal Episode eligibility migration is missing: ${required}`);
    }
  }
  if (
    terminalEpisodeNormalized?.includes(
      "create unique index if not exists continuity_state_versions_workspace_id_id_series_id_terminal_uidx",
    )
  ) {
    errors.push(
      "terminal Episode eligibility migration duplicates the existing continuity ownership key",
    );
  }
  for (const { file, sql: predecessorSql } of scriptCoordinateMigrations.filter(
    ({ file }) => !file.endsWith("phase2_script_coordinate_v2_forward.sql"),
  )) {
    if (
      predecessorSql
        .replaceAll(/\s+/g, " ")
        .includes(
          "create or replace function public.attest_script_coordinate_map( p_attestation_id uuid",
        )
    ) {
      errors.push(`${file} rewrites the authentic predecessor attestor signature`);
    }
  }

  const legacyVerifierOccurrences = [...sql.matchAll(/postgres-structural-v1/gi)]
    .length;
  if (
    legacyVerifierOccurrences !== 4 ||
    !normalized.includes("where coordinate_map_verifier = 'postgres-structural-v1';") ||
    !normalized.includes(
      "set coordinate_map = private.compact_script_coordinate_map_v2(coordinate_map), coordinate_map_verifier = 'postgres-structural-v2', script_size_policy_version = case when octet_length(raw_utf8) > 8192 then 1 else 2 end",
    ) ||
    !normalized.includes(
      "drop index if exists private.script_coordinate_attestations_request_idx; create index script_coordinate_attestations_request_idx",
    ) ||
    !normalized.includes(
      "alter table public.script_revisions disable trigger script_revisions_immutable;",
    ) ||
    !normalized.includes(
      "alter column coordinate_map_verifier set default 'postgres-structural-v2'",
    ) ||
    !normalized.includes("alter column script_size_policy_version set default 2") ||
    !normalized.includes(
      "new script revisions require size policy v2 and at most 8192 bytes",
    ) ||
    !normalized.includes(
      "add constraint script_revisions_coordinate_map_semantics_v2_check",
    ) ||
    !normalized.includes("unexpected script revision constraint inventory") ||
    !normalized.includes("script revision predecessor constraint definition drifted")
  ) {
    errors.push("the v1-to-v2 coordinate-map upgrade path changed or is incomplete");
  }

  if (scriptCoordinateHardeningMigrations.length !== 2) {
    errors.push("the replayable coordinate-map hardening pair is incomplete");
  }
  for (const { file, sql: hardeningSql } of scriptCoordinateHardeningMigrations) {
    const hardeningNormalized = hardeningSql.replaceAll(/\s+/g, " ");
    if (
      hardeningNormalized.includes(
        "octet_length(convert_to(p_raw_text, 'UTF8')) > 8192",
      )
    ) {
      errors.push(
        `${file} applies the new-write byte cap inside the legacy row semantic verifier`,
      );
    }
    for (const required of [
      "drop index if exists private.script_coordinate_attestations_request_idx; create index script_coordinate_attestations_request_idx",
      "create or replace function private.compact_script_coordinate_map_v2(",
      "where coordinate_map_verifier = 'postgres-structural-v1';",
      "script_size_policy_version = case when octet_length(raw_utf8) > 8192 then 1 else 2 end",
      "alter column script_size_policy_version set default 2",
      "create trigger script_revisions_insert_size_policy",
      "alter table public.script_revisions disable trigger script_revisions_immutable;",
      "alter table public.script_revisions enable trigger script_revisions_immutable;",
      "add constraint script_revisions_coordinate_map_semantics_v2_check",
      "drop function private.compact_script_coordinate_map_v2(jsonb);",
    ]) {
      if (!hardeningNormalized.includes(required)) {
        errors.push(`${file} is missing replayable hardening invariant: ${required}`);
      }
    }
  }

  for (const forbidden of [
    "grant select on table public.script_revisions to anon",
    "using (true)",
    "with check (true)",
    "p_coordinate_map -> 'segments'",
    "p_coordinate_map -> 'raw'",
    "p_coordinate_map -> 'processing'",
    "octet_length(p_raw_utf8) > 65536",
    "create unique index script_coordinate_attestations_request_idx",
    "pg_catalog.greatest(",
    "{8,256}",
    "before update or delete on private.live_broker_request_nonces",
  ]) {
    if (normalized.toLowerCase().includes(forbidden.toLowerCase())) {
      errors.push(`forbidden Phase 2 authorization pattern: ${forbidden}`);
    }
  }

  for (const required of [
    "create index live_broker_request_nonces_signer_created_idx on private.live_broker_request_nonces (signer_id, created_at desc);",
    "created_at < statement_timestamp() - interval '10 minutes'",
    "command_reconcile_live_broker_cancellation",
    "statement_timestamp() + interval '6 minutes'",
  ]) {
    if (!normalized.includes(required)) {
      errors.push(`the live broker durable control plane is missing: ${required}`);
    }
  }

  return { errors, publicTables: actualTables };
}

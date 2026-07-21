export const expectedPreflightProviderMigrationSuffixes = [
  "phase2_preflight_control_plane.sql",
  "phase2_restricted_agent_evaluators.sql",
  "phase2_provider_micro_authority.sql",
  "phase2_quarantine_assets.sql",
  "phase2_preflight_provider_ingest_hardening.sql",
  "phase2_micro_quote_ambiguity_correction.sql",
  "phase2_provider_slot_ambiguity_correction.sql",
  "phase2_preflight_asset_force_rls.sql",
  "phase2_fal_signed_webhook_inbox.sql",
  "phase2_provider_output_target_binding.sql",
  "phase2_provider_output_late_evidence_correction.sql",
  "phase2_preflight_provider_fk_indexes.sql",
  "phase2_provider_output_ingest_reconciler.sql",
  "phase2_provider_output_remote_fetch_binding.sql",
  "phase2_provider_media_kind_binding.sql",
  "phase2_preflight_control_broker.sql",
  "phase2_world_extraction_execution.sql",
  "phase2_world_extraction_replay_resume.sql",
  "phase2_provider_nullable_dimensions.sql",
  "phase2_world_anchor_spend_jobs.sql",
  "phase2_preflight_externalize_control.sql",
  "phase2_world_anchor_ingest_context.sql",
  "phase2_world_anchor_atomic_promotion.sql",
  "phase2_provider_canary_capability_pin.sql",
  "phase2_preflight_control_failure_retry.sql",
  "phase2_world_anchor_retry_pool.sql",
  "phase2_authenticated_voice_canaries.sql",
  "phase2_broker_key_overlap_security.sql",
];

const exposedTables = [
  "preflight_runs",
  "preflight_stage_runs",
  "preflight_stage_dependencies",
  "preflight_stage_attempts",
  "preflight_stage_leases",
  "assets",
  "asset_versions",
  "media_probes",
  "asset_references",
];

const serviceCommands = [
  "command_create_preflight_run",
  "command_transition_preflight_run",
  "command_make_preflight_stage_ready",
  "command_claim_preflight_stage",
  "command_start_preflight_attempt",
  "command_heartbeat_preflight_attempt",
  "command_complete_preflight_attempt",
  "command_record_agent_tool_call",
  "command_complete_agent_tool_call",
  "command_record_evaluator_record",
  "command_record_agent_injection_finding",
  "command_create_micro_quote",
  "command_register_provider_input_manifest",
  "command_claim_micro_provider_slot",
  "command_issue_worker_capability_grant",
  "get_broker_verification_context",
  "get_provider_dispatch_manifest",
  "command_consume_provider_broker_authority",
  "command_record_broker_security_rejection",
  "command_transition_provider_request",
  "command_record_provider_inbox",
  "command_record_provider_late_completion",
  "command_activate_remote_fetch_allowlist",
  "command_record_remote_fetch",
  "command_register_quarantine_asset",
  "command_record_ingest_attestation",
  "command_promote_quarantine_asset",
  "get_fal_webhook_binding",
  "command_record_fal_signed_webhook",
  "command_claim_provider_output_candidate",
  "command_complete_provider_output_candidate",
  "get_active_remote_fetch_policy",
  "command_claim_next_provider_output_candidate",
  "command_fail_provider_output_candidate",
  "command_record_provider_output_remote_fetch",
  "command_consume_preflight_control_assertion",
  "command_dispatch_preflight_control",
  "command_record_preflight_control_output",
  "command_finalize_preflight_control",
  "get_preflight_control_execution_input",
  "command_record_world_extraction_result",
  "get_world_extraction_replay_result",
  "command_ensure_fal_world_capability",
  "command_prepare_world_anchor_jobs",
  "command_claim_world_anchor_provider_job",
  "command_mark_world_anchor_waiting_external",
  "command_complete_world_anchor_job",
  "get_world_anchor_ingest_context",
  "command_promote_world_anchor_quarantine",
  "command_fail_preflight_control",
  "command_ensure_world_anchor_retry_pool",
  "command_record_authenticated_voice_canary",
  "get_current_voice_provider_context",
];

const requiredInvariants = [
  "create table private.preflight_dead_letters",
  "for update skip locked limit p_limit",
  "fencing_token",
  "authority_epoch",
  "heartbeat_at",
  "cancel_requested",
  "create trigger preflight_terminal_cascade",
  "maximum_cost_minor bigint not null check (maximum_cost_minor = 0)",
  "'source.extract','cultural.triage','world.prompt','story.plan','shot.plan'",
  "'script','upload_ocr','research_text','provider_output','provider_error','model_text'",
  "authorization_call_id",
  "create unique index agent_tool_one_completion_uq",
  "injection finding authority is stale",
  "exact_amount := ceil(new.quantity * capability.unit_price_minor)::bigint",
  "account.workspace_id <> quote.workspace_id",
  "evidence.verification_state <> 'verified'",
  "create unique index provider_request_one_retry_child_uq",
  "predecessor.state <> 'failed_retryable'",
  "broker assertion scope crosses authority boundaries",
  "create table private.broker_assertion_jtis",
  "broker assertion replayed",
  "broker authority is stale",
  "broker key overlap window is invalid",
  "interval '15 minutes'",
  "create or replace function private.broker_key_is_usable(",
  "provider_broker.authority_rejected",
  "create table private.provider_inbox_messages",
  "create table private.provider_late_completions",
  "environment, fetch_class, version_number",
  "remote-fetch-allowlist:' || p_environment || ':' || p_fetch_class",
  "v.environment = p_environment",
  "quarantine deliberately has no authenticated policy",
  "quarantine storage object metadata is not exact",
  "disposition in ('accepted','rejected')",
  "promoted storage object is not hash-bound",
  "o.user_metadata ->> 'sha256' = new.content_sha256",
  "create table private.provider_output_candidates",
  "provider output authority is stale",
  "fal webhook replay binding changed",
  "provider.output.ready_for_secure_ingest",
  "provider output quarantine binding is invalid",
  "manifest.payload_json ->> 'targetassetid' = new.stable_asset_id::text",
  "provider output target guard predecessor is unexpected",
  "create index provider_requests_attempt_fk_idx",
  "create index preflight_runs_configuration_fk_idx",
  "create index provider_outputs_inbox_fk_idx",
  "provider output failure lease is stale",
  "provider_output.ingest_failed",
  "provider_output_candidate_id uuid",
  "provider output fetch evidence changed",
  "provider remote fetch binding is invalid",
  "asset media kind binding is invalid",
  "create table private.preflight_control_assertion_jtis",
  "control assertion replayed",
  "create table private.preflight_input_manifests",
  "create table private.world_extraction_results",
  "world extraction authority is stale",
  "world extraction replay differs",
  "world extraction replay authority is stale",
  "expected_width is null or expected_width between 1 and 32768",
  "create table private.world_build_spend_intents",
  "hard_ceiling_minor bigint not null check (hard_ceiling_minor = 384)",
  "world anchor jobs exceed human ceiling",
  "world anchor job is invalid or requires temple research",
  "create table private.world_anchor_jobs",
  "command_authorize_world_build_intent",
  "perform private.assert_aal2()",
  "operation in ('dispatch','execute','externalize','finalize','fail')",
  "command_promote_world_anchor_quarantine",
  "canary_evidence_snapshot_id uuid not null",
  "capability.canary_evidence_snapshot_id<>canary_evidence.id",
  "create table private.world_anchor_retry_pools",
  "create table private.world_anchor_job_requests",
  "retry_of_id, expected_cost_minor, maximum_cost_minor",
  "world anchor retry budget exhausted",
  "preflight control failure lost authority",
  "attempts_exhausted",
  "create table private.voice_authenticated_canaries",
  "authenticated voice capability is stale",
  "revoke all on all tables in schema private from public, anon, authenticated",
];

const forbiddenMicroAuthority = [
  "gen_video",
  "render_video",
  "export_video",
  "approve_video",
  "publish_video",
];

export function selectPreflightProviderMigrations(files) {
  return files.filter((file) =>
    expectedPreflightProviderMigrationSuffixes.some((suffix) => file.endsWith(suffix)),
  );
}

export function analyzePreflightProviderMigrations(sources) {
  const errors = [];
  const filenames = sources.map(({ file }) => file);
  const sql = sources.map(({ sql: source }) => source).join("\n");
  const normalized = sql.toLowerCase().replaceAll(/\s+/g, " ");
  const statements = normalized.split(";").map((statement) => `${statement.trim()};`);

  if (
    filenames.length !== expectedPreflightProviderMigrationSuffixes.length ||
    expectedPreflightProviderMigrationSuffixes.some(
      (suffix, index) => !filenames[index]?.endsWith(suffix),
    )
  ) {
    errors.push("the ordered preflight/provider migration set is incomplete");
  }

  const actualTables = [
    ...new Set(
      [...sql.matchAll(/create table public\.([a-z0-9_]+)/gi)].map((match) => match[1]),
    ),
  ].sort();
  if (
    actualTables.length !== exposedTables.length ||
    [...exposedTables].sort().some((table, index) => table !== actualTables[index])
  ) {
    errors.push("the preflight/provider exposed-table inventory changed");
  }

  for (const table of exposedTables) {
    for (const boundary of [
      `alter table public.${table} enable row level security;`,
      `alter table public.${table} force row level security;`,
    ]) {
      if (!normalized.includes(boundary)) {
        errors.push(`public.${table} is missing boundary: ${boundary}`);
      }
    }
    if (
      !new RegExp(
        `create policy [a-z0-9_]+ on public\\.${table} for select to authenticated using \\(private\\.is_active_member\\(workspace_id, \\(select auth\\.uid\\(\\)\\)\\)\\);`,
      ).test(normalized)
    ) {
      errors.push(`public.${table} is missing its exact workspace read policy`);
    }
  }
  for (const tableGroup of [
    "public.preflight_runs, public.preflight_stage_runs, public.preflight_stage_dependencies, public.preflight_stage_attempts, public.preflight_stage_leases",
    "public.assets, public.asset_versions, public.media_probes, public.asset_references",
  ]) {
    if (
      !normalized.includes(
        `revoke all on table ${tableGroup} from public, anon, authenticated;`,
      ) ||
      !normalized.includes(`grant select on table ${tableGroup} to authenticated;`)
    ) {
      errors.push(
        `exposed table group lacks a read-only grant boundary: ${tableGroup}`,
      );
    }
  }

  for (const functionChunk of sql.split(/create or replace function /i).slice(1)) {
    const definition = functionChunk.split(/\$\$;/, 1)[0] ?? "";
    if (
      /\bsecurity definer\b/i.test(definition) &&
      !/\bset\s+search_path\s*=\s*''/i.test(definition)
    ) {
      const name = functionChunk.match(/^([a-z0-9_.]+)/i)?.[1] ?? "unknown";
      errors.push(`SECURITY DEFINER ${name} lacks an empty search_path`);
    }
  }

  for (const command of serviceCommands) {
    const revoked = statements.some(
      (statement) =>
        statement.startsWith("revoke all on function ") &&
        statement.includes(`public.${command}(`) &&
        /from public\s*,\s*anon\s*,\s*authenticated;$/u.test(statement),
    );
    const granted = statements.some(
      (statement) =>
        statement.startsWith("grant execute on function ") &&
        statement.includes(`public.${command}(`) &&
        /to service_role;$/u.test(statement),
    );
    if (!revoked || !granted) {
      errors.push(`${command} lacks an explicit service-only boundary`);
    }
  }

  for (const invariant of requiredInvariants) {
    if (!normalized.includes(invariant)) {
      errors.push(`missing preflight/provider invariant: ${invariant}`);
    }
  }
  for (const forbidden of forbiddenMicroAuthority) {
    if (normalized.includes(`'${forbidden}'`)) {
      errors.push(`micro authority includes forbidden operation: ${forbidden}`);
    }
  }

  const hardening = sources.find(({ file }) =>
    file.endsWith("phase2_preflight_provider_ingest_hardening.sql"),
  );
  if (
    /create or replace function public\.command_create_micro_quote\s*\(/i.test(
      hardening?.sql ?? "",
    )
  ) {
    errors.push("an applied migration was rewritten instead of corrected forward");
  }
  for (const correction of [
    "phase2_micro_quote_ambiguity_correction.sql",
    "phase2_provider_slot_ambiguity_correction.sql",
  ]) {
    const source = sources.find(({ file }) => file.endsWith(correction))?.sql ?? "";
    if (
      !source.includes("pg_get_functiondef") ||
      !source.includes("#variable_conflict use_column")
    ) {
      errors.push(`${correction} is not a replayable forward correction`);
    }
  }

  return { errors, exposedTables };
}

export function analyzePreflightProviderPgTap(source) {
  const errors = [];
  if (!/select\s+plan\(100\)\s*;/i.test(source)) {
    errors.push("preflight/provider pgTAP must declare its exact 100-test plan");
  }
  for (const required of [
    "underquoted provider cost cannot become authority",
    "another workspace provider capability cannot be quoted",
    "the consumed request and grant cannot be replayed",
    "failing a run terminalizes its active attempt",
    "failed ingest remains rejected after the command commits",
    "promotion rejects a storage version that is not hash-bound to attestation evidence",
    "a repeated signed delivery cannot create another output candidate",
    "a valid provider request cannot quarantine bytes for an unrelated target asset",
    "generic fetch evidence cannot be repurposed for a provider output candidate",
    "remote fetch evidence is immutably bound to the exact claimed output candidate",
  ]) {
    if (!source.toLowerCase().includes(required)) {
      errors.push(`preflight/provider pgTAP is missing: ${required}`);
    }
  }
  return { errors };
}

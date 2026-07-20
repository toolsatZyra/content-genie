-- Cover every Phase 2 foreign-key path used by deletion checks, reconciliation,
-- and workspace-scoped joins. These are deliberately narrow B-tree indexes;
-- they do not grant access or change authority semantics.

create index preflight_runs_configuration_fk_idx
  on public.preflight_runs (workspace_id, configuration_candidate_id);
create index preflight_runs_script_fk_idx
  on public.preflight_runs (workspace_id, episode_id, script_revision_id);
create index preflight_runs_micro_quote_fk_idx
  on public.preflight_runs (micro_quote_id) where micro_quote_id is not null;
create index preflight_runs_micro_auth_fk_idx
  on public.preflight_runs (micro_authorization_id)
  where micro_authorization_id is not null;
create index preflight_runs_micro_reservation_fk_idx
  on public.preflight_runs (micro_reservation_id)
  where micro_reservation_id is not null;
create index preflight_dependencies_predecessor_fk_idx
  on public.preflight_stage_dependencies (
    workspace_id, preflight_run_id, depends_on_stage_run_id
  );
create index preflight_dependencies_successor_fk_idx
  on public.preflight_stage_dependencies (
    workspace_id, preflight_run_id, stage_run_id
  );
create index preflight_leases_attempt_fk_idx
  on public.preflight_stage_leases (
    workspace_id, preflight_run_id, stage_attempt_id
  );

create index asset_references_version_fk_idx
  on public.asset_references (workspace_id, asset_version_id);
create index media_probes_version_fk_idx
  on public.media_probes (workspace_id, asset_version_id);

create index preflight_dead_letters_workspace_fk_idx
  on private.preflight_dead_letters (workspace_id);
create index preflight_dead_letters_attempt_fk_idx
  on private.preflight_dead_letters (
    workspace_id, preflight_run_id, stage_attempt_id
  );
create index agent_tool_calls_configuration_fk_idx
  on private.agent_tool_calls (workspace_id, configuration_candidate_id);
create index agent_tool_calls_script_fk_idx
  on private.agent_tool_calls (workspace_id, episode_id, script_revision_id);
create index agent_tool_calls_attempt_fk_idx
  on private.agent_tool_calls (
    workspace_id, preflight_run_id, stage_attempt_id
  );
create index agent_injection_findings_attempt_fk_idx
  on private.agent_injection_findings (
    workspace_id, preflight_run_id, stage_attempt_id
  );
create index evaluator_records_attempt_fk_idx
  on private.evaluator_records (
    workspace_id, preflight_run_id, stage_attempt_id
  );

create index provider_capabilities_evidence_fk_idx
  on private.provider_capabilities (evidence_snapshot_id);
create index provider_cost_events_workspace_fk_idx
  on private.provider_cost_events (workspace_id);
create index provider_inbox_request_fk_idx
  on private.provider_inbox_messages (provider_request_id)
  where provider_request_id is not null;
create index provider_late_quarantine_fk_idx
  on private.provider_late_completions (quarantined_asset_id)
  where quarantined_asset_id is not null;
create index provider_outputs_inbox_fk_idx
  on private.provider_output_candidates (provider_inbox_message_id);
create index provider_outputs_quarantine_fk_idx
  on private.provider_output_candidates (quarantine_asset_version_id)
  where quarantine_asset_version_id is not null;
create index provider_claims_authorization_fk_idx
  on private.provider_request_quote_claims (micro_authorization_id);
create index provider_claims_reservation_fk_idx
  on private.provider_request_quote_claims (micro_reservation_id);
create index provider_claims_preflight_fk_idx
  on private.provider_request_quote_claims (workspace_id, preflight_run_id);
create index provider_requests_input_manifest_fk_idx
  on private.provider_requests (workspace_id, input_manifest_id);
create index provider_requests_capability_fk_idx
  on private.provider_requests (provider_capability_id);
create index provider_requests_attempt_fk_idx
  on private.provider_requests (
    workspace_id, preflight_run_id, stage_attempt_id
  );
create index quarantine_assets_remote_fetch_fk_idx
  on private.quarantine_assets (remote_fetch_request_id)
  where remote_fetch_request_id is not null;
create index remote_fetch_requests_attempt_fk_idx
  on private.remote_fetch_requests (
    workspace_id, preflight_run_id, stage_attempt_id
  );
create index worker_grants_attempt_fk_idx
  on private.worker_capability_grants (
    workspace_id, preflight_run_id, stage_attempt_id
  );

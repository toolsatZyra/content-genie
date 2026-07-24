-- Cover the composite preflight-run foreign key used by archive audit and
-- retention queries. The configuration index has the reverse second column
-- and cannot serve this relationship efficiently.

create index world_selection_history_preflight_run_idx
  on private.world_selection_history(
    workspace_id,
    authoritative_preflight_run_id
  );

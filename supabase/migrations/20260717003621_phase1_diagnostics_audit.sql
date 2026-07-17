-- Phase 1 / 0006: bounded diagnostics and append-only audit.

create table private.diagnostic_events (
  id uuid primary key default gen_random_uuid(),
  schema_version integer not null default 1 check (schema_version > 0),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default statement_timestamp(),
  environment text not null check (environment in ('development', 'preview', 'production', 'test')),
  release text check (release is null or char_length(release) <= 160),
  workspace_id uuid references public.workspaces(id) on delete set null,
  aggregate_type text,
  aggregate_id uuid,
  correlation_id text not null check (char_length(correlation_id) between 8 and 160),
  causation_id text,
  stage text,
  provider text,
  capability text,
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 86400000),
  status text,
  error_class text,
  retry_count integer check (retry_count is null or retry_count between 0 and 100),
  safe_summary text check (safe_summary is null or char_length(safe_summary) <= 1000),
  retention_class text not null check (retention_class in ('short', 'operational', 'security')),
  source text not null check (source in ('server', 'client', 'workflow', 'reconciler')),
  dedupe_hash text check (dedupe_hash is null or dedupe_hash ~ '^[a-f0-9]{64}$'),
  actor_user_id uuid references auth.users(id) on delete set null
);

create index diagnostic_events_operational_idx
  on private.diagnostic_events (received_at desc, event_type);
create index diagnostic_events_workspace_idx
  on private.diagnostic_events (workspace_id, received_at desc)
  where workspace_id is not null;
create unique index diagnostic_events_dedupe_uq
  on private.diagnostic_events (dedupe_hash)
  where dedupe_hash is not null;

create table audit.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete restrict,
  actor_kind text not null check (actor_kind in ('user', 'workflow', 'system', 'service')),
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_principal text not null,
  membership_role public.membership_role,
  session_id uuid,
  aal text check (aal is null or aal in ('aal1', 'aal2')),
  command_id uuid,
  idempotency_key text,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  target_type text not null,
  target_id uuid,
  target_version bigint,
  permission_decision text not null check (permission_decision in ('allow', 'deny', 'system')),
  prior_hash text check (prior_hash is null or prior_hash ~ '^[a-f0-9]{64}$'),
  new_hash text check (new_hash is null or new_hash ~ '^[a-f0-9]{64}$'),
  reason text,
  correlation_id uuid not null,
  causation_id uuid,
  outcome text not null check (outcome in ('accepted', 'rejected', 'failed')),
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  check (reason is null or char_length(reason) <= 2000),
  check (jsonb_typeof(safe_metadata) = 'object'),
  check (pg_column_size(safe_metadata) <= 16384)
);

create index audit_events_workspace_time_idx
  on audit.events (workspace_id, created_at desc)
  where workspace_id is not null;
create index audit_events_target_idx
  on audit.events (target_type, target_id, created_at desc);

create trigger diagnostic_events_immutable
before update or delete on private.diagnostic_events
for each row execute function private.reject_mutation();

create trigger audit_events_immutable
before update or delete on audit.events
for each row execute function private.reject_mutation();

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all tables in schema audit from public, anon, authenticated;

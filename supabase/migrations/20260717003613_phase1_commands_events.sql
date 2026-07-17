-- Phase 1 / 0004: idempotent commands, aggregate ordering, events, and outbox.

create table private.command_receipts (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_principal text not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  command_type text not null check (command_type ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  aggregate_type text not null check (aggregate_type in ('series', 'episode', 'work_item', 'notification')),
  aggregate_id uuid,
  expected_version bigint,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  outcome public.command_outcome not null,
  response_json jsonb not null,
  correlation_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, actor_principal, idempotency_key),
  check (jsonb_typeof(response_json) = 'object')
);

create table private.aggregate_versions (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  aggregate_type text not null check (aggregate_type in ('series', 'episode', 'work_item')),
  aggregate_id uuid not null,
  current_version bigint not null check (current_version > 0),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, aggregate_type, aggregate_id)
);

create table public.domain_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  aggregate_type text not null check (aggregate_type in ('workspace', 'series', 'episode', 'work_item')),
  aggregate_id uuid not null,
  aggregate_sequence bigint not null check (aggregate_sequence > 0),
  actor_kind text not null check (actor_kind in ('user', 'workflow', 'system')),
  actor_principal text not null,
  correlation_id uuid not null,
  causation_id uuid,
  schema_version integer not null default 1 check (schema_version > 0),
  safe_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, aggregate_type, aggregate_id, aggregate_sequence),
  check (jsonb_typeof(safe_payload) = 'object'),
  check (pg_column_size(safe_payload) <= 16384)
);

create table private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  destination text not null check (destination ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  payload_json jsonb not null,
  payload_schema_version integer not null default 1 check (payload_schema_version > 0),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 240),
  available_at timestamptz not null default statement_timestamp(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 10 check (max_attempts between 1 and 50),
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  state public.outbox_state not null default 'pending',
  last_error_class text,
  delivered_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  check (jsonb_typeof(payload_json) = 'object'),
  check (pg_column_size(payload_json) <= 32768),
  check (
    (state = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or state <> 'leased'
  ),
  check ((state = 'delivered') = (delivered_at is not null))
);

create table private.outbox_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null references private.outbox_events(id) on delete restrict,
  attempt_no integer not null check (attempt_no > 0),
  fencing_token bigint not null check (fencing_token > 0),
  outcome text not null check (outcome in ('started', 'delivered', 'retryable_error', 'terminal_error')),
  error_class text,
  occurred_at timestamptz not null default statement_timestamp(),
  unique (outbox_event_id, attempt_no)
);

create table private.dead_letters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  source_kind text not null check (source_kind in ('outbox', 'workflow', 'realtime')),
  source_id uuid not null,
  reason_class text not null,
  attempts integer not null check (attempts >= 0),
  safe_summary jsonb not null default '{}'::jsonb,
  next_action text not null,
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  check (jsonb_typeof(safe_summary) = 'object'),
  check (pg_column_size(safe_summary) <= 16384)
);

create trigger command_receipts_immutable
before update or delete on private.command_receipts
for each row execute function private.reject_mutation();

create trigger domain_events_immutable
before update or delete on public.domain_events
for each row execute function private.reject_mutation();

create trigger outbox_delivery_attempts_immutable
before update or delete on private.outbox_delivery_attempts
for each row execute function private.reject_mutation();

revoke all on all tables in schema private from public, anon, authenticated;

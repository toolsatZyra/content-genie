-- Phase 2 / 0017 + 0019: provider registry, project identity, one-attempt
-- capabilities, pre-lock micro authority, and idempotent request lifecycle.

create type private.micro_quote_state as enum (
  'draft','priced','confirmed','expired','superseded'
);
create type private.micro_authorization_state as enum (
  'pending','active','exhausted','released','revoked','expired'
);
create type private.micro_reservation_state as enum (
  'held','partially_settled','settled','released','expired'
);
create type private.provider_request_state as enum (
  'reserved','queued','submitted','accepted','polling','succeeded',
  'failed_retryable','failed_terminal','cancel_requested','canceled'
);
create type private.broker_client_state as enum ('disabled','active');
create type private.broker_key_state as enum ('pending','active','revoked');
create type private.capability_grant_state as enum (
  'active','consumed','released','revoked','expired'
);

create table private.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  environment text not null check (environment in (
    'development','preview','production','test'
  )),
  provider text not null check (provider in ('fal','elevenlabs','google','seedance')),
  account_key text not null check (account_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  credential_secret_ref text not null check (
    credential_secret_ref ~ '^[A-Z][A-Z0-9_]{2,100}$'
  ),
  callback_secret_ref text check (
    callback_secret_ref is null or callback_secret_ref ~ '^[A-Z][A-Z0-9_]{2,100}$'
  ),
  region text not null check (char_length(region) between 2 and 40),
  state text not null default 'disabled' check (state in ('disabled','active')),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, environment, account_key),
  unique (workspace_id, id)
);

create table private.provider_evidence_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references private.provider_accounts(id)
    on delete restrict,
  evidence_kind text not null check (evidence_kind in (
    'official_schema','authenticated_account','pricing','retention','canary'
  )),
  source_url_hash text not null check (source_url_hash ~ '^[a-f0-9]{64}$'),
  raw_object_sha256 text not null check (raw_object_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_hash text not null check (canonical_hash ~ '^[a-f0-9]{64}$'),
  storage_object_name text not null check (
    char_length(storage_object_name) between 10 and 512
    and storage_object_name !~ '(^|/)\.\.(/|$)'
  ),
  verification_state text not null check (verification_state in (
    'pending','verified','failed','withdrawn'
  )),
  retrieved_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > retrieved_at),
  unique (provider_account_id, evidence_kind, canonical_hash)
);

create table private.provider_capabilities (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references private.provider_accounts(id)
    on delete restrict,
  capability text not null check (capability in (
    'gen_image','edit_image','gen_speech','align_speech','asr',
    'gen_music_preview','gen_sfx_preview','zero_cost'
  )),
  model_key text not null check (model_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{2,160}$'),
  model_version text not null check (char_length(model_version) between 1 and 160),
  endpoint_key text not null check (endpoint_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  schema_version text not null check (schema_version ~ '^[a-z0-9_.-]{3,100}$'),
  evidence_snapshot_id uuid not null references private.provider_evidence_snapshots(id)
    on delete restrict,
  currency char(3) not null check (currency = 'USD'),
  unit_name text not null check (unit_name in (
    'image','character','second','minute','request'
  )),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  maximum_request_minor bigint not null check (maximum_request_minor between 0 and 5000),
  retention_class text not null check (retention_class in (
    'no_training','account_opt_out','restricted_internal'
  )),
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null check (status in ('verified','disabled','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > verified_at),
  unique (
    provider_account_id, capability, model_key, model_version, endpoint_key,
    schema_version
  )
);

create table private.micro_quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  preflight_kind public.preflight_kind not null,
  quote_number integer not null check (quote_number > 0),
  quote_hash text not null check (quote_hash ~ '^[a-f0-9]{64}$'),
  rate_snapshot_hash text not null check (rate_snapshot_hash ~ '^[a-f0-9]{64}$'),
  currency char(3) not null check (currency = 'USD'),
  total_minor bigint not null check (total_minor between 0 and 7500),
  state private.micro_quote_state not null default 'priced',
  expires_at timestamptz not null,
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  confirmed_at timestamptz,
  unique (workspace_id, id),
  unique (configuration_candidate_id, preflight_kind, quote_number),
  unique (configuration_candidate_id, quote_hash),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, episode_id, script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict,
  check (expires_at > created_at),
  check ((state = 'confirmed') = (confirmed_at is not null))
);

create table private.micro_quote_lines (
  id uuid primary key default gen_random_uuid(),
  micro_quote_id uuid not null references private.micro_quotes(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  slot_key text not null check (slot_key ~ '^[a-z][a-z0-9_.:-]{2,140}$'),
  capability_id uuid not null references private.provider_capabilities(id)
    on delete restrict,
  operation text not null check (operation in (
    'gen_image','edit_image','gen_speech','align_speech','asr',
    'gen_music_preview','gen_sfx_preview','zero_cost'
  )),
  quantity numeric(12,4) not null check (quantity > 0 and quantity <= 10000),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  amount_minor bigint not null check (amount_minor between 0 and 5000),
  request_schema_hash text not null check (request_schema_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (micro_quote_id, line_number),
  unique (micro_quote_id, slot_key)
);

create table private.micro_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  micro_quote_id uuid not null references private.micro_quotes(id) on delete restrict,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  authorized_by uuid not null references auth.users(id) on delete restrict,
  actor_authority_epoch bigint not null check (actor_authority_epoch > 0),
  aal text not null check (aal = 'aal2'),
  quote_hash text not null check (quote_hash ~ '^[a-f0-9]{64}$'),
  hard_ceiling_minor bigint not null check (hard_ceiling_minor between 0 and 7500),
  state private.micro_authorization_state not null default 'active',
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  authorized_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  unique (micro_quote_id),
  unique (workspace_id, id),
  check (expires_at > authorized_at)
);

create table private.micro_reservations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  micro_quote_id uuid not null references private.micro_quotes(id) on delete restrict,
  micro_authorization_id uuid not null references private.micro_authorizations(id)
    on delete restrict,
  amount_minor bigint not null check (amount_minor between 0 and 7500),
  settled_minor bigint not null default 0 check (settled_minor >= 0),
  released_minor bigint not null default 0 check (released_minor >= 0),
  state private.micro_reservation_state not null default 'held',
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  unique (micro_quote_id, micro_authorization_id),
  unique (micro_authorization_id),
  unique (workspace_id, id),
  check (expires_at > created_at),
  check (settled_minor + released_minor <= amount_minor)
);

alter table public.preflight_runs
  add constraint preflight_micro_quote_fk foreign key (micro_quote_id)
    references private.micro_quotes(id) on delete restrict,
  add constraint preflight_micro_authorization_fk foreign key (micro_authorization_id)
    references private.micro_authorizations(id) on delete restrict,
  add constraint preflight_micro_reservation_fk foreign key (micro_reservation_id)
    references private.micro_reservations(id) on delete restrict;

create table private.broker_clients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  environment text not null check (environment in (
    'development','preview','production','test'
  )),
  trigger_project text not null check (
    trigger_project ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,100}$'
  ),
  client_id text not null check (
    client_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,100}$'
  ),
  audience text not null check (
    audience ~ '^https://[A-Za-z0-9.-]+(?::443)?/api/internal/provider-broker$'
  ),
  state private.broker_client_state not null default 'disabled',
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  registered_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  disabled_at timestamptz,
  unique (environment, trigger_project, client_id),
  unique (workspace_id, id),
  check ((state = 'disabled') = (disabled_at is not null))
);

create table private.broker_client_key_versions (
  id uuid primary key default gen_random_uuid(),
  broker_client_id uuid not null references private.broker_clients(id)
    on delete restrict,
  kid text not null check (kid ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$'),
  public_key_spki_base64 text not null check (
    public_key_spki_base64 ~ '^[A-Za-z0-9+/]{56,200}={0,2}$'
  ),
  state private.broker_key_state not null default 'pending',
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  overlap_until timestamptz,
  rotation_reason text not null check (char_length(rotation_reason) between 1 and 1000),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  activated_at timestamptz,
  revoked_at timestamptz,
  unique (broker_client_id, kid),
  check (valid_until > valid_from),
  check (overlap_until is null or overlap_until between valid_from and valid_until),
  check (
    (state = 'pending' and activated_at is null and revoked_at is null)
    or (state = 'active' and activated_at is not null and revoked_at is null)
    or (state = 'revoked' and revoked_at is not null)
  )
);

create table private.broker_assertion_jtis (
  id uuid primary key default gen_random_uuid(),
  broker_client_id uuid not null references private.broker_clients(id)
    on delete restrict,
  broker_key_version_id uuid not null references private.broker_client_key_versions(id)
    on delete restrict,
  jti_hash text not null unique check (jti_hash ~ '^[a-f0-9]{64}$'),
  assertion_subject text not null check (char_length(assertion_subject) between 8 and 600),
  provider_request_id uuid not null,
  capability_grant_id uuid not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  check (expires_at > issued_at and consumed_at <= expires_at + interval '5 seconds')
);

create table private.provider_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  provider_account_id uuid not null references private.provider_accounts(id)
    on delete restrict,
  provider_capability_id uuid not null references private.provider_capabilities(id)
    on delete restrict,
  operation text not null check (operation in (
    'gen_image','edit_image','gen_speech','align_speech','asr',
    'gen_music_preview','gen_sfx_preview','zero_cost'
  )),
  request_schema_version text not null check (
    request_schema_version ~ '^[a-z0-9_.-]{3,100}$'
  ),
  input_manifest_id uuid not null,
  input_manifest_hash text not null check (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  correlation_id uuid not null unique,
  retry_of_id uuid references private.provider_requests(id) on delete restrict,
  external_job_id text,
  state private.provider_request_state not null default 'reserved',
  expected_cost_minor bigint not null check (expected_cost_minor between 0 and 5000),
  maximum_cost_minor bigint not null check (
    maximum_cost_minor between 0 and 5000 and maximum_cost_minor >= expected_cost_minor
  ),
  billable_state text not null default 'unknown' check (billable_state in (
    'unknown','not_billable','estimated','settled','refunded'
  )),
  safe_response_hash text check (
    safe_response_hash is null or safe_response_hash ~ '^[a-f0-9]{64}$'
  ),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  submitted_at timestamptz,
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (provider_account_id, idempotency_key),
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict,
  check (retry_of_id is null or retry_of_id <> id),
  check (
    (state in ('succeeded','failed_retryable','failed_terminal','canceled')
      and completed_at is not null)
    or (state not in ('succeeded','failed_retryable','failed_terminal','canceled')
      and completed_at is null)
  )
);

create table private.provider_input_manifests (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  operation text not null check (operation in (
    'gen_image','edit_image','gen_speech','align_speech','asr',
    'gen_music_preview','gen_sfx_preview','zero_cost'
  )),
  payload_schema_version text not null check (
    payload_schema_version ~ '^[a-z0-9_.-]{3,100}$'
  ),
  payload_json jsonb not null check (
    jsonb_typeof(payload_json) = 'object' and pg_column_size(payload_json) <= 262144
  ),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, content_hash)
);

alter table private.provider_requests
  add constraint provider_request_input_manifest_fk
  foreign key (workspace_id, input_manifest_id)
  references private.provider_input_manifests(workspace_id, id) on delete restrict;

create unique index provider_external_job_uq
  on private.provider_requests (provider_account_id, external_job_id)
  where external_job_id is not null;
create index provider_requests_reconcile_idx
  on private.provider_requests (state, updated_at)
  where state in ('submitted','accepted','polling','cancel_requested');

create table private.provider_request_quote_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  provider_request_id uuid not null references private.provider_requests(id)
    on delete restrict,
  preflight_run_id uuid not null,
  micro_quote_line_id uuid not null references private.micro_quote_lines(id)
    on delete restrict,
  micro_authorization_id uuid not null references private.micro_authorizations(id)
    on delete restrict,
  micro_reservation_id uuid not null references private.micro_reservations(id)
    on delete restrict,
  authority_epoch bigint not null check (authority_epoch > 0),
  fencing_token bigint not null check (fencing_token > 0),
  claimed_at timestamptz not null default statement_timestamp(),
  unique (provider_request_id),
  unique (micro_quote_line_id),
  unique (workspace_id, id),
  foreign key (workspace_id, preflight_run_id)
    references public.preflight_runs(workspace_id, id) on delete restrict
);

create table private.worker_capability_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  provider_request_id uuid not null references private.provider_requests(id)
    on delete restrict,
  micro_quote_line_id uuid not null references private.micro_quote_lines(id)
    on delete restrict,
  capability text not null check (capability in (
    'gen_image','edit_image','gen_speech','align_speech','asr',
    'gen_music_preview','gen_sfx_preview','zero_cost'
  )),
  authority_epoch bigint not null check (authority_epoch > 0),
  fencing_token bigint not null check (fencing_token > 0),
  input_manifest_hash text not null check (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  token_jti_hash text not null unique check (token_jti_hash ~ '^[a-f0-9]{64}$'),
  allowed_rpc text not null check (allowed_rpc = 'provider.submit_exact_request'),
  allowed_object_scope_hash text not null check (
    allowed_object_scope_hash ~ '^[a-f0-9]{64}$'
  ),
  state private.capability_grant_state not null default 'active',
  issued_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  unique (provider_request_id),
  unique (workspace_id, id),
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict,
  check (expires_at > issued_at and expires_at <= issued_at + interval '5 minutes'),
  check (
    (state = 'active' and consumed_at is null and revoked_at is null)
    or (state = 'consumed' and consumed_at is not null and revoked_at is null)
    or (state in ('released','expired') and consumed_at is null)
    or (state = 'revoked' and revoked_at is not null)
  )
);

alter table private.broker_assertion_jtis
  add constraint broker_assertion_request_fk foreign key (provider_request_id)
    references private.provider_requests(id) on delete restrict,
  add constraint broker_assertion_grant_fk foreign key (capability_grant_id)
    references private.worker_capability_grants(id) on delete restrict;

create table private.provider_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references private.provider_accounts(id)
    on delete restrict,
  provider_request_id uuid references private.provider_requests(id) on delete restrict,
  provider_event_id text,
  canonical_payload_hash text not null check (canonical_payload_hash ~ '^[a-f0-9]{64}$'),
  raw_body_sha256 text not null check (raw_body_sha256 ~ '^[a-f0-9]{64}$'),
  signature_verified boolean not null,
  verification_class text not null check (verification_class in (
    'signed','poll_signal_only','rejected'
  )),
  received_at timestamptz not null default statement_timestamp(),
  processed_at timestamptz,
  safe_summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_summary) = 'object' and pg_column_size(safe_summary) <= 16384
  )
);
create unique index provider_inbox_event_uq
  on private.provider_inbox_messages (provider_account_id, provider_event_id)
  where provider_event_id is not null;
create unique index provider_inbox_hash_uq
  on private.provider_inbox_messages (provider_account_id, canonical_payload_hash)
  where provider_event_id is null;

create table private.provider_late_completions (
  id uuid primary key default gen_random_uuid(),
  provider_request_id uuid not null references private.provider_requests(id)
    on delete restrict,
  canonical_event_hash text not null check (canonical_event_hash ~ '^[a-f0-9]{64}$'),
  classification text not null check (classification in (
    'duplicate','stale','billable_no_asset','quarantined_asset'
  )),
  quarantined_asset_id uuid,
  billable_minor bigint check (billable_minor is null or billable_minor >= 0),
  created_at timestamptz not null default statement_timestamp(),
  unique (provider_request_id, canonical_event_hash)
);

create table private.provider_cost_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  provider_request_id uuid not null references private.provider_requests(id)
    on delete restrict,
  event_kind text not null check (event_kind in (
    'estimated','submitted','settled','refunded','unknown_billable'
  )),
  amount_minor bigint not null,
  currency char(3) not null check (currency = 'USD'),
  billing_evidence_hash text not null check (billing_evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (provider_request_id, event_kind, billing_evidence_hash)
);

create trigger provider_accounts_updated_at
before update on private.provider_accounts
for each row execute function private.set_updated_at();
create trigger broker_clients_updated_at
before update on private.broker_clients
for each row execute function private.set_updated_at();
create trigger provider_requests_updated_at
before update on private.provider_requests
for each row execute function private.set_updated_at();
create trigger provider_evidence_immutable
before update or delete on private.provider_evidence_snapshots
for each row execute function private.reject_mutation();
create trigger provider_capabilities_immutable
before update or delete on private.provider_capabilities
for each row execute function private.reject_mutation();
create trigger provider_input_manifests_immutable
before update or delete on private.provider_input_manifests
for each row execute function private.reject_mutation();
create trigger micro_quote_lines_immutable
before update or delete on private.micro_quote_lines
for each row execute function private.reject_mutation();
create trigger provider_quote_claims_immutable
before update or delete on private.provider_request_quote_claims
for each row execute function private.reject_mutation();
create trigger provider_inbox_immutable
before update or delete on private.provider_inbox_messages
for each row execute function private.reject_mutation();
create trigger provider_late_immutable
before update or delete on private.provider_late_completions
for each row execute function private.reject_mutation();
create trigger provider_cost_immutable
before update or delete on private.provider_cost_events
for each row execute function private.reject_mutation();

create or replace function private.guard_preflight_micro_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.requires_micro_authority and not exists (
    select 1
    from private.micro_quotes q
    join private.micro_authorizations a on a.micro_quote_id = q.id
    join private.micro_reservations r on r.micro_quote_id = q.id
      and r.micro_authorization_id = a.id
    where q.id = new.micro_quote_id
      and a.id = new.micro_authorization_id
      and r.id = new.micro_reservation_id
      and q.workspace_id = new.workspace_id
      and q.episode_id = new.episode_id
      and q.configuration_candidate_id = new.configuration_candidate_id
      and q.script_revision_id = new.script_revision_id
      and q.preflight_kind = new.kind
      and q.state = 'confirmed' and q.expires_at > statement_timestamp()
      and a.state = 'active' and a.expires_at > statement_timestamp()
      and r.state = 'held' and r.expires_at > statement_timestamp()
      and a.hard_ceiling_minor = r.amount_minor
      and q.total_minor <= r.amount_minor
  ) then
    raise exception 'exact live micro authority is required' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger preflight_micro_authority_guard
before insert or update of micro_quote_id, micro_authorization_id, micro_reservation_id,
  requires_micro_authority on public.preflight_runs
for each row execute function private.guard_preflight_micro_authority();

create or replace function public.command_create_micro_quote(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_configuration_candidate_id uuid,
  p_script_revision_id uuid,
  p_preflight_kind public.preflight_kind,
  p_quote_hash text,
  p_rate_snapshot_hash text,
  p_lines jsonb,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  quote_id uuid;
  quote_number integer;
  line jsonb;
  computed_total bigint := 0;
  line_number integer := 0;
  capability private.provider_capabilities%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_quote_hash !~ '^[a-f0-9]{64}$'
    or p_rate_snapshot_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 32
    or pg_column_size(p_lines) > 131072
    or p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '24 hours'
  then
    raise exception 'micro quote envelope is invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'micro-quote:' || p_configuration_candidate_id::text || ':' ||
      p_preflight_kind::text, 0
    )
  );
  if not exists (
    select 1 from public.episode_configuration_candidates c
    where c.workspace_id = p_workspace_id and c.episode_id = p_episode_id
      and c.id = p_configuration_candidate_id
      and c.script_revision_id = p_script_revision_id
      and c.state in ('world_design','preflight','ready_to_lock')
  ) then
    raise exception 'current configuration candidate not found' using errcode = 'P0002';
  end if;
  select coalesce(max(q.quote_number), 0) + 1 into quote_number
  from private.micro_quotes q
  where q.configuration_candidate_id = p_configuration_candidate_id
    and q.preflight_kind = p_preflight_kind;
  insert into private.micro_quotes (
    workspace_id, episode_id, configuration_candidate_id, script_revision_id,
    preflight_kind, quote_number, quote_hash, rate_snapshot_hash, currency,
    total_minor, state, expires_at
  ) values (
    p_workspace_id, p_episode_id, p_configuration_candidate_id,
    p_script_revision_id, p_preflight_kind, quote_number, p_quote_hash,
    p_rate_snapshot_hash, 'USD', 0, 'priced', p_expires_at
  ) returning id into quote_id;
  for line in select * from jsonb_array_elements(p_lines)
  loop
    line_number := line_number + 1;
    if jsonb_typeof(line) <> 'object'
      or (line - array[
        'slotKey','capabilityId','operation','quantity','unitPriceMinor',
        'amountMinor','requestSchemaHash'
      ]::text[]) <> '{}'::jsonb
      or not (line ?& array[
        'slotKey','capabilityId','operation','quantity','unitPriceMinor',
        'amountMinor','requestSchemaHash'
      ])
      or line ->> 'slotKey' !~ '^[a-z][a-z0-9_.:-]{2,140}$'
      or line ->> 'capabilityId' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or line ->> 'operation' not in (
        'gen_image','edit_image','gen_speech','align_speech','asr',
        'gen_music_preview','gen_sfx_preview','zero_cost'
      )
      or line ->> 'requestSchemaHash' !~ '^[a-f0-9]{64}$'
    then
      raise exception 'micro quote line is invalid' using errcode = '22023';
    end if;
    select * into capability from private.provider_capabilities
    where id = (line ->> 'capabilityId')::uuid
      and capability = line ->> 'operation'
      and status = 'verified'
      and expires_at > statement_timestamp();
    if not found
      or capability.unit_price_minor <> (line ->> 'unitPriceMinor')::bigint
      or (line ->> 'amountMinor')::bigint > capability.maximum_request_minor
    then
      raise exception 'micro quote capability is stale' using errcode = '40001';
    end if;
    insert into private.micro_quote_lines (
      micro_quote_id, line_number, slot_key, capability_id, operation,
      quantity, unit_price_minor, amount_minor, request_schema_hash
    ) values (
      quote_id, line_number, line ->> 'slotKey', capability.id,
      line ->> 'operation', (line ->> 'quantity')::numeric,
      (line ->> 'unitPriceMinor')::bigint, (line ->> 'amountMinor')::bigint,
      line ->> 'requestSchemaHash'
    );
    computed_total := computed_total + (line ->> 'amountMinor')::bigint;
  end loop;
  if computed_total > 7500 then
    raise exception 'micro quote exceeds checkpoint ceiling' using errcode = '54000';
  end if;
  update private.micro_quotes set total_minor = computed_total where id = quote_id;
  return quote_id;
end;
$$;

create or replace function public.command_register_provider_input_manifest(
  p_manifest_id uuid,
  p_workspace_id uuid,
  p_operation text,
  p_payload_schema_version text,
  p_payload_json jsonb,
  p_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_operation not in (
      'gen_image','edit_image','gen_speech','align_speech','asr',
      'gen_music_preview','gen_sfx_preview','zero_cost'
    )
    or p_payload_schema_version !~ '^[a-z0-9_.-]{3,100}$'
    or jsonb_typeof(p_payload_json) <> 'object'
    or pg_column_size(p_payload_json) > 262144
    or p_content_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'provider input manifest is invalid' using errcode = '22023'; end if;
  insert into private.provider_input_manifests (
    id, workspace_id, operation, payload_schema_version, payload_json, content_hash
  ) values (
    p_manifest_id, p_workspace_id, p_operation, p_payload_schema_version,
    p_payload_json, p_content_hash
  );
  return p_manifest_id;
end;
$$;

create or replace function public.command_authorize_micro_quote(
  p_workspace_id uuid,
  p_micro_quote_id uuid,
  p_expected_quote_version bigint,
  p_quote_hash text,
  p_hard_ceiling_minor bigint,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_epoch bigint;
  quote private.micro_quotes%rowtype;
  authorization_id uuid;
  reservation_id uuid;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_aal2();
  select authority_epoch into actor_epoch from public.memberships
  where workspace_id = p_workspace_id and user_id = actor_id and status = 'active';
  if actor_epoch is null then raise exception 'active membership required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('micro-authorize:' || p_micro_quote_id::text, 0)
  );
  select * into quote from private.micro_quotes
  where id = p_micro_quote_id and workspace_id = p_workspace_id for update;
  if not found then raise exception 'micro quote not found' using errcode = 'P0002'; end if;
  if quote.aggregate_version <> p_expected_quote_version
    or quote.state <> 'priced' or quote.expires_at <= statement_timestamp()
    or quote.quote_hash <> p_quote_hash
    or p_hard_ceiling_minor <> quote.total_minor
  then
    raise exception 'micro quote authorization is stale' using errcode = '40001';
  end if;
  insert into private.micro_authorizations (
    workspace_id, micro_quote_id, configuration_candidate_id,
    script_revision_id, authorized_by, actor_authority_epoch, aal, quote_hash,
    hard_ceiling_minor, state, expires_at
  ) values (
    p_workspace_id, quote.id, quote.configuration_candidate_id,
    quote.script_revision_id, actor_id, actor_epoch, 'aal2', quote.quote_hash,
    p_hard_ceiling_minor, 'active', quote.expires_at
  ) returning id into authorization_id;
  insert into private.micro_reservations (
    workspace_id, micro_quote_id, micro_authorization_id, amount_minor,
    state, expires_at
  ) values (
    p_workspace_id, quote.id, authorization_id, p_hard_ceiling_minor,
    'held', quote.expires_at
  ) returning id into reservation_id;
  update private.micro_quotes
  set state = 'confirmed', confirmed_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where id = quote.id returning * into quote;
  perform private.insert_audit_event(
    p_workspace_id, 'micro_quote.authorize', 'episode', quote.episode_id,
    quote.aggregate_version, p_command_id, p_idempotency_key, p_correlation_id,
    'allow', 'accepted', null,
    jsonb_build_object('quoteId', quote.id, 'ceilingMinor', p_hard_ceiling_minor)
  );
  return jsonb_build_object(
    'ok', true, 'microQuoteId', quote.id,
    'microAuthorizationId', authorization_id,
    'microReservationId', reservation_id,
    'aggregateVersion', quote.aggregate_version
  );
end;
$$;

create or replace function public.command_claim_micro_provider_slot(
  p_workspace_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_micro_quote_line_id uuid,
  p_input_manifest_id uuid,
  p_input_manifest_hash text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_retry_of_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  line private.micro_quote_lines%rowtype;
  capability private.provider_capabilities%rowtype;
  request_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_input_manifest_hash !~ '^[a-f0-9]{64}$'
    or char_length(p_idempotency_key) not between 8 and 200
  then raise exception 'provider slot envelope is invalid' using errcode = '22023'; end if;
  select * into run from public.preflight_runs
  where id = p_preflight_run_id and workspace_id = p_workspace_id for update;
  select * into attempt from public.preflight_stage_attempts
  where id = p_stage_attempt_id and preflight_run_id = p_preflight_run_id for update;
  select * into line from private.micro_quote_lines
  where id = p_micro_quote_line_id and micro_quote_id = run.micro_quote_id for update;
  if run.state not in ('running','waiting_external')
    or not run.requires_micro_authority or line.id is null
    or attempt.state not in ('running','waiting_external')
    or attempt.authority_epoch <> run.authority_epoch
    or attempt.fencing_token <> (
      select highest_fencing_token from public.preflight_stage_runs
      where id = attempt.preflight_stage_run_id
    )
    or attempt.input_manifest_id <> p_input_manifest_id
    or attempt.input_manifest_hash <> p_input_manifest_hash
    or not exists (
      select 1
      from private.micro_authorizations a
      join private.micro_reservations r on r.micro_authorization_id = a.id
      where a.id = run.micro_authorization_id and r.id = run.micro_reservation_id
        and a.state = 'active' and r.state in ('held','partially_settled')
        and a.expires_at > statement_timestamp()
        and r.expires_at > statement_timestamp()
    )
  then raise exception 'provider slot authority is stale' using errcode = '40001'; end if;
  select * into capability from private.provider_capabilities
  where id = line.capability_id and capability = line.operation
    and status = 'verified' and expires_at > statement_timestamp();
  if not found then raise exception 'provider capability is stale' using errcode = '40001'; end if;
  if not exists (
    select 1 from private.provider_input_manifests manifest
    where manifest.id = p_input_manifest_id
      and manifest.workspace_id = p_workspace_id
      and manifest.operation = line.operation
      and manifest.content_hash = p_input_manifest_hash
  ) then raise exception 'provider input manifest is stale' using errcode = '40001'; end if;
  if p_retry_of_id is not null and not exists (
    select 1 from private.provider_requests prior
    where prior.id = p_retry_of_id
      and prior.workspace_id = p_workspace_id
      and prior.preflight_run_id = p_preflight_run_id
      and prior.state = 'failed_retryable'
  ) then raise exception 'retry predecessor is invalid' using errcode = '40001'; end if;
  insert into private.provider_requests (
    workspace_id, preflight_run_id, stage_attempt_id, provider_account_id,
    provider_capability_id, operation, request_schema_version,
    input_manifest_id, input_manifest_hash, idempotency_key, correlation_id,
    retry_of_id, expected_cost_minor, maximum_cost_minor
  ) values (
    p_workspace_id, p_preflight_run_id, p_stage_attempt_id,
    capability.provider_account_id, capability.id, line.operation,
    capability.schema_version, p_input_manifest_id, p_input_manifest_hash,
    p_idempotency_key, p_correlation_id, p_retry_of_id, line.amount_minor,
    line.amount_minor
  ) returning id into request_id;
  insert into private.provider_request_quote_claims (
    workspace_id, provider_request_id, preflight_run_id, micro_quote_line_id,
    micro_authorization_id, micro_reservation_id, authority_epoch, fencing_token
  ) values (
    p_workspace_id, request_id, run.id, line.id, run.micro_authorization_id,
    run.micro_reservation_id, run.authority_epoch, attempt.fencing_token
  );
  return request_id;
end;
$$;

create or replace function public.command_issue_worker_capability_grant(
  p_workspace_id uuid,
  p_provider_request_id uuid,
  p_capability_jti uuid,
  p_allowed_object_scope_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request private.provider_requests%rowtype;
  claim private.provider_request_quote_claims%rowtype;
  grant_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_allowed_object_scope_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '5 minutes'
  then raise exception 'capability grant envelope is invalid' using errcode = '22023'; end if;
  select * into request from private.provider_requests
  where id = p_provider_request_id and workspace_id = p_workspace_id
    and state = 'reserved' for update;
  select * into claim from private.provider_request_quote_claims
  where provider_request_id = request.id;
  if request.id is null or claim.id is null then
    raise exception 'reserved provider request not found' using errcode = 'P0002';
  end if;
  insert into private.worker_capability_grants (
    workspace_id, preflight_run_id, stage_attempt_id, provider_request_id,
    micro_quote_line_id, capability, authority_epoch, fencing_token,
    input_manifest_hash, token_jti_hash, allowed_rpc,
    allowed_object_scope_hash, expires_at
  ) values (
    p_workspace_id, request.preflight_run_id, request.stage_attempt_id,
    request.id, claim.micro_quote_line_id, request.operation,
    claim.authority_epoch, claim.fencing_token, request.input_manifest_hash,
    encode(extensions.digest(convert_to(p_capability_jti::text, 'UTF8'), 'sha256'), 'hex'),
    'provider.submit_exact_request', p_allowed_object_scope_hash, p_expires_at
  ) returning id into grant_id;
  return grant_id;
end;
$$;

create or replace function private.assert_broker_admin(
  p_workspace_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_aal2();
  if not private.has_workspace_role(
    p_workspace_id, actor_id, array['admin']::public.membership_role[]
  ) then raise exception 'security admin required' using errcode = '42501'; end if;
  return actor_id;
end;
$$;

create or replace function public.command_register_broker_client(
  p_workspace_id uuid,
  p_environment text,
  p_trigger_project text,
  p_client_id text,
  p_audience text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid; client_uuid uuid;
begin
  actor_id := private.assert_broker_admin(p_workspace_id);
  insert into private.broker_clients (
    workspace_id, environment, trigger_project, client_id, audience, state,
    registered_by, disabled_at
  ) values (
    p_workspace_id, p_environment, p_trigger_project, p_client_id, p_audience,
    'disabled', actor_id, statement_timestamp()
  ) returning id into client_uuid;
  return client_uuid;
end;
$$;

create or replace function public.command_add_broker_client_key(
  p_broker_client_id uuid,
  p_expected_client_version bigint,
  p_kid text,
  p_public_key_spki_base64 text,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_overlap_until timestamptz,
  p_rotation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare client private.broker_clients%rowtype; actor_id uuid; key_id uuid;
begin
  select * into client from private.broker_clients
  where id = p_broker_client_id for update;
  if not found then raise exception 'broker client not found' using errcode = 'P0002'; end if;
  actor_id := private.assert_broker_admin(client.workspace_id);
  if client.aggregate_version <> p_expected_client_version then
    raise exception 'stale broker client version' using errcode = '40001';
  end if;
  insert into private.broker_client_key_versions (
    broker_client_id, kid, public_key_spki_base64, state, valid_from,
    valid_until, overlap_until, rotation_reason, created_by
  ) values (
    client.id, p_kid, p_public_key_spki_base64, 'pending', p_valid_from,
    p_valid_until, p_overlap_until, p_rotation_reason, actor_id
  ) returning id into key_id;
  update private.broker_clients set aggregate_version = aggregate_version + 1
  where id = client.id;
  return key_id;
end;
$$;

create or replace function public.command_activate_broker_client_key(
  p_broker_client_id uuid,
  p_broker_key_id uuid,
  p_expected_client_version bigint,
  p_expected_key_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare client private.broker_clients%rowtype; key private.broker_client_key_versions%rowtype;
begin
  select * into client from private.broker_clients where id = p_broker_client_id for update;
  perform private.assert_broker_admin(client.workspace_id);
  select * into key from private.broker_client_key_versions
  where id = p_broker_key_id and broker_client_id = client.id for update;
  if client.aggregate_version <> p_expected_client_version
    or key.aggregate_version <> p_expected_key_version
    or key.state <> 'pending'
    or statement_timestamp() not between key.valid_from and key.valid_until
  then raise exception 'broker key activation is stale' using errcode = '40001'; end if;
  if (
    select count(*) from private.broker_client_key_versions existing
    where existing.broker_client_id = client.id and existing.state = 'active'
      and existing.valid_until > statement_timestamp()
  ) >= 2 then
    raise exception 'broker key overlap limit exceeded' using errcode = '54000';
  end if;
  update private.broker_client_key_versions
  set state = 'active', activated_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where id = key.id;
  update private.broker_clients
  set state = 'active', disabled_at = null, aggregate_version = aggregate_version + 1
  where id = client.id returning * into client;
  return jsonb_build_object(
    'ok', true, 'brokerClientId', client.id, 'kid', key.kid,
    'aggregateVersion', client.aggregate_version
  );
end;
$$;

create or replace function public.command_revoke_broker_client_key(
  p_broker_client_id uuid,
  p_broker_key_id uuid,
  p_expected_key_version bigint,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare client private.broker_clients%rowtype; key private.broker_client_key_versions%rowtype;
begin
  select * into client from private.broker_clients where id = p_broker_client_id for update;
  perform private.assert_broker_admin(client.workspace_id);
  select * into key from private.broker_client_key_versions
  where id = p_broker_key_id and broker_client_id = client.id for update;
  if key.aggregate_version <> p_expected_key_version or key.state = 'revoked'
    or char_length(btrim(p_reason)) not between 1 and 1000
  then raise exception 'broker key revocation is stale' using errcode = '40001'; end if;
  update private.broker_client_key_versions
  set state = 'revoked', revoked_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where id = key.id;
  update private.broker_assertion_jtis
  set revoked_at = statement_timestamp()
  where broker_key_version_id = key.id and revoked_at is null
    and expires_at > statement_timestamp();
  return true;
end;
$$;

create or replace function public.command_disable_broker_client(
  p_broker_client_id uuid,
  p_expected_client_version bigint,
  p_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare client private.broker_clients%rowtype;
begin
  select * into client from private.broker_clients
  where id = p_broker_client_id for update;
  perform private.assert_broker_admin(client.workspace_id);
  if client.aggregate_version <> p_expected_client_version
    or char_length(btrim(p_reason)) not between 1 and 1000
  then raise exception 'broker client disable is stale' using errcode = '40001'; end if;
  update private.broker_clients
  set state = 'disabled', disabled_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1 where id = client.id;
  update private.broker_client_key_versions
  set state = 'revoked', revoked_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where broker_client_id = client.id and state <> 'revoked';
  update private.broker_assertion_jtis
  set revoked_at = statement_timestamp()
  where broker_client_id = client.id and revoked_at is null
    and expires_at > statement_timestamp();
  return true;
end;
$$;

create or replace function public.get_broker_verification_context(
  p_client_id text,
  p_kid text,
  p_environment text,
  p_trigger_project text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare client private.broker_clients%rowtype; key private.broker_client_key_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into client from private.broker_clients
  where client_id = p_client_id and environment = p_environment
    and trigger_project = p_trigger_project and state = 'active';
  if not found then raise exception 'broker client is unavailable' using errcode = '42501'; end if;
  select * into key from private.broker_client_key_versions
  where broker_client_id = client.id and kid = p_kid and state = 'active'
    and statement_timestamp() between valid_from and valid_until;
  if not found then raise exception 'broker key is unavailable' using errcode = '42501'; end if;
  return jsonb_build_object(
    'brokerClientDatabaseId', client.id,
    'brokerKeyDatabaseId', key.id,
    'audience', client.audience,
    'clientId', client.client_id,
    'environment', client.environment,
    'triggerProject', client.trigger_project,
    'kid', key.kid,
    'publicKeySpkiBase64', key.public_key_spki_base64
  );
end;
$$;

create or replace function public.get_provider_dispatch_manifest(
  p_provider_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare request private.provider_requests%rowtype;
  account private.provider_accounts%rowtype;
  capability private.provider_capabilities%rowtype;
  manifest private.provider_input_manifests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  select * into request from private.provider_requests
  where id = p_provider_request_id and state = 'queued';
  if not found then raise exception 'queued provider request not found' using errcode = 'P0002'; end if;
  select * into account from private.provider_accounts
  where id = request.provider_account_id and state = 'active';
  select * into capability from private.provider_capabilities
  where id = request.provider_capability_id and status = 'verified'
    and expires_at > statement_timestamp();
  select * into manifest from private.provider_input_manifests
  where id = request.input_manifest_id and workspace_id = request.workspace_id
    and content_hash = request.input_manifest_hash and operation = request.operation;
  if account.id is null or capability.id is null or manifest.id is null then
    raise exception 'provider dispatch configuration is stale' using errcode = '40001'; end if;
  return jsonb_build_object(
    'providerRequestId', request.id,
    'workspaceId', request.workspace_id,
    'provider', account.provider,
    'credentialSecretRef', account.credential_secret_ref,
    'operation', request.operation,
    'modelKey', capability.model_key,
    'endpointKey', capability.endpoint_key,
    'payloadSchemaVersion', manifest.payload_schema_version,
    'payload', manifest.payload_json,
    'inputManifestHash', manifest.content_hash,
    'expectedCostMinor', request.expected_cost_minor,
    'maximumCostMinor', request.maximum_cost_minor,
    'aggregateVersion', request.aggregate_version,
    'correlationId', request.correlation_id
  );
end;
$$;

create or replace function public.command_consume_provider_broker_authority(
  p_provider_request_id uuid,
  p_capability_grant_id uuid,
  p_client_id text,
  p_kid text,
  p_environment text,
  p_trigger_project text,
  p_assertion_jti uuid,
  p_assertion_subject text,
  p_assertion_issued_at timestamptz,
  p_assertion_expires_at timestamptz,
  p_capability_jti uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare client private.broker_clients%rowtype; key private.broker_client_key_versions%rowtype;
  request private.provider_requests%rowtype; grant_row private.worker_capability_grants%rowtype;
  claim private.provider_request_quote_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_assertion_expires_at <= statement_timestamp() - interval '5 seconds'
    or p_assertion_expires_at > p_assertion_issued_at + interval '60 seconds'
    or p_assertion_issued_at > statement_timestamp() + interval '5 seconds'
    or char_length(p_assertion_subject) not between 8 and 600
  then raise exception 'broker assertion window is invalid' using errcode = '42501'; end if;
  select * into client from private.broker_clients
  where client_id = p_client_id and environment = p_environment
    and trigger_project = p_trigger_project for update;
  select * into key from private.broker_client_key_versions
  where broker_client_id = client.id and kid = p_kid for update;
  select * into request from private.provider_requests
  where id = p_provider_request_id for update;
  select * into grant_row from private.worker_capability_grants
  where id = p_capability_grant_id and provider_request_id = request.id for update;
  select * into claim from private.provider_request_quote_claims
  where provider_request_id = request.id;
  if client.state <> 'active' or key.state <> 'active'
    or statement_timestamp() not between key.valid_from and key.valid_until
    or request.state <> 'reserved' or grant_row.state <> 'active'
    or grant_row.expires_at <= statement_timestamp()
    or grant_row.token_jti_hash <> encode(
      extensions.digest(convert_to(p_capability_jti::text, 'UTF8'), 'sha256'), 'hex'
    )
    or grant_row.workspace_id <> request.workspace_id
    or grant_row.preflight_run_id <> request.preflight_run_id
    or grant_row.stage_attempt_id <> request.stage_attempt_id
    or grant_row.capability <> request.operation
    or grant_row.input_manifest_hash <> request.input_manifest_hash
    or grant_row.micro_quote_line_id <> claim.micro_quote_line_id
    or grant_row.authority_epoch <> claim.authority_epoch
    or grant_row.fencing_token <> claim.fencing_token
    or not exists (
      select 1 from public.preflight_stage_attempts a
      join public.preflight_stage_runs s on s.id = a.preflight_stage_run_id
      join public.preflight_runs r on r.id = a.preflight_run_id
      where a.id = request.stage_attempt_id
        and a.state in ('running','waiting_external')
        and a.authority_epoch = grant_row.authority_epoch
        and a.fencing_token = grant_row.fencing_token
        and s.highest_fencing_token = a.fencing_token
        and r.authority_epoch = a.authority_epoch
        and r.state in ('running','waiting_external')
    )
  then raise exception 'broker authority is stale' using errcode = '40001'; end if;
  insert into private.broker_assertion_jtis (
    broker_client_id, broker_key_version_id, jti_hash, assertion_subject,
    provider_request_id, capability_grant_id, issued_at, expires_at
  ) values (
    client.id, key.id,
    encode(extensions.digest(convert_to(p_assertion_jti::text, 'UTF8'), 'sha256'), 'hex'),
    p_assertion_subject, request.id, grant_row.id, p_assertion_issued_at,
    p_assertion_expires_at
  );
  update private.worker_capability_grants
  set state = 'consumed', consumed_at = statement_timestamp()
  where id = grant_row.id;
  update private.provider_requests
  set state = 'queued', aggregate_version = aggregate_version + 1
  where id = request.id returning * into request;
  insert into private.outbox_events (
    workspace_id, event_type, destination, payload_json, idempotency_key
  ) values (
    request.workspace_id, 'provider.request.queued', 'vercel.provider-broker',
    jsonb_build_object(
      'providerRequestId', request.id,
      'capabilityGrantId', grant_row.id,
      'preflightRunId', request.preflight_run_id,
      'stageAttemptId', request.stage_attempt_id
    ),
    'provider-request:' || request.id::text || ':queued'
  );
  return jsonb_build_object(
    'ok', true, 'providerRequestId', request.id, 'state', request.state,
    'aggregateVersion', request.aggregate_version
  );
exception
  when unique_violation then
    raise exception 'broker assertion replayed' using errcode = '54000';
end;
$$;

create or replace function public.command_transition_provider_request(
  p_provider_request_id uuid,
  p_expected_version bigint,
  p_event text,
  p_external_job_id text default null,
  p_safe_response_hash text default null,
  p_billable_state text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare request private.provider_requests%rowtype; next_state private.provider_request_state;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into request from private.provider_requests
  where id = p_provider_request_id for update;
  if not found then raise exception 'provider request not found' using errcode = 'P0002'; end if;
  if request.aggregate_version <> p_expected_version then
    raise exception 'stale provider request version' using errcode = '40001'; end if;
  next_state := case
    when p_event = 'submit' and request.state = 'queued' then 'submitted'
    when p_event = 'accept' and request.state = 'submitted' then 'accepted'
    when p_event = 'poll' and request.state in ('accepted','polling') then 'polling'
    when p_event = 'fail_retryable' and request.state in (
      'submitted','accepted','polling'
    ) then 'failed_retryable'
    when p_event = 'fail_terminal' and request.state in (
      'submitted','accepted','polling'
    ) then 'failed_terminal'
    when p_event = 'request_cancel' and request.state in (
      'reserved','queued','submitted','accepted','polling'
    ) then 'cancel_requested'
    when p_event = 'confirm_canceled' and request.state = 'cancel_requested' then 'canceled'
    else null
  end;
  if next_state is null then
    raise exception 'invalid provider request transition' using errcode = '55000'; end if;
  if p_event = 'accept' and (
    p_external_job_id is null or char_length(p_external_job_id) not between 3 and 240
  ) then raise exception 'provider external job ID required' using errcode = '22023'; end if;
  if p_safe_response_hash is not null and p_safe_response_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'provider response hash is invalid' using errcode = '22023'; end if;
  update private.provider_requests
  set state = next_state,
      external_job_id = coalesce(p_external_job_id, external_job_id),
      safe_response_hash = coalesce(p_safe_response_hash, safe_response_hash),
      billable_state = coalesce(p_billable_state, billable_state),
      submitted_at = case when next_state = 'submitted'
        then statement_timestamp() else submitted_at end,
      completed_at = case when next_state in (
        'failed_retryable','failed_terminal','canceled'
      ) then statement_timestamp() else null end,
      aggregate_version = aggregate_version + 1
  where id = request.id returning * into request;
  return jsonb_build_object(
    'ok', true, 'providerRequestId', request.id, 'state', request.state,
    'aggregateVersion', request.aggregate_version
  );
end;
$$;

create or replace function public.command_record_provider_inbox(
  p_provider_account_id uuid,
  p_provider_request_id uuid,
  p_provider_event_id text,
  p_canonical_payload_hash text,
  p_raw_body_sha256 text,
  p_signature_verified boolean,
  p_verification_class text,
  p_safe_summary jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare inbox_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_canonical_payload_hash !~ '^[a-f0-9]{64}$'
    or p_raw_body_sha256 !~ '^[a-f0-9]{64}$'
    or p_verification_class not in ('signed','poll_signal_only','rejected')
    or jsonb_typeof(p_safe_summary) <> 'object'
    or pg_column_size(p_safe_summary) > 16384
    or (p_verification_class = 'signed' and not p_signature_verified)
  then raise exception 'provider inbox envelope is invalid' using errcode = '22023'; end if;
  insert into private.provider_inbox_messages (
    provider_account_id, provider_request_id, provider_event_id,
    canonical_payload_hash, raw_body_sha256, signature_verified,
    verification_class, safe_summary
  ) values (
    p_provider_account_id, p_provider_request_id, p_provider_event_id,
    p_canonical_payload_hash, p_raw_body_sha256, p_signature_verified,
    p_verification_class, p_safe_summary
  ) returning id into inbox_id;
  return inbox_id;
end;
$$;

create or replace function public.command_record_provider_late_completion(
  p_provider_request_id uuid,
  p_canonical_event_hash text,
  p_classification text,
  p_quarantined_asset_id uuid,
  p_billable_minor bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare completion_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if not exists (
    select 1 from private.provider_requests
    where id = p_provider_request_id and state in (
      'succeeded','failed_retryable','failed_terminal','canceled'
    )
  ) then raise exception 'provider request is not terminal' using errcode = '55000'; end if;
  insert into private.provider_late_completions (
    provider_request_id, canonical_event_hash, classification,
    quarantined_asset_id, billable_minor
  ) values (
    p_provider_request_id, p_canonical_event_hash, p_classification,
    p_quarantined_asset_id, p_billable_minor
  ) returning id into completion_id;
  return completion_id;
end;
$$;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on function private.guard_preflight_micro_authority(),
  private.assert_broker_admin(uuid) from public, anon, authenticated;
revoke all on function public.command_create_micro_quote(
  uuid,uuid,uuid,uuid,public.preflight_kind,text,text,jsonb,timestamptz
), public.command_register_provider_input_manifest(uuid,uuid,text,text,jsonb,text
), public.command_claim_micro_provider_slot(
  uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid
), public.command_issue_worker_capability_grant(uuid,uuid,uuid,text,timestamptz),
  public.get_broker_verification_context(text,text,text,text),
  public.get_provider_dispatch_manifest(uuid),
  public.command_consume_provider_broker_authority(
    uuid,uuid,text,text,text,text,uuid,text,timestamptz,timestamptz,uuid
  ), public.command_transition_provider_request(uuid,bigint,text,text,text,text),
  public.command_record_provider_inbox(uuid,uuid,text,text,text,boolean,text,jsonb),
  public.command_record_provider_late_completion(uuid,text,text,uuid,bigint)
from public, anon, authenticated;
grant execute on function public.command_create_micro_quote(
  uuid,uuid,uuid,uuid,public.preflight_kind,text,text,jsonb,timestamptz
), public.command_register_provider_input_manifest(uuid,uuid,text,text,jsonb,text
), public.command_claim_micro_provider_slot(
  uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid
), public.command_issue_worker_capability_grant(uuid,uuid,uuid,text,timestamptz),
  public.get_broker_verification_context(text,text,text,text),
  public.get_provider_dispatch_manifest(uuid),
  public.command_consume_provider_broker_authority(
    uuid,uuid,text,text,text,text,uuid,text,timestamptz,timestamptz,uuid
  ), public.command_transition_provider_request(uuid,bigint,text,text,text,text),
  public.command_record_provider_inbox(uuid,uuid,text,text,text,boolean,text,jsonb),
  public.command_record_provider_late_completion(uuid,text,text,uuid,bigint)
to service_role;

revoke all on function public.command_authorize_micro_quote(
  uuid,uuid,bigint,text,bigint,uuid,text,text,uuid
), public.command_register_broker_client(uuid,text,text,text,text),
  public.command_add_broker_client_key(
    uuid,bigint,text,text,timestamptz,timestamptz,timestamptz,text
  ), public.command_activate_broker_client_key(uuid,uuid,bigint,bigint),
  public.command_revoke_broker_client_key(uuid,uuid,bigint,text),
  public.command_disable_broker_client(uuid,bigint,text)
from public, anon, authenticated;
grant execute on function public.command_authorize_micro_quote(
  uuid,uuid,bigint,text,bigint,uuid,text,text,uuid
), public.command_register_broker_client(uuid,text,text,text,text),
  public.command_add_broker_client_key(
    uuid,bigint,text,text,timestamptz,timestamptz,timestamptz,text
  ), public.command_activate_broker_client_key(uuid,uuid,bigint,bigint),
  public.command_revoke_broker_client_key(uuid,uuid,bigint,text),
  public.command_disable_broker_client(uuid,bigint,text)
to authenticated;

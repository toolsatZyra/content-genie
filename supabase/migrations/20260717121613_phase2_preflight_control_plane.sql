-- Phase 2 / 0015: durable, credential-free preflight workflow authority.

create type public.preflight_kind as enum (
  'world_anchor',
  'secure_ingest',
  'narration_clock',
  'plan_evaluation'
);
create type public.preflight_run_state as enum (
  'created',
  'queued',
  'running',
  'waiting_external',
  'waiting_decision',
  'paused',
  'succeeded',
  'failed',
  'canceled',
  'superseded'
);
create type public.preflight_stage_state as enum (
  'created',
  'ready',
  'claimed',
  'running',
  'waiting_external',
  'waiting_decision',
  'succeeded',
  'failed_retryable',
  'failed_terminal',
  'canceled',
  'superseded'
);
create type public.preflight_lease_state as enum (
  'active',
  'consumed',
  'expired',
  'revoked'
);

create table public.preflight_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  episode_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  kind public.preflight_kind not null,
  run_number integer not null check (run_number > 0),
  authority_epoch bigint not null check (authority_epoch > 0),
  state public.preflight_run_state not null default 'created',
  requires_micro_authority boolean not null,
  micro_quote_id uuid,
  micro_authorization_id uuid,
  micro_reservation_id uuid,
  trigger_run_id text,
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  reconciliation_due_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, episode_id, id),
  unique (configuration_candidate_id, kind, run_number),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, episode_id, script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict,
  check (
    (requires_micro_authority and num_nonnulls(
      micro_quote_id, micro_authorization_id, micro_reservation_id
    ) = 3)
    or (not requires_micro_authority and num_nonnulls(
      micro_quote_id, micro_authorization_id, micro_reservation_id
    ) = 0)
  ),
  check (
    (state in ('running','waiting_external','waiting_decision','succeeded')
      and trigger_run_id is not null)
    or state in ('created','queued','paused','failed','canceled','superseded')
  ),
  check (
    (state in ('succeeded','failed','canceled','superseded') and completed_at is not null)
    or (state not in ('succeeded','failed','canceled','superseded') and completed_at is null)
  )
);

create unique index preflight_one_active_authority_uq
  on public.preflight_runs (configuration_candidate_id, kind)
  where state not in ('succeeded','failed','canceled','superseded');
create index preflight_runs_workspace_episode_idx
  on public.preflight_runs (workspace_id, episode_id, created_at desc);
create index preflight_runs_state_reconcile_idx
  on public.preflight_runs (state, reconciliation_due_at)
  where state in ('running','waiting_external','waiting_decision','paused');

create table public.preflight_stage_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  preflight_run_id uuid not null,
  stage_key text not null check (stage_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  stage_revision integer not null default 1 check (stage_revision > 0),
  queue_key text not null check (queue_key in (
    'genie-preflight-world-images',
    'genie-preflight-narration-clock',
    'genie-preflight-secure-ingest',
    'genie-preflight-plan-evaluation'
  )),
  state public.preflight_stage_state not null default 'created',
  required boolean not null default true,
  maximum_attempts integer not null default 3 check (maximum_attempts between 1 and 10),
  next_attempt_no integer not null default 1 check (next_attempt_no > 0),
  highest_fencing_token bigint not null default 0 check (highest_fencing_token >= 0),
  input_manifest_id uuid,
  input_manifest_hash text check (
    input_manifest_hash is null or input_manifest_hash ~ '^[a-f0-9]{64}$'
  ),
  output_manifest_id uuid,
  output_manifest_hash text check (
    output_manifest_hash is null or output_manifest_hash ~ '^[a-f0-9]{64}$'
  ),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  available_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, preflight_run_id, id),
  unique (preflight_run_id, stage_key, stage_revision),
  foreign key (workspace_id, preflight_run_id)
    references public.preflight_runs(workspace_id, id) on delete restrict,
  check ((input_manifest_id is null) = (input_manifest_hash is null)),
  check ((output_manifest_id is null) = (output_manifest_hash is null)),
  check (
    (state = 'succeeded' and output_manifest_id is not null and completed_at is not null)
    or (state in ('failed_terminal','canceled','superseded') and completed_at is not null)
    or (state not in ('succeeded','failed_terminal','canceled','superseded')
      and completed_at is null)
  )
);

create index preflight_stage_ready_idx
  on public.preflight_stage_runs (queue_key, available_at, preflight_run_id)
  where state in ('created','ready');

create table public.preflight_stage_dependencies (
  workspace_id uuid not null,
  preflight_run_id uuid not null,
  stage_run_id uuid not null,
  depends_on_stage_run_id uuid not null,
  required_output_role text not null
    check (required_output_role ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  expected_contract_hash text not null check (expected_contract_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  primary key (stage_run_id, depends_on_stage_run_id),
  foreign key (workspace_id, preflight_run_id, stage_run_id)
    references public.preflight_stage_runs(workspace_id, preflight_run_id, id)
    on delete restrict,
  foreign key (workspace_id, preflight_run_id, depends_on_stage_run_id)
    references public.preflight_stage_runs(workspace_id, preflight_run_id, id)
    on delete restrict,
  check (stage_run_id <> depends_on_stage_run_id)
);

create table public.preflight_stage_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  preflight_run_id uuid not null,
  preflight_stage_run_id uuid not null,
  attempt_no integer not null check (attempt_no > 0),
  authority_epoch bigint not null check (authority_epoch > 0),
  fencing_token bigint not null check (fencing_token > 0),
  input_manifest_id uuid not null,
  input_manifest_hash text not null check (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  state public.preflight_stage_state not null check (state in (
    'claimed','running','waiting_external','waiting_decision','succeeded',
    'failed_retryable','failed_terminal','canceled','superseded'
  )),
  trigger_task_id text check (
    trigger_task_id is null or trigger_task_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
  ),
  trigger_run_id text check (
    trigger_run_id is null or trigger_run_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
  ),
  output_manifest_id uuid,
  output_manifest_hash text check (
    output_manifest_hash is null or output_manifest_hash ~ '^[a-f0-9]{64}$'
  ),
  safe_error_class text check (
    safe_error_class is null or safe_error_class ~ '^[a-z][a-z0-9_.-]{2,100}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, preflight_run_id, id),
  unique (workspace_id, preflight_run_id, preflight_stage_run_id, id),
  unique (preflight_stage_run_id, attempt_no),
  unique (preflight_stage_run_id, fencing_token),
  foreign key (workspace_id, preflight_run_id, preflight_stage_run_id)
    references public.preflight_stage_runs(workspace_id, preflight_run_id, id)
    on delete restrict,
  check ((output_manifest_id is null) = (output_manifest_hash is null)),
  check (
    (state in ('succeeded','failed_retryable','failed_terminal','canceled','superseded')
      and completed_at is not null)
    or (state not in ('succeeded','failed_retryable','failed_terminal','canceled','superseded')
      and completed_at is null)
  )
);

create index preflight_attempts_reconcile_idx
  on public.preflight_stage_attempts (state, preflight_run_id, created_at)
  where state in ('claimed','running','waiting_external','waiting_decision');

create table public.preflight_stage_leases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  lease_owner text not null check (
    lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
  ),
  fencing_token bigint not null check (fencing_token > 0),
  state public.preflight_lease_state not null default 'active',
  issued_at timestamptz not null default statement_timestamp(),
  heartbeat_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  unique (workspace_id, id),
  unique (stage_attempt_id, fencing_token),
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict,
  check (expires_at > issued_at),
  check (
    (state = 'active' and closed_at is null)
    or (state <> 'active' and closed_at is not null)
  )
);

create unique index preflight_attempt_one_active_lease_uq
  on public.preflight_stage_leases (stage_attempt_id)
  where state = 'active';
create index preflight_leases_expiry_idx
  on public.preflight_stage_leases (expires_at, stage_attempt_id)
  where state = 'active';

create table private.preflight_command_receipts (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  idempotency_key text not null check (
    idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  ),
  command_type text not null check (command_type ~ '^preflight\.[a-z_.-]{2,80}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  response_json jsonb not null check (
    jsonb_typeof(response_json) = 'object' and pg_column_size(response_json) <= 16384
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, idempotency_key)
);

create table private.preflight_dead_letters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  authority_epoch bigint not null check (authority_epoch > 0),
  fencing_token bigint not null check (fencing_token > 0),
  reason_class text not null check (reason_class ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  safe_summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_summary) = 'object' and pg_column_size(safe_summary) <= 16384
  ),
  created_at timestamptz not null default statement_timestamp(),
  resolved_at timestamptz,
  unique (stage_attempt_id, fencing_token),
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict
);

create trigger preflight_runs_updated_at
before update on public.preflight_runs
for each row execute function private.set_updated_at();
create trigger preflight_stage_runs_updated_at
before update on public.preflight_stage_runs
for each row execute function private.set_updated_at();
create trigger preflight_dependencies_immutable
before update or delete on public.preflight_stage_dependencies
for each row execute function private.reject_mutation();
create trigger preflight_command_receipts_immutable
before update or delete on private.preflight_command_receipts
for each row execute function private.reject_mutation();
create trigger preflight_dead_letters_immutable
before update or delete on private.preflight_dead_letters
for each row execute function private.reject_mutation();

create or replace function private.guard_preflight_dependency_cycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    with recursive ancestors(id) as (
      select new.depends_on_stage_run_id
      union all
      select d.depends_on_stage_run_id
      from public.preflight_stage_dependencies d
      join ancestors a on a.id = d.stage_run_id
      where d.preflight_run_id = new.preflight_run_id
    )
    select 1 from ancestors where id = new.stage_run_id
  ) then
    raise exception 'preflight stage dependency cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger preflight_dependency_cycle_guard
before insert on public.preflight_stage_dependencies
for each row execute function private.guard_preflight_dependency_cycle();

create or replace function private.preflight_queue_for_kind(p_kind public.preflight_kind)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'world_anchor' then 'genie-preflight-world-images'
    when 'secure_ingest' then 'genie-preflight-secure-ingest'
    when 'narration_clock' then 'genie-preflight-narration-clock'
    when 'plan_evaluation' then 'genie-preflight-plan-evaluation'
  end;
$$;

create or replace function private.preflight_receipt(
  p_workspace_id uuid,
  p_idempotency_key text,
  p_command_type text,
  p_request_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  receipt private.preflight_command_receipts%rowtype;
begin
  select * into receipt from private.preflight_command_receipts
  where workspace_id = p_workspace_id and idempotency_key = p_idempotency_key;
  if not found then return null; end if;
  if receipt.command_type <> p_command_type or receipt.request_hash <> p_request_hash then
    raise exception 'preflight idempotency key reused with different request'
      using errcode = '22023';
  end if;
  return receipt.response_json;
end;
$$;

create or replace function private.record_preflight_receipt(
  p_command_id uuid,
  p_workspace_id uuid,
  p_idempotency_key text,
  p_command_type text,
  p_request_hash text,
  p_response jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.preflight_command_receipts (
    command_id, workspace_id, idempotency_key, command_type, request_hash,
    response_json
  ) values (
    p_command_id, p_workspace_id, p_idempotency_key, p_command_type,
    p_request_hash, p_response
  );
$$;

create or replace function public.command_create_preflight_run(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_configuration_candidate_id uuid,
  p_script_revision_id uuid,
  p_kind public.preflight_kind,
  p_requires_micro_authority boolean,
  p_micro_quote_id uuid,
  p_micro_authorization_id uuid,
  p_micro_reservation_id uuid,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate public.episode_configuration_candidates%rowtype;
  run_id uuid;
  run_number integer;
  authority_epoch bigint;
  response jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_request_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid preflight command envelope' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'preflight:' || p_configuration_candidate_id::text || ':' || p_kind::text,
      0
    )
  );
  response := private.preflight_receipt(
    p_workspace_id, p_idempotency_key, 'preflight.create', p_request_hash
  );
  if response is not null then return response; end if;

  select * into candidate from public.episode_configuration_candidates
  where workspace_id = p_workspace_id
    and episode_id = p_episode_id
    and id = p_configuration_candidate_id
    and script_revision_id = p_script_revision_id
    and state in ('world_design','preflight','ready_to_lock')
  for update;
  if not found then
    raise exception 'current configuration candidate not found' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.script_lock_events l
    where l.workspace_id = p_workspace_id
      and l.episode_id = p_episode_id
      and l.script_revision_id = p_script_revision_id
  ) then
    raise exception 'exact script lock is required' using errcode = '55000';
  end if;
  if (p_requires_micro_authority and num_nonnulls(
      p_micro_quote_id, p_micro_authorization_id, p_micro_reservation_id
    ) <> 3)
    or (not p_requires_micro_authority and num_nonnulls(
      p_micro_quote_id, p_micro_authorization_id, p_micro_reservation_id
    ) <> 0)
  then
    raise exception 'preflight micro authority shape is invalid' using errcode = '22023';
  end if;
  select coalesce(max(r.run_number), 0) + 1,
         coalesce(max(r.authority_epoch), 0) + 1
    into run_number, authority_epoch
  from public.preflight_runs r
  where r.configuration_candidate_id = p_configuration_candidate_id
    and r.kind = p_kind;

  insert into public.preflight_runs (
    workspace_id, episode_id, configuration_candidate_id, script_revision_id,
    kind, run_number, authority_epoch, requires_micro_authority,
    micro_quote_id, micro_authorization_id, micro_reservation_id
  ) values (
    p_workspace_id, p_episode_id, p_configuration_candidate_id,
    p_script_revision_id, p_kind, run_number, authority_epoch,
    p_requires_micro_authority, p_micro_quote_id, p_micro_authorization_id,
    p_micro_reservation_id
  ) returning id into run_id;

  insert into public.preflight_stage_runs (
    workspace_id, preflight_run_id, stage_key, queue_key
  ) values (
    p_workspace_id, run_id, p_kind::text || '.root',
    private.preflight_queue_for_kind(p_kind)
  );

  update public.episode_configuration_candidates
  set state = case when state = 'world_design' then 'preflight' else state end,
      aggregate_version = aggregate_version + 1
  where id = p_configuration_candidate_id;

  response := jsonb_build_object(
    'ok', true, 'preflightRunId', run_id, 'state', 'created',
    'authorityEpoch', authority_epoch, 'aggregateVersion', 1
  );
  perform private.record_preflight_receipt(
    p_command_id, p_workspace_id, p_idempotency_key, 'preflight.create',
    p_request_hash, response
  );
  return response;
end;
$$;

create or replace function public.command_transition_preflight_run(
  p_preflight_run_id uuid,
  p_expected_version bigint,
  p_command text,
  p_trigger_run_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.preflight_runs%rowtype;
  next_state public.preflight_run_state;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into run from public.preflight_runs
  where id = p_preflight_run_id for update;
  if not found then raise exception 'preflight run not found' using errcode = 'P0002'; end if;
  if run.aggregate_version <> p_expected_version then
    raise exception 'stale preflight run version' using errcode = '40001';
  end if;
  next_state := case
    when p_command = 'enqueue' and run.state in ('created','paused') then 'queued'
    when p_command = 'started' and run.state = 'queued' then 'running'
    when p_command = 'wait_external' and run.state = 'running' then 'waiting_external'
    when p_command = 'wait_decision' and run.state = 'running' then 'waiting_decision'
    when p_command = 'pause' and run.state in (
      'created','queued','running','waiting_external','waiting_decision'
    ) then 'paused'
    when p_command = 'resume' and run.state = 'paused' then 'queued'
    when p_command = 'succeed' and run.state in ('running','waiting_external') then 'succeeded'
    when p_command = 'fail' and run.state not in (
      'succeeded','failed','canceled','superseded'
    ) then 'failed'
    when p_command = 'cancel' and run.state not in (
      'succeeded','failed','canceled','superseded'
    ) then 'canceled'
    when p_command = 'supersede' and run.state not in (
      'succeeded','failed','canceled','superseded'
    ) then 'superseded'
    else null
  end;
  if next_state is null then
    raise exception 'invalid preflight transition' using errcode = '55000';
  end if;
  if p_command = 'started'
    and (p_trigger_run_id is null
      or p_trigger_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$')
  then
    raise exception 'valid Trigger run identity required' using errcode = '22023';
  end if;
  if p_command = 'succeed' and exists (
    select 1 from public.preflight_stage_runs s
    where s.preflight_run_id = run.id and s.required and s.state <> 'succeeded'
  ) then
    raise exception 'required preflight stages are incomplete' using errcode = '55000';
  end if;
  update public.preflight_runs
  set state = next_state,
      trigger_run_id = coalesce(p_trigger_run_id, trigger_run_id),
      aggregate_version = aggregate_version + 1,
      started_at = case when next_state = 'running' then coalesce(started_at,
        statement_timestamp()) else started_at end,
      reconciliation_due_at = case
        when next_state in ('waiting_external','waiting_decision','paused')
          then statement_timestamp() + interval '5 minutes'
        else null
      end,
      completed_at = case
        when next_state in ('succeeded','failed','canceled','superseded')
          then statement_timestamp()
        else null
      end
  where id = run.id
  returning * into run;

  if next_state in ('canceled','superseded') then
    update public.preflight_stage_attempts a
    set state = case when next_state = 'canceled' then 'canceled' else 'superseded' end,
        completed_at = statement_timestamp()
    where a.preflight_run_id = run.id
      and a.state in ('claimed','running','waiting_external','waiting_decision');
    update public.preflight_stage_leases l
    set state = 'revoked', closed_at = statement_timestamp()
    where l.preflight_run_id = run.id and l.state = 'active';
    update public.preflight_stage_runs s
    set state = case when next_state = 'canceled' then 'canceled' else 'superseded' end,
        completed_at = statement_timestamp(),
        aggregate_version = aggregate_version + 1
    where s.preflight_run_id = run.id
      and s.state not in ('succeeded','failed_terminal','canceled','superseded');
  end if;

  if next_state = 'queued' then
    insert into private.outbox_events (
      workspace_id, event_type, destination, payload_json, idempotency_key
    ) values (
      run.workspace_id, 'preflight.queued', 'trigger.genie-control',
      jsonb_build_object(
        'preflightRunId', run.id,
        'workspaceId', run.workspace_id,
        'authorityEpoch', run.authority_epoch,
        'kind', run.kind
      ),
      'preflight:' || run.id::text || ':epoch:' || run.authority_epoch::text ||
        ':version:' || run.aggregate_version::text
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'preflightRunId', run.id, 'state', run.state,
    'aggregateVersion', run.aggregate_version
  );
end;
$$;

create or replace function private.preflight_dependencies_succeeded(
  p_stage_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.preflight_stage_dependencies d
    join public.preflight_stage_runs upstream on upstream.id = d.depends_on_stage_run_id
    where d.stage_run_id = p_stage_run_id
      and (
        upstream.state <> 'succeeded'
        or upstream.output_manifest_hash <> d.expected_contract_hash
      )
  );
$$;

create or replace function public.command_make_preflight_stage_ready(
  p_stage_run_id uuid,
  p_expected_version bigint,
  p_input_manifest_id uuid,
  p_input_manifest_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage public.preflight_stage_runs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_input_manifest_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid preflight input hash' using errcode = '22023';
  end if;
  select s.* into stage
  from public.preflight_stage_runs s
  join public.preflight_runs r on r.id = s.preflight_run_id
  where s.id = p_stage_run_id and r.state = 'running'
  for update of s;
  if not found then raise exception 'runnable preflight stage not found' using errcode = 'P0002'; end if;
  if stage.aggregate_version <> p_expected_version or stage.state not in (
    'created','failed_retryable'
  ) then
    raise exception 'stale or invalid preflight stage' using errcode = '40001';
  end if;
  if not private.preflight_dependencies_succeeded(stage.id) then
    raise exception 'preflight dependencies are incomplete' using errcode = '55000';
  end if;
  update public.preflight_stage_runs
  set state = 'ready', input_manifest_id = p_input_manifest_id,
      input_manifest_hash = p_input_manifest_hash,
      aggregate_version = aggregate_version + 1
  where id = stage.id returning * into stage;
  return jsonb_build_object(
    'ok', true, 'stageRunId', stage.id, 'state', stage.state,
    'aggregateVersion', stage.aggregate_version
  );
end;
$$;

create or replace function public.command_claim_preflight_stage(
  p_stage_run_id uuid,
  p_expected_version bigint,
  p_authority_epoch bigint,
  p_lease_owner text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  attempt_id uuid;
  lease_id uuid;
  fence bigint;
  attempt_no integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
    or p_lease_seconds not between 30 and 900
  then
    raise exception 'invalid preflight claim' using errcode = '22023';
  end if;
  select * into stage from public.preflight_stage_runs
  where id = p_stage_run_id for update;
  if not found then raise exception 'preflight stage not found' using errcode = 'P0002'; end if;
  select * into run from public.preflight_runs
  where id = stage.preflight_run_id for update;
  if stage.aggregate_version <> p_expected_version
    or stage.state <> 'ready'
    or stage.available_at > statement_timestamp()
    or run.state <> 'running'
    or run.authority_epoch <> p_authority_epoch
    or stage.input_manifest_id is null
  then
    raise exception 'preflight stage claim is stale' using errcode = '40001';
  end if;
  if stage.next_attempt_no > stage.maximum_attempts then
    raise exception 'preflight attempt budget exhausted' using errcode = '54000';
  end if;
  fence := stage.highest_fencing_token + 1;
  attempt_no := stage.next_attempt_no;
  insert into public.preflight_stage_attempts (
    workspace_id, preflight_run_id, preflight_stage_run_id, attempt_no,
    authority_epoch, fencing_token, input_manifest_id, input_manifest_hash,
    state
  ) values (
    stage.workspace_id, stage.preflight_run_id, stage.id, attempt_no,
    run.authority_epoch, fence, stage.input_manifest_id,
    stage.input_manifest_hash, 'claimed'
  ) returning id into attempt_id;
  insert into public.preflight_stage_leases (
    workspace_id, preflight_run_id, stage_attempt_id, lease_owner,
    fencing_token, expires_at
  ) values (
    stage.workspace_id, stage.preflight_run_id, attempt_id, p_lease_owner,
    fence, statement_timestamp() + make_interval(secs => p_lease_seconds)
  ) returning id into lease_id;
  update public.preflight_stage_runs
  set state = 'claimed', next_attempt_no = next_attempt_no + 1,
      highest_fencing_token = fence, aggregate_version = aggregate_version + 1
  where id = stage.id returning * into stage;
  return jsonb_build_object(
    'ok', true, 'stageRunId', stage.id, 'stageAttemptId', attempt_id,
    'leaseId', lease_id, 'attemptNo', attempt_no, 'fencingToken', fence,
    'authorityEpoch', run.authority_epoch, 'inputManifestId', stage.input_manifest_id,
    'inputManifestSha256', stage.input_manifest_hash,
    'aggregateVersion', stage.aggregate_version
  );
end;
$$;

create or replace function public.command_start_preflight_attempt(
  p_stage_attempt_id uuid,
  p_fencing_token bigint,
  p_authority_epoch bigint,
  p_input_manifest_hash text,
  p_trigger_task_id text,
  p_trigger_run_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_trigger_task_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
    or p_trigger_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
  then
    raise exception 'invalid Trigger identity' using errcode = '22023';
  end if;
  update public.preflight_stage_attempts
  set state = 'running', trigger_task_id = p_trigger_task_id,
      trigger_run_id = p_trigger_run_id, started_at = statement_timestamp()
  where id = p_stage_attempt_id and state = 'claimed'
    and fencing_token = p_fencing_token
    and authority_epoch = p_authority_epoch
    and input_manifest_hash = p_input_manifest_hash
    and exists (
      select 1 from public.preflight_stage_leases l
      where l.stage_attempt_id = p_stage_attempt_id
        and l.fencing_token = p_fencing_token
        and l.state = 'active' and l.expires_at > statement_timestamp()
    )
  returning * into attempt;
  if not found then raise exception 'stale preflight attempt start' using errcode = '40001'; end if;
  update public.preflight_stage_runs
  set state = 'running', aggregate_version = aggregate_version + 1
  where id = attempt.preflight_stage_run_id and state = 'claimed';
  return jsonb_build_object(
    'ok', true, 'stageAttemptId', attempt.id, 'state', attempt.state
  );
end;
$$;

create or replace function public.command_heartbeat_preflight_attempt(
  p_stage_attempt_id uuid,
  p_lease_id uuid,
  p_fencing_token bigint,
  p_extend_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_extend_seconds not between 30 and 300 then
    raise exception 'invalid heartbeat duration' using errcode = '22023';
  end if;
  update public.preflight_stage_leases l
  set heartbeat_at = statement_timestamp(),
      expires_at = least(
        statement_timestamp() + make_interval(secs => p_extend_seconds),
        l.issued_at + interval '15 minutes'
      )
  where l.id = p_lease_id and l.stage_attempt_id = p_stage_attempt_id
    and l.fencing_token = p_fencing_token and l.state = 'active'
    and l.expires_at > statement_timestamp()
  returning expires_at into expiry;
  if not found then raise exception 'stale preflight heartbeat' using errcode = '40001'; end if;
  return expiry;
end;
$$;

create or replace function public.command_complete_preflight_attempt(
  p_stage_attempt_id uuid,
  p_fencing_token bigint,
  p_authority_epoch bigint,
  p_input_manifest_hash text,
  p_outcome text,
  p_output_manifest_id uuid default null,
  p_output_manifest_hash text default null,
  p_safe_error_class text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  next_state public.preflight_stage_state;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_outcome not in (
    'waiting_external','waiting_decision','succeeded','failed_retryable','failed_terminal'
  ) or (p_safe_error_class is not null
    and p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$')
  then
    raise exception 'invalid preflight completion outcome' using errcode = '22023';
  end if;
  if (p_outcome = 'succeeded' and num_nonnulls(
      p_output_manifest_id, p_output_manifest_hash
    ) <> 2)
    or (p_outcome <> 'succeeded' and num_nonnulls(
      p_output_manifest_id, p_output_manifest_hash
    ) <> 0)
    or (p_output_manifest_hash is not null
      and p_output_manifest_hash !~ '^[a-f0-9]{64}$')
  then
    raise exception 'invalid preflight output manifest' using errcode = '22023';
  end if;
  select * into attempt from public.preflight_stage_attempts
  where id = p_stage_attempt_id for update;
  if not found
    or attempt.state not in ('running','waiting_external','waiting_decision')
    or attempt.fencing_token <> p_fencing_token
    or attempt.authority_epoch <> p_authority_epoch
    or attempt.input_manifest_hash <> p_input_manifest_hash
  then
    raise exception 'stale preflight completion' using errcode = '40001';
  end if;
  select * into stage from public.preflight_stage_runs
  where id = attempt.preflight_stage_run_id for update;
  if stage.highest_fencing_token <> p_fencing_token or stage.state in (
    'succeeded','failed_terminal','canceled','superseded'
  ) then
    raise exception 'preflight completion lost its fence' using errcode = '40001';
  end if;
  next_state := p_outcome::public.preflight_stage_state;
  update public.preflight_stage_attempts
  set state = next_state, output_manifest_id = p_output_manifest_id,
      output_manifest_hash = p_output_manifest_hash,
      safe_error_class = p_safe_error_class,
      completed_at = case when next_state in ('waiting_external','waiting_decision')
        then null else statement_timestamp() end
  where id = attempt.id returning * into attempt;

  if next_state in ('waiting_external','waiting_decision') then
    update public.preflight_stage_runs
    set state = next_state, aggregate_version = aggregate_version + 1
    where id = stage.id returning * into stage;
  else
    update public.preflight_stage_leases
    set state = 'consumed', closed_at = statement_timestamp()
    where stage_attempt_id = attempt.id and state = 'active';
    update public.preflight_stage_runs
    set state = next_state,
        output_manifest_id = p_output_manifest_id,
        output_manifest_hash = p_output_manifest_hash,
        available_at = case when next_state = 'failed_retryable'
          then statement_timestamp() + make_interval(
            secs => least(300, (2 ^ greatest(0, attempt.attempt_no - 1))::integer * 5)
          ) else available_at end,
        aggregate_version = aggregate_version + 1,
        completed_at = case when next_state in ('succeeded','failed_terminal')
          then statement_timestamp() else null end
    where id = stage.id returning * into stage;
    if next_state = 'failed_retryable' and stage.next_attempt_no > stage.maximum_attempts then
      update public.preflight_stage_runs
      set state = 'failed_terminal', completed_at = statement_timestamp(),
          aggregate_version = aggregate_version + 1
      where id = stage.id returning * into stage;
      insert into private.preflight_dead_letters (
        workspace_id, preflight_run_id, stage_attempt_id, authority_epoch,
        fencing_token, reason_class, safe_summary
      ) values (
        attempt.workspace_id, attempt.preflight_run_id, attempt.id,
        attempt.authority_epoch, attempt.fencing_token, 'attempts_exhausted',
        jsonb_build_object('stageKey', stage.stage_key)
      );
    end if;
  end if;
  return jsonb_build_object(
    'ok', true, 'stageAttemptId', attempt.id, 'stageRunId', stage.id,
    'state', stage.state, 'aggregateVersion', stage.aggregate_version
  );
end;
$$;

create or replace function private.reconcile_expired_preflight_leases(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease public.preflight_stage_leases%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  affected integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_limit not between 1 and 500 then
    raise exception 'invalid preflight reconciliation limit' using errcode = '22023';
  end if;
  for lease in
    select * from public.preflight_stage_leases
    where state = 'active' and expires_at < statement_timestamp() - interval '15 seconds'
    order by expires_at for update skip locked limit p_limit
  loop
    update public.preflight_stage_leases
    set state = 'expired', closed_at = statement_timestamp()
    where id = lease.id;
    update public.preflight_stage_attempts
    set state = 'failed_retryable', safe_error_class = 'lease_expired',
        completed_at = statement_timestamp()
    where id = lease.stage_attempt_id
      and state in ('claimed','running','waiting_external','waiting_decision')
      and fencing_token = lease.fencing_token
    returning * into attempt;
    if found then
      update public.preflight_stage_runs
      set state = case when next_attempt_no <= maximum_attempts
            then 'failed_retryable'::public.preflight_stage_state
            else 'failed_terminal'::public.preflight_stage_state end,
          available_at = statement_timestamp() + interval '5 seconds',
          completed_at = case when next_attempt_no > maximum_attempts
            then statement_timestamp() else null end,
          aggregate_version = aggregate_version + 1
      where id = attempt.preflight_stage_run_id
        and highest_fencing_token = lease.fencing_token;
      affected := affected + 1;
    end if;
  end loop;
  return affected;
end;
$$;

alter table public.preflight_runs enable row level security;
alter table public.preflight_stage_runs enable row level security;
alter table public.preflight_stage_dependencies enable row level security;
alter table public.preflight_stage_attempts enable row level security;
alter table public.preflight_stage_leases enable row level security;

create policy preflight_runs_member_select on public.preflight_runs
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy preflight_stages_member_select on public.preflight_stage_runs
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy preflight_dependencies_member_select on public.preflight_stage_dependencies
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy preflight_attempts_member_select on public.preflight_stage_attempts
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy preflight_leases_member_select on public.preflight_stage_leases
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

revoke all on table public.preflight_runs, public.preflight_stage_runs,
  public.preflight_stage_dependencies, public.preflight_stage_attempts,
  public.preflight_stage_leases from public, anon, authenticated;
grant select on table public.preflight_runs, public.preflight_stage_runs,
  public.preflight_stage_dependencies, public.preflight_stage_attempts,
  public.preflight_stage_leases to authenticated;

revoke all on function private.guard_preflight_dependency_cycle(),
  private.preflight_queue_for_kind(public.preflight_kind),
  private.preflight_receipt(uuid,text,text,text),
  private.record_preflight_receipt(uuid,uuid,text,text,text,jsonb),
  private.preflight_dependencies_succeeded(uuid),
  private.reconcile_expired_preflight_leases(integer)
from public, anon, authenticated;

revoke all on function public.command_create_preflight_run(
  uuid,uuid,uuid,uuid,public.preflight_kind,boolean,uuid,uuid,uuid,uuid,text,text
), public.command_transition_preflight_run(uuid,bigint,text,text),
  public.command_make_preflight_stage_ready(uuid,bigint,uuid,text),
  public.command_claim_preflight_stage(uuid,bigint,bigint,text,integer),
  public.command_start_preflight_attempt(uuid,bigint,bigint,text,text,text),
  public.command_heartbeat_preflight_attempt(uuid,uuid,bigint,integer),
  public.command_complete_preflight_attempt(uuid,bigint,bigint,text,text,uuid,text,text)
from public, anon, authenticated;

grant execute on function public.command_create_preflight_run(
  uuid,uuid,uuid,uuid,public.preflight_kind,boolean,uuid,uuid,uuid,uuid,text,text
), public.command_transition_preflight_run(uuid,bigint,text,text),
  public.command_make_preflight_stage_ready(uuid,bigint,uuid,text),
  public.command_claim_preflight_stage(uuid,bigint,bigint,text,integer),
  public.command_start_preflight_attempt(uuid,bigint,bigint,text,text,text),
  public.command_heartbeat_preflight_attempt(uuid,uuid,bigint,integer),
  public.command_complete_preflight_attempt(uuid,bigint,bigint,text,text,uuid,text,text)
to service_role;
grant execute on function private.reconcile_expired_preflight_leases(integer)
to service_role;

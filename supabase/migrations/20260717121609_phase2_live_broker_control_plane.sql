-- Durable replay protection and lifecycle coordination for the production-only
-- Vercel Sandbox live-proof broker. Candidate code has no grants on this state.

create table private.live_broker_request_nonces (
  nonce uuid primary key,
  signer_id text not null check (signer_id = 'genie-ci-ed25519-v1'),
  issued_at_ms bigint not null check (issued_at_ms > 0),
  body_sha256 text not null check (body_sha256 ~ '^[a-f0-9]{64}$'),
  action text not null check (action in ('start', 'status', 'stop')),
  sandbox_name text not null check (sandbox_name ~ '^genie-live-[a-f0-9]{24}$'),
  candidate_commit text not null check (candidate_commit ~ '^[a-f0-9]{40}$'),
  candidate_tree text not null check (candidate_tree ~ '^[a-f0-9]{40}$'),
  broker_deployment_commit text not null
    check (broker_deployment_commit ~ '^[a-f0-9]{40}$'),
  created_at timestamptz not null default statement_timestamp()
);

create index live_broker_request_nonces_signer_created_idx
on private.live_broker_request_nonces (signer_id, created_at desc);

create trigger live_broker_request_nonces_immutable
before update on private.live_broker_request_nonces
for each row execute function private.reject_mutation();

create table private.live_broker_lifecycles (
  sandbox_name text primary key check (sandbox_name ~ '^genie-live-[a-f0-9]{24}$'),
  candidate_commit text not null check (candidate_commit ~ '^[a-f0-9]{40}$'),
  candidate_tree text not null check (candidate_tree ~ '^[a-f0-9]{40}$'),
  broker_deployment_commit text not null
    check (broker_deployment_commit ~ '^[a-f0-9]{40}$'),
  state text not null check (
    state in ('creating', 'running', 'finished', 'cancel_requested', 'failed', 'deleted')
  ),
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  cancel_requested boolean not null default false,
  create_in_flight boolean not null default false,
  sandbox_session_id text check (
    sandbox_session_id is null or sandbox_session_id ~ '^[A-Za-z0-9_-]{8,255}$'
  ),
  create_lease_expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  finished_at timestamptz,
  deleted_at timestamptz,
  check (not create_in_flight or create_lease_expires_at is not null),
  check (state <> 'deleted' or (cancel_requested and not create_in_flight))
);

create table private.live_branch_cleanup_leases (
  branch_id uuid primary key,
  branch_name text not null unique
    check (branch_name ~ '^genie-live-[a-f0-9]{8}-[a-f0-9]{3}$'),
  branch_ref text not null unique check (branch_ref ~ '^[a-z0-9]{20}$'),
  production_project_ref text not null
    check (production_project_ref ~ '^[a-z0-9]{20}$'),
  candidate_commit text check (
    candidate_commit is null or candidate_commit ~ '^[a-f0-9]{40}$'
  ),
  candidate_tree text check (
    candidate_tree is null or candidate_tree ~ '^[a-f0-9]{40}$'
  ),
  cleanup_lease_id uuid not null unique,
  lease_source text not null check (lease_source in ('candidate', 'orphan_discovery')),
  coordinator_owner uuid,
  coordinator_lease_expires_at timestamptz,
  state text not null default 'registered'
    check (state in ('registered', 'reaping', 'deleted')),
  reaper_owner uuid,
  reaper_lease_expires_at timestamptz,
  confirmed_absent_snapshots smallint not null default 0
    check (confirmed_absent_snapshots between 0 and 3),
  delete_requested boolean not null default false,
  registered_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  reaped_at timestamptz,
  check (branch_ref <> production_project_ref),
  check (
    (lease_source = 'candidate' and candidate_commit is not null and candidate_tree is not null)
    or (lease_source = 'orphan_discovery' and candidate_commit is null and candidate_tree is null)
  ),
  check (
    (
      lease_source = 'candidate'
      and coordinator_owner is not null
      and coordinator_lease_expires_at is not null
    )
    or (
      lease_source = 'orphan_discovery'
      and coordinator_owner is null
      and coordinator_lease_expires_at is null
    )
  ),
  check (
    (state = 'reaping' and reaper_owner is not null and reaper_lease_expires_at is not null)
    or (state <> 'reaping' and reaper_owner is null and reaper_lease_expires_at is null)
  ),
  check (
    (state = 'deleted' and confirmed_absent_snapshots = 3 and reaped_at is not null)
    or (state <> 'deleted' and reaped_at is null)
  )
);

create index live_branch_cleanup_leases_reaper_idx
on private.live_branch_cleanup_leases (
  production_project_ref, state, coordinator_lease_expires_at,
  reaper_lease_expires_at, registered_at
);

revoke all on table private.live_broker_request_nonces
from public, anon, authenticated;
revoke all on table private.live_broker_lifecycles
from public, anon, authenticated;
revoke all on table private.live_branch_cleanup_leases
from public, anon, authenticated, service_role;

create or replace function private.live_broker_lifecycle_json(
  lifecycle private.live_broker_lifecycles
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'sandboxName', lifecycle.sandbox_name,
    'state', lifecycle.state,
    'aggregateVersion', lifecycle.aggregate_version,
    'cancelRequested', lifecycle.cancel_requested,
    'createInFlight', lifecycle.create_in_flight,
    'sandboxSessionId', lifecycle.sandbox_session_id,
    'createLeaseExpiresAt', lifecycle.create_lease_expires_at
  );
$$;

revoke all on function private.live_broker_lifecycle_json(
  private.live_broker_lifecycles
) from public, anon, authenticated;

create or replace function private.live_branch_cleanup_lease_json(
  lease private.live_branch_cleanup_leases
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'branchId', lease.branch_id,
    'branchName', lease.branch_name,
    'branchRef', lease.branch_ref,
    'productionProjectRef', lease.production_project_ref,
    'candidateCommit', lease.candidate_commit,
    'candidateTree', lease.candidate_tree,
    'cleanupLeaseId', lease.cleanup_lease_id,
    'leaseSource', lease.lease_source,
    'coordinatorOwner', lease.coordinator_owner,
    'coordinatorLeaseExpiresAt', lease.coordinator_lease_expires_at,
    'state', lease.state,
    'reaperOwner', lease.reaper_owner,
    'reaperLeaseExpiresAt', lease.reaper_lease_expires_at,
    'confirmedAbsentSnapshots', lease.confirmed_absent_snapshots,
    'deleteRequested', lease.delete_requested,
    'registeredAt', lease.registered_at,
    'reapedAt', lease.reaped_at
  );
$$;

revoke all on function private.live_branch_cleanup_lease_json(
  private.live_branch_cleanup_leases
) from public, anon, authenticated, service_role;

create or replace function private.register_live_branch_cleanup_lease(
  p_branch_id uuid,
  p_branch_name text,
  p_branch_ref text,
  p_production_project_ref text,
  p_candidate_commit text,
  p_candidate_tree text,
  p_cleanup_lease_id uuid,
  p_coordinator_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease private.live_branch_cleanup_leases%rowtype;
begin
  if p_branch_id is null
    or p_branch_name is null
    or p_branch_name !~ '^genie-live-[a-f0-9]{8}-[a-f0-9]{3}$'
    or p_branch_ref is null
    or p_branch_ref !~ '^[a-z0-9]{20}$'
    or p_production_project_ref is null
    or p_production_project_ref !~ '^[a-z0-9]{20}$'
    or p_branch_ref = p_production_project_ref
    or p_candidate_commit is null
    or p_candidate_commit !~ '^[a-f0-9]{40}$'
    or p_candidate_tree is null
    or p_candidate_tree !~ '^[a-f0-9]{40}$'
    or p_cleanup_lease_id is null
    or p_coordinator_owner is null
  then
    raise exception 'invalid live branch cleanup lease' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-branch-cleanup:' || p_production_project_ref, 0)
  );
  select * into lease
  from private.live_branch_cleanup_leases
  where branch_id = p_branch_id
    or branch_name = p_branch_name
    or branch_ref = p_branch_ref
    or cleanup_lease_id = p_cleanup_lease_id
  for update;
  if found then
    if lease.branch_id is distinct from p_branch_id
      or lease.branch_name is distinct from p_branch_name
      or lease.branch_ref is distinct from p_branch_ref
      or lease.production_project_ref is distinct from p_production_project_ref
      or lease.candidate_commit is distinct from p_candidate_commit
      or lease.candidate_tree is distinct from p_candidate_tree
      or lease.cleanup_lease_id is distinct from p_cleanup_lease_id
      or lease.coordinator_owner is distinct from p_coordinator_owner
      or lease.lease_source <> 'candidate'
    then
      raise exception 'live branch cleanup lease identity mismatch' using errcode = '22023';
    end if;
    return private.live_branch_cleanup_lease_json(lease);
  end if;
  insert into private.live_branch_cleanup_leases (
    branch_id, branch_name, branch_ref, production_project_ref,
    candidate_commit, candidate_tree, cleanup_lease_id, lease_source,
    coordinator_owner, coordinator_lease_expires_at
  ) values (
    p_branch_id, p_branch_name, p_branch_ref, p_production_project_ref,
    p_candidate_commit, p_candidate_tree, p_cleanup_lease_id, 'candidate',
    p_coordinator_owner, statement_timestamp() + interval '2 hours'
  ) returning * into lease;
  return private.live_branch_cleanup_lease_json(lease);
end;
$$;

create or replace function private.claim_live_branch_cleanup_leases(
  p_production_project_ref text,
  p_reaper_owner uuid,
  p_limit integer default 20
)
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease private.live_branch_cleanup_leases%rowtype;
begin
  if p_production_project_ref is null
    or p_production_project_ref !~ '^[a-z0-9]{20}$'
    or p_reaper_owner is null
    or p_limit not between 1 and 50
  then
    raise exception 'invalid live branch cleanup claim' using errcode = '22023';
  end if;
  for lease in
    with claimable as (
      select branch_id
      from private.live_branch_cleanup_leases
      where production_project_ref = p_production_project_ref
        and state <> 'deleted'
        and (
          (
            state = 'registered'
            and (
              lease_source = 'orphan_discovery'
              or coordinator_owner = p_reaper_owner
              or coordinator_lease_expires_at <= statement_timestamp()
            )
          )
          or (
            state = 'reaping'
            and (
              reaper_owner = p_reaper_owner
              or reaper_lease_expires_at <= statement_timestamp()
            )
          )
        )
      order by registered_at, branch_id
      for update skip locked
      limit p_limit
    )
    update private.live_branch_cleanup_leases target
    set state = 'reaping',
        reaper_owner = p_reaper_owner,
        reaper_lease_expires_at = statement_timestamp() + interval '30 minutes',
        updated_at = statement_timestamp()
    from claimable
    where target.branch_id = claimable.branch_id
    returning target.*
  loop
    return next private.live_branch_cleanup_lease_json(lease);
  end loop;
end;
$$;

create or replace function private.adopt_orphan_live_branch_cleanup_lease(
  p_branch_id uuid,
  p_branch_name text,
  p_branch_ref text,
  p_production_project_ref text,
  p_cleanup_lease_id uuid,
  p_reaper_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease private.live_branch_cleanup_leases%rowtype;
begin
  if p_branch_id is null
    or p_branch_name is null
    or p_branch_name !~ '^genie-live-[a-f0-9]{8}-[a-f0-9]{3}$'
    or p_branch_ref is null
    or p_branch_ref !~ '^[a-z0-9]{20}$'
    or p_production_project_ref is null
    or p_production_project_ref !~ '^[a-z0-9]{20}$'
    or p_branch_ref = p_production_project_ref
    or p_cleanup_lease_id is null
    or p_reaper_owner is null
  then
    raise exception 'invalid orphan live branch cleanup lease' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-branch-cleanup:' || p_production_project_ref, 0)
  );
  select * into lease
  from private.live_branch_cleanup_leases
  where branch_id = p_branch_id
    or branch_name = p_branch_name
    or branch_ref = p_branch_ref
    or cleanup_lease_id = p_cleanup_lease_id
  for update;
  if found then
    if lease.branch_id is distinct from p_branch_id
      or lease.branch_name is distinct from p_branch_name
      or lease.branch_ref is distinct from p_branch_ref
      or lease.production_project_ref is distinct from p_production_project_ref
    then
      raise exception 'live branch cleanup lease identity mismatch' using errcode = '22023';
    end if;
    if lease.lease_source = 'orphan_discovery'
      and lease.state <> 'deleted'
      and (
        lease.reaper_owner = p_reaper_owner
        or lease.reaper_lease_expires_at <= statement_timestamp()
      )
    then
      update private.live_branch_cleanup_leases
      set state = 'reaping',
          reaper_owner = p_reaper_owner,
          reaper_lease_expires_at = statement_timestamp() + interval '30 minutes',
          updated_at = statement_timestamp()
      where branch_id = p_branch_id
      returning * into lease;
    end if;
    return private.live_branch_cleanup_lease_json(lease);
  end if;
  insert into private.live_branch_cleanup_leases (
    branch_id, branch_name, branch_ref, production_project_ref,
    cleanup_lease_id, lease_source, state, reaper_owner,
    reaper_lease_expires_at
  ) values (
    p_branch_id, p_branch_name, p_branch_ref, p_production_project_ref,
    p_cleanup_lease_id, 'orphan_discovery', 'reaping', p_reaper_owner,
    statement_timestamp() + interval '30 minutes'
  ) returning * into lease;
  return private.live_branch_cleanup_lease_json(lease);
end;
$$;

create or replace function private.complete_live_branch_cleanup_lease(
  p_cleanup_lease_id uuid,
  p_branch_id uuid,
  p_branch_name text,
  p_branch_ref text,
  p_production_project_ref text,
  p_reaper_owner uuid,
  p_confirmed_absent_snapshots integer,
  p_delete_requested boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease private.live_branch_cleanup_leases%rowtype;
begin
  if p_confirmed_absent_snapshots <> 3 or p_delete_requested is null then
    raise exception 'three absence snapshots are required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-branch-cleanup:' || p_production_project_ref, 0)
  );
  select * into lease from private.live_branch_cleanup_leases
  where cleanup_lease_id = p_cleanup_lease_id for update;
  if not found
    or lease.branch_id is distinct from p_branch_id
    or lease.branch_name is distinct from p_branch_name
    or lease.branch_ref is distinct from p_branch_ref
    or lease.production_project_ref is distinct from p_production_project_ref
  then
    raise exception 'live branch cleanup lease identity mismatch' using errcode = '22023';
  end if;
  if lease.state = 'deleted' then
    return private.live_branch_cleanup_lease_json(lease);
  end if;
  if lease.state <> 'reaping' or lease.reaper_owner is distinct from p_reaper_owner then
    raise exception 'live branch cleanup lease owner mismatch' using errcode = '55000';
  end if;
  update private.live_branch_cleanup_leases
  set state = 'deleted',
      reaper_owner = null,
      reaper_lease_expires_at = null,
      confirmed_absent_snapshots = 3,
      delete_requested = p_delete_requested,
      updated_at = statement_timestamp(),
      reaped_at = statement_timestamp()
  where cleanup_lease_id = p_cleanup_lease_id
  returning * into lease;
  return private.live_branch_cleanup_lease_json(lease);
end;
$$;

create or replace function private.release_live_branch_cleanup_lease(
  p_cleanup_lease_id uuid,
  p_reaper_owner uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lease private.live_branch_cleanup_leases%rowtype;
begin
  select * into lease from private.live_branch_cleanup_leases
  where cleanup_lease_id = p_cleanup_lease_id for update;
  if not found then
    raise exception 'live branch cleanup lease not found' using errcode = 'P0002';
  end if;
  if lease.state = 'deleted' then
    return private.live_branch_cleanup_lease_json(lease);
  end if;
  if lease.state <> 'reaping' or lease.reaper_owner is distinct from p_reaper_owner then
    raise exception 'live branch cleanup lease owner mismatch' using errcode = '55000';
  end if;
  update private.live_branch_cleanup_leases
  set state = 'registered',
      reaper_owner = null,
      reaper_lease_expires_at = null,
      updated_at = statement_timestamp()
  where cleanup_lease_id = p_cleanup_lease_id
  returning * into lease;
  return private.live_branch_cleanup_lease_json(lease);
end;
$$;

create or replace function private.list_live_branch_cleanup_leases(
  p_production_project_ref text
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.live_branch_cleanup_lease_json(lease)
  from private.live_branch_cleanup_leases lease
  where lease.production_project_ref = p_production_project_ref
  order by lease.registered_at, lease.branch_id;
$$;

revoke all on function private.register_live_branch_cleanup_lease(
  uuid,text,text,text,text,text,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.claim_live_branch_cleanup_leases(
  text,uuid,integer
) from public, anon, authenticated, service_role;
revoke all on function private.adopt_orphan_live_branch_cleanup_lease(
  uuid,text,text,text,uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.complete_live_branch_cleanup_lease(
  uuid,uuid,text,text,text,uuid,integer,boolean
) from public, anon, authenticated, service_role;
revoke all on function private.release_live_branch_cleanup_lease(
  uuid,uuid
) from public, anon, authenticated, service_role;
revoke all on function private.list_live_branch_cleanup_leases(text)
from public, anon, authenticated, service_role;

create or replace function public.command_claim_live_broker_request(
  p_nonce uuid,
  p_signer_id text,
  p_issued_at_ms bigint,
  p_body_sha256 text,
  p_action text,
  p_sandbox_name text,
  p_candidate_commit text,
  p_candidate_tree text,
  p_broker_deployment_commit text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle private.live_broker_lifecycles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_nonce is null
    or p_signer_id is distinct from 'genie-ci-ed25519-v1'
    or p_issued_at_ms is null
    or p_issued_at_ms not between 1000000000000 and 9999999999999
    or abs((extract(epoch from clock_timestamp()) * 1000)::bigint - p_issued_at_ms) > 300000
    or p_body_sha256 is null
    or p_body_sha256 !~ '^[a-f0-9]{64}$'
    or p_action is null
    or p_action not in ('start', 'status', 'stop')
    or p_sandbox_name is null
    or p_sandbox_name !~ '^genie-live-[a-f0-9]{24}$'
    or p_candidate_commit is null
    or p_candidate_commit !~ '^[a-f0-9]{40}$'
    or p_candidate_tree is null
    or p_candidate_tree !~ '^[a-f0-9]{40}$'
    or p_broker_deployment_commit is null
    or p_broker_deployment_commit !~ '^[a-f0-9]{40}$'
  then
    raise exception 'invalid live broker ledger request' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-broker-signer:' || p_signer_id, 0)
  );
  -- Signed requests are accepted only within five minutes. Retaining ten minutes
  -- preserves the full replay window while bounding this service-only ledger.
  delete from private.live_broker_request_nonces
  where signer_id = p_signer_id
    and created_at < statement_timestamp() - interval '10 minutes';
  if (
    select count(*) >= 180
    from private.live_broker_request_nonces
    where signer_id = p_signer_id
      and created_at >= statement_timestamp() - interval '1 minute'
  ) then
    raise exception 'live broker signer rate limit exceeded' using errcode = '54000';
  end if;

  begin
    insert into private.live_broker_request_nonces (
      nonce, signer_id, issued_at_ms, body_sha256, action, sandbox_name,
      candidate_commit, candidate_tree, broker_deployment_commit
    ) values (
      p_nonce, p_signer_id, p_issued_at_ms, p_body_sha256, p_action,
      p_sandbox_name, p_candidate_commit, p_candidate_tree,
      p_broker_deployment_commit
    );
  exception when unique_violation then
    raise exception 'live broker nonce replayed' using errcode = '23505';
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-broker:' || p_sandbox_name, 0)
  );
  select * into lifecycle
  from private.live_broker_lifecycles
  where sandbox_name = p_sandbox_name
  for update;

  if found and lifecycle.create_in_flight
    and lifecycle.create_lease_expires_at <= statement_timestamp()
  then
    update private.live_broker_lifecycles
    set state = case
          when cancel_requested then 'cancel_requested'
          else 'failed'
        end,
        create_in_flight = false,
        create_lease_expires_at = null,
        aggregate_version = aggregate_version + 1,
        updated_at = statement_timestamp(),
        finished_at = statement_timestamp()
    where sandbox_name = p_sandbox_name
    returning * into lifecycle;
  end if;

  if p_action = 'start' then
    if not found then
      insert into private.live_broker_lifecycles (
        sandbox_name, candidate_commit, candidate_tree,
        broker_deployment_commit, state, create_in_flight,
        create_lease_expires_at
      ) values (
        p_sandbox_name, p_candidate_commit, p_candidate_tree,
        p_broker_deployment_commit, 'creating', true,
        -- Longer than the Vercel route's five-minute hard ceiling. A creator
        -- cannot outlive this lease, and stop requests can reconcile it safely.
        statement_timestamp() + interval '6 minutes'
      ) returning * into lifecycle;
    elsif lifecycle.candidate_commit is distinct from p_candidate_commit
      or lifecycle.candidate_tree is distinct from p_candidate_tree
      or lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit
    then
      raise exception 'live broker lifecycle identity mismatch' using errcode = '22023';
    elsif lifecycle.cancel_requested or lifecycle.state in ('cancel_requested', 'deleted') then
      return private.live_broker_lifecycle_json(lifecycle);
    else
      raise exception 'live broker lifecycle already exists' using errcode = '23505';
    end if;
  elsif p_action = 'stop' then
    if not found then
      insert into private.live_broker_lifecycles (
        sandbox_name, candidate_commit, candidate_tree,
        broker_deployment_commit, state, cancel_requested,
        create_in_flight
      ) values (
        p_sandbox_name, p_candidate_commit, p_candidate_tree,
        p_broker_deployment_commit, 'cancel_requested', true, false
      ) returning * into lifecycle;
    elsif lifecycle.candidate_commit is distinct from p_candidate_commit
      or lifecycle.candidate_tree is distinct from p_candidate_tree
      or lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit
    then
      raise exception 'live broker lifecycle identity mismatch' using errcode = '22023';
    elsif lifecycle.state <> 'deleted' then
      update private.live_broker_lifecycles
      set cancel_requested = true,
          state = case
            when create_in_flight then state
            else 'cancel_requested'
          end,
          aggregate_version = aggregate_version + 1,
          updated_at = statement_timestamp()
      where sandbox_name = p_sandbox_name
      returning * into lifecycle;
    end if;
  else
    if not found then
      raise exception 'live broker lifecycle not found' using errcode = 'P0002';
    end if;
    if lifecycle.candidate_commit is distinct from p_candidate_commit
      or lifecycle.candidate_tree is distinct from p_candidate_tree
      or lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit
    then
      raise exception 'live broker lifecycle identity mismatch' using errcode = '22023';
    end if;
  end if;
  return private.live_broker_lifecycle_json(lifecycle);
end;
$$;

create or replace function public.command_reconcile_live_broker_cancellation(
  p_sandbox_name text,
  p_candidate_commit text,
  p_candidate_tree text,
  p_broker_deployment_commit text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle private.live_broker_lifecycles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-broker:' || p_sandbox_name, 0)
  );
  select * into lifecycle from private.live_broker_lifecycles
  where sandbox_name = p_sandbox_name for update;
  if not found
    or lifecycle.candidate_commit is distinct from p_candidate_commit
    or lifecycle.candidate_tree is distinct from p_candidate_tree
    or lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit
  then
    raise exception 'live broker lifecycle identity mismatch' using errcode = '22023';
  end if;
  if lifecycle.cancel_requested
    and lifecycle.create_in_flight
    and lifecycle.create_lease_expires_at <= statement_timestamp()
  then
    update private.live_broker_lifecycles
    set state = 'cancel_requested',
        create_in_flight = false,
        create_lease_expires_at = null,
        aggregate_version = aggregate_version + 1,
        updated_at = statement_timestamp(),
        finished_at = statement_timestamp()
    where sandbox_name = p_sandbox_name
    returning * into lifecycle;
  end if;
  return private.live_broker_lifecycle_json(lifecycle);
end;
$$;

create or replace function public.command_record_live_broker_created(
  p_sandbox_name text,
  p_candidate_commit text,
  p_candidate_tree text,
  p_sandbox_session_id text,
  p_broker_deployment_commit text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle private.live_broker_lifecycles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-broker:' || p_sandbox_name, 0)
  );
  select * into lifecycle from private.live_broker_lifecycles
  where sandbox_name = p_sandbox_name for update;
  if not found
    or lifecycle.candidate_commit is distinct from p_candidate_commit
    or lifecycle.candidate_tree is distinct from p_candidate_tree
    or lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit
    or lifecycle.state <> 'creating'
    or not lifecycle.create_in_flight
    or p_sandbox_session_id is null
    or p_sandbox_session_id !~ '^[A-Za-z0-9_-]{8,255}$'
  then
    raise exception 'live broker lifecycle identity mismatch' using errcode = '22023';
  end if;
  update private.live_broker_lifecycles
  set sandbox_session_id = p_sandbox_session_id,
      state = case when cancel_requested then 'cancel_requested' else 'running' end,
      create_in_flight = cancel_requested,
      create_lease_expires_at = case
        when cancel_requested then statement_timestamp() + interval '2 minutes'
        else null
      end,
      aggregate_version = aggregate_version + 1,
      updated_at = statement_timestamp()
  where sandbox_name = p_sandbox_name
  returning * into lifecycle;
  return private.live_broker_lifecycle_json(lifecycle);
end;
$$;

create or replace function public.command_record_live_broker_state(
  p_sandbox_name text,
  p_candidate_commit text,
  p_candidate_tree text,
  p_state text,
  p_broker_deployment_commit text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle private.live_broker_lifecycles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_state is null or p_state not in ('finished', 'failed', 'deleted') then
    raise exception 'invalid live broker terminal state' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('live-broker:' || p_sandbox_name, 0)
  );
  select * into lifecycle from private.live_broker_lifecycles
  where sandbox_name = p_sandbox_name for update;
  if not found
    or lifecycle.candidate_commit is distinct from p_candidate_commit
    or lifecycle.candidate_tree is distinct from p_candidate_tree
    or lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit
  then
    raise exception 'live broker lifecycle identity mismatch' using errcode = '22023';
  end if;
  if p_state = 'finished' and (
    lifecycle.state not in ('running', 'finished') or lifecycle.cancel_requested
  ) then
    raise exception 'live broker cannot finish a cancelled lifecycle' using errcode = '55000';
  end if;
  if lifecycle.state = 'deleted' and p_state <> 'deleted' then
    raise exception 'live broker deletion tombstone is terminal' using errcode = '55000';
  end if;
  update private.live_broker_lifecycles
  set state = p_state,
      cancel_requested = case
        when p_state = 'deleted' then true else cancel_requested
      end,
      create_in_flight = false,
      create_lease_expires_at = null,
      aggregate_version = aggregate_version + 1,
      updated_at = statement_timestamp(),
      finished_at = case
        when p_state in ('finished', 'failed') then statement_timestamp()
        else finished_at
      end,
      deleted_at = case
        when p_state = 'deleted' then statement_timestamp()
        else deleted_at
      end
  where sandbox_name = p_sandbox_name
  returning * into lifecycle;
  return private.live_broker_lifecycle_json(lifecycle);
end;
$$;

create or replace function public.get_live_broker_lifecycle(
  p_sandbox_name text,
  p_candidate_commit text,
  p_candidate_tree text,
  p_broker_deployment_commit text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifecycle private.live_broker_lifecycles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into lifecycle from private.live_broker_lifecycles
  where sandbox_name = p_sandbox_name;
  if not found
    or lifecycle.candidate_commit is distinct from p_candidate_commit
    or lifecycle.candidate_tree is distinct from p_candidate_tree
    or lifecycle.broker_deployment_commit is distinct from p_broker_deployment_commit
  then
    raise exception 'live broker lifecycle identity mismatch' using errcode = '22023';
  end if;
  return private.live_broker_lifecycle_json(lifecycle);
end;
$$;

revoke all on function public.command_claim_live_broker_request(
  uuid,text,bigint,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.command_claim_live_broker_request(
  uuid,text,bigint,text,text,text,text,text,text
) to service_role;
revoke all on function public.command_record_live_broker_created(
  text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.command_record_live_broker_created(
  text,text,text,text,text
) to service_role;
revoke all on function public.command_record_live_broker_state(
  text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.command_record_live_broker_state(
  text,text,text,text,text
) to service_role;
revoke all on function public.get_live_broker_lifecycle(text,text,text,text)
from public, anon, authenticated;
grant execute on function public.get_live_broker_lifecycle(text,text,text,text)
to service_role;
revoke all on function public.command_reconcile_live_broker_cancellation(
  text,text,text,text
) from public, anon, authenticated;
grant execute on function public.command_reconcile_live_broker_cancellation(
  text,text,text,text
) to service_role;

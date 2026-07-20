-- Phase 2: enforce bounded broker-key rotation and durable security evidence.

create or replace function private.record_broker_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  client private.broker_clients%rowtype;
  action text;
  target_type text;
  target_id uuid;
  target_version bigint;
  status text;
  correlation uuid := gen_random_uuid();
begin
  if tg_table_name = 'broker_clients' then
    client := new;
    target_type := 'broker_client';
    target_id := new.id;
    target_version := new.aggregate_version;
    status := new.state::text;
    if tg_op = 'INSERT' then
      action := 'provider_broker.client_registered';
    elsif old.state is distinct from new.state and new.state = 'disabled' then
      action := 'provider_broker.client_disabled';
    else
      return new;
    end if;
  else
    select * into client from private.broker_clients where id = new.broker_client_id;
    target_type := 'broker_key';
    target_id := new.id;
    target_version := new.aggregate_version;
    status := new.state::text;
    if tg_op = 'INSERT' then
      action := 'provider_broker.key_added';
    elsif old.state is distinct from new.state and new.state = 'active' then
      action := 'provider_broker.key_activated';
    elsif old.state is distinct from new.state and new.state = 'revoked' then
      action := 'provider_broker.key_revoked';
    else
      return new;
    end if;
  end if;
  perform private.insert_audit_event(
    client.workspace_id, action, target_type, target_id, target_version,
    null, null, correlation, 'allow', 'accepted', null,
    jsonb_build_object(
      'brokerClientId', client.id,
      'environment', client.environment,
      'status', status,
      'triggerProject', client.trigger_project
    )
  );
  insert into private.diagnostic_events (
    event_type, occurred_at, environment, workspace_id, aggregate_type,
    aggregate_id, correlation_id, stage, status, safe_summary,
    retention_class, source, actor_user_id
  ) values (
    action, statement_timestamp(), client.environment, client.workspace_id,
    target_type, target_id, correlation::text, 'broker_key_lifecycle', status,
    'Broker identity lifecycle command accepted.', 'security', 'server', auth.uid()
  );
  return new;
end;
$$;

create trigger broker_client_lifecycle_evidence
after insert or update of state on private.broker_clients
for each row execute function private.record_broker_lifecycle_event();
create trigger broker_key_lifecycle_evidence
after insert or update of state on private.broker_client_key_versions
for each row execute function private.record_broker_lifecycle_event();

create or replace function private.broker_key_is_usable(
  p_broker_client_id uuid,
  p_broker_key_id uuid,
  p_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.broker_client_key_versions key
    where key.id = p_broker_key_id
      and key.broker_client_id = p_broker_client_id
      and key.state = 'active'
      and p_at between key.valid_from and key.valid_until
      and (
        key.id = (
          select newest.id
          from private.broker_client_key_versions newest
          where newest.broker_client_id = p_broker_client_id
            and newest.state = 'active'
            and p_at between newest.valid_from and newest.valid_until
          order by newest.activated_at desc, newest.id desc
          limit 1
        )
        or key.overlap_until >= p_at
      )
  );
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
declare
  client private.broker_clients%rowtype;
  actor_id uuid;
  key_id uuid;
begin
  select * into client from private.broker_clients
  where id = p_broker_client_id for update;
  if not found then raise exception 'broker client not found' using errcode = 'P0002'; end if;
  actor_id := private.assert_broker_admin(client.workspace_id);
  if client.aggregate_version <> p_expected_client_version then
    raise exception 'stale broker client version' using errcode = '40001';
  end if;
  if p_valid_from < statement_timestamp() - interval '5 minutes'
    or p_valid_until > statement_timestamp() + interval '180 days'
    or p_valid_until <= p_valid_from
    or char_length(btrim(p_rotation_reason)) not between 1 and 1000
  then raise exception 'broker key validity is invalid' using errcode = '22023'; end if;
  insert into private.broker_client_key_versions (
    broker_client_id, kid, public_key_spki_base64, state, valid_from,
    valid_until, overlap_until, rotation_reason, created_by
  ) values (
    client.id, p_kid, p_public_key_spki_base64, 'pending', p_valid_from,
    p_valid_until, p_overlap_until, btrim(p_rotation_reason), actor_id
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
declare
  client private.broker_clients%rowtype;
  key private.broker_client_key_versions%rowtype;
  active_count integer;
  at_time timestamptz := statement_timestamp();
begin
  select * into client from private.broker_clients
  where id = p_broker_client_id for update;
  if not found then raise exception 'broker client not found' using errcode = 'P0002'; end if;
  perform private.assert_broker_admin(client.workspace_id);
  select * into key from private.broker_client_key_versions
  where id = p_broker_key_id and broker_client_id = client.id for update;
  if client.aggregate_version <> p_expected_client_version
    or key.aggregate_version <> p_expected_key_version
    or key.state <> 'pending'
    or at_time not between key.valid_from and key.valid_until
  then raise exception 'broker key activation is stale' using errcode = '40001'; end if;

  update private.broker_assertion_jtis assertion
  set revoked_at = at_time
  where assertion.broker_client_id = client.id
    and assertion.revoked_at is null and assertion.expires_at > at_time
    and exists (
      select 1 from private.broker_client_key_versions expired
      where expired.id = assertion.broker_key_version_id
        and expired.state = 'active'
        and expired.overlap_until is not null
        and expired.overlap_until < at_time
        and expired.id <> (
          select newest.id from private.broker_client_key_versions newest
          where newest.broker_client_id = client.id and newest.state = 'active'
          order by newest.activated_at desc, newest.id desc limit 1
        )
    );
  update private.broker_client_key_versions expired
  set state = 'revoked', revoked_at = at_time,
      aggregate_version = expired.aggregate_version + 1
  where expired.broker_client_id = client.id and expired.state = 'active'
    and expired.overlap_until is not null and expired.overlap_until < at_time
    and expired.id <> (
      select newest.id from private.broker_client_key_versions newest
      where newest.broker_client_id = client.id and newest.state = 'active'
      order by newest.activated_at desc, newest.id desc limit 1
    );

  select count(*) into active_count
  from private.broker_client_key_versions existing
  where existing.broker_client_id = client.id and existing.state = 'active'
    and existing.valid_until > at_time;
  if active_count >= 2 then
    raise exception 'broker key overlap limit exceeded' using errcode = '54000';
  end if;
  if active_count = 0 and key.overlap_until is not null then
    raise exception 'initial broker key cannot declare overlap' using errcode = '22023';
  end if;
  if active_count > 0 and (
    key.overlap_until is null or key.overlap_until <= at_time
    or key.overlap_until > at_time + interval '15 minutes'
    or key.overlap_until > key.valid_until
  ) then
    raise exception 'broker key overlap window is invalid' using errcode = '22023';
  end if;
  if active_count > 0 then
    update private.broker_client_key_versions existing
    set overlap_until = key.overlap_until,
        aggregate_version = existing.aggregate_version + 1
    where existing.broker_client_id = client.id and existing.state = 'active'
      and existing.valid_until > at_time;
  end if;
  update private.broker_client_key_versions
  set state = 'active', activated_at = at_time,
      aggregate_version = aggregate_version + 1
  where id = key.id returning * into key;
  update private.broker_clients
  set state = 'active', disabled_at = null,
      aggregate_version = aggregate_version + 1
  where id = client.id returning * into client;
  return jsonb_build_object(
    'ok', true, 'brokerClientId', client.id, 'kid', key.kid,
    'aggregateVersion', client.aggregate_version
  );
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
declare
  client private.broker_clients%rowtype;
  key private.broker_client_key_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into client from private.broker_clients
  where client_id = p_client_id and environment = p_environment
    and trigger_project = p_trigger_project and state = 'active';
  if not found then raise exception 'broker client is unavailable' using errcode = '42501'; end if;
  select * into key from private.broker_client_key_versions
  where broker_client_id = client.id and kid = p_kid;
  if not found or not private.broker_key_is_usable(
    client.id, key.id, statement_timestamp()
  ) then raise exception 'broker key is unavailable' using errcode = '42501'; end if;
  return jsonb_build_object(
    'brokerClientDatabaseId', client.id, 'brokerKeyDatabaseId', key.id,
    'audience', client.audience, 'clientId', client.client_id,
    'environment', client.environment, 'triggerProject', client.trigger_project,
    'kid', key.kid, 'publicKeySpkiBase64', key.public_key_spki_base64
  );
end;
$$;

create or replace function private.guard_broker_assertion_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.broker_key_is_usable(
      new.broker_client_id, new.broker_key_version_id, statement_timestamp()
    )
    or not exists (
      select 1
      from private.broker_clients client
      join private.broker_client_key_versions key
        on key.broker_client_id = client.id
      join private.provider_requests request
        on request.id = new.provider_request_id
      join private.worker_capability_grants grant_row
        on grant_row.id = new.capability_grant_id
      where client.id = new.broker_client_id and client.state = 'active'
        and key.id = new.broker_key_version_id
        and request.workspace_id = client.workspace_id
        and grant_row.workspace_id = client.workspace_id
        and grant_row.provider_request_id = request.id
    )
  then
    raise exception 'broker assertion scope crosses authority boundaries'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.command_record_broker_security_rejection(
  p_environment text,
  p_trigger_project text,
  p_client_id text,
  p_kid text,
  p_reason_code text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  client private.broker_clients%rowtype;
  key_id uuid;
  event_id uuid;
  correlation uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_environment not in ('development','preview','production','test')
    or p_trigger_project !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,100}$'
    or p_client_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,100}$'
    or p_kid !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,79}$'
    or p_reason_code not in ('assertion_invalid','contract_invalid','replay_or_stale')
  then raise exception 'broker rejection event is invalid' using errcode = '22023'; end if;
  select * into client from private.broker_clients
  where environment = p_environment and trigger_project = p_trigger_project
    and client_id = p_client_id;
  if client.id is not null then
    select id into key_id from private.broker_client_key_versions
    where broker_client_id = client.id and kid = p_kid;
  end if;
  insert into private.diagnostic_events (
    event_type, occurred_at, environment, workspace_id, aggregate_type,
    aggregate_id, correlation_id, stage, status, error_class, safe_summary,
    retention_class, source
  ) values (
    'provider_broker.authority_rejected', statement_timestamp(), p_environment,
    client.workspace_id,
    case when key_id is null then 'broker_client' else 'broker_key' end,
    coalesce(key_id, client.id), correlation::text, 'broker_authorization',
    'rejected', p_reason_code, 'Provider broker authority rejected safely.',
    'security', 'server'
  ) returning id into event_id;
  return event_id;
end;
$$;

revoke all on function private.record_broker_lifecycle_event(),
  private.broker_key_is_usable(uuid,uuid,timestamptz)
from public, anon, authenticated;
revoke all on function public.command_record_broker_security_rejection(
  text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.command_record_broker_security_rejection(
  text,text,text,text,text
) to service_role;
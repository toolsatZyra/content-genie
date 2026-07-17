-- Phase 1 / 0007: indexes, explicit grants/RLS, commands, and reconciliation.

-- Workspace-leading indexes used by RLS and common projections.
create index memberships_user_workspace_idx on public.memberships (user_id, workspace_id);
create index memberships_workspace_status_idx on public.memberships (workspace_id, status, role);
create index membership_history_workspace_user_idx
  on public.membership_role_history (workspace_id, user_id, created_at desc);
create index invitations_workspace_expiry_idx
  on public.invitations (workspace_id, expires_at)
  where consumed_at is null and revoked_at is null;
create index acl_workspace_principal_idx
  on public.workspace_acl_entries (workspace_id, principal_user_id, action);
create index series_workspace_state_idx on public.series (workspace_id, state, updated_at desc);
create index series_search_idx on public.series using gin (search_document);
create index series_title_trgm_idx on public.series using gin (title gin_trgm_ops);
create index releases_workspace_series_idx
  on public.series_releases (workspace_id, series_id, release_number desc);
create index release_statuses_workspace_series_idx
  on public.series_release_statuses (workspace_id, series_id, changed_at desc);
create index continuity_workspace_series_idx
  on public.continuity_state_versions (workspace_id, series_id, version_no desc);
create index episodes_workspace_state_idx
  on public.episodes (workspace_id, workflow_state, updated_at desc);
create index episodes_workspace_owner_idx
  on public.episodes (workspace_id, owner_user_id, updated_at desc);
create index episodes_workspace_series_idx
  on public.episodes (workspace_id, series_id, episode_number desc);
create index episodes_search_idx on public.episodes using gin (search_document);
create index episodes_title_trgm_idx on public.episodes using gin (title gin_trgm_ops);
create index episode_watchers_workspace_user_idx
  on public.episode_watchers (workspace_id, user_id, episode_id);
create index domain_events_workspace_time_idx
  on public.domain_events (workspace_id, occurred_at desc);
create index work_items_workspace_state_idx
  on public.work_items (workspace_id, state, priority desc, created_at);
create index work_items_workspace_assignee_idx
  on public.work_items (workspace_id, assigned_user_id, state);
create index work_leases_workspace_holder_idx
  on public.work_leases (workspace_id, holder_user_id, lease_state, expires_at);
create index notifications_workspace_recipient_idx
  on public.notifications (workspace_id, recipient_user_id, state, created_at desc);
create index watches_workspace_user_idx on public.watches (workspace_id, user_id);
create index presence_workspace_expiry_idx
  on public.presence_sessions (workspace_id, expires_at, user_id);
create index command_receipts_workspace_actor_idx
  on private.command_receipts (workspace_id, actor_user_id, created_at desc);
create index outbox_events_claim_idx
  on private.outbox_events (state, available_at, workspace_id)
  where state in ('pending', 'leased');

create or replace function private.is_organization_member(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspaces w
    join public.memberships m on m.workspace_id = w.id
    where w.organization_id = p_organization_id
      and w.state = 'active'
      and m.user_id = p_user_id
      and m.status = 'active'
  );
$$;

create or replace function private.shares_active_workspace(
  p_left_user_id uuid,
  p_right_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships l
    join public.memberships r on r.workspace_id = l.workspace_id
    join public.workspaces w on w.id = l.workspace_id
    where l.user_id = p_left_user_id
      and r.user_id = p_right_user_id
      and l.status = 'active'
      and r.status = 'active'
      and w.state = 'active'
  );
$$;

create or replace function private.role_rank(p_role public.membership_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'member' then 1 when 'reviewer' then 2 when 'admin' then 3 end;
$$;

create or replace function private.assert_active_session(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_current_session_allowed(p_workspace_id) then
    raise exception 'active workspace session required' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.assert_aal2()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if private.current_aal() <> 'aal2' then
    raise exception 'aal2 required' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.insert_audit_event(
  p_workspace_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_target_version bigint,
  p_command_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_permission_decision text,
  p_outcome text,
  p_reason text default null,
  p_safe_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_id uuid;
  actor_role public.membership_role;
begin
  select m.role into actor_role
  from public.memberships m
  where m.workspace_id = p_workspace_id and m.user_id = auth.uid();

  insert into audit.events (
    workspace_id, actor_kind, actor_user_id, actor_principal, membership_role,
    session_id, aal, command_id, idempotency_key, action, target_type, target_id,
    target_version, permission_decision, reason, correlation_id, outcome, safe_metadata
  )
  values (
    p_workspace_id, 'user', auth.uid(), 'user:' || auth.uid()::text, actor_role,
    private.current_session_id(), private.current_aal(), p_command_id, p_idempotency_key,
    p_action, p_target_type, p_target_id, p_target_version, p_permission_decision,
    p_reason, p_correlation_id, p_outcome, p_safe_metadata
  )
  returning id into audit_id;

  return audit_id;
end;
$$;

create or replace function private.existing_command_response(
  p_workspace_id uuid,
  p_actor_user_id uuid,
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
  receipt private.command_receipts%rowtype;
begin
  select * into receipt
  from private.command_receipts r
  where r.workspace_id = p_workspace_id
    and r.actor_user_id = p_actor_user_id
    and r.idempotency_key = p_idempotency_key;

  if not found then
    return null;
  end if;
  if receipt.command_type <> p_command_type or receipt.request_hash <> p_request_hash then
    raise exception 'idempotency key was already used with a different request'
      using errcode = '22023';
  end if;
  return receipt.response_json;
end;
$$;

create or replace function private.record_command(
  p_command_id uuid,
  p_workspace_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_command_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_expected_version bigint,
  p_request_hash text,
  p_response jsonb,
  p_correlation_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.command_receipts (
    command_id, workspace_id, actor_user_id, actor_principal, idempotency_key,
    command_type, aggregate_type, aggregate_id, expected_version, request_hash,
    outcome, response_json, correlation_id
  )
  values (
    p_command_id, p_workspace_id, p_actor_user_id, 'user:' || p_actor_user_id::text,
    p_idempotency_key, p_command_type, p_aggregate_type, p_aggregate_id,
    p_expected_version, p_request_hash, 'accepted', p_response, p_correlation_id
  );
$$;

create or replace function private.emit_domain_event(
  p_workspace_id uuid,
  p_event_type text,
  p_aggregate_type text,
  p_aggregate_id uuid,
  p_aggregate_sequence bigint,
  p_correlation_id uuid,
  p_safe_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_id uuid;
begin
  insert into public.domain_events (
    workspace_id, event_type, aggregate_type, aggregate_id, aggregate_sequence,
    actor_kind, actor_principal, correlation_id, safe_payload
  )
  values (
    p_workspace_id, p_event_type, p_aggregate_type, p_aggregate_id,
    p_aggregate_sequence, 'user', 'user:' || auth.uid()::text, p_correlation_id,
    p_safe_payload
  )
  returning id into event_id;

  insert into private.outbox_events (
    workspace_id, event_type, destination, payload_json, idempotency_key
  )
  values (
    p_workspace_id, p_event_type, 'realtime_projection',
    jsonb_build_object(
      'eventId', event_id,
      'workspaceId', p_workspace_id,
      'aggregateType', p_aggregate_type,
      'aggregateId', p_aggregate_id,
      'aggregateSequence', p_aggregate_sequence
    ),
    'event:' || event_id::text || ':realtime_projection'
  );

  return event_id;
end;
$$;

create or replace function public.command_create_series(
  p_workspace_id uuid,
  p_title text,
  p_description text,
  p_slug text,
  p_owner_user_id uuid,
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
  series_id uuid;
  response jsonb;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || actor_id::text || p_idempotency_key, 0)
  );
  response := private.existing_command_response(
    p_workspace_id, actor_id, p_idempotency_key, 'series.create', p_request_hash
  );
  if response is not null then return response; end if;

  perform private.assert_active_session(p_workspace_id);
  if p_owner_user_id <> actor_id
    and not private.has_workspace_role(p_workspace_id, actor_id, array['admin']::public.membership_role[])
  then
    raise exception 'only admins may assign another owner' using errcode = '42501';
  end if;
  if not private.is_active_member(p_workspace_id, p_owner_user_id) then
    raise exception 'owner must be an active workspace member' using errcode = '23503';
  end if;

  insert into public.series (
    workspace_id, slug, title, description, owner_user_id, created_by
  )
  values (
    p_workspace_id, p_slug, p_title, coalesce(p_description, ''), p_owner_user_id, actor_id
  )
  returning id into series_id;

  insert into private.aggregate_versions (
    workspace_id, aggregate_type, aggregate_id, current_version
  ) values (p_workspace_id, 'series', series_id, 1);

  perform private.emit_domain_event(
    p_workspace_id, 'series.created.v1', 'series', series_id, 1, p_correlation_id,
    jsonb_build_object('seriesId', series_id, 'title', p_title)
  );
  response := jsonb_build_object(
    'ok', true, 'seriesId', series_id, 'aggregateVersion', 1
  );
  perform private.record_command(
    p_command_id, p_workspace_id, actor_id, p_idempotency_key, 'series.create',
    'series', series_id, null, p_request_hash, response, p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id, 'series.create', 'series', series_id, 1, p_command_id,
    p_idempotency_key, p_correlation_id, 'allow', 'accepted'
  );
  return response;
end;
$$;

create or replace function public.command_create_episode(
  p_workspace_id uuid,
  p_series_id uuid,
  p_title text,
  p_summary text,
  p_owner_user_id uuid,
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
  episode_id uuid;
  work_item_id uuid;
  event_id uuid;
  next_number integer;
  current_release uuid;
  current_continuity uuid;
  response jsonb;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || actor_id::text || p_idempotency_key, 0)
  );
  response := private.existing_command_response(
    p_workspace_id, actor_id, p_idempotency_key, 'episode.create', p_request_hash
  );
  if response is not null then return response; end if;

  perform private.assert_active_session(p_workspace_id);
  if p_owner_user_id <> actor_id
    and not private.has_workspace_role(p_workspace_id, actor_id, array['admin']::public.membership_role[])
  then
    raise exception 'only admins may assign another owner' using errcode = '42501';
  end if;
  if not private.is_active_member(p_workspace_id, p_owner_user_id) then
    raise exception 'owner must be an active workspace member' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('episode-number:' || p_series_id::text, 0)
  );
  select s.active_release_id, r.continuity_state_version_id
    into current_release, current_continuity
  from public.series s
  left join public.series_releases r on r.id = s.active_release_id
  where s.id = p_series_id
    and s.workspace_id = p_workspace_id
    and s.state = 'active'
  for update of s;
  if not found then
    raise exception 'active Series not found' using errcode = 'P0002';
  end if;

  select coalesce(max(e.episode_number), 0) + 1 into next_number
  from public.episodes e where e.series_id = p_series_id;

  insert into public.episodes (
    workspace_id, series_id, episode_number, title, summary, workflow_state,
    owner_user_id, pinned_series_release_id, pinned_continuity_version_id, created_by
  )
  values (
    p_workspace_id, p_series_id, next_number, p_title, coalesce(p_summary, ''),
    'draft', p_owner_user_id, current_release, current_continuity, actor_id
  )
  returning id into episode_id;

  insert into private.aggregate_versions (
    workspace_id, aggregate_type, aggregate_id, current_version
  ) values (p_workspace_id, 'episode', episode_id, 1);

  insert into public.work_items (
    workspace_id, episode_id, series_id, kind, required_role, assigned_user_id,
    dedupe_key, safe_summary, deep_link
  )
  values (
    p_workspace_id, episode_id, p_series_id, 'episode.world_setup', 'member',
    p_owner_user_id, 'episode:' || episode_id::text || ':world_setup',
    'Set the script, look, characters, and locations',
    '/episodes/' || episode_id::text || '/create'
  )
  returning id into work_item_id;

  event_id := private.emit_domain_event(
    p_workspace_id, 'episode.created.v1', 'episode', episode_id, 1, p_correlation_id,
    jsonb_build_object(
      'episodeId', episode_id, 'seriesId', p_series_id, 'episodeNumber', next_number
    )
  );

  insert into public.notifications (
    workspace_id, recipient_user_id, work_item_id, domain_event_id, material_key,
    title, safe_summary, deep_link
  ) values (
    p_workspace_id, p_owner_user_id, work_item_id, event_id,
    'episode:' || episode_id::text || ':world_setup',
    'Episode ready for world setup',
    'Start with the exact script and creative world.',
    '/episodes/' || episode_id::text || '/create'
  );

  response := jsonb_build_object(
    'ok', true, 'episodeId', episode_id, 'episodeNumber', next_number,
    'workItemId', work_item_id, 'aggregateVersion', 1
  );
  perform private.record_command(
    p_command_id, p_workspace_id, actor_id, p_idempotency_key, 'episode.create',
    'episode', episode_id, null, p_request_hash, response, p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id, 'episode.create', 'episode', episode_id, 1, p_command_id,
    p_idempotency_key, p_correlation_id, 'allow', 'accepted'
  );
  return response;
end;
$$;

create or replace function public.command_archive_series(
  p_workspace_id uuid,
  p_series_id uuid,
  p_expected_version bigint,
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
  new_version bigint;
  response jsonb;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || actor_id::text || p_idempotency_key, 0)
  );
  response := private.existing_command_response(
    p_workspace_id, actor_id, p_idempotency_key, 'series.archive', p_request_hash
  );
  if response is not null then return response; end if;
  perform private.assert_active_session(p_workspace_id);

  update public.series s
  set state = 'archived',
      archived_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where s.id = p_series_id
    and s.workspace_id = p_workspace_id
    and s.state = 'active'
    and s.aggregate_version = p_expected_version
    and (
      s.owner_user_id = actor_id
      or private.has_workspace_role(
        p_workspace_id, actor_id, array['admin']::public.membership_role[]
      )
    )
  returning aggregate_version into new_version;
  if not found then
    raise exception 'Series conflict or authorization failure' using errcode = '40001';
  end if;

  update private.aggregate_versions
  set current_version = new_version, updated_at = statement_timestamp()
  where workspace_id = p_workspace_id and aggregate_type = 'series' and aggregate_id = p_series_id;

  perform private.emit_domain_event(
    p_workspace_id, 'series.archived.v1', 'series', p_series_id, new_version,
    p_correlation_id, jsonb_build_object('seriesId', p_series_id)
  );
  response := jsonb_build_object(
    'ok', true, 'seriesId', p_series_id, 'aggregateVersion', new_version
  );
  perform private.record_command(
    p_command_id, p_workspace_id, actor_id, p_idempotency_key, 'series.archive',
    'series', p_series_id, p_expected_version, p_request_hash, response, p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id, 'series.archive', 'series', p_series_id, new_version, p_command_id,
    p_idempotency_key, p_correlation_id, 'allow', 'accepted'
  );
  return response;
end;
$$;

create or replace function public.command_claim_work_item(
  p_workspace_id uuid,
  p_work_item_id uuid,
  p_lease_seconds integer,
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
  actor_role public.membership_role;
  required public.membership_role;
  assigned uuid;
  fence bigint;
  lease_id uuid;
  response jsonb;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_lease_seconds not between 60 and 1800 then
    raise exception 'lease duration out of range' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || actor_id::text || p_idempotency_key, 0)
  );
  response := private.existing_command_response(
    p_workspace_id, actor_id, p_idempotency_key, 'work.claim', p_request_hash
  );
  if response is not null then return response; end if;
  perform private.assert_active_session(p_workspace_id);

  select m.role into actor_role from public.memberships m
  where m.workspace_id = p_workspace_id and m.user_id = actor_id and m.status = 'active';
  select w.required_role, w.assigned_user_id into required, assigned
  from public.work_items w
  where w.workspace_id = p_workspace_id
    and w.id = p_work_item_id
    and w.state in ('open', 'claimed')
  for update;
  if not found
    or private.role_rank(actor_role) < private.role_rank(required)
    or (assigned is not null and assigned <> actor_id and actor_role <> 'admin')
  then
    raise exception 'work item unavailable or actor ineligible' using errcode = '42501';
  end if;

  update public.work_leases
  set lease_state = 'expired', released_at = statement_timestamp(),
      release_reason = 'expired before takeover'
  where work_item_id = p_work_item_id
    and lease_state = 'active'
    and expires_at <= statement_timestamp();

  if exists (
    select 1 from public.work_leases
    where work_item_id = p_work_item_id and lease_state = 'active'
  ) then
    raise exception 'work item is already leased' using errcode = '55P03';
  end if;

  select coalesce(max(fencing_token), 0) + 1 into fence
  from public.work_leases where work_item_id = p_work_item_id;

  insert into public.work_leases (
    workspace_id, work_item_id, holder_user_id, fencing_token, expires_at
  ) values (
    p_workspace_id, p_work_item_id, actor_id, fence,
    statement_timestamp() + make_interval(secs => p_lease_seconds)
  ) returning id into lease_id;

  update public.work_items
  set state = 'claimed', assigned_user_id = actor_id,
      aggregate_version = aggregate_version + 1
  where id = p_work_item_id;

  response := jsonb_build_object(
    'ok', true, 'workItemId', p_work_item_id, 'leaseId', lease_id,
    'fencingToken', fence
  );
  perform private.record_command(
    p_command_id, p_workspace_id, actor_id, p_idempotency_key, 'work.claim',
    'work_item', p_work_item_id, null, p_request_hash, response, p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id, 'work.claim', 'work_item', p_work_item_id, fence, p_command_id,
    p_idempotency_key, p_correlation_id, 'allow', 'accepted'
  );
  return response;
end;
$$;

create or replace function public.command_create_invitation(
  p_workspace_id uuid,
  p_invited_email text,
  p_token_hash text,
  p_maximum_role public.membership_role,
  p_expires_at timestamptz,
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
  invitation_id uuid;
  response jsonb;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || actor_id::text || p_idempotency_key, 0)
  );
  response := private.existing_command_response(
    p_workspace_id, actor_id, p_idempotency_key, 'invitation.create', p_request_hash
  );
  if response is not null then return response; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_aal2();
  if not private.has_workspace_role(
    p_workspace_id, actor_id, array['admin']::public.membership_role[]
  ) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if p_maximum_role = 'admin' then
    raise exception 'invitations cannot grant admin' using errcode = '42501';
  end if;
  if p_expires_at <= statement_timestamp()
    or p_expires_at > statement_timestamp() + interval '24 hours'
  then
    raise exception 'invitation expiry must be within 24 hours' using errcode = '22023';
  end if;

  update public.invitations
  set revoked_at = statement_timestamp(), revoke_reason = 'superseded by resend'
  where workspace_id = p_workspace_id
    and invited_email = lower(trim(p_invited_email))::extensions.citext
    and consumed_at is null and revoked_at is null;

  insert into public.invitations (
    workspace_id, invited_email, token_hash, maximum_role, issued_by, expires_at
  ) values (
    p_workspace_id, lower(trim(p_invited_email))::extensions.citext, p_token_hash,
    p_maximum_role, actor_id, p_expires_at
  ) returning id into invitation_id;

  response := jsonb_build_object(
    'ok', true, 'invitationId', invitation_id, 'expiresAt', p_expires_at
  );
  perform private.record_command(
    p_command_id, p_workspace_id, actor_id, p_idempotency_key, 'invitation.create',
    'notification', invitation_id, null, p_request_hash, response, p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id, 'invitation.create', 'invitation', invitation_id, 1,
    p_command_id, p_idempotency_key, p_correlation_id, 'allow', 'accepted',
    null, jsonb_build_object('maximumRole', p_maximum_role)
  );
  return response;
end;
$$;

create or replace function public.command_accept_invitation(
  p_token_hash text,
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
  invite public.invitations%rowtype;
  jwt_email extensions.citext;
  response jsonb;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select lower(trim(auth.jwt() ->> 'email'))::extensions.citext into jwt_email;
  if jwt_email is null then raise exception 'verified email required' using errcode = '42501'; end if;

  select * into invite from public.invitations
  where token_hash = p_token_hash
  for update;
  if not found
    or invite.consumed_at is not null
    or invite.revoked_at is not null
    or invite.expires_at <= statement_timestamp()
    or invite.invited_email <> jwt_email
    or not exists (
      select 1 from auth.users u
      where u.id = actor_id and u.email_confirmed_at is not null
        and lower(u.email)::extensions.citext = invite.invited_email
    )
  then
    raise exception 'invitation is invalid, expired, replayed, or email-mismatched'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(invite.workspace_id::text || actor_id::text || p_idempotency_key, 0)
  );
  response := private.existing_command_response(
    invite.workspace_id, actor_id, p_idempotency_key, 'invitation.accept', p_request_hash
  );
  if response is not null then return response; end if;

  insert into public.profiles (user_id, display_name)
  values (actor_id, split_part(auth.jwt() ->> 'email', '@', 1))
  on conflict (user_id) do nothing;

  insert into public.memberships (
    workspace_id, user_id, role, status, authority_epoch, invited_by, activated_at
  ) values (
    invite.workspace_id, actor_id, invite.maximum_role, 'active', 1,
    invite.issued_by, statement_timestamp()
  )
  on conflict (workspace_id, user_id) do update
  set role = excluded.role, status = 'active',
      authority_epoch = public.memberships.authority_epoch + 1,
      invited_by = excluded.invited_by, activated_at = statement_timestamp(),
      deactivated_at = null;

  update public.invitations
  set consumed_at = statement_timestamp(), consumed_by = actor_id
  where id = invite.id;

  insert into public.membership_role_history (
    workspace_id, user_id, actor_user_id, new_role, new_status, reason, authority_epoch
  )
  select m.workspace_id, m.user_id, invite.issued_by, m.role, m.status,
    'invitation accepted', m.authority_epoch
  from public.memberships m
  where m.workspace_id = invite.workspace_id and m.user_id = actor_id;

  response := jsonb_build_object(
    'ok', true, 'workspaceId', invite.workspace_id, 'role', invite.maximum_role
  );
  perform private.record_command(
    p_command_id, invite.workspace_id, actor_id, p_idempotency_key, 'invitation.accept',
    'notification', invite.id, null, p_request_hash, response, p_correlation_id
  );
  perform private.insert_audit_event(
    invite.workspace_id, 'invitation.accept', 'invitation', invite.id, 1,
    p_command_id, p_idempotency_key, p_correlation_id, 'allow', 'accepted'
  );
  return response;
end;
$$;

create or replace function public.command_offboard_member(
  p_workspace_id uuid,
  p_target_user_id uuid,
  p_replacement_user_id uuid,
  p_expected_authority_epoch bigint,
  p_reason text,
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
  target_role public.membership_role;
  response jsonb;
  new_epoch bigint;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_workspace_id::text || actor_id::text || p_idempotency_key, 0)
  );
  response := private.existing_command_response(
    p_workspace_id, actor_id, p_idempotency_key, 'membership.offboard', p_request_hash
  );
  if response is not null then return response; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_aal2();
  if not private.has_workspace_role(
    p_workspace_id, actor_id, array['admin']::public.membership_role[]
  ) then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  if actor_id = p_target_user_id then
    raise exception 'self-offboarding requires a different active admin' using errcode = '42501';
  end if;
  if not private.is_active_member(p_workspace_id, p_replacement_user_id) then
    raise exception 'replacement must be an active member' using errcode = '23503';
  end if;

  select role into target_role from public.memberships
  where workspace_id = p_workspace_id and user_id = p_target_user_id
    and status = 'active' and authority_epoch = p_expected_authority_epoch
  for update;
  if not found then raise exception 'membership conflict' using errcode = '40001'; end if;
  if target_role = 'admin' and (
    select count(*) from public.memberships
    where workspace_id = p_workspace_id and role = 'admin' and status = 'active'
  ) <= 1 then
    raise exception 'cannot offboard the last active admin' using errcode = '42501';
  end if;

  update public.work_leases
  set lease_state = 'revoked', released_at = statement_timestamp(),
      release_reason = 'member offboarded'
  where workspace_id = p_workspace_id and holder_user_id = p_target_user_id
    and lease_state = 'active';
  update public.work_items
  set assigned_user_id = p_replacement_user_id,
      state = case when state = 'claimed' then 'open' else state end,
      aggregate_version = aggregate_version + 1
  where workspace_id = p_workspace_id and assigned_user_id = p_target_user_id
    and state in ('open', 'claimed');
  update public.episodes
  set owner_user_id = p_replacement_user_id, aggregate_version = aggregate_version + 1
  where workspace_id = p_workspace_id and owner_user_id = p_target_user_id;
  update public.series
  set owner_user_id = p_replacement_user_id, aggregate_version = aggregate_version + 1
  where workspace_id = p_workspace_id and owner_user_id = p_target_user_id;

  insert into private.auth_session_revocations (
    workspace_id, user_id, revoked_by, reason, expires_at
  ) values (
    p_workspace_id, p_target_user_id, actor_id, p_reason,
    statement_timestamp() + interval '30 days'
  );
  update public.memberships
  set status = 'deactivated', deactivated_at = statement_timestamp(),
      authority_epoch = authority_epoch + 1
  where workspace_id = p_workspace_id and user_id = p_target_user_id
  returning authority_epoch into new_epoch;

  insert into public.membership_role_history (
    workspace_id, user_id, actor_user_id, prior_role, new_role,
    prior_status, new_status, reason, authority_epoch
  ) values (
    p_workspace_id, p_target_user_id, actor_id, target_role, target_role,
    'active', 'deactivated', p_reason, new_epoch
  );

  response := jsonb_build_object(
    'ok', true, 'userId', p_target_user_id,
    'replacementUserId', p_replacement_user_id, 'authorityEpoch', new_epoch
  );
  perform private.record_command(
    p_command_id, p_workspace_id, actor_id, p_idempotency_key, 'membership.offboard',
    'notification', p_target_user_id, p_expected_authority_epoch,
    p_request_hash, response, p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id, 'membership.offboard', 'membership', p_target_user_id, new_epoch,
    p_command_id, p_idempotency_key, p_correlation_id, 'allow', 'accepted', p_reason,
    jsonb_build_object('replacementUserId', p_replacement_user_id)
  );
  return response;
end;
$$;

create or replace function private.reconcile_expired_work_leases(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_limit not between 1 and 1000 then raise exception 'limit out of range'; end if;
  with expired as (
    select l.id, l.work_item_id
    from public.work_leases l
    where l.lease_state = 'active' and l.expires_at <= statement_timestamp()
    order by l.expires_at
    for update skip locked
    limit p_limit
  ),
  changed as (
    update public.work_leases l
    set lease_state = 'expired', released_at = statement_timestamp(),
        release_reason = 'lease reconciler'
    from expired e
    where l.id = e.id
    returning l.work_item_id
  )
  update public.work_items w
  set state = 'open', aggregate_version = aggregate_version + 1
  where w.id in (select work_item_id from changed)
    and w.state = 'claimed'
    and not exists (
      select 1 from public.work_leases live
      where live.work_item_id = w.id and live.lease_state = 'active'
    );
  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- RLS is mandatory on every table in the exposed public schema.
alter table public.organizations enable row level security;
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_role_history enable row level security;
alter table public.invitations enable row level security;
alter table public.workspace_acl_entries enable row level security;
alter table public.series enable row level security;
alter table public.series_releases enable row level security;
alter table public.series_release_statuses enable row level security;
alter table public.continuity_state_versions enable row level security;
alter table public.episodes enable row level security;
alter table public.episode_watchers enable row level security;
alter table public.domain_events enable row level security;
alter table public.work_items enable row level security;
alter table public.work_leases enable row level security;
alter table public.notifications enable row level security;
alter table public.watches enable row level security;
alter table public.presence_sessions enable row level security;

create policy organizations_member_select on public.organizations
for select to authenticated
using (private.is_organization_member(id, (select auth.uid())));

create policy workspaces_member_select on public.workspaces
for select to authenticated
using (private.is_active_member(id, (select auth.uid())));

create policy profiles_colleague_select on public.profiles
for select to authenticated
using (private.shares_active_workspace(user_id, (select auth.uid())));
create policy profiles_self_update on public.profiles
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy memberships_workspace_select on public.memberships
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy membership_history_admin_select on public.membership_role_history
for select to authenticated
using (
  private.has_workspace_role(
    workspace_id, (select auth.uid()), array['admin']::public.membership_role[]
  )
);
create policy invitations_admin_select on public.invitations
for select to authenticated
using (
  private.has_workspace_role(
    workspace_id, (select auth.uid()), array['admin']::public.membership_role[]
  )
);
create policy acl_admin_select on public.workspace_acl_entries
for select to authenticated
using (
  private.has_workspace_role(
    workspace_id, (select auth.uid()), array['admin']::public.membership_role[]
  )
);

create policy series_member_select on public.series
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy releases_member_select on public.series_releases
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy release_statuses_member_select on public.series_release_statuses
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy continuity_member_select on public.continuity_state_versions
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy episodes_member_select on public.episodes
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy episode_watchers_member_select on public.episode_watchers
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy events_member_select on public.domain_events
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy work_items_member_select on public.work_items
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy work_leases_member_select on public.work_leases
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy notifications_recipient_select on public.notifications
for select to authenticated
using (
  recipient_user_id = (select auth.uid())
  and private.is_active_member(workspace_id, (select auth.uid()))
);
create policy notifications_recipient_update on public.notifications
for update to authenticated
using (
  recipient_user_id = (select auth.uid())
  and private.is_active_member(workspace_id, (select auth.uid()))
)
with check (
  recipient_user_id = (select auth.uid())
  and private.is_active_member(workspace_id, (select auth.uid()))
);
create policy watches_self_all on public.watches
for all to authenticated
using (
  user_id = (select auth.uid())
  and private.is_active_member(workspace_id, (select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and private.is_active_member(workspace_id, (select auth.uid()))
);
create policy presence_workspace_select on public.presence_sessions
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy presence_self_insert on public.presence_sessions
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and session_id = private.current_session_id()
  and private.is_current_session_allowed(workspace_id)
);
create policy presence_self_update on public.presence_sessions
for update to authenticated
using (user_id = (select auth.uid()) and session_id = private.current_session_id())
with check (
  user_id = (select auth.uid())
  and session_id = private.current_session_id()
  and private.is_current_session_allowed(workspace_id)
);
create policy presence_self_delete on public.presence_sessions
for delete to authenticated
using (user_id = (select auth.uid()) and session_id = private.current_session_id());

revoke all on all tables in schema public from anon, authenticated;
grant select on public.organizations, public.workspaces, public.profiles,
  public.memberships, public.membership_role_history, public.invitations,
  public.workspace_acl_entries, public.series, public.series_releases,
  public.series_release_statuses, public.continuity_state_versions,
  public.episodes, public.episode_watchers, public.domain_events,
  public.work_items, public.work_leases, public.notifications,
  public.watches, public.presence_sessions to authenticated;
grant update (display_name, avatar_path) on public.profiles to authenticated;
grant update (state, read_at, dismissed_at) on public.notifications to authenticated;
grant insert, delete on public.watches to authenticated;
grant insert, update, delete on public.presence_sessions to authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.command_create_series(
  uuid,text,text,text,uuid,uuid,text,text,uuid
) to authenticated;
grant execute on function public.command_create_episode(
  uuid,uuid,text,text,uuid,uuid,text,text,uuid
) to authenticated;
grant execute on function public.command_archive_series(
  uuid,uuid,bigint,uuid,text,text,uuid
) to authenticated;
grant execute on function public.command_claim_work_item(
  uuid,uuid,integer,uuid,text,text,uuid
) to authenticated;
grant execute on function public.command_create_invitation(
  uuid,text,text,public.membership_role,timestamptz,uuid,text,text,uuid
) to authenticated;
grant execute on function public.command_accept_invitation(
  text,uuid,text,text,uuid
) to authenticated;
grant execute on function public.command_offboard_member(
  uuid,uuid,uuid,bigint,text,uuid,text,text,uuid
) to authenticated;

grant usage on schema private to authenticated;
grant execute on function private.is_active_member(uuid,uuid) to authenticated;
grant execute on function private.has_workspace_role(
  uuid,uuid,public.membership_role[]
) to authenticated;
grant execute on function private.is_organization_member(uuid,uuid) to authenticated;
grant execute on function private.shares_active_workspace(uuid,uuid) to authenticated;
grant execute on function private.current_session_id() to authenticated;
grant execute on function private.is_current_session_allowed(uuid) to authenticated;

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all tables in schema audit from public, anon, authenticated;

alter table public.series replica identity full;
alter table public.episodes replica identity full;
alter table public.work_items replica identity full;
alter table public.work_leases replica identity full;
alter table public.notifications replica identity full;
alter table public.presence_sessions replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.series;
    alter publication supabase_realtime add table public.episodes;
    alter publication supabase_realtime add table public.work_items;
    alter publication supabase_realtime add table public.work_leases;
    alter publication supabase_realtime add table public.notifications;
    alter publication supabase_realtime add table public.presence_sessions;
  end if;
end;
$$;

-- Phase 1 adversarial corrections:
-- - every replay is re-authorized against current membership/session state;
-- - invitation retries are safe and offboarding cannot be undone by an old invite;
-- - deactivated members cannot retain active ownership, assignments, or leases;
-- - authenticated diagnostics are rate-limited again at the database boundary.

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

  -- A receipt is a replay result, not an authorization cache.
  perform private.assert_active_session(p_workspace_id);

  if receipt.command_type <> p_command_type or receipt.request_hash <> p_request_hash then
    raise exception 'idempotency key was already used with a different request'
      using errcode = '22023';
  end if;
  return receipt.response_json;
end;
$$;

create or replace function private.is_current_session_allowed(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and w.state = 'active'
      and not exists (
        select 1
        from private.auth_session_revocations r
        where r.workspace_id = m.workspace_id
          and r.user_id = m.user_id
          -- A deliberate later re-invitation establishes a new authority epoch.
          and r.revoked_at >= m.activated_at
          and (
            r.session_id = private.current_session_id()
            or (
              r.session_id is null
              and (r.expires_at is null or r.expires_at > statement_timestamp())
            )
          )
      )
  );
$$;

create or replace function private.validate_invitation_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from auth.users u
    join public.memberships m
      on m.workspace_id = new.workspace_id
     and m.user_id = u.id
     and m.status = 'active'
    where lower(u.email)::extensions.citext = new.invited_email
  ) then
    raise exception 'invitation target is already an active member'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

update public.invitations i
set revoked_at = statement_timestamp(),
    revoke_reason = 'active member invitation invalidated by security migration'
where i.consumed_at is null
  and i.revoked_at is null
  and exists (
    select 1
    from auth.users u
    join public.memberships m
      on m.workspace_id = i.workspace_id
     and m.user_id = u.id
     and m.status = 'active'
    where lower(u.email)::extensions.citext = i.invited_email
  );

create trigger invitations_reject_active_member
before insert on public.invitations
for each row execute function private.validate_invitation_target();

create or replace function private.guard_membership_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status = 'deactivated' then
    if exists (
      select 1 from public.series s
      where s.workspace_id = new.workspace_id and s.owner_user_id = new.user_id
    ) or exists (
      select 1 from public.episodes e
      where e.workspace_id = new.workspace_id and e.owner_user_id = new.user_id
    ) or exists (
      select 1 from public.work_items w
      where w.workspace_id = new.workspace_id
        and w.assigned_user_id = new.user_id
        and w.state in ('open', 'claimed')
    ) or exists (
      select 1 from public.work_leases l
      where l.workspace_id = new.workspace_id
        and l.holder_user_id = new.user_id
        and l.lease_state = 'active'
    ) then
      raise exception 'deactivated member retains active ownership or work'
        using errcode = '23514';
    end if;

    update public.invitations i
    set revoked_at = statement_timestamp(),
        revoke_reason = 'member offboarded'
    where i.workspace_id = new.workspace_id
      and i.consumed_at is null
      and i.revoked_at is null
      and i.invited_email = (
        select lower(u.email)::extensions.citext
        from auth.users u
        where u.id = new.user_id
      );
  end if;
  return new;
end;
$$;

create trigger memberships_deactivation_guard
before update of status on public.memberships
for each row execute function private.guard_membership_deactivation();

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
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select lower(trim(auth.jwt() ->> 'email'))::extensions.citext into jwt_email;
  if jwt_email is null then
    raise exception 'verified email required' using errcode = '42501';
  end if;

  select * into invite
  from public.invitations
  where token_hash = p_token_hash
  for update;
  if not found then
    raise exception 'invitation is invalid, expired, replayed, or email-mismatched'
      using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      invite.workspace_id::text || actor_id::text || p_idempotency_key,
      0
    )
  );
  response := private.existing_command_response(
    invite.workspace_id,
    actor_id,
    p_idempotency_key,
    'invitation.accept',
    p_request_hash
  );
  if response is not null then
    return response;
  end if;

  if invite.consumed_at is not null
    or invite.revoked_at is not null
    or invite.expires_at <= statement_timestamp()
    or invite.invited_email <> jwt_email
    or not exists (
      select 1
      from auth.users u
      where u.id = actor_id
        and u.email_confirmed_at is not null
        and lower(u.email)::extensions.citext = invite.invited_email
    )
    or exists (
      select 1
      from private.auth_session_revocations r
      where r.workspace_id = invite.workspace_id
        and r.user_id = actor_id
        and r.revoked_at >= invite.created_at
    )
  then
    raise exception 'invitation is invalid, expired, replayed, or email-mismatched'
      using errcode = '42501';
  end if;

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
  set role = excluded.role,
      status = 'active',
      authority_epoch = public.memberships.authority_epoch + 1,
      invited_by = excluded.invited_by,
      activated_at = statement_timestamp(),
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
    p_command_id, invite.workspace_id, actor_id, p_idempotency_key,
    'invitation.accept', 'notification', invite.id, null, p_request_hash,
    response, p_correlation_id
  );
  perform private.insert_audit_event(
    invite.workspace_id, 'invitation.accept', 'invitation', invite.id, 1,
    p_command_id, p_idempotency_key, p_correlation_id, 'allow', 'accepted'
  );
  return response;
end;
$$;

create or replace function public.record_client_diagnostic(
  p_event_type text,
  p_occurred_at timestamptz,
  p_environment text,
  p_correlation_id text,
  p_safe_summary text,
  p_dedupe_hash text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  diagnostic_id uuid;
begin
  if auth.role() <> 'service_role' or p_actor_user_id is null then
    raise exception 'authenticated service intake required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = p_actor_user_id
      and m.status = 'active'
      and w.state = 'active'
  ) then
    raise exception 'active member required' using errcode = '42501';
  end if;
  if p_event_type <> 'app.client_error'
    or p_environment not in ('development', 'preview', 'production', 'test')
    or char_length(p_correlation_id) not between 8 and 160
    or char_length(coalesce(p_safe_summary, '')) > 1000
    or p_dedupe_hash !~ '^[a-f0-9]{64}$'
    or p_occurred_at < statement_timestamp() - interval '10 minutes'
    or p_occurred_at > statement_timestamp() + interval '1 minute'
  then
    raise exception 'diagnostic envelope rejected' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('diagnostic:' || p_actor_user_id::text, 0)
  );
  if (
    select count(*)
    from private.diagnostic_events d
    where d.actor_user_id = p_actor_user_id
      and d.received_at > statement_timestamp() - interval '1 minute'
  ) >= 20 then
    raise exception 'diagnostic rate limit reached' using errcode = '54000';
  end if;

  insert into private.diagnostic_events (
    event_type, occurred_at, environment, correlation_id, safe_summary,
    retention_class, source, dedupe_hash, actor_user_id
  )
  values (
    p_event_type, p_occurred_at, p_environment, p_correlation_id,
    p_safe_summary, 'short', 'client', p_dedupe_hash, p_actor_user_id
  )
  on conflict (dedupe_hash) where dedupe_hash is not null
  do nothing
  returning id into diagnostic_id;

  if diagnostic_id is null then
    select d.id into diagnostic_id
    from private.diagnostic_events d
    where d.dedupe_hash = p_dedupe_hash;
  end if;

  return diagnostic_id;
end;
$$;

revoke all on function public.record_client_diagnostic(
  text,timestamptz,text,text,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.record_client_diagnostic(
  text,timestamptz,text,text,text,text,uuid
) to service_role;

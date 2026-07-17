-- Phase 1 / 0012: serialize workspace authority changes, close invitation
-- offboarding races, and force signed URL creation through the bounded broker.

-- Invitation creation may wait behind the workspace authority lock. Capture
-- the actual post-lock insert time rather than the statement start time so a
-- deliberately fresh reinvitation is not misclassified as predating the
-- offboarding transaction it waited for.
alter table public.invitations
  alter column created_at set default clock_timestamp();

create or replace function private.lock_workspace_authority(p_workspace_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_workspace_id is null then
    raise exception 'workspace is required' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'genie:workspace-authority:' || p_workspace_id::text,
      0
    )
  );
end;
$$;

create table private.membership_session_authorizations (
  workspace_id uuid not null,
  user_id uuid not null,
  authority_epoch bigint not null check (authority_epoch > 0),
  session_id uuid not null,
  authorized_at timestamptz not null default statement_timestamp(),
  invitation_id uuid references public.invitations(id) on delete restrict,
  primary key (workspace_id, user_id, authority_epoch, session_id),
  foreign key (workspace_id, user_id)
    references public.memberships(workspace_id, user_id) on delete cascade
);

create index membership_session_authorizations_session_idx
  on private.membership_session_authorizations (session_id, workspace_id, user_id);

revoke all on private.membership_session_authorizations
from public, anon, authenticated;

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
      and private.current_session_id() is not null
      and not exists (
        select 1
        from private.auth_session_revocations r
        where r.workspace_id = m.workspace_id
          and r.user_id = m.user_id
          and r.session_id = private.current_session_id()
          and (r.expires_at is null or r.expires_at > statement_timestamp())
      )
      and (
        -- No historical global revocation means this is an original,
        -- continuously active membership.
        not exists (
          select 1
          from private.auth_session_revocations r
          where r.workspace_id = m.workspace_id
            and r.user_id = m.user_id
            and r.session_id is null
        )
        or exists (
          -- After any global offboarding event, only the exact session that
          -- accepted the current authority epoch is trusted. Historical global
          -- revocations remain epoch markers even after their embargo expires.
          select 1
          from private.membership_session_authorizations a
          where a.workspace_id = m.workspace_id
            and a.user_id = m.user_id
            and a.authority_epoch = m.authority_epoch
            and a.session_id = private.current_session_id()
            -- The current authority epoch proves this authorization was
            -- created only by the serialized successful reinvitation. Equal
            -- database timestamps are therefore valid; a pre-offboarding
            -- authorization has an older epoch and cannot match.
            and a.authorized_at >= (
              select max(r.revoked_at)
              from private.auth_session_revocations r
              where r.workspace_id = m.workspace_id
                and r.user_id = m.user_id
                and r.session_id is null
            )
        )
      )
  );
$$;

create or replace function private.is_active_member(
  p_workspace_id uuid,
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
    from public.memberships m
    join public.workspaces w on w.id = m.workspace_id
    where m.workspace_id = p_workspace_id
      and m.user_id = p_user_id
      and m.status = 'active'
      and w.state = 'active'
      and (
        p_user_id is distinct from auth.uid()
        or private.is_current_session_allowed(p_workspace_id)
      )
  );
$$;

create or replace function private.has_workspace_role(
  p_workspace_id uuid,
  p_user_id uuid,
  p_roles public.membership_role[]
)
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
      and m.user_id = p_user_id
      and m.status = 'active'
      and m.role = any(p_roles)
      and w.state = 'active'
      and (
        p_user_id is distinct from auth.uid()
        or private.is_current_session_allowed(p_workspace_id)
      )
  );
$$;

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
      and (
        p_user_id is distinct from auth.uid()
        or private.is_current_session_allowed(w.id)
      )
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
      and (
        p_left_user_id is distinct from auth.uid()
        or private.is_current_session_allowed(l.workspace_id)
      )
      and (
        p_right_user_id is distinct from auth.uid()
        or private.is_current_session_allowed(r.workspace_id)
      )
  );
$$;

create or replace function private.assert_active_session(p_workspace_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.lock_workspace_authority(p_workspace_id);
  if auth.uid() is null or not private.is_current_session_allowed(p_workspace_id) then
    raise exception 'active workspace session required' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.can_access_storage_object(
  p_workspace_id uuid,
  p_name text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if private.storage_workspace_id(p_name) is distinct from p_workspace_id then
    return false;
  end if;
  perform private.lock_workspace_authority(p_workspace_id);
  return private.is_current_session_allowed(p_workspace_id);
end;
$$;

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
      and (
        i.issued_by = new.user_id
        or i.invited_email = (
          select lower(u.email)::extensions.citext
          from auth.users u
          where u.id = new.user_id
        )
      );
  end if;
  return new;
end;
$$;

create or replace function private.validate_invitation_consumption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.consumed_at is null and new.consumed_at is not null
    and not private.has_workspace_role(
      new.workspace_id,
      old.issued_by,
      array['admin']::public.membership_role[]
    )
  then
    raise exception 'active invitation issuer required' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists invitations_require_active_issuer_before_consumption
on public.invitations;
create trigger invitations_require_active_issuer_before_consumption
before update of consumed_at on public.invitations
for each row execute function private.validate_invitation_consumption();

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
  current_session uuid;
  invite public.invitations%rowtype;
  invite_workspace_id uuid;
  jwt_email extensions.citext;
  response jsonb;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  current_session := private.current_session_id();
  if current_session is null then
    raise exception 'authenticated session required' using errcode = '42501';
  end if;
  select lower(trim(auth.jwt() ->> 'email'))::extensions.citext into jwt_email;
  if jwt_email is null then
    raise exception 'verified email required' using errcode = '42501';
  end if;

  -- Read only the workspace before taking the workspace-wide authority lock.
  -- The row is selected again FOR UPDATE after the lock, so revocation or
  -- consumption that committed while waiting is always observed.
  select i.workspace_id into invite_workspace_id
  from public.invitations i
  where i.token_hash = p_token_hash;
  if not found then
    raise exception 'invitation is invalid, expired, replayed, or email-mismatched'
      using errcode = '42501';
  end if;
  perform private.lock_workspace_authority(invite_workspace_id);

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
    or not private.has_workspace_role(
      invite.workspace_id,
      invite.issued_by,
      array['admin']::public.membership_role[]
    )
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
        -- The deactivation trigger already revokes every then-live invitation
        -- addressed to this user while holding the workspace authority lock.
        -- Equality therefore represents a fresh, serialized reinvitation in
        -- the same transaction timestamp; only an invitation strictly older
        -- than a later revocation is stale.
        and r.revoked_at > invite.created_at
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

  insert into private.membership_session_authorizations (
    workspace_id,
    user_id,
    authority_epoch,
    session_id,
    invitation_id
  )
  select
    m.workspace_id,
    m.user_id,
    m.authority_epoch,
    current_session,
    invite.id
  from public.memberships m
  where m.workspace_id = invite.workspace_id and m.user_id = actor_id;

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

create or replace function public.authorize_storage_sign(
  p_bucket text,
  p_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
begin
  if p_bucket <> 'workspace-private' then
    raise exception 'storage access denied' using errcode = '42501';
  end if;
  workspace_id := private.storage_workspace_id(p_path);
  if workspace_id is null then
    raise exception 'storage access denied' using errcode = '42501';
  end if;
  perform private.assert_active_session(workspace_id);
  return true;
end;
$$;

revoke all on function public.authorize_storage_sign(text,text)
from public, anon, authenticated;
grant execute on function public.authorize_storage_sign(text,text) to authenticated;

drop policy if exists workspace_private_member_select on storage.objects;
create policy workspace_private_member_select on storage.objects
for select to authenticated
using (
  bucket_id = 'workspace-private'
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
  and (
    storage.allow_any_operation(array[
      'storage.object.list',
      'storage.object.list_v2',
      'storage.object.get_authenticated',
      'object.get_authenticated_info',
      'object.head_authenticated_info'
    ])
    or (
      storage.allow_any_operation(array[
        'storage.object.upload',
        'storage.object.upload_update'
      ])
      and owner_id = (select auth.uid()::text)
    )
  )
);

drop policy if exists workspace_private_member_insert on storage.objects;
create policy workspace_private_member_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'workspace-private'
  and storage.allow_only_operation('storage.object.upload')
  and owner_id = (select auth.uid()::text)
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
);

drop policy if exists workspace_private_member_update on storage.objects;
create policy workspace_private_member_update on storage.objects
for update to authenticated
using (
  bucket_id = 'workspace-private'
  and storage.allow_only_operation('storage.object.upload_update')
  and owner_id = (select auth.uid()::text)
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
)
with check (
  bucket_id = 'workspace-private'
  and storage.allow_only_operation('storage.object.upload_update')
  and owner_id = (select auth.uid()::text)
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
);

drop policy if exists workspace_private_member_delete on storage.objects;
create policy workspace_private_member_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'workspace-private'
  and storage.allow_any_operation(array[
    'storage.object.delete',
    'storage.object.delete_many'
  ])
  and owner_id = (select auth.uid()::text)
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
);

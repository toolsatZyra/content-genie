-- Phase 1 / 0002: identity, membership, invitations, sessions, and ACLs.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_at timestamptz not null default statement_timestamp()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  state public.workspace_state not null default 'active',
  settings_version bigint not null default 1 check (settings_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 100),
  avatar_path text,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  check (avatar_path is null or (
    avatar_path !~ '(^|/)\.{1,2}(/|$)'
    and avatar_path !~ '[\\%]'
    and char_length(avatar_path) <= 512
  ))
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.membership_role not null,
  status public.membership_state not null default 'pending',
  authority_epoch bigint not null default 1 check (authority_epoch > 0),
  invited_by uuid references auth.users(id) on delete set null,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (workspace_id, user_id),
  check (
    (status = 'active' and activated_at is not null and deactivated_at is null)
    or (status = 'pending' and activated_at is null and deactivated_at is null)
    or (status = 'deactivated' and deactivated_at is not null)
  )
);

create table public.membership_role_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  prior_role public.membership_role,
  new_role public.membership_role not null,
  prior_status public.membership_state,
  new_status public.membership_state not null,
  reason text not null check (char_length(reason) between 1 and 1000),
  authority_epoch bigint not null check (authority_epoch > 0),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (workspace_id, user_id)
    references public.memberships(workspace_id, user_id) on delete restrict
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  invited_email extensions.citext not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  maximum_role public.membership_role not null,
  issued_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default statement_timestamp(),
  check (expires_at > created_at),
  check (consumed_at is null or consumed_by is not null),
  check (not (consumed_at is not null and revoked_at is not null)),
  check (revoke_reason is null or revoked_at is not null)
);

create unique index invitations_one_live_email_uq
  on public.invitations (workspace_id, invited_email)
  where consumed_at is null and revoked_at is null;

create table public.workspace_acl_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  principal_user_id uuid not null references auth.users(id) on delete cascade,
  resource_type text not null check (resource_type in ('workspace', 'series')),
  resource_id uuid not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  granted_by uuid not null references auth.users(id) on delete restrict,
  expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, principal_user_id, resource_type, resource_id, action)
);

create table private.auth_session_revocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  session_id uuid,
  revoked_by uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 1000),
  revoked_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  check (session_id is not null or expires_at is not null)
);

create unique index auth_session_revocations_session_uq
  on private.auth_session_revocations (session_id)
  where session_id is not null;

create or replace function private.is_active_member(p_workspace_id uuid, p_user_id uuid)
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
  );
$$;

create or replace function private.current_aal()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

create or replace function private.current_session_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  claim text;
begin
  claim := auth.jwt() ->> 'session_id';
  if claim is null or claim = '' then
    return null;
  end if;
  return claim::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.is_current_session_allowed(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_member(p_workspace_id, auth.uid())
    and not exists (
      select 1
      from private.auth_session_revocations r
      where r.workspace_id = p_workspace_id
        and r.user_id = auth.uid()
        and (
          r.session_id = private.current_session_id()
          or (r.session_id is null and (r.expires_at is null or r.expires_at > statement_timestamp()))
        )
    );
$$;

create trigger organizations_immutable
before update or delete on public.organizations
for each row execute function private.reject_mutation();

create trigger workspaces_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

create trigger profiles_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger memberships_updated_at
before update on public.memberships
for each row execute function private.set_updated_at();

create trigger membership_role_history_immutable
before update or delete on public.membership_role_history
for each row execute function private.reject_mutation();

revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;

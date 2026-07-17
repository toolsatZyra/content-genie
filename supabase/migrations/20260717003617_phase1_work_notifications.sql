-- Phase 1 / 0005: work queues, fenced leases, notifications, watches, and presence.

create table public.work_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid,
  series_id uuid,
  kind text not null check (kind ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  state public.work_item_state not null default 'open',
  required_role public.membership_role not null default 'member',
  assigned_user_id uuid references auth.users(id) on delete set null,
  dedupe_key text not null check (char_length(dedupe_key) between 4 and 240),
  priority smallint not null default 50 check (priority between 0 and 100),
  safe_summary text not null check (char_length(safe_summary) between 1 and 1000),
  deep_link text not null check (deep_link ~ '^/' and char_length(deep_link) <= 1000),
  due_at timestamptz,
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  closed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, episode_id, series_id)
    references public.episodes(workspace_id, id, series_id) on delete restrict,
  foreign key (workspace_id, series_id)
    references public.series(workspace_id, id) on delete restrict,
  foreign key (workspace_id, assigned_user_id)
    references public.memberships(workspace_id, user_id) on delete restrict,
  check (episode_id is not null or series_id is not null),
  check (
    (state in ('completed', 'canceled', 'superseded') and closed_at is not null)
    or (state in ('open', 'claimed') and closed_at is null)
  )
);

create unique index work_items_open_dedupe_uq
  on public.work_items (workspace_id, dedupe_key)
  where state in ('open', 'claimed');

create table public.work_leases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  work_item_id uuid not null,
  holder_user_id uuid not null references auth.users(id) on delete restrict,
  lease_state public.work_lease_state not null default 'active',
  fencing_token bigint not null check (fencing_token > 0),
  acquired_at timestamptz not null default statement_timestamp(),
  heartbeat_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  unique (workspace_id, id),
  unique (work_item_id, fencing_token),
  foreign key (workspace_id, work_item_id)
    references public.work_items(workspace_id, id) on delete restrict,
  foreign key (workspace_id, holder_user_id)
    references public.memberships(workspace_id, user_id) on delete restrict,
  check (expires_at > acquired_at),
  check (
    (lease_state = 'active' and released_at is null)
    or (lease_state <> 'active' and released_at is not null)
  )
);

create unique index work_leases_one_active_uq
  on public.work_leases (work_item_id)
  where lease_state = 'active';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  work_item_id uuid,
  domain_event_id uuid,
  channel text not null default 'in_app' check (channel = 'in_app'),
  state public.notification_state not null default 'unread',
  material_key text not null check (char_length(material_key) between 4 and 240),
  title text not null check (char_length(title) between 1 and 240),
  safe_summary text not null check (char_length(safe_summary) between 1 and 1000),
  deep_link text not null check (deep_link ~ '^/' and char_length(deep_link) <= 1000),
  created_at timestamptz not null default statement_timestamp(),
  read_at timestamptz,
  dismissed_at timestamptz,
  obsolete_at timestamptz,
  unique (workspace_id, recipient_user_id, material_key, channel),
  foreign key (workspace_id, work_item_id)
    references public.work_items(workspace_id, id) on delete cascade,
  foreign key (workspace_id, domain_event_id)
    references public.domain_events(workspace_id, id) on delete cascade,
  check (work_item_id is not null or domain_event_id is not null),
  check ((state = 'read') = (read_at is not null)),
  check ((state = 'dismissed') = (dismissed_at is not null)),
  check ((state = 'obsolete') = (obsolete_at is not null))
);

create table public.watches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('series', 'episode')),
  target_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, user_id, target_type, target_id),
  foreign key (workspace_id, user_id)
    references public.memberships(workspace_id, user_id) on delete cascade
);

create table public.presence_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  episode_id uuid,
  session_id uuid not null,
  status text not null check (status in ('active', 'idle', 'offline')),
  last_seen_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  unique (workspace_id, user_id, session_id),
  foreign key (workspace_id, user_id)
    references public.memberships(workspace_id, user_id) on delete cascade,
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete cascade,
  check (expires_at > last_seen_at)
);

create trigger work_items_updated_at
before update on public.work_items
for each row execute function private.set_updated_at();

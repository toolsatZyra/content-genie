-- Phase 1 / 0003: Series, immutable release projections, continuity, and Episodes.

create table public.series (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  title text not null check (char_length(title) between 1 and 200),
  description text not null default '' check (char_length(description) <= 4000),
  state public.series_state not null default 'active',
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  active_release_id uuid,
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  archived_at timestamptz,
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(description, ''))
  ) stored,
  unique (workspace_id, id),
  unique (workspace_id, slug),
  foreign key (workspace_id, owner_user_id)
    references public.memberships(workspace_id, user_id) on delete restrict,
  check (
    (state = 'active' and archived_at is null)
    or (state = 'archived' and archived_at is not null)
  )
);

create table public.series_releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  series_id uuid not null,
  release_number integer not null check (release_number > 0),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  look_version_id uuid,
  continuity_state_version_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, id, series_id),
  unique (workspace_id, series_id, release_number),
  unique (series_id, release_number),
  unique (series_id, manifest_hash),
  foreign key (workspace_id, series_id)
    references public.series(workspace_id, id) on delete restrict
);

create table public.series_release_statuses (
  release_id uuid primary key references public.series_releases(id) on delete restrict,
  workspace_id uuid not null,
  series_id uuid not null,
  status text not null check (status in ('active', 'superseded', 'withdrawn')),
  version bigint not null default 1 check (version > 0),
  reason text,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, release_id),
  foreign key (workspace_id, series_id)
    references public.series(workspace_id, id) on delete restrict,
  foreign key (workspace_id, release_id, series_id)
    references public.series_releases(workspace_id, id, series_id) on delete restrict,
  check (reason is null or char_length(reason) between 1 and 1000)
);

create table public.continuity_state_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  series_id uuid not null,
  version_no integer not null check (version_no > 0),
  base_version_id uuid,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  safe_summary jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (workspace_id, id, series_id),
  unique (workspace_id, series_id, version_no),
  unique (series_id, version_no),
  foreign key (workspace_id, series_id)
    references public.series(workspace_id, id) on delete restrict,
  foreign key (workspace_id, base_version_id, series_id)
    references public.continuity_state_versions(workspace_id, id, series_id) on delete restrict,
  check (jsonb_typeof(safe_summary) = 'object')
);

alter table public.series_releases
  add constraint series_release_continuity_fk
  foreign key (continuity_state_version_id)
  references public.continuity_state_versions(id) on delete restrict;

alter table public.series
  add constraint series_active_release_fk
  foreign key (workspace_id, active_release_id, id)
  references public.series_releases(workspace_id, id, series_id) on delete restrict;

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  series_id uuid not null,
  episode_number integer not null check (episode_number > 0),
  title text not null check (char_length(title) between 1 and 240),
  summary text not null default '' check (char_length(summary) <= 4000),
  workflow_state public.episode_workflow_state not null default 'draft',
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  pinned_series_release_id uuid,
  pinned_continuity_version_id uuid,
  aggregate_version bigint not null default 1 check (aggregate_version > 0),
  progress_percent numeric(5,2) not null default 0
    check (progress_percent between 0 and 100),
  cost_estimate_minor bigint check (cost_estimate_minor is null or cost_estimate_minor >= 0),
  currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  archived_at timestamptz,
  search_document tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(title, '') || ' ' || coalesce(summary, ''))
  ) stored,
  unique (workspace_id, id),
  unique (workspace_id, id, series_id),
  unique (workspace_id, series_id, episode_number),
  unique (series_id, episode_number),
  foreign key (workspace_id, series_id)
    references public.series(workspace_id, id) on delete restrict,
  foreign key (workspace_id, owner_user_id)
    references public.memberships(workspace_id, user_id) on delete restrict,
  foreign key (workspace_id, pinned_series_release_id, series_id)
    references public.series_releases(workspace_id, id, series_id) on delete restrict,
  foreign key (workspace_id, pinned_continuity_version_id, series_id)
    references public.continuity_state_versions(workspace_id, id, series_id) on delete restrict
);

create table public.episode_watchers (
  workspace_id uuid not null,
  episode_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default statement_timestamp(),
  primary key (episode_id, user_id),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, user_id)
    references public.memberships(workspace_id, user_id) on delete cascade
);

create trigger series_updated_at
before update on public.series
for each row execute function private.set_updated_at();

create trigger episodes_updated_at
before update on public.episodes
for each row execute function private.set_updated_at();

create trigger series_releases_immutable
before update or delete on public.series_releases
for each row execute function private.reject_mutation();

create trigger continuity_state_versions_immutable
before update or delete on public.continuity_state_versions
for each row execute function private.reject_mutation();

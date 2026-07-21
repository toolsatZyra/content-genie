-- Keep the public aggregate version and the private command registry aligned.
-- World asset decisions historically advanced the episode row without advancing
-- the registry, which made a fully accepted World impossible to lock.

create or replace function private.synchronize_core_aggregate_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  aggregate_kind text;
begin
  aggregate_kind := case tg_table_name
    when 'series' then 'series'
    when 'episodes' then 'episode'
    when 'work_items' then 'work_item'
    else null
  end;

  if aggregate_kind is null then
    raise exception 'unsupported aggregate table %', tg_table_name;
  end if;

  insert into private.aggregate_versions (
    workspace_id,
    aggregate_type,
    aggregate_id,
    current_version,
    updated_at
  ) values (
    new.workspace_id,
    aggregate_kind,
    new.id,
    new.aggregate_version,
    statement_timestamp()
  )
  on conflict (workspace_id, aggregate_type, aggregate_id)
  do update set
    current_version = excluded.current_version,
    updated_at = excluded.updated_at;

  return null;
end;
$$;

drop trigger if exists series_aggregate_version_consistency on public.series;
create constraint trigger series_aggregate_version_consistency
after update of aggregate_version on public.series
deferrable initially deferred
for each row execute function private.synchronize_core_aggregate_version();

drop trigger if exists episode_aggregate_version_consistency on public.episodes;
create constraint trigger episode_aggregate_version_consistency
after update of aggregate_version on public.episodes
deferrable initially deferred
for each row execute function private.synchronize_core_aggregate_version();

drop trigger if exists work_item_aggregate_version_consistency on public.work_items;
create constraint trigger work_item_aggregate_version_consistency
after update of aggregate_version on public.work_items
deferrable initially deferred
for each row execute function private.synchronize_core_aggregate_version();

-- Repair historical drift without changing the authoritative public versions.
insert into private.aggregate_versions (
  workspace_id,
  aggregate_type,
  aggregate_id,
  current_version,
  updated_at
)
select workspace_id, 'series', id, aggregate_version, statement_timestamp()
from public.series
on conflict (workspace_id, aggregate_type, aggregate_id)
do update set
  current_version = excluded.current_version,
  updated_at = excluded.updated_at
where private.aggregate_versions.current_version is distinct from excluded.current_version;

insert into private.aggregate_versions (
  workspace_id,
  aggregate_type,
  aggregate_id,
  current_version,
  updated_at
)
select workspace_id, 'episode', id, aggregate_version, statement_timestamp()
from public.episodes
on conflict (workspace_id, aggregate_type, aggregate_id)
do update set
  current_version = excluded.current_version,
  updated_at = excluded.updated_at
where private.aggregate_versions.current_version is distinct from excluded.current_version;

insert into private.aggregate_versions (
  workspace_id,
  aggregate_type,
  aggregate_id,
  current_version,
  updated_at
)
select workspace_id, 'work_item', id, aggregate_version, statement_timestamp()
from public.work_items
on conflict (workspace_id, aggregate_type, aggregate_id)
do update set
  current_version = excluded.current_version,
  updated_at = excluded.updated_at
where private.aggregate_versions.current_version is distinct from excluded.current_version;

revoke all on function private.synchronize_core_aggregate_version() from public;
revoke all on function private.synchronize_core_aggregate_version() from anon;
revoke all on function private.synchronize_core_aggregate_version() from authenticated;

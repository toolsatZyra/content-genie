-- The reconciliation command selects the latest succeeded World run. Guard its
-- active-row retirement so a newer failed/in-progress run can never cause an
-- older succeeded entity set to become authoritative again.

create or replace function private.guard_world_selection_retirement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  archive private.world_selection_history%rowtype;
  entity_id uuid;
  latest_run public.preflight_runs%rowtype;
begin
  select history.*
  into archive
  from private.world_selection_history history
  where history.selection_kind = tg_argv[0]
    and history.selection_id = old.id;

  -- Existing maintenance paths are unchanged. The stricter authority check
  -- applies only to a row the reconciliation command has just archived.
  if archive.selection_id is null then
    return old;
  end if;

  select run.*
  into latest_run
  from public.preflight_runs run
  where run.workspace_id = old.workspace_id
    and run.configuration_candidate_id = old.configuration_candidate_id
    and run.kind = 'world_anchor'
  order by run.run_number desc, run.id desc
  limit 1;

  if latest_run.id is null
    or latest_run.state <> 'succeeded'
    or latest_run.id <> archive.authoritative_preflight_run_id
  then
    raise exception 'stale World selection retirement authority'
      using errcode = '40001';
  end if;

  if tg_argv[0] = 'character' then
    entity_id := old.character_form_id;
  else
    entity_id := old.location_id;
  end if;

  if exists (
    select 1
    from public.world_build_progress_items progress
    where progress.workspace_id = old.workspace_id
      and progress.configuration_candidate_id = old.configuration_candidate_id
      and progress.preflight_run_id = latest_run.id
      and progress.item_kind = any (
        case
          when tg_argv[0] = 'character'
            then array['character']::text[]
          else array['location', 'prop']::text[]
        end
      )
      and progress.world_entity_id = entity_id
  ) then
    raise exception 'current World selection cannot be retired'
      using errcode = '40001';
  end if;

  return old;
end;
$$;

create trigger character_selection_retirement_authority
before delete on public.character_selections
for each row execute function private.guard_world_selection_retirement('character');

create trigger location_selection_retirement_authority
before delete on public.location_selections
for each row execute function private.guard_world_selection_retirement('location');

revoke all on function private.guard_world_selection_retirement()
  from public, anon, authenticated, service_role;

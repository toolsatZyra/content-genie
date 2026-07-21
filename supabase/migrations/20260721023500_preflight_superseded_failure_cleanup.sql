-- A later successful run of the same preparation kind supersedes terminal
-- feedback from older runs. Keep the immutable attempts, but remove obsolete
-- work from the active owner queue.

create or replace function private.supersede_recovered_preflight_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state <> 'succeeded' or old.state = 'succeeded' then
    return new;
  end if;

  update public.work_items item
  set state = 'superseded',
      aggregate_version = item.aggregate_version + 1,
      closed_at = statement_timestamp(),
      updated_at = statement_timestamp()
  from public.preflight_stage_attempts attempt
  join public.preflight_runs failed_run
    on failed_run.id = attempt.preflight_run_id
  where item.workspace_id = new.workspace_id
    and item.episode_id = new.episode_id
    and item.kind = 'preflight.blocked'
    and item.state = 'open'
    and item.dedupe_key = 'preflight-blocked:' || attempt.id::text
    and failed_run.configuration_candidate_id = new.configuration_candidate_id
    and failed_run.kind = new.kind
    and failed_run.run_number < new.run_number;

  return new;
end;
$$;

revoke all on function private.supersede_recovered_preflight_work()
from public, anon, authenticated;

drop trigger if exists supersede_recovered_preflight_work
on public.preflight_runs;
create trigger supersede_recovered_preflight_work
after update of state on public.preflight_runs
for each row
when (new.state = 'succeeded' and old.state is distinct from new.state)
execute function private.supersede_recovered_preflight_work();

update public.work_items item
set state = 'superseded',
    aggregate_version = item.aggregate_version + 1,
    closed_at = statement_timestamp(),
    updated_at = statement_timestamp()
from public.preflight_stage_attempts attempt
join public.preflight_runs failed_run
  on failed_run.id = attempt.preflight_run_id
where item.kind = 'preflight.blocked'
  and item.state = 'open'
  and item.dedupe_key = 'preflight-blocked:' || attempt.id::text
  and exists (
    select 1
    from public.preflight_runs recovered_run
    where recovered_run.workspace_id = failed_run.workspace_id
      and recovered_run.configuration_candidate_id =
        failed_run.configuration_candidate_id
      and recovered_run.kind = failed_run.kind
      and recovered_run.run_number > failed_run.run_number
      and recovered_run.state = 'succeeded'
  );

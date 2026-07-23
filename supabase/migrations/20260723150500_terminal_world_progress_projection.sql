-- A serverless timeout can end outside the application catch path. When the
-- durable lease reconciler exhausts the run's attempts, project that terminal
-- authority into every still-active World progress row so the studio offers a
-- fresh retry instead of displaying an endless "researching" state.

create or replace function private.project_terminal_world_run_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'world_anchor'
    and new.state = 'failed'
    and old.state is distinct from new.state
  then
    update public.world_build_progress_items
    set state = 'failed',
        safe_detail = 'World generation stopped after its worker retries; retry World to continue',
        updated_at = statement_timestamp()
    where preflight_run_id = new.id
      and state not in ('review_ready','failed');
  end if;
  return new;
end;
$$;

drop trigger if exists project_terminal_world_run_progress
  on public.preflight_runs;
create trigger project_terminal_world_run_progress
after update of state on public.preflight_runs
for each row execute function private.project_terminal_world_run_progress();

update public.world_build_progress_items progress
set state = 'failed',
    safe_detail = 'World generation stopped after its worker retries; retry World to continue',
    updated_at = statement_timestamp()
from public.preflight_runs run
where run.id = progress.preflight_run_id
  and run.kind = 'world_anchor'
  and run.state = 'failed'
  and progress.state not in ('review_ready','failed');

revoke all on function private.project_terminal_world_run_progress()
from public, anon, authenticated;

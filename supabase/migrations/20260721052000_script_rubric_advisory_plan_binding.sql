-- Script-rubric output is advisory. An older locked Episode may legitimately
-- predate the rubric worker, so absence of advisory advice must not prevent
-- Monica from constructing and evaluating an executable plan. When advice is
-- present, keep pinning the newest immutable result to the plan run.

create or replace function private.bind_plan_script_rubric_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'plan_evaluation' then return new; end if;
  if new.script_rubric_run_id is null then
    select r.id into new.script_rubric_run_id
    from public.script_rubric_runs r
    where r.workspace_id = new.workspace_id
      and r.episode_id = new.episode_id
      and r.script_revision_id = new.script_revision_id
      and r.advisory_only
    order by r.run_number desc
    limit 1;
  end if;
  return new;
end;
$$;

revoke all on function private.bind_plan_script_rubric_v1()
from public, anon, authenticated;

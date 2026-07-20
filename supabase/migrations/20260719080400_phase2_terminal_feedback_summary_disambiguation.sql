-- The terminal-feedback trigger used `summary` as both a PL/pgSQL variable and
-- a relation-column identifier. With variable_conflict=error, a genuine
-- terminal preflight transition therefore aborted instead of sealing its safe
-- work item. Prefix every local value so the trigger is deterministic.

create or replace function private.surface_terminal_preflight_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run public.preflight_runs%rowtype;
  v_stage public.preflight_stage_runs%rowtype;
  v_safe_summary text;
begin
  if new.state <> 'failed_terminal' or old.state = 'failed_terminal' then
    return new;
  end if;
  select * into v_run
  from public.preflight_runs
  where id = new.preflight_run_id;
  select * into v_stage
  from public.preflight_stage_runs
  where id = new.preflight_stage_run_id;
  if v_run.id is null or v_stage.id is null then
    raise exception 'terminal preflight scope is missing' using errcode = '40001';
  end if;
  v_safe_summary := case new.safe_error_class
    when 'plan-quality-blocked' then
      'Monica tried two materially different cinematic-plan repairs; independent evaluators still blocked production. No production spend was authorized.'
    when 'plan-repair-no-change' then
      'Monica could not produce a materially different cinematic repair. No production spend was authorized.'
    when 'production-quote-ceiling-exceeded' then
      'The complete quality-first production envelope exceeds the $50 launch ceiling. No production spend was authorized.'
    else
      'Monica sealed this Preflight attempt because an exact production prerequisite failed. No production spend was authorized.'
  end;
  insert into public.work_items(
    workspace_id,episode_id,series_id,kind,state,required_role,dedupe_key,
    priority,safe_summary,deep_link
  )
  select v_run.workspace_id,v_run.episode_id,episode.series_id,'preflight.blocked',
    'open','member','preflight-blocked:' || new.id::text,95,v_safe_summary,
    '/episodes/' || v_run.episode_id::text || '/create'
  from public.episodes episode
  where episode.id = v_run.episode_id
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function private.surface_terminal_preflight_failure()
from public,anon,authenticated;

-- Correct the waiver lifecycle before production promotion. A narration run
-- moves the configuration from world_design to preflight; plan evaluation is
-- created after narration succeeds and before World Lock. Capture the honest
-- advisory deferral at that preflight transition, not after locking.

create or replace function private.capture_owner_mvp_script_rubric_deferred_waiver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state not in ('preflight', 'ready_to_lock', 'locked') then
    return new;
  end if;

  if not exists (
    select 1
    from public.script_rubric_runs rubric
    where rubric.workspace_id = new.workspace_id
      and rubric.episode_id = new.episode_id
      and rubric.script_revision_id = new.script_revision_id
      and rubric.advisory_only
  ) then
    insert into private.script_rubric_legacy_waivers (
      workspace_id,
      episode_id,
      configuration_candidate_id,
      script_revision_id,
      waiver_reason
    ) values (
      new.workspace_id,
      new.episode_id,
      new.id,
      new.script_revision_id,
      'owner-mvp-advisory-rubric-deferred.v1'
    )
    on conflict (configuration_candidate_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function private.capture_owner_mvp_script_rubric_deferred_waiver()
from public, anon, authenticated, service_role;

drop trigger if exists capture_owner_mvp_script_rubric_deferred_waiver
on public.episode_configuration_candidates;

create trigger capture_owner_mvp_script_rubric_deferred_waiver
after insert or update of state
on public.episode_configuration_candidates
for each row
when (new.state in ('preflight', 'ready_to_lock', 'locked'))
execute function private.capture_owner_mvp_script_rubric_deferred_waiver();

insert into private.script_rubric_legacy_waivers (
  workspace_id,
  episode_id,
  configuration_candidate_id,
  script_revision_id,
  waiver_reason
)
select
  configuration.workspace_id,
  configuration.episode_id,
  configuration.id,
  configuration.script_revision_id,
  'owner-mvp-advisory-rubric-deferred.v1'
from public.episode_configuration_candidates configuration
where configuration.state in ('preflight', 'ready_to_lock', 'locked')
  and not exists (
    select 1
    from public.script_rubric_runs rubric
    where rubric.workspace_id = configuration.workspace_id
      and rubric.episode_id = configuration.episode_id
      and rubric.script_revision_id = configuration.script_revision_id
      and rubric.advisory_only
  )
on conflict (configuration_candidate_id) do nothing;

comment on function private.capture_owner_mvp_script_rubric_deferred_waiver() is
  'Records an immutable owner-MVP waiver when a preflight-ready configuration has no advisory script-rubric run.';


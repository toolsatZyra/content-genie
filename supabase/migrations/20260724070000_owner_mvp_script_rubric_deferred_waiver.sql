-- The script rubric is advisory for the owner-operated MVP, but the runtime
-- does not yet schedule its evaluator. Preserve that honest absence instead of
-- blocking every otherwise verified cinematic plan. The waiver remains
-- explicit, private and immutable; a subsequently recorded rubric still wins
-- when the plan run is bound.

alter table private.script_rubric_legacy_waivers
  drop constraint if exists script_rubric_legacy_waivers_waiver_reason_check;

alter table private.script_rubric_legacy_waivers
  add constraint script_rubric_legacy_waivers_waiver_reason_check
  check (
    waiver_reason in (
      'captured-existing-world-lock-before-required-rubric.v1',
      'owner-mvp-advisory-rubric-deferred.v1'
    )
  );

create or replace function private.capture_owner_mvp_script_rubric_deferred_waiver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state <> 'locked' then
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
when (new.state = 'locked')
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
where configuration.state = 'locked'
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
  'Records an immutable owner-MVP waiver only when a locked configuration has no advisory script-rubric run.';


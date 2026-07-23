-- Keep the required SCRIPT_PREFLIGHT rubric gate for every new Episode while
-- allowing only configurations that were already World-locked before this
-- correction to resume. The seed is migration-time bounded and has no runtime
-- writer or application grants.

create table private.script_rubric_legacy_waivers (
  workspace_id uuid not null,
  episode_id uuid not null,
  configuration_candidate_id uuid primary key,
  script_revision_id uuid not null,
  waiver_reason text not null check (
    waiver_reason = 'captured-existing-world-lock-before-required-rubric.v1'
  ),
  captured_at timestamptz not null default statement_timestamp(),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, episode_id, script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict
);

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
  'captured-existing-world-lock-before-required-rubric.v1'
from public.episode_configuration_candidates configuration
where configuration.state = 'locked'
on conflict (configuration_candidate_id) do nothing;

create trigger script_rubric_legacy_waivers_immutable
before update or delete on private.script_rubric_legacy_waivers
for each row execute function private.reject_mutation();

revoke all on table private.script_rubric_legacy_waivers
from public, anon, authenticated, service_role;

create or replace function private.bind_plan_script_rubric_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'plan_evaluation' then
    return new;
  end if;

  if new.script_rubric_run_id is null then
    select rubric.id into new.script_rubric_run_id
    from public.script_rubric_runs rubric
    where rubric.workspace_id = new.workspace_id
      and rubric.episode_id = new.episode_id
      and rubric.script_revision_id = new.script_revision_id
      and rubric.advisory_only
    order by rubric.run_number desc
    limit 1;
  end if;

  if new.script_rubric_run_id is null and not exists (
    select 1
    from private.script_rubric_legacy_waivers waiver
    where waiver.workspace_id = new.workspace_id
      and waiver.episode_id = new.episode_id
      and waiver.configuration_candidate_id = new.configuration_candidate_id
      and waiver.script_revision_id = new.script_revision_id
  ) then
    raise exception 'completed advisory script rubric is required before planning'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

revoke all on function private.bind_plan_script_rubric_v1()
from public, anon, authenticated;

comment on table private.script_rubric_legacy_waivers is
  'Immutable migration-time allowlist for configurations World-locked before the required script-rubric gate.';

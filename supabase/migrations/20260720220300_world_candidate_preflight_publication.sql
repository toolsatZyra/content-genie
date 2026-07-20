-- Autonomous World generation runs inside the preflight authority envelope.
-- Candidate media may therefore arrive after the configuration has moved from
-- world_design to preflight, but never after World Lock or a terminal state.

create or replace function private.assert_world_candidate_scope(
  p_workspace_id uuid,
  p_configuration_candidate_id uuid
)
returns public.episode_configuration_candidates
language plpgsql
security definer
set search_path = ''
as $$
declare candidate public.episode_configuration_candidates%rowtype;
begin
  select * into candidate from public.episode_configuration_candidates
  where id = p_configuration_candidate_id and workspace_id = p_workspace_id;
  if not found or candidate.state not in ('world_design', 'preflight')
    or candidate.look_confirmed_at is null or candidate.voice_confirmed_at is null
  then
    raise exception 'world configuration is unavailable' using errcode = '40001';
  end if;
  return candidate;
end;
$$;

revoke all on function private.assert_world_candidate_scope(uuid, uuid)
from public, anon, authenticated;

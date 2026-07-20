-- A queued World recast remains valid when the same configuration has moved
-- from World review into preflight before the durable worker claims it. Keep
-- every original decision, membership, identity and spend check unchanged.

create or replace function public.command_ensure_world_regeneration_authority(
  p_regeneration_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  request private.world_regeneration_requests%rowtype;
  configuration public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  decision private.world_asset_decisions%rowtype;
  member public.memberships%rowtype;
  intent private.world_build_spend_intents%rowtype;
  intent_key text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into request from private.world_regeneration_requests
  where id=p_regeneration_request_id for update;
  if request.id is null or request.state<>'queued' then
    raise exception 'world regeneration is not queued' using errcode='40001';
  end if;
  select * into configuration from public.episode_configuration_candidates
  where id=request.configuration_candidate_id and workspace_id=request.workspace_id;
  select * into episode from public.episodes
  where id=configuration.episode_id and workspace_id=request.workspace_id;
  select * into decision from private.world_asset_decisions
  where command_id=request.command_id and decision='regenerate'
    and actor_user_id=request.requested_by
    and configuration_candidate_id=request.configuration_candidate_id;
  select * into member from public.memberships
  where workspace_id=request.workspace_id and user_id=request.requested_by
    and status='active';
  if configuration.id is null
    or configuration.state not in ('world_design','preflight')
    or configuration.voice_confirmed_at is null
    or configuration.look_confirmed_at is null
    or episode.id is null or decision.command_id is null or member.user_id is null
  then
    raise exception 'world regeneration authority is stale' using errcode='40001';
  end if;
  if request.preflight_run_id is not null then
    return jsonb_build_object(
      'configurationCandidateId',configuration.id,
      'episodeId',episode.id,
      'preflightRunId',request.preflight_run_id,
      'regenerationRequestId',request.id,
      'scriptRevisionId',configuration.script_revision_id,
      'workspaceId',request.workspace_id
    );
  end if;
  intent_key:='world-regeneration:'||request.id::text;
  select * into intent from private.world_build_spend_intents
  where workspace_id=request.workspace_id and authorized_by=request.requested_by
    and idempotency_key=intent_key;
  if intent.id is null then
    update private.world_build_spend_intents set state='expired'
    where configuration_candidate_id=configuration.id and state='active';
    insert into private.world_build_spend_intents(
      workspace_id,episode_id,configuration_candidate_id,script_revision_id,
      look_version_id,authorized_by,actor_authority_epoch,aal,hard_ceiling_minor,
      world_ceiling_minor,narration_ceiling_minor,state,command_id,idempotency_key,
      request_hash,expires_at
    ) values(
      request.workspace_id,episode.id,configuration.id,configuration.script_revision_id,
      configuration.look_version_id,request.requested_by,member.authority_epoch,
      decision.actor_aal,500,384,116,'active',request.command_id,intent_key,
      request.request_hash,statement_timestamp()+interval '24 hours'
    ) returning * into intent;
  end if;
  return jsonb_build_object(
    'configurationCandidateId',configuration.id,
    'episodeId',episode.id,
    'preflightRunId',null,
    'regenerationRequestId',request.id,
    'scriptRevisionId',configuration.script_revision_id,
    'workspaceId',request.workspace_id
  );
end;
$$;

revoke all on function public.command_ensure_world_regeneration_authority(uuid)
from public,anon,authenticated;

grant execute on function public.command_ensure_world_regeneration_authority(uuid)
to service_role;

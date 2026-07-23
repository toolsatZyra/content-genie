-- A terminal World run does not consume the owner's still-current USD 5
-- authority. A retry may advance the configuration aggregate from world_design
-- to preflight, so reuse the active intent by immutable scope rather than
-- attempting to insert a second active row with a new UI idempotency key.

do $migration$
declare
  function_definition text;
  predecessor text;
  replacement text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_authorize_world_build_intent(uuid,uuid,uuid,bigint,bigint,uuid,text,text)'::regprocedure
  ) into function_definition;
  predecessor:=$needle$
  update private.world_build_spend_intents set state='expired'
    where configuration_candidate_id=candidate.id and state='active'
      and expires_at<=statement_timestamp();
$needle$;
  replacement:=$replacement$
  select * into intent
  from private.world_build_spend_intents
  where configuration_candidate_id=candidate.id
    and state='active'
    and expires_at>statement_timestamp()
  for update;
  if found then
    if intent.workspace_id<>p_workspace_id
      or intent.episode_id<>p_episode_id
      or intent.script_revision_id<>candidate.script_revision_id
      or intent.look_version_id<>candidate.look_version_id
      or intent.authorized_by<>actor_id
      or intent.actor_authority_epoch<>actor_epoch
      or intent.hard_ceiling_minor<>500
      or intent.world_ceiling_minor<>384
      or intent.narration_ceiling_minor<>116
    then
      raise exception 'world build active intent conflicts with retry scope'
        using errcode='40001';
    end if;
    return jsonb_build_object(
      'ok',true,'replayed',true,'reusedActiveIntent',true,
      'intentId',intent.id,'hardCeilingMinor',intent.hard_ceiling_minor,
      'worldCeilingMinor',intent.world_ceiling_minor,
      'narrationCeilingMinor',intent.narration_ceiling_minor,
      'expiresAt',intent.expires_at
    );
  end if;
  update private.world_build_spend_intents set state='expired'
    where configuration_candidate_id=candidate.id and state='active'
      and expires_at<=statement_timestamp();
$replacement$;
  if position(predecessor in function_definition)=0
    or position('reusedActiveIntent' in function_definition)>0
  then
    raise exception 'World active-intent retry predecessor is unexpected';
  end if;
  execute replace(function_definition,predecessor,replacement);
end;
$migration$;

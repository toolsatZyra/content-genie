-- World Lock must validate reference counts using the authenticated provider
-- input strategy. A composited start frame intentionally consumes one provider
-- reference even when its composition graph contains several World anchors.

do $migration$
declare
  definition text;
  old_guard text := $guard$
        or slot.reference_count<>(select count(*) from public.preflight_reference_edges edge
          where edge.plan_bundle_id=plan.id and edge.shot_number=slot.shot_number)))
$guard$;
  new_guard text := $guard$
        or (slot.input_strategy='composited_start_frame' and (
          slot.reference_count<>1 or not exists(select 1
            from public.preflight_reference_edges edge
            where edge.plan_bundle_id=plan.id and edge.shot_number=slot.shot_number)))
        or (slot.input_strategy='direct_multi_reference' and
          slot.reference_count<>(select count(*)
            from public.preflight_reference_edges edge
            where edge.plan_bundle_id=plan.id and edge.shot_number=slot.shot_number))))
$guard$;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure
  ) into definition;

  if pg_catalog.strpos(definition, old_guard) = 0 then
    raise exception 'World Lock provider input guard did not match expected definition';
  end if;

  definition := pg_catalog.replace(definition, old_guard, new_guard);
  execute definition;
end;
$migration$;

revoke all on function public.command_lock_first_episode_world(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,
  text,uuid,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.command_lock_first_episode_world(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,
  text,uuid,text,text,uuid
) to authenticated;

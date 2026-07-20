-- A retry has the same immutable run input manifest. Reuse that exact row
-- instead of colliding with the (run, manifest hash) uniqueness boundary.

do $$
declare
  definition text;
  predecessor text := $block$
  insert into private.preflight_input_manifests(
    id,workspace_id,preflight_run_id,schema_version,manifest_json,manifest_hash
  ) values(input_id,run.workspace_id,run.id,'genie.preflight-input.v1',manifest,manifest_hash);
$block$;
  successor text := $block$
  select existing.id into input_id
  from private.preflight_input_manifests existing
  where existing.preflight_run_id=run.id
    and existing.manifest_hash=encode(
      extensions.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex'
    );
  if input_id is null then
    input_id:=gen_random_uuid();
    insert into private.preflight_input_manifests(
      id,workspace_id,preflight_run_id,schema_version,manifest_json,manifest_hash
    ) values(input_id,run.workspace_id,run.id,'genie.preflight-input.v1',manifest,manifest_hash);
  end if;
$block$;
begin
  select pg_get_functiondef(
    'public.command_dispatch_preflight_control(uuid,text,text,integer)'::regprocedure
  ) into definition;
  if strpos(definition,predecessor)=0 then
    raise exception 'preflight dispatcher manifest predecessor is unexpected';
  end if;
  definition:=replace(definition,predecessor,successor);
  execute definition;
end;
$$;

revoke all on function public.command_dispatch_preflight_control(
  uuid,text,text,integer
) from public,anon,authenticated;
grant execute on function public.command_dispatch_preflight_control(
  uuid,text,text,integer
) to service_role;

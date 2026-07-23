-- Authenticated FAL polling starts only after a request is accepted. The
-- service-only manifest reader must therefore preserve the queued dispatch
-- path while also permitting the exact accepted/polling recovery states.

do $migration$
declare
  function_definition text;
  revised text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.get_provider_dispatch_manifest(uuid)'::regprocedure
  ) into function_definition;
  revised:=replace(
    function_definition,
    $$  where id = p_provider_request_id and state = 'queued';$$,
    $$  where id = p_provider_request_id
    and state in ('queued','accepted','polling');$$
  );
  if revised=function_definition
    or revised not like '%state in (''queued'',''accepted'',''polling'')%'
  then
    raise exception 'Provider recovery manifest predecessor is unexpected';
  end if;
  execute revised;
end;
$migration$;

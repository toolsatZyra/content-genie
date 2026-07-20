-- A user explicitly pressing Retry World may renew the same bounded intent
-- after the candidate has entered preflight. The route already admits this
-- recovery state; align the ledger while retaining membership, exact version,
-- confirmed voice/look, USD 5 ceiling, expiry, and idempotency checks.

do $migration$
declare
  function_definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_authorize_world_build_intent(uuid,uuid,uuid,bigint,bigint,uuid,text,text)'::regprocedure
  ) into function_definition;
  rewritten:=replace(
    function_definition,
    'candidate.state<>''world_design''',
    'candidate.state not in (''world_design'',''preflight'')'
  );
  if rewritten=function_definition
    or rewritten not like '%candidate.state not in (''world_design'',''preflight'')%'
  then
    raise exception 'World intent predecessor is unexpected';
  end if;
  execute rewritten;
end;
$migration$;

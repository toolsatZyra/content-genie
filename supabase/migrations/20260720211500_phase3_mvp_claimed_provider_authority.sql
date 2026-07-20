-- The compact inline worker submits provider work while its exact attempt is
-- still `claimed`. All other execution-ledger functions already accept that
-- leased state; include it here while retaining every grant, manifest, quote,
-- epoch, expiry, and fencing check.

do $migration$
declare
  function_definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_consume_mvp_provider_authority(uuid,uuid,uuid)'::regprocedure
  ) into function_definition;
  rewritten:=replace(
    function_definition,
    'attempt.state in (''running'',''waiting_external'')',
    'attempt.state in (''claimed'',''running'',''waiting_external'')'
  );
  if rewritten=function_definition
    or rewritten not like '%attempt.state in (''claimed'',''running'',''waiting_external'')%'
  then
    raise exception 'MVP provider authority predecessor is unexpected';
  end if;
  execute rewritten;
end;
$migration$;

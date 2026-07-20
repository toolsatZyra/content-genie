-- PL/pgSQL treats the local `capability` record and the unqualified
-- provider_capabilities.capability column as ambiguous. Qualify the lookup in
-- both Nano Banana registrations without changing their evidence contract.

do $migration$
declare
  signature regprocedure;
  function_definition text;
  rewritten text;
begin
  foreach signature in array array[
    'public.command_ensure_fal_world_capability(uuid,text,text,text,text,text,timestamptz,timestamptz)'::regprocedure,
    'public.command_ensure_fal_world_edit_capability(uuid,text,text,text,text,text,timestamptz,timestamptz)'::regprocedure
  ] loop
    select pg_catalog.pg_get_functiondef(signature) into function_definition;
    rewritten:=regexp_replace(
      function_definition,
      'select \* into capability from private\.provider_capabilities\s+where provider_account_id=account\.id and capability=',
      'select registered.* into capability from private.provider_capabilities registered where registered.provider_account_id=account.id and registered.capability=',
      'i'
    );
    if rewritten=function_definition
      or rewritten not like '%registered.capability=%'
    then
      raise exception 'provider capability predecessor is unexpected: %',signature;
    end if;
    execute rewritten;
  end loop;
end;
$migration$;

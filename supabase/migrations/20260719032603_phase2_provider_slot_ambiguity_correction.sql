-- Resolve the provider_capabilities.capability column explicitly in the slot
-- claim function while retaining the exact previously migrated function body.
do $migration$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_claim_micro_provider_slot(uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid)'::regprocedure
  ) into function_definition;
  if function_definition not like '%#variable_conflict use_column%' then
    function_definition := pg_catalog.replace(
      function_definition,
      'AS $function$' || chr(10),
      'AS $function$' || chr(10) || '#variable_conflict use_column' || chr(10)
    );
    execute function_definition;
  end if;
end;
$migration$;

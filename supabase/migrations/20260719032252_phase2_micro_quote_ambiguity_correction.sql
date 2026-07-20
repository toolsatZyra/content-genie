-- Forward bridge for environments that applied the provider-authority migration
-- before the capability lookup was explicitly qualified. The directive is
-- embedded in the stored function, so the correction is deterministic for both
-- already-migrated preview databases and clean installs.
do $migration$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_create_micro_quote(uuid,uuid,uuid,uuid,public.preflight_kind,text,text,jsonb,timestamptz)'::regprocedure
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

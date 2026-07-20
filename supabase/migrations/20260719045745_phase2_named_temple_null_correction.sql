-- SQL three-valued logic must not let a named temple with a NULL evidence
-- hash pass the location-candidate command.

do $migration$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_record_location_candidate(uuid,uuid,uuid,text,text,boolean,text,uuid,text,text,text,text,uuid,jsonb,text,text,uuid)'::regprocedure
  ) into function_definition;
  if strpos(function_definition,
    'or p_temple_evidence_set_hash !~ ''^[a-f0-9]{64}$''') = 0
  then raise exception 'named temple correction predecessor is unexpected'; end if;
  function_definition := replace(
    function_definition,
    'or p_temple_evidence_set_hash !~ ''^[a-f0-9]{64}$''',
    'or p_temple_evidence_set_hash is null
      or p_temple_evidence_set_hash !~ ''^[a-f0-9]{64}$'''
  );
  execute function_definition;
end;
$migration$;

-- Forward-only correction: an accepted anchor remains the active fallback
-- while its owner asks for a replacement candidate. Accept still requires the
-- current review candidate; regenerate may reopen an accepted selection.

do $migration$
declare
  function_definition text;
  occurrence_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_decide_world_candidate(uuid,uuid,text,uuid,uuid,bigint,text,text,text,uuid,text,text,uuid)'::regprocedure
  ) into function_definition;
  select count(*) into occurrence_count
  from regexp_matches(
    function_definition,
    'and selection\.state = ''review_required''',
    'g'
  );
  if occurrence_count <> 2 then
    raise exception 'world reselection correction predecessor is unexpected';
  end if;
  function_definition := replace(
    function_definition,
    'and selection.state = ''review_required''',
    'and ((p_decision = ''accept'' and selection.state = ''review_required'')
        or (p_decision = ''regenerate'' and selection.state in (''review_required'',''accepted'')))'
  );
  execute function_definition;
end;
$migration$;

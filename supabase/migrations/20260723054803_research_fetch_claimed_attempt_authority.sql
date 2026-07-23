-- World research happens inside the root control attempt while it is still in
-- `claimed`. Provider-output retrieval keeps its stricter running/waiting
-- boundary; only rights-cleared research fetches may use the exact claimed,
-- highest-fencing attempt.

do $migration$
declare
  function_definition text;
  revised text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_record_remote_fetch(uuid,uuid,uuid,text,text,text,uuid,text,text,jsonb,integer,bigint,integer,text,text,text)'::regprocedure
  ) into function_definition;
  revised:=replace(
    function_definition,
    $$      and a.state in ('running','waiting_external')$$,
    $$      and (
        (p_fetch_class='research_reference'
          and a.state in ('claimed','running','waiting_external'))
        or
        (p_fetch_class='provider_output'
          and a.state in ('running','waiting_external'))
      )$$
  );
  if revised=function_definition
    or revised not like '%p_fetch_class=''research_reference''%'
  then
    raise exception 'Research-fetch claimed-attempt predecessor is unexpected';
  end if;
  execute revised;
end;
$migration$;

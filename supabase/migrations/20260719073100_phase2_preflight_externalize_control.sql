-- Add the signed stage-bound acknowledgement used only after Trigger has
-- submitted every exact provider request returned by the control broker.

alter table private.preflight_control_assertion_jtis
  drop constraint preflight_control_assertion_jtis_operation_check,
  drop constraint preflight_control_assertion_jtis_check1,
  add constraint preflight_control_assertion_jtis_operation_check
    check (operation in ('dispatch','execute','externalize','finalize','fail')),
  add constraint preflight_control_assertion_jtis_stage_binding_check
    check ((operation in ('execute','externalize','fail'))=(stage_attempt_id is not null));

do $migration$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_consume_preflight_control_assertion(uuid,text,timestamptz,timestamptz,text,text,text,text,uuid,uuid,text)'::regprocedure
  ) into function_definition;
  if function_definition not like '%p_operation not in (''dispatch'',''execute'',''finalize'',''fail'')%'
    or function_definition not like '%p_operation in (''execute'',''fail'')%'
  then raise exception 'preflight control assertion predecessor is unexpected'; end if;
  function_definition:=replace(function_definition,
    'p_operation not in (''dispatch'',''execute'',''finalize'',''fail'')',
    'p_operation not in (''dispatch'',''execute'',''externalize'',''finalize'',''fail'')');
  function_definition:=replace(function_definition,
    'p_operation in (''execute'',''fail'')',
    'p_operation in (''execute'',''externalize'',''fail'')');
  execute function_definition;
end;
$migration$;

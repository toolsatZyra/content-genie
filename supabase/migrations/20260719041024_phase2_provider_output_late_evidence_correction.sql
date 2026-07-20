-- Terminal outputs are still retained as late evidence. Keep the exact
-- workspace/request/manifest-target binding, but do not require a nonterminal
-- request merely to preserve that evidence.
do $migration$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'private.guard_quarantine_asset_scope()'::regprocedure
  ) into function_definition;
  if pg_catalog.strpos(
    function_definition,
    'and pr.state in (''accepted'',''polling'')'
  ) = 0 then
    raise exception 'provider output target guard predecessor is unexpected';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    'and pr.state in (''accepted'',''polling'')',
    ''
  );
  execute function_definition;
end;
$migration$;

revoke all on function private.guard_quarantine_asset_scope()
from public, anon, authenticated;

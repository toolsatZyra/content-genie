-- The preparation replay branch has a PL/pgSQL total_minor variable and reads
-- the identically named quote column. Qualify the quote column so a safely
-- retried exact attempt can receive its immutable preparation.

do $migration$
declare
  function_definition text;
  rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_prepare_world_anchor_jobs(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  ) into function_definition;
  rewritten := replace(
    function_definition,
    'select total_minor from private.micro_quotes where id=preparation.micro_quote_id',
    'select quote.total_minor from private.micro_quotes quote where quote.id=preparation.micro_quote_id'
  );
  if rewritten = function_definition
    or rewritten not like '%select quote.total_minor from private.micro_quotes quote%'
  then
    raise exception 'World preparation predecessor is unexpected';
  end if;
  execute rewritten;
end;
$migration$;

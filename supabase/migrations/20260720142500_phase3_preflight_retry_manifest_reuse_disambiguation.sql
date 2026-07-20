-- Correct the already-applied retry manifest selector without weakening its
-- exact hash binding. Fresh databases already receive the disambiguated form.

do $$
declare
  definition text;
  predecessor text := $block$    and existing.manifest_hash=manifest_hash;$block$;
  successor text := $block$    and existing.manifest_hash=encode(
      extensions.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex'
    );$block$;
begin
  select pg_get_functiondef(
    'public.command_dispatch_preflight_control(uuid,text,text,integer)'::regprocedure
  ) into definition;
  if strpos(definition,predecessor)>0 then
    definition:=replace(definition,predecessor,successor);
    execute definition;
  elsif strpos(definition,successor)=0 then
    raise exception 'preflight retry manifest selector is unexpected';
  end if;
end;
$$;

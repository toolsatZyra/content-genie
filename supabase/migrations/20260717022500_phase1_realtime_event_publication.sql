-- Publish the immutable event stream used for reconnect reconciliation.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'domain_events'
  ) then
    alter publication supabase_realtime add table public.domain_events;
  end if;
end;
$$;

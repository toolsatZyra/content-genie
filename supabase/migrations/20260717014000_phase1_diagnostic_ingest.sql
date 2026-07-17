-- Phase 1 corrective expansion: server-only client diagnostic persistence.

create or replace function public.record_client_diagnostic(
  p_event_type text,
  p_occurred_at timestamptz,
  p_environment text,
  p_correlation_id text,
  p_safe_summary text,
  p_dedupe_hash text,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  diagnostic_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_event_type <> 'app.client_error'
    or p_environment not in ('development', 'preview', 'production', 'test')
    or char_length(p_correlation_id) not between 8 and 160
    or char_length(coalesce(p_safe_summary, '')) > 1000
    or p_dedupe_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'diagnostic envelope rejected' using errcode = '22023';
  end if;

  insert into private.diagnostic_events (
    event_type, occurred_at, environment, correlation_id, safe_summary,
    retention_class, source, dedupe_hash, actor_user_id
  )
  values (
    p_event_type, p_occurred_at, p_environment, p_correlation_id,
    p_safe_summary, 'short', 'client', p_dedupe_hash, p_actor_user_id
  )
  on conflict (dedupe_hash) where dedupe_hash is not null
  do nothing
  returning id into diagnostic_id;

  if diagnostic_id is null then
    select d.id into diagnostic_id
    from private.diagnostic_events d
    where d.dedupe_hash = p_dedupe_hash;
  end if;

  return diagnostic_id;
end;
$$;

revoke all on function public.record_client_diagnostic(
  text,timestamptz,text,text,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.record_client_diagnostic(
  text,timestamptz,text,text,text,text,uuid
) to service_role;

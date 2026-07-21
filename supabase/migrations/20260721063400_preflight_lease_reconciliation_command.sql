-- Expose expired preflight-lease reconciliation to the credentialed cron
-- worker. The underlying reconciler remains private and fail-closed; this
-- wrapper is executable only by service_role.

create or replace function public.command_reconcile_expired_preflight_leases(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  return private.reconcile_expired_preflight_leases(p_limit);
end;
$$;

revoke all on function public.command_reconcile_expired_preflight_leases(integer)
from public, anon, authenticated;
grant execute on function public.command_reconcile_expired_preflight_leases(integer)
to service_role;


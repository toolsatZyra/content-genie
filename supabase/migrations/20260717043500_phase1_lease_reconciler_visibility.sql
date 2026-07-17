-- Phase 1 corrective migration: make expired-lease reconciliation reopen the
-- affected work item within the same data-modifying CTE snapshot.

create or replace function private.reconcile_expired_work_leases(
  p_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_limit not between 1 and 1000 then
    raise exception 'limit out of range';
  end if;

  with expired as materialized (
    select l.id, l.work_item_id
    from public.work_leases l
    where l.lease_state = 'active'
      and l.expires_at <= statement_timestamp()
    order by l.expires_at
    for update skip locked
    limit p_limit
  ),
  changed as (
    update public.work_leases l
    set lease_state = 'expired',
        released_at = statement_timestamp(),
        release_reason = 'lease reconciler'
    from expired e
    where l.id = e.id
    returning l.id, l.work_item_id
  )
  update public.work_items w
  set state = 'open',
      aggregate_version = aggregate_version + 1
  where w.id in (select work_item_id from changed)
    and w.state = 'claimed'
    and not exists (
      select 1
      from public.work_leases live
      where live.work_item_id = w.id
        and live.lease_state = 'active'
        -- A data-modifying CTE reads one statement snapshot. The rows updated
        -- by `changed` therefore still appear active here and must be excluded
        -- explicitly; any different active lease still prevents reopening.
        and live.id not in (select id from changed)
    );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function private.reconcile_expired_work_leases(integer)
  from public, anon, authenticated;

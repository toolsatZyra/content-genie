-- PostgREST exposes the public API schema, not the private schema. Give the
-- production service role a narrowly granted, updatable view while keeping the
-- underlying provider receipts private from browser roles.

create or replace view public.mvp_production_clip_worker
with (security_invoker = true)
as
select * from private.mvp_production_clips;

revoke all on public.mvp_production_clip_worker from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_production_clip_worker to service_role;
grant select, insert, update, delete on private.mvp_production_clips to service_role;


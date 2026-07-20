-- SECURITY DEFINER functions inherit EXECUTE for PUBLIC unless it is revoked.
-- Keep these owner commands callable only by signed-in users; their bodies
-- continue to enforce AAL2 and active workspace membership.

revoke all on function public.command_start_mvp_production(uuid,uuid)
  from public, anon;
revoke all on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) from public, anon;
revoke all on function public.command_retry_mvp_production(uuid,uuid,bigint)
  from public, anon;

grant execute on function public.command_start_mvp_production(uuid,uuid)
  to authenticated;
grant execute on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) to authenticated;
grant execute on function public.command_retry_mvp_production(uuid,uuid,bigint)
  to authenticated;

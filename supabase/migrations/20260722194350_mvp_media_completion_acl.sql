revoke all on function public.command_complete_mvp_media_dispatch_output(
  uuid,
  text,
  text,
  numeric,
  text
) from public, anon, authenticated;
grant execute on function public.command_complete_mvp_media_dispatch_output(
  uuid,
  text,
  text,
  numeric,
  text
) to service_role;

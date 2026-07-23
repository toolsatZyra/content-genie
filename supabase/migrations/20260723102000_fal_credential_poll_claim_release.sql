-- HTTP 401/403 reports the poller's credential state, not the remote job
-- outcome. Release that exact claim without changing provider or World
-- authority so repaired credentials can resume the same durable request.

create or replace function public.command_release_fal_authenticated_poll_credential_claim(
  p_provider_request_id uuid,
  p_expected_poll_attempt_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request private.provider_requests%rowtype;
  released_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_expected_poll_attempt_count not between 1 and 100 then
    raise exception 'fal credential poll claim is invalid' using errcode = '22023';
  end if;

  select * into request
  from private.provider_requests
  where id = p_provider_request_id
  for update;
  if request.id is null then
    raise exception 'fal credential poll request is unavailable'
      using errcode = 'P0002';
  end if;

  update private.provider_requests
  set fal_authenticated_poll_count = fal_authenticated_poll_count - 1,
      updated_at = statement_timestamp()
  where id = request.id
    and state in ('accepted','polling')
    and fal_authenticated_poll_count = p_expected_poll_attempt_count
    and fal_authenticated_poll_count > 0
    and not exists (
      select 1
      from private.provider_output_candidates output
      where output.provider_request_id = request.id
    );
  get diagnostics released_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'providerRequestId', request.id,
    'released', released_count = 1
  );
end;
$$;

revoke all on function public.command_release_fal_authenticated_poll_credential_claim(
  uuid, integer
) from public, anon, authenticated;
grant execute on function public.command_release_fal_authenticated_poll_credential_claim(
  uuid, integer
) to service_role;

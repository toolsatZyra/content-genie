-- Signed webhooks remain the preferred completion path. This bounded fallback
-- lets the existing secure-ingest cron recover a FAL image completion when a
-- delivery is missed or its signature cannot be verified. The subsequent
-- authenticated result fetch is still non-authoritative until it passes the
-- existing provider inbox, quarantine, scan, and promotion pipeline.

create or replace function public.get_next_fal_authenticated_poll_candidate(
  p_environment text,
  p_minimum_age_seconds integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_environment not in ('development','preview','production','test')
    or p_minimum_age_seconds not between 15 and 3600
  then
    raise exception 'fal poll recovery scope is invalid' using errcode = '22023';
  end if;

  select request.id as provider_request_id,
    request.external_job_id
  into candidate
  from private.provider_requests request
  join private.provider_accounts account
    on account.id = request.provider_account_id
  where account.provider = 'fal'
    and account.environment = p_environment
    and account.state = 'active'
    and request.operation in ('gen_image','edit_image')
    and request.state in ('accepted','polling')
    and request.external_job_id is not null
    and request.updated_at <= statement_timestamp()
      - make_interval(secs => p_minimum_age_seconds)
    and not exists (
      select 1 from private.provider_output_candidates output
      where output.provider_request_id = request.id
    )
  order by request.updated_at, request.id
  limit 1;

  if candidate.provider_request_id is null then
    return jsonb_build_object('empty', true, 'ok', true);
  end if;
  return jsonb_build_object(
    'empty', false,
    'externalJobId', candidate.external_job_id,
    'ok', true,
    'providerRequestId', candidate.provider_request_id
  );
end;
$$;

revoke all on function public.get_next_fal_authenticated_poll_candidate(text, integer)
from public, anon, authenticated;
grant execute on function public.get_next_fal_authenticated_poll_candidate(text, integer)
to service_role;

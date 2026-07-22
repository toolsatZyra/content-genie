-- Reconcile a provider receipt that is already known to the dispatch worker
-- when the first ledger acknowledgement is lost. The exact claim fence and
-- immutable dispatch intent remain required, while an exact committed receipt
-- is replayed idempotently.

create or replace function public.command_reconcile_mvp_media_dispatch_submission(
  p_dispatch_id uuid,
  p_expected_version bigint,
  p_claim_token uuid,
  p_fencing_token bigint,
  p_production_run_id uuid,
  p_attempt_number integer,
  p_dispatch_key text,
  p_endpoint text,
  p_input_manifest_sha256 text,
  p_external_request_id text,
  p_status_url text,
  p_response_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare dispatch_row private.mvp_media_dispatches%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_expected_version is null
    or p_expected_version < 1 or p_claim_token is null
    or p_fencing_token is null or p_fencing_token < 1
    or p_production_run_id is null or p_attempt_number is null
    or p_attempt_number not between 1 and 20
    or p_dispatch_key is null
    or p_dispatch_key !~ '^(storyboard|clip):[0-9]{1,3}:(single|start|end|motion)$'
    or p_endpoint is null
    or p_endpoint !~ '^fal-ai/[A-Za-z0-9._/-]{3,180}$'
    or strpos(p_endpoint, '..') > 0 or strpos(p_endpoint, '//') > 0
    or right(p_endpoint, 1) = '/'
    or p_input_manifest_sha256 is null
    or p_input_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_external_request_id is null
    or p_external_request_id !~ '^[A-Za-z0-9_-]{6,200}$'
    or p_status_url is null or p_response_url is null
    or char_length(p_status_url) not between 12 and 2048
    or char_length(p_response_url) not between 12 and 2048
    or p_status_url !~ '^https://queue[.]fal[.]run/'
    or p_response_url !~ '^https://queue[.]fal[.]run/'
    or strpos(p_status_url, '/requests/' || p_external_request_id) = 0
    or strpos(p_response_url, '/requests/' || p_external_request_id) = 0
    or strpos(p_status_url, '#') > 0 or strpos(p_response_url, '#') > 0
  then
    raise exception 'media dispatch reconciliation receipt is invalid'
      using errcode = '22023';
  end if;

  select * into dispatch_row
  from private.mvp_media_dispatches
  where id = p_dispatch_id
  for update;
  if not found then
    raise exception 'media dispatch reconciliation target is missing'
      using errcode = '40001';
  end if;
  if dispatch_row.production_run_id <> p_production_run_id
    or dispatch_row.attempt_number <> p_attempt_number
    or dispatch_row.dispatch_key <> p_dispatch_key
    or dispatch_row.endpoint <> p_endpoint
    or dispatch_row.input_manifest_sha256 <> p_input_manifest_sha256
  then
    raise exception 'media dispatch reconciliation conflicts with immutable intent'
      using errcode = '40001';
  end if;
  if dispatch_row.state in ('submitted','succeeded') then
    if dispatch_row.external_request_id = p_external_request_id
      and dispatch_row.status_url = p_status_url
      and dispatch_row.response_url = p_response_url
    then
      return to_jsonb(dispatch_row);
    end if;
    raise exception 'media dispatch reconciliation conflicts with committed receipt'
      using errcode = '40001';
  end if;

  update private.mvp_media_dispatches
  set state = 'submitted', version = version + 1,
      claim_token = null, lease_expires_at = null,
      external_request_id = p_external_request_id,
      status_url = p_status_url, response_url = p_response_url,
      dispatched_at = statement_timestamp()
  where id = p_dispatch_id and state = 'dispatching'
    and version = p_expected_version and claim_token = p_claim_token
    and fencing_token = p_fencing_token
  returning * into dispatch_row;
  if not found then
    raise exception 'media dispatch reconciliation fence is stale'
      using errcode = '40001';
  end if;
  return to_jsonb(dispatch_row);
end;
$$;

revoke all on function public.command_reconcile_mvp_media_dispatch_submission(
  uuid,bigint,uuid,bigint,uuid,integer,text,text,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.command_reconcile_mvp_media_dispatch_submission(
  uuid,bigint,uuid,bigint,uuid,integer,text,text,text,text,text,text
) to service_role;

-- A verified fal.ai callback can close the remaining worker-crash window. The
-- callback URL is bound to this dispatch id before submission, and the signed
-- provider request id is sufficient to recover an expired outcome_unknown row
-- without issuing the media request again.
create or replace function public.command_reconcile_mvp_media_dispatch_webhook(
  p_dispatch_id uuid,
  p_external_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_row private.mvp_media_dispatches%rowtype;
  queue_base_url text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_external_request_id is null
    or p_external_request_id !~ '^[A-Za-z0-9_-]{6,200}$'
  then
    raise exception 'media dispatch callback receipt is invalid'
      using errcode = '22023';
  end if;

  select * into dispatch_row
  from private.mvp_media_dispatches
  where id = p_dispatch_id
  for update;
  if not found then
    raise exception 'media dispatch callback target is missing'
      using errcode = '40001';
  end if;
  if dispatch_row.state in ('submitted','succeeded') then
    if dispatch_row.external_request_id = p_external_request_id then
      return to_jsonb(dispatch_row);
    end if;
    raise exception 'media dispatch callback conflicts with committed receipt'
      using errcode = '40001';
  end if;
  if dispatch_row.state not in ('dispatching','outcome_unknown') then
    raise exception 'media dispatch callback state is not recoverable'
      using errcode = '40001';
  end if;

  queue_base_url := 'https://queue.fal.run/' || dispatch_row.endpoint
    || '/requests/' || p_external_request_id;
  update private.mvp_media_dispatches
  set state = 'submitted', version = version + 1,
      claim_token = null, lease_expires_at = null,
      external_request_id = p_external_request_id,
      status_url = queue_base_url || '/status',
      response_url = queue_base_url || '/response',
      dispatched_at = statement_timestamp(), completed_at = null,
      last_error_code = null, last_error_summary = null
  where id = dispatch_row.id
    and state in ('dispatching','outcome_unknown')
  returning * into dispatch_row;
  if not found then
    raise exception 'media dispatch callback reconciliation is stale'
      using errcode = '40001';
  end if;
  return to_jsonb(dispatch_row);
end;
$$;

revoke all on function public.command_reconcile_mvp_media_dispatch_webhook(
  uuid,text
) from public, anon, authenticated;
grant execute on function public.command_reconcile_mvp_media_dispatch_webhook(
  uuid,text
) to service_role;

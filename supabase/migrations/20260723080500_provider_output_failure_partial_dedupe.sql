-- The diagnostic dedupe index is partial. PostgreSQL requires the matching
-- predicate on the conflict target, otherwise a scanner failure cannot release
-- a quarantined provider output for retry.

create or replace function public.command_fail_provider_output_candidate(
  p_candidate_id uuid,
  p_lease_token uuid,
  p_retryable boolean,
  p_safe_error_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate private.provider_output_candidates%rowtype;
  retry boolean;
  event_environment text;
  quarantine_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'provider output failure class is invalid' using errcode = '22023';
  end if;
  select * into candidate from private.provider_output_candidates
  where id = p_candidate_id for update;
  if candidate.id is null or not (
    (candidate.state = 'claimed' and candidate.lease_token = p_lease_token
      and candidate.lease_expires_at > statement_timestamp())
    or
    (candidate.state = 'quarantined' and candidate.lease_token is null
      and candidate.quarantine_asset_version_id is not null)
  ) then
    raise exception 'provider output failure lease is stale' using errcode = '40001';
  end if;
  quarantine_id := candidate.quarantine_asset_version_id;
  retry := p_retryable and candidate.attempt_count < 5;
  if quarantine_id is not null then
    update private.quarantine_assets
    set state = 'rejected', completed_at = statement_timestamp()
    where id = quarantine_id and state in ('quarantined', 'scanning');
  end if;
  update private.provider_output_candidates
  set state = case when retry then 'pending'::private.provider_output_candidate_state
      else 'rejected'::private.provider_output_candidate_state end,
    available_at = case when retry then statement_timestamp() +
      make_interval(secs => least(60, (2 ^ attempt_count)::integer)) else available_at end,
    lease_token = null,
    lease_expires_at = null,
    quarantine_asset_version_id = null,
    completed_at = case when retry then null else statement_timestamp() end
  where id = candidate.id returning * into candidate;
  select account.environment into event_environment
  from private.provider_requests request
  join private.provider_accounts account on account.id = request.provider_account_id
  where request.id = candidate.provider_request_id;
  insert into private.diagnostic_events(
    event_type, occurred_at, environment, workspace_id, aggregate_type,
    aggregate_id, correlation_id, stage, provider, status, error_class,
    retry_count, safe_summary, retention_class, source, dedupe_hash
  ) values (
    'provider_output.ingest_failed', statement_timestamp(), event_environment,
    candidate.workspace_id, 'provider_output_candidate', candidate.id,
    candidate.id::text, 'secure_ingest', 'fal',
    case when retry then 'retrying' else 'rejected' end,
    p_safe_error_class, candidate.attempt_count,
    'Provider output secure ingest failed safely.', 'operational', 'reconciler',
    encode(extensions.digest(convert_to(candidate.id::text || ':' ||
      candidate.attempt_count::text || ':' || p_safe_error_class, 'UTF8'), 'sha256'), 'hex')
  ) on conflict (dedupe_hash) where dedupe_hash is not null do nothing;
  return jsonb_build_object(
    'ok', true,
    'candidateId', candidate.id,
    'state', candidate.state,
    'retryable', retry
  );
end;
$$;

revoke all on function public.command_fail_provider_output_candidate(uuid, uuid, boolean, text)
from public, anon, authenticated;
grant execute on function public.command_fail_provider_output_candidate(uuid, uuid, boolean, text)
to service_role;

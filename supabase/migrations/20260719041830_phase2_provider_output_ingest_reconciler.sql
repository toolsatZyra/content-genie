-- Service-only, paginated secure-ingest reconciliation. Vercel owns the broad
-- database/storage credential; Trigger and provider callbacks carry IDs only.

create or replace function public.get_active_remote_fetch_policy(
  p_environment text,
  p_fetch_class text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare version private.remote_fetch_allowlist_versions%rowtype;
  hosts jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_fetch_class not in ('provider_output','research_reference')
  then raise exception 'remote fetch policy scope is invalid' using errcode = '22023'; end if;
  select * into version from private.remote_fetch_allowlist_versions
  where environment = p_environment and fetch_class = p_fetch_class
    and state = 'active';
  if not found then raise exception 'remote fetch policy is unavailable' using errcode = 'P0002'; end if;
  select jsonb_agg(e.exact_hostname order by e.exact_hostname) into hosts
  from private.remote_fetch_allowlist_entries e
  where e.allowlist_version_id = version.id;
  if jsonb_array_length(coalesce(hosts, '[]'::jsonb)) not between 1 and 64
  then raise exception 'remote fetch policy host set is invalid' using errcode = '55000'; end if;
  return jsonb_build_object(
    'allowlistVersionId', version.id, 'environment', version.environment,
    'fetchClass', version.fetch_class, 'manifestHash', version.manifest_hash,
    'allowedHosts', hosts
  );
end;
$$;

create or replace function public.command_claim_next_provider_output_candidate(
  p_environment text,
  p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_lease_seconds not between 30 and 300
  then raise exception 'provider output claim scope is invalid' using errcode = '22023'; end if;
  select candidate.id into candidate_id
  from private.provider_output_candidates candidate
  join private.provider_requests request on request.id = candidate.provider_request_id
  join private.provider_accounts account on account.id = request.provider_account_id
  join private.provider_request_quote_claims claim
    on claim.provider_request_id = request.id
  join public.preflight_stage_attempts attempt on attempt.id = request.stage_attempt_id
  join public.preflight_stage_runs stage on stage.id = attempt.preflight_stage_run_id
  join public.preflight_runs run on run.id = attempt.preflight_run_id
  where account.environment = p_environment and account.state = 'active'
    and request.state = 'polling'
    and candidate.available_at <= statement_timestamp()
    and (
      candidate.state = 'pending'
      or (candidate.state = 'claimed'
        and candidate.lease_expires_at <= statement_timestamp())
    )
    and candidate.attempt_count < 5
    and attempt.state in ('running','waiting_external')
    and attempt.authority_epoch = claim.authority_epoch
    and attempt.fencing_token = claim.fencing_token
    and stage.highest_fencing_token = attempt.fencing_token
    and run.authority_epoch = attempt.authority_epoch
    and run.state in ('running','waiting_external')
  order by candidate.available_at, candidate.created_at, candidate.id
  for update of candidate skip locked
  limit 1;
  if candidate_id is null then
    return jsonb_build_object('ok', true, 'empty', true);
  end if;
  return public.command_claim_provider_output_candidate(
    candidate_id, p_lease_token, p_lease_seconds
  ) || jsonb_build_object('empty', false);
end;
$$;

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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_safe_error_class !~ '^[a-z][a-z0-9_.-]{2,100}$'
  then raise exception 'provider output failure class is invalid' using errcode = '22023'; end if;
  select * into candidate from private.provider_output_candidates
  where id = p_candidate_id for update;
  if not found or candidate.state <> 'claimed'
    or candidate.lease_token <> p_lease_token
    or candidate.lease_expires_at <= statement_timestamp()
  then raise exception 'provider output failure lease is stale' using errcode = '40001'; end if;
  retry := p_retryable and candidate.attempt_count < 5;
  update private.provider_output_candidates
  set state = case when retry then 'pending'::private.provider_output_candidate_state
        else 'rejected'::private.provider_output_candidate_state end,
      available_at = case when retry then statement_timestamp() +
        make_interval(secs => least(60, (2 ^ attempt_count)::integer))
        else available_at end,
      lease_token = null, lease_expires_at = null,
      completed_at = case when retry then null else statement_timestamp() end
  where id = candidate.id returning * into candidate;
  select account.environment into event_environment
  from private.provider_requests request
  join private.provider_accounts account on account.id = request.provider_account_id
  where request.id = candidate.provider_request_id;
  insert into private.diagnostic_events (
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
    encode(extensions.digest(convert_to(
      candidate.id::text || ':' || candidate.attempt_count::text || ':' ||
      p_safe_error_class, 'UTF8'
    ), 'sha256'), 'hex')
  );
  return jsonb_build_object(
    'ok', true, 'candidateId', candidate.id, 'state', candidate.state,
    'retryable', retry
  );
end;
$$;

revoke all on function public.get_active_remote_fetch_policy(text,text),
  public.command_claim_next_provider_output_candidate(text,uuid,integer),
  public.command_fail_provider_output_candidate(uuid,uuid,boolean,text)
from public, anon, authenticated;
grant execute on function public.get_active_remote_fetch_policy(text,text),
  public.command_claim_next_provider_output_candidate(text,uuid,integer),
  public.command_fail_provider_output_candidate(uuid,uuid,boolean,text)
to service_role;

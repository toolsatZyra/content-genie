-- Make repeated claims for one quoted provider slot converge on the one
-- authoritative request. The existing immediate unique constraint remains the
-- final database guard; this function now gives every valid caller the same ID.

do $migration$
declare
  quote_line_attnum smallint;
begin
  select attribute.attnum
  into quote_line_attnum
  from pg_catalog.pg_attribute attribute
  where attribute.attrelid = 'private.provider_request_quote_claims'::regclass
    and attribute.attname = 'micro_quote_line_id'
    and not attribute.attisdropped;

  if quote_line_attnum is null or not exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conrelid =
        'private.provider_request_quote_claims'::regclass
      and constraint_row.contype = 'u'
      and constraint_row.convalidated
      and not constraint_row.condeferrable
      and constraint_row.conkey::smallint[] = array[quote_line_attnum]::smallint[]
  ) then
    raise exception 'provider quote-line uniqueness contract is unavailable'
      using errcode = '55000';
  end if;
end;
$migration$;

create or replace function public.command_claim_micro_provider_slot(
  p_workspace_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_micro_quote_line_id uuid,
  p_input_manifest_id uuid,
  p_input_manifest_hash text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_retry_of_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  line private.micro_quote_lines%rowtype;
  capability private.provider_capabilities%rowtype;
  existing_request private.provider_requests%rowtype;
  existing_claim private.provider_request_quote_claims%rowtype;
  request_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_input_manifest_hash !~ '^[a-f0-9]{64}$'
    or char_length(p_idempotency_key) not between 8 and 200
  then
    raise exception 'provider slot envelope is invalid' using errcode = '22023';
  end if;

  select * into run
  from public.preflight_runs
  where id = p_preflight_run_id and workspace_id = p_workspace_id
  for update;
  select * into attempt
  from public.preflight_stage_attempts
  where id = p_stage_attempt_id and preflight_run_id = p_preflight_run_id
  for update;
  select * into line
  from private.micro_quote_lines
  where id = p_micro_quote_line_id and micro_quote_id = run.micro_quote_id
  for update;

  if run.state not in ('running','waiting_external')
    or not run.requires_micro_authority
    or line.id is null
    or attempt.state not in ('running','waiting_external')
    or attempt.authority_epoch <> run.authority_epoch
    or attempt.fencing_token <> (
      select highest_fencing_token
      from public.preflight_stage_runs
      where id = attempt.preflight_stage_run_id
    )
    or attempt.input_manifest_id <> p_input_manifest_id
    or attempt.input_manifest_hash <> p_input_manifest_hash
    or not exists (
      select 1
      from private.micro_authorizations a
      join private.micro_reservations r on r.micro_authorization_id = a.id
      where a.id = run.micro_authorization_id
        and r.id = run.micro_reservation_id
        and a.state = 'active'
        and r.state in ('held','partially_settled')
        and a.expires_at > statement_timestamp()
        and r.expires_at > statement_timestamp()
    )
  then
    raise exception 'provider slot authority is stale' using errcode = '40001';
  end if;

  select * into capability
  from private.provider_capabilities
  where id = line.capability_id
    and provider_capabilities.capability = line.operation
    and status = 'verified'
    and expires_at > statement_timestamp();
  if not found then
    raise exception 'provider capability is stale' using errcode = '40001';
  end if;

  if not exists (
    select 1
    from private.provider_input_manifests manifest
    where manifest.id = p_input_manifest_id
      and manifest.workspace_id = p_workspace_id
      and manifest.operation = line.operation
      and manifest.content_hash = p_input_manifest_hash
  ) then
    raise exception 'provider input manifest is stale' using errcode = '40001';
  end if;
  if p_retry_of_id is not null and not exists (
    select 1
    from private.provider_requests prior
    where prior.id = p_retry_of_id
      and prior.workspace_id = p_workspace_id
      and prior.preflight_run_id = p_preflight_run_id
      and prior.state = 'failed_retryable'
  ) then
    raise exception 'retry predecessor is invalid' using errcode = '40001';
  end if;

  select request.* into existing_request
  from private.provider_request_quote_claims claim
  join private.provider_requests request on request.id = claim.provider_request_id
  where claim.micro_quote_line_id = line.id;
  if found then
    select * into existing_claim
    from private.provider_request_quote_claims
    where micro_quote_line_id = line.id;

    if existing_request.workspace_id <> p_workspace_id
      or existing_request.preflight_run_id <> p_preflight_run_id
      or existing_request.stage_attempt_id <> p_stage_attempt_id
      or existing_request.provider_account_id <> capability.provider_account_id
      or existing_request.provider_capability_id <> capability.id
      or existing_request.operation <> line.operation
      or existing_request.request_schema_version <> capability.schema_version
      or existing_request.input_manifest_id <> p_input_manifest_id
      or existing_request.input_manifest_hash <> p_input_manifest_hash
      or existing_request.retry_of_id is distinct from p_retry_of_id
      or existing_request.expected_cost_minor <> line.amount_minor
      or existing_request.maximum_cost_minor <> line.amount_minor
      or existing_claim.preflight_run_id <> p_preflight_run_id
      or existing_claim.micro_authorization_id <> run.micro_authorization_id
      or existing_claim.micro_reservation_id <> run.micro_reservation_id
      or existing_claim.authority_epoch <> run.authority_epoch
      or existing_claim.fencing_token <> attempt.fencing_token
    then
      raise exception 'provider slot already has a different authority envelope'
        using errcode = '40001';
    end if;
    return existing_request.id;
  end if;

  insert into private.provider_requests (
    workspace_id, preflight_run_id, stage_attempt_id, provider_account_id,
    provider_capability_id, operation, request_schema_version,
    input_manifest_id, input_manifest_hash, idempotency_key, correlation_id,
    retry_of_id, expected_cost_minor, maximum_cost_minor
  ) values (
    p_workspace_id, p_preflight_run_id, p_stage_attempt_id,
    capability.provider_account_id, capability.id, line.operation,
    capability.schema_version, p_input_manifest_id, p_input_manifest_hash,
    p_idempotency_key, p_correlation_id, p_retry_of_id, line.amount_minor,
    line.amount_minor
  ) returning id into request_id;
  insert into private.provider_request_quote_claims (
    workspace_id, provider_request_id, preflight_run_id, micro_quote_line_id,
    micro_authorization_id, micro_reservation_id, authority_epoch, fencing_token
  ) values (
    p_workspace_id, request_id, run.id, line.id, run.micro_authorization_id,
    run.micro_reservation_id, run.authority_epoch, attempt.fencing_token
  );
  return request_id;
end;
$$;

revoke all on function public.command_claim_micro_provider_slot(
  uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid
) from public, anon, authenticated;
grant execute on function public.command_claim_micro_provider_slot(
  uuid,uuid,uuid,uuid,uuid,text,text,uuid,uuid
) to service_role;

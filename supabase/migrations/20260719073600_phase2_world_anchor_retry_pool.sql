-- Pre-authorize a fixed 32-request pool inside the user's existing $3.84 cap.
-- A provider-declared retryable rejection may consume a fresh pool slot only by
-- creating a new request row linked to the failed predecessor. Unknown outcomes
-- are deliberately not retryable because they may already be billable.

create table private.world_anchor_retry_pools (
  preparation_id uuid primary key
    references private.world_anchor_preparations(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  micro_quote_id uuid not null references private.micro_quotes(id) on delete restrict,
  original_quote_hash text not null check (original_quote_hash ~ '^[a-f0-9]{64}$'),
  pooled_quote_hash text not null check (pooled_quote_hash ~ '^[a-f0-9]{64}$'),
  primary_slot_count integer not null check (primary_slot_count between 1 and 32),
  retry_slot_count integer not null check (retry_slot_count between 0 and 31),
  hard_ceiling_minor bigint not null check (hard_ceiling_minor = 384),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, preparation_id),
  unique (micro_quote_id),
  check (primary_slot_count + retry_slot_count = 32)
);

create table private.world_anchor_job_requests (
  job_id uuid not null references private.world_anchor_jobs(id) on delete restrict,
  attempt_no integer not null check (attempt_no between 1 and 32),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  micro_quote_line_id uuid not null references private.micro_quote_lines(id) on delete restrict,
  provider_request_id uuid not null references private.provider_requests(id) on delete restrict,
  capability_grant_id uuid not null references private.worker_capability_grants(id) on delete restrict,
  predecessor_request_id uuid references private.provider_requests(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  primary key (job_id, attempt_no),
  unique (provider_request_id),
  unique (micro_quote_line_id),
  check (predecessor_request_id is null or predecessor_request_id <> provider_request_id)
);

create trigger world_anchor_retry_pools_immutable
before update or delete on private.world_anchor_retry_pools
for each row execute function private.reject_mutation();

create trigger world_anchor_job_requests_immutable
before update or delete on private.world_anchor_job_requests
for each row execute function private.reject_mutation();

create or replace function public.command_ensure_world_anchor_retry_pool(
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  preparation private.world_anchor_preparations%rowtype;
  pool_row private.world_anchor_retry_pools%rowtype;
  quote_row private.micro_quotes%rowtype;
  auth_row private.micro_authorizations%rowtype;
  reservation_row private.micro_reservations%rowtype;
  capability private.provider_capabilities%rowtype;
  pooled_hash text;
  line_number integer;
  retry_slots integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into run from public.preflight_runs
  where id = p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts
  where id = p_stage_attempt_id and preflight_run_id = run.id for update;
  select * into preparation from private.world_anchor_preparations
  where preflight_run_id = run.id for update;
  select * into pool_row from private.world_anchor_retry_pools
  where preparation_id = preparation.id;
  if found then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'preparationId', preparation.id,
      'primarySlotCount', pool_row.primary_slot_count,
      'retrySlotCount', pool_row.retry_slot_count,
      'hardCeilingMinor', pool_row.hard_ceiling_minor,
      'pooledQuoteHash', pool_row.pooled_quote_hash
    );
  end if;
  select * into quote_row from private.micro_quotes
  where id = preparation.micro_quote_id for update;
  select * into auth_row from private.micro_authorizations
  where id = preparation.micro_authorization_id for update;
  select * into reservation_row from private.micro_reservations
  where id = preparation.micro_reservation_id for update;
  select * into capability from private.provider_capabilities
  where id = preparation.provider_capability_id;
  if run.id is null or run.kind <> 'world_anchor' or run.state <> 'running'
    or attempt.id is null or attempt.state <> 'claimed'
    or preparation.id is null or preparation.stage_attempt_id <> attempt.id
    or quote_row.id is null or quote_row.state <> 'confirmed'
    or auth_row.id is null or auth_row.state <> 'active'
    or reservation_row.id is null or reservation_row.state <> 'held'
    or capability.id is null or capability.status <> 'verified'
    or capability.expires_at <= statement_timestamp()
    or capability.unit_price_minor <> 12
    or auth_row.hard_ceiling_minor <> preparation.job_count * 12
    or reservation_row.amount_minor <> preparation.job_count * 12
    or quote_row.total_minor <> preparation.job_count * 12
    or quote_row.expires_at <= statement_timestamp()
    or auth_row.expires_at <= statement_timestamp()
    or reservation_row.expires_at <= statement_timestamp()
  then
    raise exception 'world anchor retry pool authority is stale'
      using errcode = '40001';
  end if;

  retry_slots := 32 - preparation.job_count;
  pooled_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'schemaVersion', 'genie.world-anchor-retry-pool.v1',
    'preparationId', preparation.id,
    'originalQuoteHash', quote_row.quote_hash,
    'primarySlotCount', preparation.job_count,
    'retrySlotCount', retry_slots,
    'unitPriceMinor', capability.unit_price_minor,
    'hardCeilingMinor', 384
  )::text, 'UTF8'), 'sha256'), 'hex');

  if retry_slots > 0 then
    for line_number in (preparation.job_count + 1)..32 loop
      insert into private.micro_quote_lines(
        micro_quote_id, line_number, slot_key, capability_id, operation,
        quantity, unit_price_minor, amount_minor, request_schema_hash
      ) values (
        quote_row.id, line_number,
        'retry.pool.' || lpad((line_number - preparation.job_count)::text, 2, '0'),
        capability.id, 'gen_image', 1, capability.unit_price_minor,
        capability.unit_price_minor,
        encode(extensions.digest(convert_to(capability.schema_version, 'UTF8'), 'sha256'), 'hex')
      );
    end loop;
  end if;

  update private.micro_quotes
  set quote_hash = pooled_hash, total_minor = 384
  where id = quote_row.id;
  update private.micro_authorizations
  set quote_hash = pooled_hash, hard_ceiling_minor = 384,
      aggregate_version = aggregate_version + 1
  where id = auth_row.id;
  update private.micro_reservations
  set amount_minor = 384, aggregate_version = aggregate_version + 1
  where id = reservation_row.id;
  insert into private.world_anchor_retry_pools(
    preparation_id, workspace_id, micro_quote_id, original_quote_hash,
    pooled_quote_hash, primary_slot_count, retry_slot_count, hard_ceiling_minor
  ) values (
    preparation.id, preparation.workspace_id, quote_row.id, quote_row.quote_hash,
    pooled_hash, preparation.job_count, retry_slots, 384
  ) returning * into pool_row;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'preparationId', preparation.id,
    'primarySlotCount', pool_row.primary_slot_count,
    'retrySlotCount', pool_row.retry_slot_count,
    'hardCeilingMinor', pool_row.hard_ceiling_minor,
    'pooledQuoteHash', pool_row.pooled_quote_hash
  );
end;
$$;

create or replace function public.command_claim_world_anchor_provider_job(
  p_job_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.world_anchor_jobs%rowtype;
  preparation private.world_anchor_preparations%rowtype;
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  capability private.provider_capabilities%rowtype;
  request private.provider_requests%rowtype;
  predecessor private.provider_requests%rowtype;
  grant_id uuid;
  scope_hash text;
  selected_line_id uuid;
  request_attempt integer;
  effective_idempotency text;
  effective_correlation uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if char_length(p_idempotency_key) not between 8 and 160 then
    raise exception 'world anchor provider idempotency key is invalid'
      using errcode = '22023';
  end if;
  select * into job from private.world_anchor_jobs where id = p_job_id for update;
  if job.id is null then
    raise exception 'world anchor provider job not found' using errcode = 'P0002';
  end if;
  select * into preparation from private.world_anchor_preparations
  where id = job.preparation_id;
  if job.provider_request_id is not null then
    select * into request from private.provider_requests
    where id = job.provider_request_id;
    if request.state <> 'failed_retryable' then
      return jsonb_build_object(
        'ok', true, 'replayed', true, 'jobId', job.id,
        'providerRequestId', request.id, 'providerRequestState', request.state,
        'capabilityGrantId', job.capability_grant_id,
        'capabilityJti', job.capability_jti, 'workspaceId', job.workspace_id,
        'preflightRunId', job.preflight_run_id,
        'stageAttemptId', job.stage_attempt_id,
        'stageRunId', (select preflight_stage_run_id from public.preflight_stage_attempts where id = job.stage_attempt_id),
        'authorityEpoch', (select authority_epoch from public.preflight_stage_attempts where id = job.stage_attempt_id),
        'fencingToken', (select fencing_token from public.preflight_stage_attempts where id = job.stage_attempt_id),
        'inputManifestId', job.input_manifest_id,
        'inputManifestHash', job.input_manifest_hash,
        'quoteLineId', job.micro_quote_line_id
      );
    end if;
    predecessor := request;
    select line.id into selected_line_id
    from private.micro_quote_lines line
    left join private.provider_request_quote_claims claim
      on claim.micro_quote_line_id = line.id
    where line.micro_quote_id = preparation.micro_quote_id
      and line.slot_key like 'retry.pool.%'
      and claim.id is null
    order by line.line_number
    for update of line skip locked
    limit 1;
    if selected_line_id is null then
      raise exception 'world anchor retry budget exhausted' using errcode = '54000';
    end if;
    select coalesce(max(history.attempt_no), 0) + 1 into request_attempt
    from private.world_anchor_job_requests history where history.job_id = job.id;
    effective_idempotency := p_idempotency_key || ':retry:' || request_attempt::text;
    effective_correlation := gen_random_uuid();
    update private.world_anchor_jobs
    set micro_quote_line_id = selected_line_id,
        capability_jti = gen_random_uuid(),
        provider_request_id = null,
        capability_grant_id = null,
        state = 'reserved'
    where id = job.id
    returning * into job;
  else
    request_attempt := 1;
    effective_idempotency := p_idempotency_key;
    effective_correlation := p_correlation_id;
  end if;

  select * into run from public.preflight_runs
  where id = job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts
  where id = job.stage_attempt_id for update;
  select registered.* into capability
  from private.world_anchor_preparations prep
  join private.provider_capabilities registered
    on registered.id = prep.provider_capability_id
  where prep.id = job.preparation_id;
  if job.state <> 'reserved' or run.state <> 'running'
    or not run.requires_micro_authority or attempt.state <> 'claimed'
    or attempt.authority_epoch <> run.authority_epoch
    or attempt.fencing_token <> (
      select highest_fencing_token from public.preflight_stage_runs
      where id = attempt.preflight_stage_run_id
    )
    or capability.status <> 'verified'
    or capability.expires_at <= statement_timestamp()
    or not exists (
      select 1 from private.world_anchor_retry_pools pool
      where pool.preparation_id = preparation.id
        and pool.micro_quote_id = run.micro_quote_id
        and pool.hard_ceiling_minor = 384
    )
    or not exists (
      select 1 from private.micro_quote_lines line
      where line.id = job.micro_quote_line_id
        and line.micro_quote_id = run.micro_quote_id
        and line.capability_id = capability.id
        and not exists (
          select 1 from private.provider_request_quote_claims claim
          where claim.micro_quote_line_id = line.id
        )
    )
  then
    raise exception 'world anchor provider job authority is stale'
      using errcode = '40001';
  end if;

  insert into private.provider_requests(
    workspace_id, preflight_run_id, stage_attempt_id, provider_account_id,
    provider_capability_id, operation, request_schema_version,
    input_manifest_id, input_manifest_hash, idempotency_key, correlation_id,
    retry_of_id, expected_cost_minor, maximum_cost_minor
  ) values (
    job.workspace_id, run.id, attempt.id, capability.provider_account_id,
    capability.id, 'gen_image', capability.schema_version,
    job.input_manifest_id, job.input_manifest_hash, effective_idempotency,
    effective_correlation, predecessor.id, capability.unit_price_minor,
    capability.maximum_request_minor
  ) returning * into request;
  insert into private.provider_request_quote_claims(
    workspace_id, provider_request_id, preflight_run_id, micro_quote_line_id,
    micro_authorization_id, micro_reservation_id, authority_epoch, fencing_token
  ) values (
    job.workspace_id, request.id, run.id, job.micro_quote_line_id,
    run.micro_authorization_id, run.micro_reservation_id, run.authority_epoch,
    attempt.fencing_token
  );
  scope_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'jobId', job.id, 'targetAssetId', job.target_asset_id,
    'inputManifestHash', job.input_manifest_hash,
    'providerRequestId', request.id
  )::text, 'UTF8'), 'sha256'), 'hex');
  insert into private.worker_capability_grants(
    workspace_id, preflight_run_id, stage_attempt_id, provider_request_id,
    micro_quote_line_id, capability, authority_epoch, fencing_token,
    input_manifest_hash, token_jti_hash, allowed_rpc,
    allowed_object_scope_hash, expires_at
  ) values (
    job.workspace_id, run.id, attempt.id, request.id, job.micro_quote_line_id,
    'gen_image', run.authority_epoch, attempt.fencing_token,
    job.input_manifest_hash,
    encode(extensions.digest(convert_to(job.capability_jti::text, 'UTF8'), 'sha256'), 'hex'),
    'provider.submit_exact_request', scope_hash,
    statement_timestamp() + interval '5 minutes'
  ) returning id into grant_id;
  update private.world_anchor_jobs
  set provider_request_id = request.id,
      capability_grant_id = grant_id,
      state = 'dispatching'
  where id = job.id
  returning * into job;
  insert into private.world_anchor_job_requests(
    job_id, attempt_no, workspace_id, micro_quote_line_id,
    provider_request_id, capability_grant_id, predecessor_request_id
  ) values (
    job.id, request_attempt, job.workspace_id, job.micro_quote_line_id,
    request.id, grant_id, predecessor.id
  );
  return jsonb_build_object(
    'ok', true, 'replayed', false, 'jobId', job.id,
    'providerRequestId', request.id, 'providerRequestState', request.state,
    'capabilityGrantId', grant_id, 'capabilityJti', job.capability_jti,
    'workspaceId', job.workspace_id, 'preflightRunId', job.preflight_run_id,
    'stageAttemptId', job.stage_attempt_id,
    'stageRunId', attempt.preflight_stage_run_id,
    'authorityEpoch', attempt.authority_epoch,
    'fencingToken', attempt.fencing_token,
    'inputManifestId', job.input_manifest_id,
    'inputManifestHash', job.input_manifest_hash,
    'quoteLineId', job.micro_quote_line_id
  );
end;
$$;

revoke all on table private.world_anchor_retry_pools,
  private.world_anchor_job_requests from public, anon, authenticated;
revoke all on function public.command_ensure_world_anchor_retry_pool(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.command_ensure_world_anchor_retry_pool(uuid,uuid)
  to service_role;

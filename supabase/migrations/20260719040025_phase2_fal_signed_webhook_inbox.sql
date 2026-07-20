-- Signed fal completion inbox. The webhook can recover an asynchronous request
-- identity even when the submit response was lost, while media remains
-- non-authoritative until a separately fenced secure-ingest claim quarantines it.

create type private.provider_output_candidate_state as enum (
  'pending','claimed','quarantined','rejected'
);

create table private.provider_output_candidates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  provider_request_id uuid not null references private.provider_requests(id)
    on delete restrict,
  provider_inbox_message_id uuid not null references private.provider_inbox_messages(id)
    on delete restrict,
  target_asset_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 4),
  remote_url text not null check (
    char_length(remote_url) between 12 and 2048
    and remote_url ~ '^https://'
    and remote_url !~ '[[:cntrl:][:space:]]'
  ),
  remote_url_hash text not null check (remote_url_hash ~ '^[a-f0-9]{64}$'),
  declared_mime text not null check (declared_mime in (
    'image/png','image/jpeg','image/webp'
  )),
  expected_width integer not null check (expected_width between 1 and 32768),
  expected_height integer not null check (expected_height between 1 and 32768),
  state private.provider_output_candidate_state not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  available_at timestamptz not null default statement_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  quarantine_asset_version_id uuid references private.quarantine_assets(id)
    on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (workspace_id, id),
  unique (provider_request_id, ordinal),
  unique (provider_request_id, remote_url_hash),
  check (
    (state = 'pending' and lease_token is null and lease_expires_at is null
      and quarantine_asset_version_id is null and completed_at is null)
    or (state = 'claimed' and lease_token is not null and lease_expires_at is not null
      and quarantine_asset_version_id is null and completed_at is null)
    or (state = 'quarantined' and lease_token is null and lease_expires_at is null
      and quarantine_asset_version_id is not null and completed_at is not null)
    or (state = 'rejected' and lease_token is null and lease_expires_at is null
      and quarantine_asset_version_id is null and completed_at is not null)
  )
);

create index provider_output_candidates_ingest_idx
  on private.provider_output_candidates (state, available_at)
  where state in ('pending','claimed');

create or replace function public.get_fal_webhook_binding(
  p_provider_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare request private.provider_requests%rowtype;
  account private.provider_accounts%rowtype;
  manifest private.provider_input_manifests%rowtype;
  target_asset_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  select * into request from private.provider_requests
  where id = p_provider_request_id;
  if not found or request.state not in (
    'submitted','accepted','polling','succeeded','failed_retryable',
    'failed_terminal','cancel_requested','canceled'
  ) then raise exception 'fal webhook binding is unavailable' using errcode = 'P0002'; end if;
  select * into account from private.provider_accounts
  where id = request.provider_account_id;
  select * into manifest from private.provider_input_manifests
  where id = request.input_manifest_id and workspace_id = request.workspace_id;
  if account.provider <> 'fal' or manifest.id is null
    or request.operation not in ('gen_image','edit_image')
    or manifest.payload_json ->> 'targetAssetId' is null
  then raise exception 'fal webhook binding is invalid' using errcode = '40001'; end if;
  target_asset_id := (manifest.payload_json ->> 'targetAssetId')::uuid;
  return jsonb_build_object(
    'providerRequestId', request.id, 'targetAssetId', target_asset_id,
    'workspaceId', request.workspace_id
  );
end;
$$;

create or replace function public.command_record_fal_signed_webhook(
  p_provider_request_id uuid,
  p_provider_event_id text,
  p_external_job_id text,
  p_gateway_request_id text,
  p_status text,
  p_canonical_payload_hash text,
  p_raw_body_sha256 text,
  p_safe_summary jsonb,
  p_outputs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request private.provider_requests%rowtype;
  account private.provider_accounts%rowtype;
  manifest private.provider_input_manifests%rowtype;
  inbox private.provider_inbox_messages%rowtype;
  existing_inbox private.provider_inbox_messages%rowtype;
  output jsonb;
  target_asset_id uuid;
  candidate_ids jsonb := '[]'::jsonb;
  is_terminal boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if char_length(p_provider_event_id) not between 3 and 240
    or char_length(p_external_job_id) not between 3 and 240
    or char_length(p_gateway_request_id) not between 3 and 240
    or p_status not in ('OK','ERROR')
    or p_canonical_payload_hash !~ '^[a-f0-9]{64}$'
    or p_raw_body_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_safe_summary) <> 'object'
    or pg_column_size(p_safe_summary) > 16384
    or jsonb_typeof(p_outputs) <> 'array'
    or jsonb_array_length(p_outputs) > 4
    or pg_column_size(p_outputs) > 32768
  then
    raise exception 'fal webhook envelope is invalid' using errcode = '22023';
  end if;

  select * into request from private.provider_requests
  where id = p_provider_request_id for update;
  if not found then
    raise exception 'provider request not found' using errcode = 'P0002';
  end if;
  select * into account from private.provider_accounts
  where id = request.provider_account_id;
  select * into manifest from private.provider_input_manifests
  where id = request.input_manifest_id and workspace_id = request.workspace_id;
  if account.provider <> 'fal' or account.state <> 'active'
    or manifest.id is null
    or request.state not in (
      'submitted','accepted','polling','succeeded','failed_retryable',
      'failed_terminal','cancel_requested','canceled'
    )
  then
    raise exception 'fal webhook provider scope is unavailable' using errcode = '40001';
  end if;

  select * into existing_inbox
  from private.provider_inbox_messages
  where provider_account_id = account.id
    and (provider_event_id = p_provider_event_id
      or canonical_payload_hash = p_canonical_payload_hash)
  order by received_at limit 1;
  if found then
    if existing_inbox.provider_request_id <> request.id
      or existing_inbox.raw_body_sha256 <> p_raw_body_sha256
    then
      raise exception 'fal webhook replay binding changed' using errcode = '54000';
    end if;
    select coalesce(jsonb_agg(c.id order by c.ordinal), '[]'::jsonb)
      into candidate_ids
    from private.provider_output_candidates c
    where c.provider_inbox_message_id = existing_inbox.id;
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'disposition',
      coalesce(existing_inbox.safe_summary ->> 'disposition', 'recorded'),
      'providerRequestId', request.id, 'state', request.state,
      'aggregateVersion', request.aggregate_version,
      'candidateIds', candidate_ids
    );
  end if;

  if exists (
    select 1 from private.provider_requests other
    where other.provider_account_id = account.id
      and other.external_job_id = p_external_job_id
      and other.id <> request.id
  ) or (request.external_job_id is not null
    and request.external_job_id <> p_external_job_id)
  then
    insert into private.provider_inbox_messages (
      provider_account_id, provider_request_id, provider_event_id,
      canonical_payload_hash, raw_body_sha256, signature_verified,
      verification_class, processed_at, safe_summary
    ) values (
      account.id, request.id, p_provider_event_id, p_canonical_payload_hash,
      p_raw_body_sha256, true, 'rejected', statement_timestamp(),
      p_safe_summary || jsonb_build_object('disposition','job_mismatch')
    ) returning * into inbox;
    return jsonb_build_object(
      'ok', false, 'duplicate', false, 'disposition', 'job_mismatch',
      'providerRequestId', request.id, 'state', request.state,
      'aggregateVersion', request.aggregate_version, 'candidateIds', '[]'::jsonb
    );
  end if;

  is_terminal := request.state in (
    'succeeded','failed_retryable','failed_terminal','canceled','cancel_requested'
  );
  insert into private.provider_inbox_messages (
    provider_account_id, provider_request_id, provider_event_id,
    canonical_payload_hash, raw_body_sha256, signature_verified,
    verification_class, processed_at, safe_summary
  ) values (
    account.id, request.id, p_provider_event_id, p_canonical_payload_hash,
    p_raw_body_sha256, true, 'signed', statement_timestamp(),
    p_safe_summary || jsonb_build_object(
      'disposition', case when is_terminal then 'stale'
        when p_status = 'ERROR' then 'failed_retryable' else 'accepted' end
    )
  ) returning * into inbox;

  if is_terminal then
    if p_status = 'OK' then
      insert into private.provider_late_completions (
        provider_request_id, canonical_event_hash, classification
      ) values (request.id, p_canonical_payload_hash, 'stale')
      on conflict (provider_request_id, canonical_event_hash) do nothing;
    end if;
    return jsonb_build_object(
      'ok', true, 'duplicate', false, 'disposition', 'stale',
      'providerRequestId', request.id, 'state', request.state,
      'aggregateVersion', request.aggregate_version, 'candidateIds', '[]'::jsonb
    );
  end if;

  if p_status = 'ERROR' then
    update private.provider_requests
    set external_job_id = coalesce(external_job_id, p_external_job_id),
        state = 'failed_retryable', billable_state = 'unknown',
        safe_response_hash = p_canonical_payload_hash,
        completed_at = statement_timestamp(),
        aggregate_version = aggregate_version + 1
    where id = request.id returning * into request;
    return jsonb_build_object(
      'ok', true, 'duplicate', false, 'disposition', 'failed_retryable',
      'providerRequestId', request.id, 'state', request.state,
      'aggregateVersion', request.aggregate_version, 'candidateIds', '[]'::jsonb
    );
  end if;

  if request.operation not in ('gen_image','edit_image')
    or jsonb_array_length(p_outputs) <> 1
    or manifest.payload_json ->> 'targetAssetId' is null
  then
    raise exception 'fal output does not match the image capability'
      using errcode = '22023';
  end if;
  target_asset_id := (manifest.payload_json ->> 'targetAssetId')::uuid;
  update private.provider_requests
  set external_job_id = coalesce(external_job_id, p_external_job_id),
      state = 'polling', billable_state = 'estimated',
      safe_response_hash = p_canonical_payload_hash,
      aggregate_version = aggregate_version + 1
  where id = request.id and state in ('submitted','accepted','polling')
  returning * into request;
  if not found then
    raise exception 'fal webhook authority became stale' using errcode = '40001';
  end if;

  for output in select * from jsonb_array_elements(p_outputs)
  loop
    if jsonb_typeof(output) <> 'object'
      or (output - array[
        'ordinal','url','urlSha256','contentType','width','height','targetAssetId'
      ]::text[]) <> '{}'::jsonb
      or not (output ?& array[
        'ordinal','url','urlSha256','contentType','width','height','targetAssetId'
      ])
      or (output ->> 'ordinal')::integer <> 1
      or char_length(output ->> 'url') not between 12 and 2048
      or output ->> 'url' !~ '^https://'
      or output ->> 'url' ~ '[[:cntrl:][:space:]]'
      or output ->> 'urlSha256' !~ '^[a-f0-9]{64}$'
      or output ->> 'contentType' not in ('image/png','image/jpeg','image/webp')
      or (output ->> 'width')::integer not between 1 and 32768
      or (output ->> 'height')::integer not between 1 and 32768
      or (output ->> 'targetAssetId')::uuid <> target_asset_id
    then
      raise exception 'fal output candidate is invalid' using errcode = '22023';
    end if;
    insert into private.provider_output_candidates (
      workspace_id, provider_request_id, provider_inbox_message_id,
      target_asset_id, ordinal, remote_url, remote_url_hash, declared_mime,
      expected_width, expected_height
    ) values (
      request.workspace_id, request.id, inbox.id, target_asset_id,
      (output ->> 'ordinal')::integer, output ->> 'url',
      output ->> 'urlSha256', output ->> 'contentType',
      (output ->> 'width')::integer, (output ->> 'height')::integer
    );
  end loop;
  select jsonb_agg(c.id order by c.ordinal) into candidate_ids
  from private.provider_output_candidates c
  where c.provider_inbox_message_id = inbox.id;
  insert into private.outbox_events (
    workspace_id, event_type, destination, payload_json, idempotency_key
  ) values (
    request.workspace_id, 'provider.output.ready_for_secure_ingest',
    'trigger.preflight-secure-ingest',
    jsonb_build_object(
      'providerRequestId', request.id, 'providerInboxMessageId', inbox.id,
      'candidateIds', candidate_ids
    ),
    'provider-output:' || request.id::text || ':' || p_canonical_payload_hash
  );
  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'disposition', 'accepted',
    'providerRequestId', request.id, 'state', request.state,
    'aggregateVersion', request.aggregate_version, 'candidateIds', candidate_ids
  );
end;
$$;

create or replace function public.command_claim_provider_output_candidate(
  p_candidate_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate private.provider_output_candidates%rowtype;
  request private.provider_requests%rowtype;
  claim private.provider_request_quote_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_lease_seconds not between 30 and 300 then
    raise exception 'provider output lease is invalid' using errcode = '22023'; end if;
  select * into candidate from private.provider_output_candidates
  where id = p_candidate_id for update;
  if not found then raise exception 'provider output candidate not found' using errcode = 'P0002'; end if;
  select * into request from private.provider_requests
  where id = candidate.provider_request_id;
  select * into claim from private.provider_request_quote_claims
  where provider_request_id = request.id;
  if request.state <> 'polling'
    or not exists (
      select 1 from public.preflight_stage_attempts a
      join public.preflight_stage_runs s on s.id = a.preflight_stage_run_id
      join public.preflight_runs r on r.id = a.preflight_run_id
      where a.id = request.stage_attempt_id
        and a.state in ('running','waiting_external')
        and a.authority_epoch = claim.authority_epoch
        and a.fencing_token = claim.fencing_token
        and s.highest_fencing_token = a.fencing_token
        and r.authority_epoch = a.authority_epoch
        and r.state in ('running','waiting_external')
    )
  then raise exception 'provider output authority is stale' using errcode = '40001'; end if;
  if candidate.state = 'claimed' and candidate.lease_expires_at > statement_timestamp()
  then raise exception 'provider output candidate is already leased' using errcode = '40001'; end if;
  if candidate.state not in ('pending','claimed') or candidate.attempt_count >= 5
  then raise exception 'provider output candidate is not claimable' using errcode = '55000'; end if;
  update private.provider_output_candidates
  set state = 'claimed', lease_token = p_lease_token,
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1
  where id = candidate.id returning * into candidate;
  return jsonb_build_object(
    'ok', true, 'candidateId', candidate.id,
    'workspaceId', candidate.workspace_id,
    'providerRequestId', candidate.provider_request_id,
    'targetAssetId', candidate.target_asset_id,
    'remoteUrl', candidate.remote_url,
    'remoteUrlSha256', candidate.remote_url_hash,
    'declaredMime', candidate.declared_mime,
    'expectedWidth', candidate.expected_width,
    'expectedHeight', candidate.expected_height,
    'leaseToken', candidate.lease_token,
    'leaseExpiresAt', candidate.lease_expires_at,
    'preflightRunId', request.preflight_run_id,
    'stageAttemptId', request.stage_attempt_id,
    'authorityEpoch', claim.authority_epoch,
    'fencingToken', claim.fencing_token
  );
end;
$$;

create or replace function public.command_complete_provider_output_candidate(
  p_candidate_id uuid,
  p_lease_token uuid,
  p_quarantine_asset_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare candidate private.provider_output_candidates%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  select * into candidate from private.provider_output_candidates
  where id = p_candidate_id for update;
  if not found or candidate.state <> 'claimed'
    or candidate.lease_token <> p_lease_token
    or candidate.lease_expires_at <= statement_timestamp()
  then raise exception 'provider output completion lease is stale' using errcode = '40001'; end if;
  if not exists (
    select 1 from private.quarantine_assets q
    where q.id = p_quarantine_asset_version_id
      and q.workspace_id = candidate.workspace_id
      and q.provider_request_id = candidate.provider_request_id
      and q.stable_asset_id = candidate.target_asset_id
      and q.state = 'quarantined'
  ) then raise exception 'provider output quarantine binding is invalid' using errcode = '40001'; end if;
  update private.provider_output_candidates
  set state = 'quarantined', lease_token = null, lease_expires_at = null,
      quarantine_asset_version_id = p_quarantine_asset_version_id,
      completed_at = statement_timestamp()
  where id = candidate.id returning * into candidate;
  return jsonb_build_object(
    'ok', true, 'candidateId', candidate.id, 'state', candidate.state,
    'quarantineAssetVersionId', candidate.quarantine_asset_version_id
  );
end;
$$;

revoke all on table private.provider_output_candidates
from public, anon, authenticated;
revoke all on function public.command_record_fal_signed_webhook(
  uuid,text,text,text,text,text,text,jsonb,jsonb
), public.get_fal_webhook_binding(uuid),
  public.command_claim_provider_output_candidate(uuid,uuid,integer),
  public.command_complete_provider_output_candidate(uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.command_record_fal_signed_webhook(
  uuid,text,text,text,text,text,text,jsonb,jsonb
), public.get_fal_webhook_binding(uuid),
  public.command_claim_provider_output_candidate(uuid,uuid,integer),
  public.command_complete_provider_output_candidate(uuid,uuid,uuid)
to service_role;

-- Bind every remotely fetched provider output to the exact leased webhook
-- candidate. Generic research fetch evidence cannot be repurposed as paid
-- provider output evidence, even by accidentally passing both foreign keys.

alter table private.remote_fetch_requests
  add column provider_output_candidate_id uuid
    references private.provider_output_candidates(id) on delete restrict;

create unique index remote_fetch_provider_output_candidate_uq
  on private.remote_fetch_requests (provider_output_candidate_id)
  where provider_output_candidate_id is not null;

create or replace function public.command_record_provider_output_remote_fetch(
  p_candidate_id uuid,
  p_lease_token uuid,
  p_environment text,
  p_exact_hostname text,
  p_allowlist_version_id uuid,
  p_requested_url_hash text,
  p_canonical_url_hash text,
  p_allowlist_version_hash text,
  p_resolved_address_hashes jsonb,
  p_redirect_count integer,
  p_maximum_bytes bigint,
  p_timeout_ms integer,
  p_response_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate private.provider_output_candidates%rowtype;
  request private.provider_requests%rowtype;
  existing private.remote_fetch_requests%rowtype;
  fetch_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  select * into candidate
  from private.provider_output_candidates
  where id = p_candidate_id
  for update;

  if not found
    or candidate.state <> 'claimed'
    or candidate.lease_token <> p_lease_token
    or candidate.lease_expires_at <= statement_timestamp()
  then
    raise exception 'provider output fetch lease is stale' using errcode = '40001';
  end if;

  select * into request
  from private.provider_requests
  where id = candidate.provider_request_id;

  if request.state <> 'polling'
    or request.workspace_id <> candidate.workspace_id
    or p_requested_url_hash <> candidate.remote_url_hash
  then
    raise exception 'provider output fetch scope is stale' using errcode = '40001';
  end if;

  if p_environment not in ('development','preview','production','test')
    or p_exact_hostname <> lower(p_exact_hostname)
    or p_requested_url_hash !~ '^[a-f0-9]{64}$'
    or p_canonical_url_hash !~ '^[a-f0-9]{64}$'
    or p_allowlist_version_hash !~ '^[a-f0-9]{64}$'
    or p_response_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_resolved_address_hashes) <> 'array'
    or jsonb_array_length(p_resolved_address_hashes) not between 1 and 16
    or p_redirect_count not between 0 and 5
    or p_maximum_bytes not between 1 and 104857600
    or p_timeout_ms not between 1000 and 120000
    or exists (
      select 1 from jsonb_array_elements_text(p_resolved_address_hashes) h
      where h !~ '^[a-f0-9]{64}$'
    )
  then
    raise exception 'provider output fetch envelope is invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.remote_fetch_allowlist_versions version
    join private.remote_fetch_allowlist_entries entry
      on entry.allowlist_version_id = version.id
    where version.id = p_allowlist_version_id
      and version.environment = p_environment
      and version.fetch_class = 'provider_output'
      and version.state = 'active'
      and version.manifest_hash = p_allowlist_version_hash
      and entry.exact_hostname = p_exact_hostname
  ) then
    raise exception 'provider output fetch host is not allowlisted' using errcode = '42501';
  end if;

  select * into existing
  from private.remote_fetch_requests
  where provider_output_candidate_id = candidate.id;

  if found then
    if existing.workspace_id <> candidate.workspace_id
      or existing.preflight_run_id <> request.preflight_run_id
      or existing.stage_attempt_id <> request.stage_attempt_id
      or existing.environment <> p_environment
      or existing.fetch_class <> 'provider_output'
      or existing.allowlist_version_id <> p_allowlist_version_id
      or existing.exact_hostname <> p_exact_hostname
      or existing.canonical_url_hash <> p_canonical_url_hash
      or existing.allowlist_version_hash <> p_allowlist_version_hash
      or existing.resolved_address_hashes <> p_resolved_address_hashes
      or existing.redirect_count <> p_redirect_count
      or existing.maximum_bytes <> p_maximum_bytes
      or existing.timeout_ms <> p_timeout_ms
      or existing.status <> 'fetched'
      or existing.response_sha256 <> p_response_sha256
    then
      raise exception 'provider output fetch evidence changed' using errcode = '40001';
    end if;
    return existing.id;
  end if;

  insert into private.remote_fetch_requests (
    workspace_id, preflight_run_id, stage_attempt_id, environment, fetch_class,
    allowlist_version_id, exact_hostname, canonical_url_hash,
    allowlist_version_hash, resolved_address_hashes, redirect_count,
    maximum_bytes, timeout_ms, status, response_sha256, safe_failure_class,
    provider_output_candidate_id, completed_at
  ) values (
    candidate.workspace_id, request.preflight_run_id, request.stage_attempt_id,
    p_environment, 'provider_output', p_allowlist_version_id, p_exact_hostname,
    p_canonical_url_hash, p_allowlist_version_hash, p_resolved_address_hashes,
    p_redirect_count, p_maximum_bytes, p_timeout_ms, 'fetched',
    p_response_sha256, null, candidate.id, statement_timestamp()
  ) returning id into fetch_id;

  return fetch_id;
end;
$$;

create or replace function private.guard_quarantine_asset_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'quarantine'
      and o.name = new.object_name
      and (o.metadata ->> 'size')::bigint = new.byte_length
      and o.metadata ->> 'mimetype' = new.declared_mime
  ) then
    raise exception 'quarantine storage object metadata is not exact'
      using errcode = '55000';
  end if;

  if new.source_kind = 'provider_output' and not exists (
    select 1
    from private.provider_requests pr
    join private.provider_input_manifests manifest
      on manifest.id = pr.input_manifest_id
      and manifest.workspace_id = pr.workspace_id
    where pr.id = new.provider_request_id
      and pr.workspace_id = new.workspace_id
      and pr.state in ('accepted','polling')
      and manifest.payload_json ->> 'targetAssetId' = new.stable_asset_id::text
  ) then
    raise exception 'provider quarantine scope is invalid' using errcode = '40001';
  elsif new.source_kind = 'provider_output'
    and new.remote_fetch_request_id is not null
    and not exists (
      select 1
      from private.remote_fetch_requests rf
      join private.provider_output_candidates candidate
        on candidate.id = rf.provider_output_candidate_id
      where rf.id = new.remote_fetch_request_id
        and rf.workspace_id = new.workspace_id
        and rf.fetch_class = 'provider_output'
        and rf.status = 'fetched'
        and rf.response_sha256 = new.source_sha256
        and candidate.workspace_id = new.workspace_id
        and candidate.provider_request_id = new.provider_request_id
        and candidate.target_asset_id = new.stable_asset_id
        and candidate.state = 'claimed'
    )
  then
    raise exception 'provider remote fetch binding is invalid' using errcode = '40001';
  elsif new.source_kind = 'research_fetch' and not exists (
    select 1 from private.remote_fetch_requests rf
    where rf.id = new.remote_fetch_request_id
      and rf.workspace_id = new.workspace_id
      and rf.fetch_class = 'research_reference'
      and rf.status = 'fetched'
      and rf.response_sha256 = new.source_sha256
  ) then
    raise exception 'research quarantine scope is invalid' using errcode = '40001';
  end if;

  return new;
end;
$$;

revoke all on function public.command_record_provider_output_remote_fetch(
  uuid,uuid,text,text,uuid,text,text,text,jsonb,integer,bigint,integer,text
) from public, anon, authenticated;

grant execute on function public.command_record_provider_output_remote_fetch(
  uuid,uuid,text,text,uuid,text,text,text,jsonb,integer,bigint,integer,text
) to service_role;

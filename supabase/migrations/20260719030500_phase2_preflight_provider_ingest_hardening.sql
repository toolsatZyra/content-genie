-- Phase 2 hardening for preflight terminality, restricted-tool replay,
-- provider cost/scope authority, allowlist rotation, and quarantine evidence.

-- A terminal preflight invalidates every outstanding worker authority, including
-- explicit failure (the original command only cascaded cancel/supersede).
create or replace function private.cascade_preflight_terminal_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare terminal_stage_state public.preflight_stage_state;
begin
  if new.state not in ('failed','canceled','superseded')
    or old.state = new.state
  then
    return new;
  end if;
  terminal_stage_state := case new.state
    when 'failed' then 'failed_terminal'::public.preflight_stage_state
    when 'canceled' then 'canceled'::public.preflight_stage_state
    else 'superseded'::public.preflight_stage_state
  end;
  update public.preflight_stage_attempts
  set state = terminal_stage_state,
      safe_error_class = case when new.state = 'failed'
        then coalesce(safe_error_class, 'preflight_run_failed')
        else safe_error_class end,
      completed_at = statement_timestamp()
  where preflight_run_id = new.id
    and state in ('claimed','running','waiting_external','waiting_decision');
  update public.preflight_stage_leases
  set state = 'revoked', closed_at = statement_timestamp()
  where preflight_run_id = new.id and state = 'active';
  update public.preflight_stage_runs
  set state = terminal_stage_state,
      completed_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where preflight_run_id = new.id
    and state not in ('succeeded','failed_terminal','canceled','superseded');
  return new;
end;
$$;

drop trigger if exists preflight_terminal_cascade on public.preflight_runs;
create trigger preflight_terminal_cascade
after update of state on public.preflight_runs
for each row execute function private.cascade_preflight_terminal_state();

-- Link the immutable result row to the one exact authorization row. This makes
-- completion retry-safe and prevents a worker retry from manufacturing multiple
-- successful records from one authorization.
alter table private.agent_tool_calls
  add column authorization_call_id uuid
    references private.agent_tool_calls(id) on delete restrict;
create unique index agent_tool_one_completion_uq
  on private.agent_tool_calls (authorization_call_id)
  where authorization_call_id is not null;
alter table private.agent_tool_calls
  add constraint agent_tool_completion_link_check check (
    (status = 'authorized' and authorization_call_id is null)
    or (status in ('succeeded','rejected') and authorization_call_id is not null)
  );

create or replace function public.command_complete_agent_tool_call(
  p_tool_call_id uuid,
  p_arguments_hash text,
  p_result_hash text,
  p_safe_result_summary jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare prior private.agent_tool_calls%rowtype;
  completed private.agent_tool_calls%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_arguments_hash !~ '^[a-f0-9]{64}$'
    or p_result_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_safe_result_summary) <> 'object'
    or pg_column_size(p_safe_result_summary) > 16384
  then
    raise exception 'restricted tool result is invalid' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('agent-tool-complete:' || p_tool_call_id::text, 0)
  );
  select * into prior from private.agent_tool_calls
  where id = p_tool_call_id and status = 'authorized';
  if not found or prior.arguments_hash <> p_arguments_hash then
    raise exception 'restricted tool result is stale' using errcode = '40001';
  end if;
  select * into completed from private.agent_tool_calls
  where authorization_call_id = prior.id;
  if found then
    if completed.arguments_hash = p_arguments_hash
      and completed.result_hash = p_result_hash
      and completed.safe_result_summary = p_safe_result_summary
    then
      return true;
    end if;
    raise exception 'restricted tool completion conflicts with prior result'
      using errcode = '40001';
  end if;
  insert into private.agent_tool_calls (
    workspace_id, episode_id, configuration_candidate_id, script_revision_id,
    policy_version_id, preflight_run_id, stage_attempt_id, tool_name,
    classification, trusted_scope_hash, arguments_hash, result_hash,
    source_set_hash, schema_version, maximum_fan_out, maximum_depth,
    maximum_tokens, maximum_duration_ms, maximum_result_bytes,
    maximum_cost_minor, model_family, model_version, prompt_hash, status,
    safe_result_summary, completed_at, authorization_call_id
  ) select
    workspace_id, episode_id, configuration_candidate_id, script_revision_id,
    policy_version_id, preflight_run_id, stage_attempt_id, tool_name,
    classification, trusted_scope_hash, arguments_hash, p_result_hash,
    source_set_hash, schema_version, maximum_fan_out, maximum_depth,
    maximum_tokens, maximum_duration_ms, maximum_result_bytes,
    maximum_cost_minor, model_family, model_version, prompt_hash, 'succeeded',
    p_safe_result_summary, statement_timestamp(), id
  from private.agent_tool_calls where id = p_tool_call_id;
  return true;
end;
$$;

create or replace function public.command_record_agent_injection_finding(
  p_workspace_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_source_class text,
  p_source_content_hash text,
  p_finding_code text,
  p_disposition text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare finding_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_source_class not in (
      'script','upload_ocr','research_text','provider_output','provider_error','model_text'
    )
    or p_source_content_hash !~ '^[a-f0-9]{64}$'
    or p_finding_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    or p_disposition not in ('quoted_data','rejected','quarantined')
  then
    raise exception 'injection finding is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.preflight_stage_attempts a
    join public.preflight_stage_runs s on s.id = a.preflight_stage_run_id
    join public.preflight_runs r on r.id = a.preflight_run_id
    where a.workspace_id = p_workspace_id
      and a.preflight_run_id = p_preflight_run_id
      and a.id = p_stage_attempt_id
      and a.state in ('running','waiting_external','waiting_decision')
      and s.highest_fencing_token = a.fencing_token
      and r.authority_epoch = a.authority_epoch
      and r.state in ('running','waiting_external','waiting_decision')
  ) then
    raise exception 'injection finding authority is stale' using errcode = '40001';
  end if;
  insert into private.agent_injection_findings (
    workspace_id, preflight_run_id, stage_attempt_id, source_class,
    source_content_hash, finding_code, disposition
  ) values (
    p_workspace_id, p_preflight_run_id, p_stage_attempt_id, p_source_class,
    p_source_content_hash, p_finding_code, p_disposition
  ) returning id into finding_id;
  return finding_id;
end;
$$;

-- Quote rows are authority, not advisory estimates: every line must belong to
-- the quote workspace and equal the ceiling-rounded verified rate exactly.
create or replace function private.guard_micro_quote_line()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare quote private.micro_quotes%rowtype;
  capability private.provider_capabilities%rowtype;
  account private.provider_accounts%rowtype;
  evidence private.provider_evidence_snapshots%rowtype;
  exact_amount bigint;
begin
  select * into quote from private.micro_quotes where id = new.micro_quote_id;
  select * into capability from private.provider_capabilities
  where id = new.capability_id;
  select * into account from private.provider_accounts
  where id = capability.provider_account_id;
  select * into evidence from private.provider_evidence_snapshots
  where id = capability.evidence_snapshot_id;
  exact_amount := ceil(new.quantity * capability.unit_price_minor)::bigint;
  if quote.id is null or capability.id is null or account.id is null
    or evidence.id is null
    or account.workspace_id <> quote.workspace_id
    or account.state <> 'active'
    or capability.capability <> new.operation
    or capability.status <> 'verified'
    or capability.expires_at <= statement_timestamp()
    or evidence.verification_state <> 'verified'
    or evidence.expires_at <= statement_timestamp()
    or new.unit_price_minor <> capability.unit_price_minor
    or new.amount_minor <> exact_amount
    or new.amount_minor > capability.maximum_request_minor
  then
    raise exception 'micro quote line is not exact verified authority'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists micro_quote_line_authority_guard on private.micro_quote_lines;
create trigger micro_quote_line_authority_guard
before insert on private.micro_quote_lines
for each row execute function private.guard_micro_quote_line();

create unique index provider_request_one_retry_child_uq
  on private.provider_requests (retry_of_id)
  where retry_of_id is not null;

create or replace function private.guard_provider_request_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare account private.provider_accounts%rowtype;
  capability private.provider_capabilities%rowtype;
  predecessor private.provider_requests%rowtype;
begin
  select * into account from private.provider_accounts
  where id = new.provider_account_id;
  select * into capability from private.provider_capabilities
  where id = new.provider_capability_id;
  if account.id is null or capability.id is null
    or account.workspace_id <> new.workspace_id
    or account.state <> 'active'
    or capability.provider_account_id <> account.id
    or capability.capability <> new.operation
    or capability.schema_version <> new.request_schema_version
    or capability.status <> 'verified'
    or capability.expires_at <= statement_timestamp()
  then
    raise exception 'provider request scope is stale' using errcode = '40001';
  end if;
  if new.retry_of_id is not null then
    select * into predecessor from private.provider_requests
    where id = new.retry_of_id;
    if predecessor.id is null
      or predecessor.workspace_id <> new.workspace_id
      or predecessor.preflight_run_id <> new.preflight_run_id
      or predecessor.operation <> new.operation
      or predecessor.provider_account_id <> new.provider_account_id
      or predecessor.provider_capability_id <> new.provider_capability_id
      or predecessor.input_manifest_id <> new.input_manifest_id
      or predecessor.input_manifest_hash <> new.input_manifest_hash
      or predecessor.state <> 'failed_retryable'
    then
      raise exception 'provider retry predecessor is not exact'
        using errcode = '40001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists provider_request_scope_guard on private.provider_requests;
create trigger provider_request_scope_guard
before insert on private.provider_requests
for each row execute function private.guard_provider_request_scope();

create or replace function private.guard_broker_assertion_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from private.broker_clients c
    join private.broker_client_key_versions k
      on k.broker_client_id = c.id
    join private.provider_requests request
      on request.workspace_id = c.workspace_id
    join private.worker_capability_grants grant_row
      on grant_row.provider_request_id = request.id
    where c.id = new.broker_client_id
      and k.id = new.broker_key_version_id
      and request.id = new.provider_request_id
      and grant_row.id = new.capability_grant_id
  ) then
    raise exception 'broker assertion scope crosses authority boundaries'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists broker_assertion_scope_guard on private.broker_assertion_jtis;
create trigger broker_assertion_scope_guard
before insert on private.broker_assertion_jtis
for each row execute function private.guard_broker_assertion_scope();

-- Permit only the one valid state transition on an otherwise immutable
-- allowlist version so an incident or deployment can rotate exact hosts.
drop trigger if exists remote_fetch_allowlists_immutable
  on private.remote_fetch_allowlist_versions;
create or replace function private.guard_remote_fetch_allowlist_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable evidence cannot be changed' using errcode = '55000';
  end if;
  if old.state = 'active' and new.state = 'withdrawn'
    and old.id = new.id
    and old.environment = new.environment
    and old.fetch_class = new.fetch_class
    and old.version_number = new.version_number
    and old.manifest_hash = new.manifest_hash
    and old.created_at = new.created_at
    and old.withdrawn_at is null
    and new.withdrawn_at is not null
  then
    return new;
  end if;
  raise exception 'immutable evidence cannot be changed' using errcode = '55000';
end;
$$;
create trigger remote_fetch_allowlists_guarded_mutation
before update or delete on private.remote_fetch_allowlist_versions
for each row execute function private.guard_remote_fetch_allowlist_mutation();

create or replace function public.command_activate_remote_fetch_allowlist(
  p_environment text,
  p_fetch_class text,
  p_manifest_hash text,
  p_exact_hosts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare allowlist_id uuid; next_version integer; host text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_fetch_class not in ('provider_output','research_reference')
    or p_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_exact_hosts) <> 'array'
    or jsonb_array_length(p_exact_hosts) not between 1 and 64
    or pg_column_size(p_exact_hosts) > 16384
  then raise exception 'remote fetch allowlist is invalid' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_exact_hosts) h
    where h <> lower(h) or h !~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
      or h ~ '\\.$'
  ) then raise exception 'remote fetch hostname is invalid' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'remote-fetch-allowlist:' || p_environment || ':' || p_fetch_class, 0
    )
  );
  select coalesce(max(version_number), 0) + 1 into next_version
  from private.remote_fetch_allowlist_versions
  where environment = p_environment and fetch_class = p_fetch_class;
  update private.remote_fetch_allowlist_versions
  set state = 'withdrawn', withdrawn_at = statement_timestamp()
  where environment = p_environment and fetch_class = p_fetch_class
    and state = 'active';
  insert into private.remote_fetch_allowlist_versions (
    environment, fetch_class, version_number, manifest_hash, state
  ) values (
    p_environment, p_fetch_class, next_version, p_manifest_hash, 'active'
  ) returning id into allowlist_id;
  for host in select distinct value from jsonb_array_elements_text(p_exact_hosts)
  loop
    insert into private.remote_fetch_allowlist_entries (
      allowlist_version_id, exact_hostname
    ) values (allowlist_id, host);
  end loop;
  return allowlist_id;
end;
$$;

drop trigger if exists remote_fetch_requests_immutable
  on private.remote_fetch_requests;
alter table private.remote_fetch_requests add column environment text;
update private.remote_fetch_requests request
set environment = version.environment
from private.remote_fetch_allowlist_versions version
where version.id = request.allowlist_version_id;
alter table private.remote_fetch_requests
  alter column environment set not null,
  add constraint remote_fetch_environment_check check (
    environment in ('development','preview','production','test')
  );
create trigger remote_fetch_requests_immutable
before update or delete on private.remote_fetch_requests
for each row execute function private.reject_mutation();

revoke all on function public.command_record_remote_fetch(
  uuid,uuid,uuid,text,text,uuid,text,text,jsonb,integer,bigint,integer,text,text,text
) from service_role;
drop function public.command_record_remote_fetch(
  uuid,uuid,uuid,text,text,uuid,text,text,jsonb,integer,bigint,integer,text,text,text
);

create or replace function public.command_record_remote_fetch(
  p_workspace_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_environment text,
  p_fetch_class text,
  p_exact_hostname text,
  p_allowlist_version_id uuid,
  p_canonical_url_hash text,
  p_allowlist_version_hash text,
  p_resolved_address_hashes jsonb,
  p_redirect_count integer,
  p_maximum_bytes bigint,
  p_timeout_ms integer,
  p_status text,
  p_response_sha256 text,
  p_safe_failure_class text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare fetch_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_fetch_class not in ('provider_output','research_reference')
    or p_exact_hostname <> lower(p_exact_hostname)
    or p_canonical_url_hash !~ '^[a-f0-9]{64}$'
    or p_allowlist_version_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_resolved_address_hashes) <> 'array'
    or jsonb_array_length(p_resolved_address_hashes) not between 1 and 16
    or p_status not in ('authorized','fetched','rejected','failed')
  then raise exception 'remote fetch envelope is invalid' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.preflight_stage_attempts a
    join public.preflight_stage_runs s on s.id = a.preflight_stage_run_id
    join public.preflight_runs r on r.id = a.preflight_run_id
    where a.workspace_id = p_workspace_id and a.preflight_run_id = p_preflight_run_id
      and a.id = p_stage_attempt_id
      and a.state in ('running','waiting_external')
      and s.highest_fencing_token = a.fencing_token
      and r.authority_epoch = a.authority_epoch
      and r.state in ('running','waiting_external')
  ) then raise exception 'remote fetch authority is stale' using errcode = '40001'; end if;
  if not exists (
    select 1
    from private.remote_fetch_allowlist_versions v
    join private.remote_fetch_allowlist_entries e on e.allowlist_version_id = v.id
    where v.id = p_allowlist_version_id
      and v.environment = p_environment
      and v.fetch_class = p_fetch_class
      and v.state = 'active'
      and e.exact_hostname = p_exact_hostname
      and v.manifest_hash = p_allowlist_version_hash
  ) then raise exception 'remote fetch host is not allowlisted' using errcode = '42501'; end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_resolved_address_hashes) h
    where h !~ '^[a-f0-9]{64}$'
  ) then raise exception 'resolved address evidence is invalid' using errcode = '22023'; end if;
  insert into private.remote_fetch_requests (
    workspace_id, preflight_run_id, stage_attempt_id, environment, fetch_class,
    allowlist_version_id, exact_hostname, canonical_url_hash,
    allowlist_version_hash, resolved_address_hashes, redirect_count,
    maximum_bytes, timeout_ms, status, response_sha256, safe_failure_class,
    completed_at
  ) values (
    p_workspace_id, p_preflight_run_id, p_stage_attempt_id, p_environment,
    p_fetch_class, p_allowlist_version_id, p_exact_hostname,
    p_canonical_url_hash, p_allowlist_version_hash, p_resolved_address_hashes,
    p_redirect_count, p_maximum_bytes, p_timeout_ms, p_status,
    p_response_sha256, p_safe_failure_class,
    case when p_status <> 'authorized' then statement_timestamp() else null end
  ) returning id into fetch_id;
  return fetch_id;
end;
$$;

revoke all on function public.command_record_remote_fetch(
  uuid,uuid,uuid,text,text,text,uuid,text,text,jsonb,integer,bigint,integer,
  text,text,text
) from public, anon, authenticated;
grant execute on function public.command_record_remote_fetch(
  uuid,uuid,uuid,text,text,text,uuid,text,text,jsonb,integer,bigint,integer,
  text,text,text
) to service_role;

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
    select 1 from private.provider_requests pr
    where pr.id = new.provider_request_id
      and pr.workspace_id = new.workspace_id
  ) then
    raise exception 'provider quarantine scope is invalid' using errcode = '40001';
  elsif new.source_kind = 'research_fetch' and not exists (
    select 1 from private.remote_fetch_requests rf
    where rf.id = new.remote_fetch_request_id
      and rf.workspace_id = new.workspace_id
      and rf.status = 'fetched'
      and rf.response_sha256 = new.source_sha256
  ) then
    raise exception 'research quarantine scope is invalid' using errcode = '40001';
  end if;
  return new;
end;
$$;

drop trigger if exists quarantine_asset_scope_guard on private.quarantine_assets;
create trigger quarantine_asset_scope_guard
before insert on private.quarantine_assets
for each row execute function private.guard_quarantine_asset_scope();

alter table private.media_ingest_attestations
  add column disposition text not null default 'accepted'
    check (disposition in ('accepted','rejected'));

do $$
declare constraint_name text;
begin
  select c.conname into constraint_name
  from pg_catalog.pg_constraint c
  where c.conrelid = 'private.media_ingest_attestations'::regclass
    and c.contype = 'c'
    and pg_catalog.pg_get_constraintdef(c.oid) like '%magic_mime = reencoded_mime%';
  if constraint_name is not null then
    execute pg_catalog.format(
      'alter table private.media_ingest_attestations drop constraint %I',
      constraint_name
    );
  end if;
end;
$$;
alter table private.media_ingest_attestations
  add constraint media_ingest_mime_disposition_check check (
    disposition = 'rejected' or magic_mime = reencoded_mime
  );

create or replace function public.command_record_ingest_attestation(
  p_workspace_id uuid,
  p_quarantine_asset_version_id uuid,
  p_policy_version_id uuid,
  p_scan_engine text,
  p_scan_version text,
  p_malware_status text,
  p_parser_sandboxed boolean,
  p_metadata_stripped boolean,
  p_magic_mime text,
  p_reencoded_mime text,
  p_decompressed_bytes bigint,
  p_width integer,
  p_height integer,
  p_duration_ms bigint,
  p_frame_count bigint,
  p_probe_sha256 text,
  p_output_sha256 text,
  p_output_byte_length bigint,
  p_scanner_task_id text,
  p_scanner_task_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare attestation_id uuid; quarantine private.quarantine_assets%rowtype;
  accepted boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  select * into quarantine from private.quarantine_assets
  where id = p_quarantine_asset_version_id and workspace_id = p_workspace_id
    and state in ('quarantined','scanning') for update;
  if not found then raise exception 'quarantine asset is not scannable' using errcode = 'P0002'; end if;
  accepted := p_magic_mime = quarantine.declared_mime
    and p_magic_mime = p_reencoded_mime
    and p_malware_status = 'clean'
    and p_parser_sandboxed and p_metadata_stripped;
  insert into private.media_ingest_attestations (
    workspace_id, quarantine_asset_version_id, schema_version,
    policy_version_id, scan_engine, scan_version, malware_status,
    parser_sandboxed, metadata_stripped, magic_mime, reencoded_mime,
    decompressed_bytes, width, height, duration_ms, frame_count,
    probe_sha256, output_sha256, output_byte_length, scanner_task_id,
    scanner_task_version, disposition
  ) values (
    p_workspace_id, quarantine.id, 'genie.ingest-attestation.v1',
    p_policy_version_id, p_scan_engine, p_scan_version, p_malware_status,
    p_parser_sandboxed, p_metadata_stripped, p_magic_mime, p_reencoded_mime,
    p_decompressed_bytes, p_width, p_height, p_duration_ms, p_frame_count,
    p_probe_sha256, p_output_sha256, p_output_byte_length, p_scanner_task_id,
    p_scanner_task_version, case when accepted then 'accepted' else 'rejected' end
  ) returning id into attestation_id;
  update private.quarantine_assets
  set state = case when accepted then 'scanning'::private.quarantine_asset_state
        else 'rejected'::private.quarantine_asset_state end,
      completed_at = case when accepted then null else statement_timestamp() end
  where id = quarantine.id;
  return attestation_id;
end;
$$;

create or replace function private.guard_promoted_asset_storage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = new.bucket_id
      and o.name = new.object_name
      and o.version = new.storage_version
      and (o.metadata ->> 'size')::bigint = new.byte_length
      and o.metadata ->> 'mimetype' = new.media_mime
      and o.user_metadata ->> 'sha256' = new.content_sha256
  ) then
    raise exception 'promoted storage object is not hash-bound'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists promoted_asset_storage_guard on public.asset_versions;
create trigger promoted_asset_storage_guard
before insert on public.asset_versions
for each row execute function private.guard_promoted_asset_storage();

revoke all on function private.cascade_preflight_terminal_state(),
  private.guard_micro_quote_line(), private.guard_provider_request_scope(),
  private.guard_broker_assertion_scope(),
  private.guard_remote_fetch_allowlist_mutation(),
  private.guard_quarantine_asset_scope(), private.guard_promoted_asset_storage()
from public, anon, authenticated;

-- Service-only MVP bridge for Vercel-hosted preflight dispatch.

create or replace function public.command_consume_mvp_provider_authority(
  p_provider_request_id uuid,
  p_capability_grant_id uuid,
  p_capability_jti uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request private.provider_requests%rowtype;
  grant_row private.worker_capability_grants%rowtype;
  claim private.provider_request_quote_claims%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into request from private.provider_requests
  where id = p_provider_request_id for update;
  select * into grant_row from private.worker_capability_grants
  where id = p_capability_grant_id and provider_request_id = request.id for update;
  select * into claim from private.provider_request_quote_claims
  where provider_request_id = request.id;
  if request.state <> 'reserved' or grant_row.state <> 'active'
    or grant_row.expires_at <= statement_timestamp()
    or grant_row.token_jti_hash <> encode(
      extensions.digest(convert_to(p_capability_jti::text, 'UTF8'), 'sha256'), 'hex'
    )
    or grant_row.workspace_id <> request.workspace_id
    or grant_row.preflight_run_id <> request.preflight_run_id
    or grant_row.stage_attempt_id <> request.stage_attempt_id
    or grant_row.capability <> request.operation
    or grant_row.input_manifest_hash <> request.input_manifest_hash
    or grant_row.micro_quote_line_id <> claim.micro_quote_line_id
    or grant_row.authority_epoch <> claim.authority_epoch
    or grant_row.fencing_token <> claim.fencing_token
    or not exists (
      select 1 from public.preflight_stage_attempts attempt
      join public.preflight_stage_runs stage on stage.id = attempt.preflight_stage_run_id
      join public.preflight_runs run on run.id = attempt.preflight_run_id
      where attempt.id = request.stage_attempt_id
        and attempt.state in ('running','waiting_external')
        and attempt.authority_epoch = grant_row.authority_epoch
        and attempt.fencing_token = grant_row.fencing_token
        and stage.highest_fencing_token = attempt.fencing_token
        and run.authority_epoch = attempt.authority_epoch
        and run.state in ('running','waiting_external')
    )
  then
    raise exception 'MVP provider authority is stale' using errcode = '40001';
  end if;
  update private.worker_capability_grants
  set state = 'consumed', consumed_at = statement_timestamp()
  where id = grant_row.id;
  update private.provider_requests
  set state = 'queued', aggregate_version = aggregate_version + 1
  where id = request.id returning * into request;
  insert into private.outbox_events(
    workspace_id, event_type, destination, payload_json, idempotency_key
  ) values (
    request.workspace_id, 'provider.request.queued', 'vercel.mvp-preflight',
    jsonb_build_object(
      'providerRequestId', request.id,
      'capabilityGrantId', grant_row.id,
      'preflightRunId', request.preflight_run_id,
      'stageAttemptId', request.stage_attempt_id
    ),
    'mvp-provider-request:' || request.id::text || ':queued'
  );
  return jsonb_build_object(
    'ok', true,
    'providerRequestId', request.id,
    'state', request.state,
    'aggregateVersion', request.aggregate_version
  );
end;
$$;

revoke all on function public.command_consume_mvp_provider_authority(uuid,uuid,uuid)
from public, anon, authenticated;
grant execute on function public.command_consume_mvp_provider_authority(uuid,uuid,uuid)
to service_role;

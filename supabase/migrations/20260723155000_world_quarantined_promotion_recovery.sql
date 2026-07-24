-- A serverless worker can finish quarantine, scanning, attestation, and the
-- immutable storage upload immediately before its runtime expires. Expose only
-- exact, authority-current receipts so the next cron invocation can finish the
-- atomic World promotion without downloading or scanning the same bytes again.

create or replace function public.get_next_world_promotion_recovery()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  recovery record;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  select
    candidate.id as candidate_id,
    candidate.workspace_id,
    candidate.provider_request_id,
    candidate.quarantine_asset_version_id,
    attestation.id as ingest_attestation_id,
    case
      when job.entity_kind = 'character' then 'character_anchor'
      else 'location_anchor'
    end as asset_kind,
    split_part(object.name, '/', 4)::uuid as asset_version_id,
    object.name as final_object_name,
    object.version as storage_version
  into recovery
  from private.provider_output_candidates candidate
  join private.quarantine_assets quarantine
    on quarantine.id = candidate.quarantine_asset_version_id
   and quarantine.workspace_id = candidate.workspace_id
   and quarantine.provider_request_id = candidate.provider_request_id
   and quarantine.state = 'scanning'
  join private.media_ingest_attestations attestation
    on attestation.quarantine_asset_version_id = quarantine.id
   and attestation.malware_status = 'clean'
   and attestation.parser_sandboxed
   and attestation.metadata_stripped
   and attestation.reencoded_mime = attestation.magic_mime
  join private.world_anchor_jobs job
    on job.provider_request_id = candidate.provider_request_id
   and job.workspace_id = candidate.workspace_id
   and job.target_asset_id = quarantine.stable_asset_id
   and job.state = 'waiting_output'
  join private.provider_requests request
    on request.id = candidate.provider_request_id
   and request.state = 'polling'
  join private.provider_request_quote_claims quote_claim
    on quote_claim.provider_request_id = request.id
  join public.preflight_stage_attempts stage_attempt
    on stage_attempt.id = request.stage_attempt_id
   and stage_attempt.preflight_run_id = request.preflight_run_id
   and stage_attempt.state = 'waiting_external'
   and stage_attempt.fencing_token = quote_claim.fencing_token
   and stage_attempt.authority_epoch = quote_claim.authority_epoch
  join public.preflight_stage_runs stage
    on stage.id = stage_attempt.preflight_stage_run_id
   and stage.state = 'waiting_external'
   and stage.highest_fencing_token = stage_attempt.fencing_token
  join public.preflight_runs run
    on run.id = request.preflight_run_id
   and run.kind = 'world_anchor'
   and run.state = 'waiting_external'
   and run.authority_epoch = stage_attempt.authority_epoch
  join lateral (
    select stored.name, stored.version
    from storage.objects stored
    where stored.bucket_id = 'workspace-media'
      and split_part(stored.name, '/', 1) = candidate.workspace_id::text
      and split_part(stored.name, '/', 2) = case
        when job.entity_kind = 'character' then 'character_anchor'
        else 'location_anchor'
      end
      and split_part(stored.name, '/', 3) = quarantine.stable_asset_id::text
      and split_part(stored.name, '/', 4) ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and split_part(stored.name, '/', 5) = 'source'
      and array_length(string_to_array(stored.name, '/'), 1) = 5
      and stored.version is not null
      and stored.user_metadata ->> 'sha256' = attestation.output_sha256
      and stored.metadata ->> 'mimetype' = attestation.reencoded_mime
      and stored.created_at >= attestation.created_at
    order by stored.created_at desc
    limit 1
  ) object on true
  where candidate.state = 'quarantined'
    and not exists (
      select 1
      from public.asset_versions promoted
      where promoted.source_quarantine_version_id = quarantine.id
    )
  order by candidate.created_at
  limit 1;

  return jsonb_build_object(
    'ok', true,
    'empty', recovery.candidate_id is null,
    'candidateId', recovery.candidate_id,
    'workspaceId', recovery.workspace_id,
    'providerRequestId', recovery.provider_request_id,
    'quarantineAssetVersionId', recovery.quarantine_asset_version_id,
    'ingestAttestationId', recovery.ingest_attestation_id,
    'assetKind', recovery.asset_kind,
    'assetVersionId', recovery.asset_version_id,
    'finalObjectName', recovery.final_object_name,
    'storageVersion', recovery.storage_version
  );
end;
$$;

revoke all on function public.get_next_world_promotion_recovery()
from public, anon, authenticated;
grant execute on function public.get_next_world_promotion_recovery()
to service_role;

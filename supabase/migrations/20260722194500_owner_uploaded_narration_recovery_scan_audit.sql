-- Preserve an immutable, idempotent receipt for current-scanner revalidation of
-- a retained owner-narration attestation. Scanner identity drift is evidence,
-- not a media-integrity conflict, when every deterministic media binding agrees.

create or replace function public.command_record_episode_narration_upload_recovery_scan(
  p_workspace_id uuid,
  p_upload_version_id uuid,
  p_attestation_id uuid,
  p_recovery_scan_id uuid,
  p_scan_engine text,
  p_scan_version text,
  p_scanner_identity_drift boolean,
  p_source_sha256 text,
  p_source_byte_length bigint,
  p_sanitized_sha256 text,
  p_sanitized_byte_length bigint,
  p_decompressed_bytes bigint,
  p_duration_ms integer,
  p_probe_sha256 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  upload public.episode_narration_upload_versions%rowtype;
  attestation private.episode_narration_upload_attestations%rowtype;
  evidence jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_upload_version_id;

  select * into attestation
  from private.episode_narration_upload_attestations candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.upload_version_id = p_upload_version_id
    and candidate.id = p_attestation_id;

  if upload.id is null
    or upload.state not in ('prepared', 'verified')
    or attestation.id is null
    or p_scan_engine is null
    or p_scan_engine !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$'
    or p_scan_version is null
    or char_length(p_scan_version) not between 1 and 100
    or p_scanner_identity_drift is distinct from (
      attestation.scan_engine is distinct from p_scan_engine
      or attestation.scan_version is distinct from p_scan_version
    )
    or attestation.source_sha256 is distinct from p_source_sha256
    or attestation.source_byte_length is distinct from p_source_byte_length
    or attestation.sanitized_sha256 is distinct from p_sanitized_sha256
    or attestation.sanitized_byte_length is distinct from p_sanitized_byte_length
    or attestation.decompressed_bytes is distinct from p_decompressed_bytes
    or attestation.duration_ms is distinct from p_duration_ms
    or attestation.probe_sha256 is distinct from p_probe_sha256
  then
    raise exception 'narration recovery scan evidence conflicts'
      using errcode = '22023';
  end if;

  evidence := jsonb_build_object(
    'schemaVersion', 'genie.owner-narration-recovery-scan.v1',
    'attestationId', attestation.id,
    'retainedScanEngine', attestation.scan_engine,
    'retainedScanVersion', attestation.scan_version,
    'currentScanEngine', p_scan_engine,
    'currentScanVersion', p_scan_version,
    'scannerIdentityDrift', p_scanner_identity_drift,
    'sourceSha256', p_source_sha256,
    'sourceByteLength', p_source_byte_length,
    'sanitizedSha256', p_sanitized_sha256,
    'sanitizedByteLength', p_sanitized_byte_length,
    'decompressedBytes', p_decompressed_bytes,
    'durationMs', p_duration_ms,
    'probeSha256', p_probe_sha256
  );

  insert into audit.events (
    id,
    workspace_id,
    actor_kind,
    actor_user_id,
    actor_principal,
    membership_role,
    session_id,
    aal,
    command_id,
    idempotency_key,
    action,
    target_type,
    target_id,
    target_version,
    permission_decision,
    prior_hash,
    new_hash,
    reason,
    correlation_id,
    causation_id,
    outcome,
    safe_metadata
  ) values (
    p_recovery_scan_id,
    p_workspace_id,
    'service',
    null,
    'service:narration-upload-processor',
    null,
    null,
    null,
    null,
    'narration-upload-recovery-scan:' || p_recovery_scan_id::text,
    'narration_upload.recovery_scan_revalidated',
    'episode_narration_upload_version',
    p_upload_version_id,
    upload.state_version,
    'system',
    null,
    null,
    case when p_scanner_identity_drift
      then 'Current scanner identity differs from the retained attestation.'
      else null
    end,
    p_recovery_scan_id,
    null,
    'accepted',
    evidence
  )
  on conflict (id) do nothing;

  if not exists (
    select 1
    from audit.events recorded
    where recorded.id = p_recovery_scan_id
      and recorded.workspace_id = p_workspace_id
      and recorded.actor_kind = 'service'
      and recorded.actor_principal = 'service:narration-upload-processor'
      and recorded.action = 'narration_upload.recovery_scan_revalidated'
      and recorded.target_type = 'episode_narration_upload_version'
      and recorded.target_id = p_upload_version_id
      and recorded.target_version = upload.state_version
      and recorded.permission_decision = 'system'
      and recorded.correlation_id = p_recovery_scan_id
      and recorded.outcome = 'accepted'
      and recorded.safe_metadata = evidence
  ) then
    raise exception 'narration recovery scan audit identity conflicts'
      using errcode = '40001';
  end if;

  return p_recovery_scan_id;
end;
$$;

revoke all on function public.command_record_episode_narration_upload_recovery_scan(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  boolean,
  text,
  bigint,
  text,
  bigint,
  bigint,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.command_record_episode_narration_upload_recovery_scan(
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  text,
  boolean,
  text,
  bigint,
  text,
  bigint,
  bigint,
  integer,
  text
) to service_role;

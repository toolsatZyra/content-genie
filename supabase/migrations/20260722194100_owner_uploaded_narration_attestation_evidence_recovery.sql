-- Return the immutable owner-narration attestation envelope needed to resume an
-- interrupted promotion without repeating external transcription.

create or replace function public.get_episode_narration_upload_processing_state(
  p_workspace_id uuid,
  p_upload_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  upload public.episode_narration_upload_versions%rowtype;
  attestation private.episode_narration_upload_attestations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  select * into upload
  from public.episode_narration_upload_versions candidate
  where candidate.workspace_id = p_workspace_id
    and candidate.id = p_upload_version_id;
  if upload.id is null then
    raise exception 'narration upload not found' using errcode = 'P0002';
  end if;

  select * into attestation
  from private.episode_narration_upload_attestations evidence
  where evidence.workspace_id = p_workspace_id
    and evidence.upload_version_id = p_upload_version_id;

  return jsonb_build_object(
    'uploadVersionId', upload.id,
    'state', upload.state,
    'stateVersion', upload.state_version,
    'promotedAssetVersionId', upload.promoted_asset_version_id,
    'attestation', case
      when attestation.id is null then null
      else jsonb_build_object(
        'id', attestation.id,
        'policyVersionId', attestation.policy_version_id,
        'quarantineAssetVersionId', attestation.quarantine_asset_version_id,
        'scanEngine', attestation.scan_engine,
        'scanVersion', attestation.scan_version,
        'sourceMime', attestation.source_mime,
        'sanitizedMime', attestation.sanitized_mime,
        'sourceSha256', attestation.source_sha256,
        'sanitizedSha256', attestation.sanitized_sha256,
        'sourceByteLength', attestation.source_byte_length,
        'sanitizedByteLength', attestation.sanitized_byte_length,
        'decompressedBytes', attestation.decompressed_bytes,
        'durationMs', attestation.duration_ms,
        'probeSha256', attestation.probe_sha256,
        'transcriptionText', attestation.transcription_text,
        'transcriptionSha256', attestation.transcription_sha256,
        'alignmentJson', attestation.alignment_json,
        'alignmentHash', attestation.alignment_hash,
        'scriptComparisonJson', attestation.script_comparison_json,
        'scriptComparisonHash', attestation.script_comparison_hash,
        'qualityEvidence', attestation.quality_evidence,
        'qualityEvidenceHash', attestation.quality_evidence_hash
      )
    end
  );
end;
$$;

revoke all on function public.get_episode_narration_upload_processing_state(
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.get_episode_narration_upload_processing_state(
  uuid,
  uuid
) to service_role;

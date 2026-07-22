-- Retain the exact upload-processing identities needed to recover an interrupted
-- owner-narration attestation/promotion without minting conflicting authority.

create index if not exists episode_narration_upload_current_pending_idx
  on public.episode_narration_upload_versions (
    workspace_id,
    configuration_candidate_id,
    version_number desc
  )
  where state in ('prepared', 'verified');

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
    'attestationId', attestation.id,
    'attestationPolicyVersionId', attestation.policy_version_id
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

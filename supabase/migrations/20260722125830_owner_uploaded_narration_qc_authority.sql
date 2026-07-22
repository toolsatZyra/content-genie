-- Generated narration retains the independent ASR/judge QC contract. For an
-- owner upload, the confirmed asset and its immutable technical/transcription
-- evidence are the corresponding authority; script comparison stays advisory.
create or replace function private.require_verified_narration_qc_for_clock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source_kind = 'uploaded_audio' then
    if not exists (
      select 1
      from public.episode_narration_upload_versions upload
      where upload.workspace_id = new.workspace_id
        and upload.id = new.narration_upload_version_id
        and upload.state = 'confirmed'
        and upload.promoted_asset_version_id = new.narration_asset_version_id
        and upload.quality_evidence_hash = new.audio_evidence_hash
        and upload.quality_evidence ->> 'schemaVersion' =
          'genie.owner-narration-quality-evidence.v1'
        and upload.quality_evidence ->> 'ownerConfirmationRequired' = 'true'
        and upload.quality_evidence ->> 'scriptComparisonAdvisoryOnly' = 'true'
    ) then
      raise exception 'confirmed owner narration quality evidence is required'
        using errcode = '40001';
    end if;
    return new;
  end if;
  if not exists (
    select 1
    from private.narration_qc_runs qc
    where qc.workspace_id = new.workspace_id
      and qc.narration_asset_version_id = new.narration_asset_version_id
      and qc.state = 'verified'
      and qc.final_audio_evidence_hash = new.audio_evidence_hash
  ) then
    raise exception 'verified independent narration QC is required'
      using errcode = '40001';
  end if;
  return new;
end;
$$;

revoke all on function private.require_verified_narration_qc_for_clock()
from public, anon, authenticated;

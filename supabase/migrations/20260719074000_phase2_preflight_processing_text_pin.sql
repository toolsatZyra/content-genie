-- Narration uses the immutable LF/NFC processing sidecar and its scalar map;
-- the raw browser bytes remain separately pinned and are never overwritten.

create or replace function public.get_preflight_control_execution_input(
  p_stage_attempt_id uuid,
  p_authority_epoch bigint,
  p_fencing_token bigint,
  p_input_manifest_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  script public.script_revisions%rowtype;
  config public.episode_configuration_candidates%rowtype;
  look public.look_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into attempt from public.preflight_stage_attempts
  where id=p_stage_attempt_id;
  select * into stage from public.preflight_stage_runs
  where id=attempt.preflight_stage_run_id;
  select * into run from public.preflight_runs where id=attempt.preflight_run_id;
  if attempt.id is null or stage.id is null or run.id is null
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch<>p_authority_epoch
    or attempt.fencing_token<>p_fencing_token
    or attempt.input_manifest_hash<>p_input_manifest_hash
    or stage.highest_fencing_token<>p_fencing_token
    or run.authority_epoch<>p_authority_epoch
    or run.state<>'running'
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=p_fencing_token
        and lease.expires_at>statement_timestamp())
  then raise exception 'preflight execution authority is stale' using errcode='40001'; end if;
  select * into script from public.script_revisions where id=run.script_revision_id;
  select * into config from public.episode_configuration_candidates
    where id=run.configuration_candidate_id;
  select * into look from public.look_versions where id=config.look_version_id;
  if script.id is null or config.id is null or look.id is null
    or config.script_revision_id<>script.id
    or config.look_confirmed_at is null or config.voice_confirmed_at is null
    or not exists(select 1 from public.script_lock_events lock
      where lock.script_revision_id=script.id and lock.raw_utf8_sha256=script.raw_utf8_sha256)
  then raise exception 'preflight execution source is stale' using errcode='40001'; end if;
  return jsonb_build_object(
    'configurationCandidateId',config.id,
    'kind',run.kind,
    'lookKey',look.look_key,
    'lookVersionId',look.id,
    'lockedLookBlockSha256',look.locked_look_block_sha256,
    'narratorGender',config.narrator_gender,
    'preflightRunId',run.id,
    'processingScalarCount',script.processing_scalar_count,
    'processingText',script.processing_text,
    'processingTextSha256',script.processing_utf8_sha256,
    'rawScript',script.raw_text,
    'rawScriptSha256',script.raw_utf8_sha256,
    'scriptRevisionId',script.id,
    'voiceVersionId',config.voice_version_id,
    'workspaceId',run.workspace_id
  );
end;
$$;

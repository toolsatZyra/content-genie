-- Reuse an immutable World extraction across fenced retries of the same run.
-- A new attempt may proceed only when it carries the exact same input manifest
-- and authority epoch as the attempt that recorded the extraction.

create or replace function public.get_world_extraction_replay_result(
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
  result private.world_extraction_results%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id;
  select * into stage from public.preflight_stage_runs
    where id=attempt.preflight_stage_run_id;
  if attempt.id is null or stage.id is null
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch<>p_authority_epoch
    or attempt.fencing_token<>p_fencing_token
    or stage.highest_fencing_token<>p_fencing_token
    or attempt.input_manifest_hash<>p_input_manifest_hash
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=p_fencing_token
        and lease.expires_at>statement_timestamp())
  then raise exception 'world extraction replay authority is stale' using errcode='40001'; end if;

  select extraction.* into result
  from private.world_extraction_results extraction
  join public.preflight_stage_attempts source_attempt
    on source_attempt.id=extraction.stage_attempt_id
  where extraction.workspace_id=attempt.workspace_id
    and extraction.preflight_run_id=attempt.preflight_run_id
    and source_attempt.preflight_run_id=attempt.preflight_run_id
    and source_attempt.authority_epoch=attempt.authority_epoch
    and source_attempt.input_manifest_hash=attempt.input_manifest_hash
  order by extraction.created_at
  limit 1;
  if result.id is null then return null; end if;
  return jsonb_build_object(
    'extractionHash',result.extraction_hash,
    'extractionJson',result.extraction_json,
    'resultId',result.id
  );
end;
$$;

revoke all on function public.get_world_extraction_replay_result(
  uuid,bigint,bigint,text
) from public,anon,authenticated;
grant execute on function public.get_world_extraction_replay_result(
  uuid,bigint,bigint,text
) to service_role;

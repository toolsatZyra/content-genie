-- Resume a completed immutable extraction without paying the model twice when
-- the final stage-output acknowledgement is retried after a transport failure.

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
  select * into result from private.world_extraction_results
    where stage_attempt_id=attempt.id;
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

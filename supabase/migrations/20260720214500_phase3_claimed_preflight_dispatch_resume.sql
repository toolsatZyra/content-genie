-- An inline worker can disappear after claiming a stage but before provider
-- submission. Requeue only the run control row, retain the exact live lease,
-- and let the durable dispatcher resume the same immutable attempt.

drop function if exists public.command_adopt_world_anchor_preparation_retry(
  uuid, uuid, uuid
);

create or replace function public.command_requeue_claimed_preflight_control(
  p_preflight_run_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.preflight_runs%rowtype;
  stage public.preflight_stage_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into run from public.preflight_runs
  where id = p_preflight_run_id for update;
  select * into stage from public.preflight_stage_runs
  where preflight_run_id = run.id and state = 'claimed'
  order by created_at limit 1 for update;
  select * into attempt from public.preflight_stage_attempts
  where preflight_stage_run_id = stage.id
    and fencing_token = stage.highest_fencing_token
  for update;
  if run.id is null
    or run.aggregate_version <> p_expected_version
    or run.state <> 'running'
    or stage.id is null
    or attempt.id is null
    or attempt.state <> 'claimed'
    or attempt.authority_epoch <> run.authority_epoch
    or not exists (
      select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id = attempt.id
        and lease.fencing_token = attempt.fencing_token
        and lease.state = 'active'
        and lease.expires_at > statement_timestamp()
    )
  then
    raise exception 'claimed preflight recovery is stale' using errcode = '40001';
  end if;
  update public.preflight_runs
  set state = 'queued', trigger_run_id = null,
      aggregate_version = aggregate_version + 1
  where id = run.id returning * into run;
  return jsonb_build_object(
    'ok', true, 'preflightRunId', run.id, 'state', run.state,
    'aggregateVersion', run.aggregate_version
  );
end;
$$;

do $migration$
declare
  function_definition text;
  rewritten text;
  needle text := E'\n  if run.state<>\'queued\' then';
  replacement text := E'\n  if run.state=\'queued\' then\n'
    || E'    select * into stage from public.preflight_stage_runs\n'
    || E'    where preflight_run_id=run.id and state in (\'claimed\',\'running\')\n'
    || E'    order by created_at limit 1;\n'
    || E'    if stage.id is not null then\n'
    || E'      select claimed.id into attempt_id from public.preflight_stage_attempts claimed\n'
    || E'      where claimed.preflight_stage_run_id=stage.id\n'
    || E'        and claimed.fencing_token=stage.highest_fencing_token\n'
    || E'        and claimed.state in (\'claimed\',\'running\')\n'
    || E'        and claimed.authority_epoch=run.authority_epoch;\n'
    || E'      select active_lease.id into lease_id from public.preflight_stage_leases active_lease\n'
    || E'      where active_lease.stage_attempt_id=attempt_id\n'
    || E'        and active_lease.state=\'active\'\n'
    || E'        and active_lease.fencing_token=stage.highest_fencing_token\n'
    || E'        and active_lease.expires_at>statement_timestamp();\n'
    || E'      if attempt_id is null or lease_id is null then\n'
    || E'        raise exception \'claimed preflight recovery lost authority\' using errcode=\'40001\';\n'
    || E'      end if;\n'
    || E'      update public.preflight_runs set state=\'running\',trigger_run_id=p_trigger_run_id,\n'
    || E'        aggregate_version=aggregate_version+1,started_at=coalesce(started_at,statement_timestamp())\n'
    || E'        where id=run.id returning * into run;\n'
    || E'      return jsonb_build_object(\n'
    || E'        \'ok\',true,\'replayed\',true,\'workspaceId\',run.workspace_id,\n'
    || E'        \'preflightRunId\',run.id,\'stageRunId\',stage.id,\'stageAttemptId\',attempt_id,\n'
    || E'        \'leaseId\',lease_id,\'authorityEpoch\',run.authority_epoch,\n'
    || E'        \'fencingToken\',stage.highest_fencing_token,\'inputManifestId\',stage.input_manifest_id,\n'
    || E'        \'inputManifestSha256\',stage.input_manifest_hash,\'kind\',run.kind\n'
    || E'      );\n'
    || E'    end if;\n'
    || E'  end if;\n'
    || E'  if run.state<>\'queued\' then';
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_dispatch_preflight_control(uuid,text,text,integer)'::regprocedure
  ) into function_definition;
  rewritten := replace(function_definition, needle, replacement);
  if rewritten = function_definition
    or rewritten not like '%claimed preflight recovery lost authority%'
  then
    raise exception 'preflight dispatcher predecessor is unexpected';
  end if;
  execute rewritten;
end;
$migration$;

revoke all on function public.command_requeue_claimed_preflight_control(uuid,bigint)
from public, anon, authenticated;
grant execute on function public.command_requeue_claimed_preflight_control(uuid,bigint)
to service_role;

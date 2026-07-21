-- ElevenLabs may return and secure-ingest may claim its exact output before
-- the orchestrator records the external-wait transition. Preserve the same
-- fenced attempt while accepting those later, already-bound job states.

create or replace function public.command_mark_world_anchor_waiting_external(
  p_preflight_run_id uuid,p_stage_attempt_id uuid,p_trigger_task_id text,p_trigger_run_id text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=p_stage_attempt_id and preflight_run_id=run.id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  if run.state='waiting_external' and attempt.state='waiting_external' then
    return jsonb_build_object('ok',true,'replayed',true,'state','waiting_external');
  end if;
  if run.state<>'running' or attempt.state<>'claimed' or stage.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch or attempt.fencing_token<>stage.highest_fencing_token
    or (run.kind='world_anchor' and exists(select 1 from private.world_anchor_jobs job
      where job.preflight_run_id=run.id and (job.provider_request_id is null or job.state<>'dispatching')))
    or (run.kind='narration_clock' and not exists(select 1 from private.narration_generation_jobs job
      where job.preflight_run_id=run.id and job.stage_attempt_id=attempt.id
        and job.provider_request_id is not null and job.capability_grant_id is not null
        and job.state in ('dispatching','quarantined','scanning')))
    or run.kind not in ('world_anchor','narration_clock')
  then raise exception 'provider external wait is stale' using errcode='40001'; end if;
  update public.preflight_stage_attempts set state='waiting_external',trigger_task_id=p_trigger_task_id,
    trigger_run_id=p_trigger_run_id,started_at=coalesce(started_at,statement_timestamp()) where id=attempt.id;
  update public.preflight_stage_leases set state='consumed',closed_at=statement_timestamp()
    where stage_attempt_id=attempt.id and state='active';
  update public.preflight_stage_runs set state='waiting_external',aggregate_version=aggregate_version+1 where id=stage.id;
  update public.preflight_runs set state='waiting_external',reconciliation_due_at=statement_timestamp()+interval '5 minutes',
    aggregate_version=aggregate_version+1 where id=run.id;
  if run.kind='world_anchor' then
    update private.world_anchor_jobs set state='waiting_output'
      where preflight_run_id=run.id and state='dispatching';
  end if;
  return jsonb_build_object('ok',true,'replayed',false,'state','waiting_external');
end;
$$;

revoke all on function public.command_mark_world_anchor_waiting_external(uuid,uuid,text,text)
from public,anon,authenticated;
grant execute on function public.command_mark_world_anchor_waiting_external(uuid,uuid,text,text)
to service_role;

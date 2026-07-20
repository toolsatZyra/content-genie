-- Bind every plan-director and blind-evaluator model request to the exact live
-- preflight authority before network I/O, then append a terminal successor.

alter table private.agent_tool_calls
  drop constraint agent_tool_calls_maximum_duration_ms_check,
  add constraint agent_tool_calls_maximum_duration_ms_check
    check(maximum_duration_ms between 1 and 180000);

create or replace function public.command_record_agent_model_call(
  p_workspace_id uuid,p_episode_id uuid,p_configuration_candidate_id uuid,
  p_script_revision_id uuid,p_policy_version_id uuid,p_preflight_run_id uuid,
  p_stage_attempt_id uuid,p_tool_name text,p_trusted_scope_hash text,
  p_arguments_hash text,p_source_set_hash text,p_maximum_fan_out integer,
  p_maximum_depth integer,p_maximum_tokens integer,p_maximum_duration_ms integer,
  p_maximum_result_bytes integer,p_model_version text,p_prompt_hash text
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare call_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_tool_name not in ('story.plan','shot.plan','edd.plan','plan.evaluate')
    or p_trusted_scope_hash !~ '^[a-f0-9]{64}$'
    or p_arguments_hash !~ '^[a-f0-9]{64}$'
    or p_source_set_hash !~ '^[a-f0-9]{64}$'
    or p_prompt_hash !~ '^[a-f0-9]{64}$'
    or p_maximum_fan_out not between 1 and 3
    or p_maximum_depth<>1
    or p_maximum_tokens not between 256 and 16000
    or p_maximum_duration_ms<>180000
    or p_maximum_result_bytes<>131072
    or p_model_version not in ('gpt-5.6-sol','gpt-5.6-terra')
  then raise exception 'agent model-call envelope is invalid' using errcode='22023'; end if;
  if not exists(
    select 1 from public.preflight_stage_attempts attempt
    join public.preflight_runs run on run.id=attempt.preflight_run_id
      and run.workspace_id=attempt.workspace_id
    join public.preflight_stage_runs stage on stage.id=attempt.preflight_stage_run_id
      and stage.preflight_run_id=run.id
    join public.preflight_stage_leases lease on lease.stage_attempt_id=attempt.id
      and lease.workspace_id=attempt.workspace_id
      and lease.preflight_run_id=attempt.preflight_run_id
    where attempt.id=p_stage_attempt_id and attempt.workspace_id=p_workspace_id
      and attempt.preflight_run_id=p_preflight_run_id
      and attempt.state in ('claimed','running')
      and run.kind='plan_evaluation' and run.state='running'
      and run.episode_id=p_episode_id
      and run.configuration_candidate_id=p_configuration_candidate_id
      and run.script_revision_id=p_script_revision_id
      and run.authority_epoch=attempt.authority_epoch
      and stage.highest_fencing_token=attempt.fencing_token
      and lease.fencing_token=attempt.fencing_token and lease.state='active'
      and lease.expires_at>statement_timestamp()
      and exists(select 1 from public.source_review_packets packet
        where packet.policy_version_id=p_policy_version_id
          and packet.configuration_candidate_id=p_configuration_candidate_id
          and packet.script_revision_id=p_script_revision_id
          and packet.workspace_id=p_workspace_id)
  ) then raise exception 'agent model-call authority is stale' using errcode='40001'; end if;
  insert into private.agent_tool_calls(
    workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    policy_version_id,preflight_run_id,stage_attempt_id,tool_name,
    classification,trusted_scope_hash,arguments_hash,source_set_hash,
    schema_version,maximum_fan_out,maximum_depth,maximum_tokens,
    maximum_duration_ms,maximum_result_bytes,maximum_cost_minor,
    model_family,model_version,prompt_hash,status
  ) values(
    p_workspace_id,p_episode_id,p_configuration_candidate_id,p_script_revision_id,
    p_policy_version_id,p_preflight_run_id,p_stage_attempt_id,
    p_tool_name::private.agent_tool_name,'read_only',p_trusted_scope_hash,
    p_arguments_hash,p_source_set_hash,'genie.restricted-tools.v1',
    p_maximum_fan_out,p_maximum_depth,p_maximum_tokens,p_maximum_duration_ms,
    p_maximum_result_bytes,0,'openai',p_model_version,p_prompt_hash,'authorized'
  ) returning id into call_id;
  return call_id;
end;
$$;

create or replace function public.command_reject_agent_model_call(
  p_tool_call_id uuid,p_arguments_hash text,p_failure_class text,
  p_safe_failure_summary jsonb
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
  prior private.agent_tool_calls%rowtype;
  completed private.agent_tool_calls%rowtype;
  summary_value jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_arguments_hash !~ '^[a-f0-9]{64}$'
    or p_failure_class not in ('configuration','contract','incomplete','provider','refusal','unknown')
    or p_safe_failure_summary is null or jsonb_typeof(p_safe_failure_summary)<>'object'
    or pg_column_size(p_safe_failure_summary)>16384
  then raise exception 'agent model-call failure is invalid' using errcode='22023'; end if;
  select * into prior from private.agent_tool_calls
    where id=p_tool_call_id and status='authorized';
  if prior.id is null or prior.arguments_hash<>p_arguments_hash
  then raise exception 'agent model-call failure is stale' using errcode='40001'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('agent-tool-complete:'||p_tool_call_id::text,0)
  );
  summary_value:=jsonb_build_object(
    'failureClass',p_failure_class,'evidence',p_safe_failure_summary
  );
  select * into completed from private.agent_tool_calls
    where authorization_call_id=prior.id;
  if completed.id is not null then
    if completed.status='rejected' and completed.arguments_hash=p_arguments_hash
      and completed.safe_result_summary=summary_value
    then return true; end if;
    raise exception 'agent model-call completion conflicts with prior result'
      using errcode='40001';
  end if;
  insert into private.agent_tool_calls(
    workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    policy_version_id,preflight_run_id,stage_attempt_id,tool_name,
    classification,trusted_scope_hash,arguments_hash,source_set_hash,
    schema_version,maximum_fan_out,maximum_depth,maximum_tokens,
    maximum_duration_ms,maximum_result_bytes,maximum_cost_minor,
    model_family,model_version,prompt_hash,status,safe_result_summary,completed_at,
    authorization_call_id
  ) select
    workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    policy_version_id,preflight_run_id,stage_attempt_id,tool_name,
    classification,trusted_scope_hash,arguments_hash,source_set_hash,
    schema_version,maximum_fan_out,maximum_depth,maximum_tokens,
    maximum_duration_ms,maximum_result_bytes,maximum_cost_minor,
    model_family,model_version,prompt_hash,'rejected',summary_value,
    statement_timestamp(),id
  from private.agent_tool_calls where id=p_tool_call_id;
  return true;
end;
$$;

revoke all on function public.command_record_agent_model_call(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,
  integer,integer,text,text
),public.command_reject_agent_model_call(uuid,text,text,jsonb)
from public,anon,authenticated;
grant execute on function public.command_record_agent_model_call(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,
  integer,integer,text,text
),public.command_reject_agent_model_call(uuid,text,text,jsonb)
to service_role;

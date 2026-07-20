-- Forward correction for preview environments that already received 0757:
-- rejected model calls use the same one-successor, retry-safe linkage as
-- successful restricted-tool completions.

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

revoke all on function public.command_reject_agent_model_call(uuid,text,text,jsonb)
from public,anon,authenticated;
grant execute on function public.command_reject_agent_model_call(uuid,text,text,jsonb)
to service_role;

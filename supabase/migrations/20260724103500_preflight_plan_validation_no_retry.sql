-- `40001` is reserved for transaction serialization failures. The plan
-- publisher historically used it for deterministic contract rejection, which
-- caused the Data API/proxy path to retry the whole JSON request until its
-- upstream timeout hid the useful validation message. Preserve the original
-- implementation and its function-local timeout behind a one-shot wrapper
-- that translates only those deterministic rejections to `22023`.

alter function public.command_record_preflight_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, numeric,
  numeric, numeric, numeric, jsonb, jsonb
)
rename to command_record_preflight_plan_retryable;

create function public.command_record_preflight_plan(
  p_plan_bundle_id uuid,
  p_workspace_id uuid,
  p_configuration_candidate_id uuid,
  p_preflight_run_id uuid,
  p_master_clock_version_id uuid,
  p_source_review_packet_id uuid,
  p_world_reference_pack_version_id uuid,
  p_plan_hash text,
  p_graph_hash text,
  p_projected_ovs numeric,
  p_projected_cvp numeric,
  p_projected_pfs numeric,
  p_projected_confidence numeric,
  p_evidence_density numeric,
  p_component_ids jsonb,
  p_plan jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
set statement_timeout = '30s'
as $$
declare
  validation_message text;
begin
  return public.command_record_preflight_plan_retryable(
    p_plan_bundle_id,
    p_workspace_id,
    p_configuration_candidate_id,
    p_preflight_run_id,
    p_master_clock_version_id,
    p_source_review_packet_id,
    p_world_reference_pack_version_id,
    p_plan_hash,
    p_graph_hash,
    p_projected_ovs,
    p_projected_cvp,
    p_projected_pfs,
    p_projected_confidence,
    p_evidence_density,
    p_component_ids,
    p_plan
  );
exception
  when serialization_failure then
    get stacked diagnostics validation_message = message_text;
    raise exception using
      errcode = '22023',
      message = validation_message;
end;
$$;

revoke all on function public.command_record_preflight_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, numeric,
  numeric, numeric, numeric, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.command_record_preflight_plan(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, numeric,
  numeric, numeric, numeric, jsonb, jsonb
) to service_role;

revoke all on function public.command_record_preflight_plan_retryable(
  uuid, uuid, uuid, uuid, uuid, uuid, uuid, text, text, numeric, numeric,
  numeric, numeric, numeric, jsonb, jsonb
) from public, anon, authenticated;


-- Migration 0759 originally rejected both stale repair authority and an
-- exhausted two-repair budget with the same serialization error. Return a
-- sealed terminal status for genuine exhaustion so the worker never mistakes
-- an operational failure for a quality decision.

create or replace function public.get_plan_repair_feedback(
  p_workspace_id uuid,p_preflight_run_id uuid,p_stage_attempt_id uuid,
  p_plan_bundle_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  bundle public.preflight_plan_bundles%rowtype;
  consensus private.preflight_plan_qc_consensus%rowtype;
  evaluator_value jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and workspace_id=p_workspace_id
      and preflight_run_id=p_preflight_run_id;
  select * into bundle from public.preflight_plan_bundles
    where id=p_plan_bundle_id and workspace_id=p_workspace_id
      and preflight_run_id=p_preflight_run_id;
  select * into consensus from private.preflight_plan_qc_consensus
    where plan_bundle_id=bundle.id and workspace_id=p_workspace_id;
  if attempt.id is null or attempt.state not in ('claimed','running')
    or bundle.id is null or bundle.state<>'blocked'
    or consensus.id is null or consensus.verdict='pass'
    or exists(select 1 from public.preflight_plan_bundles child
      where child.parent_plan_bundle_id=bundle.id)
    or not exists(select 1 from public.preflight_stage_runs stage
      where stage.id=attempt.preflight_stage_run_id
        and stage.highest_fencing_token=attempt.fencing_token)
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=attempt.fencing_token
        and lease.expires_at>statement_timestamp())
  then raise exception 'plan repair authority is stale' using errcode='40001'; end if;
  select jsonb_agg(jsonb_build_object(
    'evaluatorKey',evaluation.evaluator_key,'modelVersion',evaluation.model_version,
    'score',evaluation.score,'verdict',evaluation.verdict,'findings',evaluation.findings,
    'parameters',(select jsonb_agg(jsonb_build_object(
      'parameterId',parameter.parameter_id,'score',parameter.score,
      'applicabilityReason',parameter.applicability_reason
    ) order by parameter.parameter_id)
      from private.plan_evaluator_score_sets score_set
      join private.plan_evaluator_parameter_scores parameter
        on parameter.score_set_id=score_set.id
      where score_set.evaluator_record_id=evaluation.id)
  ) order by evaluation.evaluator_key) into evaluator_value
  from private.plan_evaluator_challenges challenge
  join private.plan_evaluator_score_sets score_set on score_set.challenge_id=challenge.id
  join private.evaluator_records evaluation on evaluation.id=score_set.evaluator_record_id
  where challenge.plan_bundle_id=bundle.id;
  if jsonb_array_length(coalesce(evaluator_value,'[]'::jsonb))<>2
  then raise exception 'plan repair evidence is incomplete' using errcode='40001'; end if;
  if bundle.plan_iteration>=3 then
    return jsonb_build_object(
      'repairAvailable',false,'reason','exhausted',
      'priorPlanBundleId',bundle.id,'priorPlanHash',bundle.plan_hash,
      'priorIteration',bundle.plan_iteration,'consensusId',consensus.id
    );
  end if;
  return jsonb_build_object(
    'repairAvailable',true,
    'priorPlanBundleId',bundle.id,'priorPlanHash',bundle.plan_hash,
    'priorIteration',bundle.plan_iteration,'nextIteration',bundle.plan_iteration+1,
    'consensusId',consensus.id,'verdict',consensus.verdict,
    'gateCodes',consensus.gate_codes,'ovs',consensus.ovs,'cvp',consensus.cvp,
    'pfs',consensus.pfs,'confidence',consensus.confidence,
    'evidenceDensity',consensus.evidence_density,'evaluators',evaluator_value
  );
end;
$$;

revoke all on function public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)
to service_role;

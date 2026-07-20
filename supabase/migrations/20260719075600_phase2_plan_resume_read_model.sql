-- Deterministic retry/read model for the transactional boundary between plan
-- publication, sealed evaluator challenges, score sets, and consensus.

create or replace function public.get_plan_preflight_resume(
  p_workspace_id uuid,p_preflight_run_id uuid,p_stage_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  bundle public.preflight_plan_bundles%rowtype;
  plan_value jsonb;
  component_ids_value jsonb;
  challenge_value jsonb;
  consensus_value jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into run from public.preflight_runs
    where id=p_preflight_run_id and workspace_id=p_workspace_id;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and workspace_id=p_workspace_id
      and preflight_run_id=p_preflight_run_id;
  if run.id is null or run.kind<>'plan_evaluation' or run.state<>'running'
    or attempt.id is null or attempt.state not in ('claimed','running')
    or attempt.authority_epoch<>run.authority_epoch
    or not exists(select 1 from public.preflight_stage_runs stage
      where stage.id=attempt.preflight_stage_run_id and stage.preflight_run_id=run.id
        and stage.highest_fencing_token=attempt.fencing_token)
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=attempt.fencing_token
        and lease.expires_at>statement_timestamp())
  then raise exception 'plan resume authority is stale' using errcode='40001'; end if;
  select * into bundle from public.preflight_plan_bundles
    where preflight_run_id=run.id and workspace_id=p_workspace_id
    order by created_at desc limit 1;
  if bundle.id is null then return null; end if;

  select jsonb_build_object(
    'story',story.payload,'beats',beat.payload,'shots',shot.payload,
    'sound',sound.payload,'composition',composition.payload,
    'safety',safety.payload,'routing',routing.payload,'edd',edd.payload,
    'requestSlots',coalesce((select jsonb_agg(jsonb_build_object(
      'slotKey',slot.slot_key,'shotNumber',slot.shot_number,'slotKind',slot.slot_kind,
      'capabilityVersionId',slot.capability_version_id,'durationMs',slot.duration_ms,
      'retainedDurationMs',slot.retained_duration_ms,'inputStrategy',slot.input_strategy,
      'referenceCount',slot.reference_count,'outputWidth',slot.output_width,
      'outputHeight',slot.output_height,'billingQuantumCount',slot.billing_quantum_count,
      'expectedOutputKind',slot.expected_output_kind
    ) order by slot.shot_number,slot.slot_key)
      from public.preflight_provider_request_slots slot
      where slot.plan_bundle_id=bundle.id),'[]'::jsonb),
    'references',coalesce((select jsonb_agg(jsonb_build_object(
      'shotNumber',edge.shot_number,
      'sourceShotNumber',case when edge.source_shot_number is null then to_jsonb(''::text)
        else to_jsonb(edge.source_shot_number) end,
      'referenceKind',edge.reference_kind,'referenceOrdinal',edge.reference_ordinal,
      'assetVersionId',coalesce(edge.asset_version_id::text,''),
      'contentHash',edge.asset_content_hash,
      'requiresUpstreamSuccess',edge.requires_upstream_success
    ) order by edge.shot_number,edge.reference_ordinal)
      from public.preflight_reference_edges edge
      where edge.plan_bundle_id=bundle.id),'[]'::jsonb)
  ),jsonb_build_object(
    'story',bundle.story_version_id,'beat',bundle.beat_version_id,
    'shot',bundle.shot_version_id,'sound',bundle.sound_version_id,
    'composition',bundle.composition_version_id,'safety',bundle.safety_version_id,
    'routing',bundle.routing_version_id,'edd',bundle.edd_version_id
  )
  into plan_value,component_ids_value
  from public.preflight_plan_component_versions story,
    public.preflight_plan_component_versions beat,
    public.preflight_plan_component_versions shot,
    public.preflight_plan_component_versions sound,
    public.preflight_plan_component_versions composition,
    public.preflight_plan_component_versions safety,
    public.preflight_plan_component_versions routing,
    public.preflight_plan_component_versions edd
  where story.id=bundle.story_version_id and beat.id=bundle.beat_version_id
    and shot.id=bundle.shot_version_id and sound.id=bundle.sound_version_id
    and composition.id=bundle.composition_version_id
    and safety.id=bundle.safety_version_id and routing.id=bundle.routing_version_id
    and edd.id=bundle.edd_version_id;
  if plan_value is null
    or encode(extensions.digest(convert_to(plan_value::text,'UTF8'),'sha256'),'hex')<>bundle.plan_hash
  then raise exception 'persisted plan content is incomplete' using errcode='40001'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'challengeId',challenge.id,'blindGroupId',challenge.blind_group_id,
    'evaluatorKey',challenge.evaluator_key,
    'deploymentFamily',challenge.evaluator_deployment_family,
    'evaluatorRecordId',score_set.evaluator_record_id,
    'scoreSetId',score_set.id
  ) order by challenge.evaluator_key),'[]'::jsonb)
  into challenge_value from private.plan_evaluator_challenges challenge
  left join private.plan_evaluator_score_sets score_set
    on score_set.challenge_id=challenge.id
  where challenge.stage_attempt_id=attempt.id and challenge.plan_bundle_id=bundle.id;

  select jsonb_build_object(
    'consensusId',summary.id,'blindGroupId',consensus.blind_group_id,
    'verdict',summary.verdict,'ovs',summary.ovs,'cvp',summary.cvp,'pfs',summary.pfs,
    'confidence',summary.confidence,'evidenceDensity',summary.evidence_density,
    'gateCodes',summary.gate_codes
  ) into consensus_value
  from private.preflight_plan_qc_consensus consensus
  join public.preflight_plan_qc_summaries summary on summary.id=consensus.id
  where consensus.stage_attempt_id=attempt.id and consensus.plan_bundle_id=bundle.id;

  return jsonb_build_object(
    'planBundleId',bundle.id,'state',bundle.state,'planHash',bundle.plan_hash,
    'graphHash',bundle.graph_hash,'plan',plan_value,
    'componentIds',component_ids_value,'challenges',challenge_value,
    'consensus',consensus_value
  );
end;
$$;

revoke all on function public.get_plan_preflight_resume(uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.get_plan_preflight_resume(uuid,uuid,uuid)
to service_role;

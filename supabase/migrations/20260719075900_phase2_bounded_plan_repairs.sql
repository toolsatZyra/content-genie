-- A failing visual plan may be repaired twice in the same fenced stage
-- attempt. Every immutable successor is parented to the exact blocked plan and
-- consensus, and receives a fresh pair of blind evaluator challenges.

alter table public.preflight_plan_bundles
  add column plan_iteration integer,
  add column parent_plan_bundle_id uuid,
  add column repair_basis_consensus_id uuid;

update public.preflight_plan_bundles set plan_iteration=1
where plan_iteration is null;

alter table public.preflight_plan_bundles
  alter column plan_iteration set not null,
  add constraint preflight_plan_iteration_bounded check(plan_iteration between 1 and 3),
  add constraint preflight_plan_parent_shape check(
    (plan_iteration=1 and parent_plan_bundle_id is null and repair_basis_consensus_id is null)
    or (plan_iteration>1 and parent_plan_bundle_id is not null and repair_basis_consensus_id is not null)
  ),
  add constraint preflight_plan_parent_fk foreign key(workspace_id,parent_plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  add constraint preflight_plan_repair_basis_fk foreign key(workspace_id,repair_basis_consensus_id)
    references private.preflight_plan_qc_consensus(workspace_id,id) on delete restrict,
  add constraint preflight_plan_run_iteration_uq unique(preflight_run_id,plan_iteration),
  add constraint preflight_plan_parent_uq unique(parent_plan_bundle_id),
  add constraint preflight_plan_repair_basis_uq unique(repair_basis_consensus_id);

create or replace function private.bind_plan_repair_lineage()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  prior public.preflight_plan_bundles%rowtype;
  basis private.preflight_plan_qc_consensus%rowtype;
  expected_iteration integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('plan-repair:'||new.preflight_run_id::text,0)
  );
  select * into prior from public.preflight_plan_bundles
    where preflight_run_id=new.preflight_run_id and workspace_id=new.workspace_id
    order by plan_iteration desc limit 1;
  if prior.id is null then
    expected_iteration:=1;
    if (new.plan_iteration is not null and new.plan_iteration<>1)
      or new.parent_plan_bundle_id is not null
      or new.repair_basis_consensus_id is not null
    then raise exception 'first plan lineage is invalid' using errcode='40001'; end if;
    new.plan_iteration:=1;
    return new;
  end if;
  select * into basis from private.preflight_plan_qc_consensus
    where plan_bundle_id=prior.id and workspace_id=new.workspace_id;
  expected_iteration:=prior.plan_iteration+1;
  if prior.state<>'blocked' or basis.id is null or basis.verdict='pass'
    or expected_iteration>3
    or (new.plan_iteration is not null and new.plan_iteration<>expected_iteration)
    or (new.parent_plan_bundle_id is not null and new.parent_plan_bundle_id<>prior.id)
    or (new.repair_basis_consensus_id is not null and new.repair_basis_consensus_id<>basis.id)
  then raise exception 'bounded plan repair lineage is invalid' using errcode='40001'; end if;
  new.plan_iteration:=expected_iteration;
  new.parent_plan_bundle_id:=prior.id;
  new.repair_basis_consensus_id:=basis.id;
  return new;
end;
$$;

create trigger plan_repair_lineage_bind
before insert on public.preflight_plan_bundles
for each row execute function private.bind_plan_repair_lineage();

alter table private.plan_evaluator_challenges
  drop constraint plan_evaluator_challenges_stage_attempt_id_evaluator_key_key,
  drop constraint plan_evaluator_challenges_blind_group_id_evaluator_deployme_key,
  add constraint plan_evaluator_challenge_plan_key_uq
    unique(stage_attempt_id,plan_bundle_id,evaluator_key),
  add constraint plan_evaluator_challenge_blind_deployment_uq
    unique(blind_group_id,evaluator_deployment_family);

alter table private.evaluator_records
  drop constraint evaluator_records_stage_attempt_id_evaluator_key_output_has_key,
  add constraint evaluator_record_plan_output_uq
    unique(stage_attempt_id,evaluator_key,plan_hash,output_hash);

create or replace function public.command_issue_plan_evaluator_challenges(
  p_workspace_id uuid,p_preflight_run_id uuid,p_stage_attempt_id uuid,
  p_plan_bundle_id uuid,p_blind_group_id uuid,p_challenges jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  challenge jsonb;
  attempt public.preflight_stage_attempts%rowtype;
  bundle public.preflight_plan_bundles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and workspace_id=p_workspace_id
      and preflight_run_id=p_preflight_run_id;
  select * into bundle from public.preflight_plan_bundles
    where id=p_plan_bundle_id and workspace_id=p_workspace_id
      and preflight_run_id=p_preflight_run_id;
  if attempt.id is null or attempt.state not in ('claimed','running')
    or bundle.id is null or bundle.state<>'candidate'
    or p_challenges is null or jsonb_typeof(p_challenges)<>'array'
    or jsonb_array_length(p_challenges)<>2
    or exists(select 1 from private.evaluator_records record
      where record.stage_attempt_id=attempt.id and record.plan_hash=bundle.plan_hash)
    or exists(select 1 from private.plan_evaluator_challenges existing
      where existing.stage_attempt_id=attempt.id and existing.plan_bundle_id=bundle.id)
    or (select count(distinct value->>'deploymentFamily')
      from jsonb_array_elements(p_challenges))<>2
    or (select count(distinct value->>'evaluatorKey')
      from jsonb_array_elements(p_challenges))<>2
    or not exists(select 1 from public.preflight_stage_runs stage
      where stage.id=attempt.preflight_stage_run_id
        and stage.highest_fencing_token=attempt.fencing_token)
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=attempt.fencing_token
        and lease.expires_at>statement_timestamp())
  then raise exception 'sealed evaluator challenge envelope is invalid' using errcode='40001'; end if;
  for challenge in select value from jsonb_array_elements(p_challenges) loop
    if jsonb_typeof(challenge)<>'object'
      or (challenge-array['challengeId','evaluatorKey','deploymentFamily']::text[])<>'{}'::jsonb
      or not(challenge?&array['challengeId','evaluatorKey','deploymentFamily'])
      or challenge->>'challengeId' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or challenge->>'evaluatorKey' !~ '^[a-z][a-z0-9_.-]{2,100}$'
      or challenge->>'deploymentFamily' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,100}$'
    then raise exception 'evaluator challenge is not exact' using errcode='22023'; end if;
    insert into private.plan_evaluator_challenges(
      id,workspace_id,preflight_run_id,stage_attempt_id,plan_bundle_id,blind_group_id,
      evaluator_key,evaluator_deployment_family,input_manifest_hash,plan_hash,
      rubric_key,rubric_version
    ) values((challenge->>'challengeId')::uuid,p_workspace_id,p_preflight_run_id,attempt.id,
      bundle.id,p_blind_group_id,challenge->>'evaluatorKey',challenge->>'deploymentFamily',
      attempt.input_manifest_hash,bundle.plan_hash,'mythological-devotional-plan','1.0.0');
  end loop;
  return p_blind_group_id;
end;
$$;

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
  then raise exception 'plan repair authority is stale or exhausted' using errcode='40001'; end if;
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

create or replace function private.guard_preflight_evaluator_success()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.state='succeeded' and old.state is distinct from 'succeeded'
    and new.kind='plan_evaluation'
    and not exists(
      select 1 from public.preflight_plan_bundles bundle
      join private.preflight_plan_qc_consensus consensus
        on consensus.plan_bundle_id=bundle.id
      where bundle.preflight_run_id=new.id and bundle.workspace_id=new.workspace_id
        and bundle.state='qc_passed' and consensus.verdict='pass'
        and (select count(*) from private.plan_evaluator_challenges challenge
          join private.plan_evaluator_score_sets score_set
            on score_set.challenge_id=challenge.id
          where challenge.plan_bundle_id=bundle.id)=2
    )
  then raise exception 'passing plan consensus evidence is incomplete' using errcode='55000'; end if;
  return new;
end;
$$;

revoke all on function private.bind_plan_repair_lineage(),
  public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)
to service_role;

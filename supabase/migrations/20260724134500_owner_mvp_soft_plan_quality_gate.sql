-- During the owner-operated developer MVP, numeric creative scores are advisory.
-- Deterministic hard gates, evidence confidence, evaluator blockers, and material
-- evaluator disagreement remain fail-closed. The score gates remain recorded so
-- Monica and the owner can repair or calibrate them during final review.

create or replace function public.command_create_preflight_plan_consensus(
  p_workspace_id uuid,p_blind_group_id uuid
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  challenge private.plan_evaluator_challenges%rowtype;
  consensus_id uuid;
  expected_rubric_hash text;
  ovs_value numeric;
  cvp_value numeric;
  pfs_value numeric;
  lcr_value numeric;
  confidence_value numeric;
  evidence_density_value numeric;
  maximum_spread integer;
  gate_codes text[]:='{}'::text[];
  blocking_gate_codes text[]:='{}'::text[];
  final_verdict text;
  consensus_hash_value text;
  reveal_applicable boolean;
  existing_consensus private.preflight_plan_qc_consensus%rowtype;
  score_first integer; score_clarity integer; score_vertical integer;
  score_emotion integer; score_reveal integer; score_blocking integer;
  score_escalation integer; score_cliffhanger integer; score_rhythm integer;
  score_economy integer; score_performance integer; score_sound integer;
  score_subtitle integer; score_feasibility integer; score_localization integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into existing_consensus from private.preflight_plan_qc_consensus
    where workspace_id=p_workspace_id and blind_group_id=p_blind_group_id;
  if existing_consensus.id is not null then return existing_consensus.id; end if;
  select * into challenge from private.plan_evaluator_challenges
    where blind_group_id=p_blind_group_id and workspace_id=p_workspace_id limit 1;
  if challenge.id is null
    or (select count(*) from private.plan_evaluator_challenges where blind_group_id=p_blind_group_id)<>2
    or (select count(distinct evaluator_deployment_family) from private.plan_evaluator_challenges where blind_group_id=p_blind_group_id)<>2
    or (select count(*) from private.plan_evaluator_score_sets score_set
        join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
        where c.blind_group_id=p_blind_group_id)<>2
  then raise exception 'two independent evaluator results are required' using errcode='40001'; end if;
  select encode(extensions.digest(convert_to(
    rubric.source_visual_hash||':'||rubric.source_checks_hash||':'||rubric.contract_hash,'UTF8'),'sha256'),'hex')
    into expected_rubric_hash from private.plan_qc_rubric_versions rubric
    where rubric.rubric_key=challenge.rubric_key and rubric.rubric_version=challenge.rubric_version and rubric.state='active';

  with scores as (
    select parameter.parameter_id,min(parameter.score) score,
      max(parameter.score)-min(parameter.score) spread,
      bool_and(parameter.applicable) applicable
    from private.plan_evaluator_parameter_scores parameter
    join private.plan_evaluator_score_sets score_set on score_set.id=parameter.score_set_id
    join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
    where c.blind_group_id=p_blind_group_id group by parameter.parameter_id
  )
  select max(spread),
    min(score) filter(where parameter_id='first_frame_hook'),
    min(score) filter(where parameter_id='visual_story_clarity'),
    min(score) filter(where parameter_id='vertical_composition'),
    min(score) filter(where parameter_id='emotional_readability'),
    min(score) filter(where parameter_id='reveal_execution'),
    min(score) filter(where parameter_id='blocking_power_geometry'),
    min(score) filter(where parameter_id='visual_escalation'),
    min(score) filter(where parameter_id='cliffhanger_image'),
    min(score) filter(where parameter_id='edit_rhythm'),
    min(score) filter(where parameter_id='shot_economy'),
    min(score) filter(where parameter_id='performance_capture'),
    min(score) filter(where parameter_id='sound_music'),
    min(score) filter(where parameter_id='subtitle_ui_safety'),
    min(score) filter(where parameter_id='production_feasibility'),
    min(score) filter(where parameter_id='localization_compliance')
  into maximum_spread,score_first,score_clarity,score_vertical,score_emotion,
    score_reveal,score_blocking,score_escalation,score_cliffhanger,score_rhythm,
    score_economy,score_performance,score_sound,score_subtitle,score_feasibility,
    score_localization from scores;

  evidence_density_value:=case when exists(
    select 1 from private.plan_evaluator_parameter_scores parameter
    join private.plan_evaluator_score_sets score_set on score_set.id=parameter.score_set_id
    join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
    where c.blind_group_id=p_blind_group_id and (not parameter.applicable or parameter.evidence_version_id is null)
  ) then 0 else 100 end;
  confidence_value:=0.45*100+0.25*evidence_density_value+0.20*70+
    0.10*greatest(0,100-12*case when maximum_spread>=3 then 1 else 0 end);

  ovs_value:=10*(10*score_first+9*score_clarity+9.6*score_vertical+8*score_emotion+
    9.6*score_reveal+8.4*score_blocking+7*score_escalation+7*score_cliffhanger+
    7*score_rhythm+7.2*score_economy+6*score_performance+4.8*score_sound+
    4*score_subtitle+4.8*score_feasibility+4.8*score_localization)/
    (10+9+9.6+8+9.6+8.4+7+7+7+7.2+6+4.8+4+4.8+4.8);
  cvp_value:=10*(0.22*score_first+0.14*score_emotion+0.14*score_escalation+
    0.18*score_reveal+0.20*score_cliffhanger+0.12*score_rhythm);
  pfs_value:=10*(0.35*score_feasibility+0.20*score_economy+0.20*score_blocking+
    0.15*score_rhythm+0.10*score_subtitle);
  lcr_value:=greatest(0,least(100,100-10*(0.45*score_localization+
    0.25*score_subtitle+0.15*score_clarity+0.15*score_sound)));
  select exists(select 1 from public.preflight_beats beat
    where beat.plan_bundle_id=challenge.plan_bundle_id and beat.reveal_level<>'none') into reveal_applicable;

  if score_first<=3 then
    gate_codes:=array_append(gate_codes,'FIRST_FRAME_HOOK');
    blocking_gate_codes:=array_append(blocking_gate_codes,'FIRST_FRAME_HOOK');
  end if;
  if reveal_applicable and score_reveal<=3 then
    gate_codes:=array_append(gate_codes,'REVEAL_EXECUTION');
    blocking_gate_codes:=array_append(blocking_gate_codes,'REVEAL_EXECUTION');
  end if;
  if score_subtitle<=3 then
    gate_codes:=array_append(gate_codes,'SUBTITLE_UI_SAFETY');
    blocking_gate_codes:=array_append(blocking_gate_codes,'SUBTITLE_UI_SAFETY');
  end if;
  if score_sound<=3 then
    gate_codes:=array_append(gate_codes,'SOUND_MUSIC');
    blocking_gate_codes:=array_append(blocking_gate_codes,'SOUND_MUSIC');
  end if;
  if score_feasibility<=3 then
    gate_codes:=array_append(gate_codes,'GENERATION_FEASIBILITY');
    blocking_gate_codes:=array_append(blocking_gate_codes,'GENERATION_FEASIBILITY');
  end if;
  if score_localization<=2 then
    gate_codes:=array_append(gate_codes,'LOCALIZATION_COMPLIANCE');
    blocking_gate_codes:=array_append(blocking_gate_codes,'LOCALIZATION_COMPLIANCE');
  end if;
  if score_cliffhanger<=3 then
    gate_codes:=array_append(gate_codes,'CLIFFHANGER_IMAGE');
    blocking_gate_codes:=array_append(blocking_gate_codes,'CLIFFHANGER_IMAGE');
  end if;
  if ovs_value<74 then gate_codes:=array_append(gate_codes,'OVS_BELOW_74'); end if;
  if cvp_value<70 then gate_codes:=array_append(gate_codes,'CVP_BELOW_70'); end if;
  if pfs_value<70 then gate_codes:=array_append(gate_codes,'PFS_BELOW_70'); end if;
  if ovs_value<74 or cvp_value<70 or pfs_value<70 then
    gate_codes:=array_append(gate_codes,'MVP_PROVISIONAL_QUALITY');
  end if;
  if confidence_value<75 or evidence_density_value<>100 then
    gate_codes:=array_append(gate_codes,'EVIDENCE_CONFIDENCE');
    blocking_gate_codes:=array_append(blocking_gate_codes,'EVIDENCE_CONFIDENCE');
  end if;
  if exists(select 1 from private.evaluator_records evaluation
      join private.plan_evaluator_score_sets score_set on score_set.evaluator_record_id=evaluation.id
      join private.plan_evaluator_challenges c on c.id=score_set.challenge_id
      where c.blind_group_id=p_blind_group_id and evaluation.verdict<>'pass')
  then
    gate_codes:=array_append(gate_codes,'EVALUATOR_BLOCK');
    blocking_gate_codes:=array_append(blocking_gate_codes,'EVALUATOR_BLOCK');
  end if;
  final_verdict:=case when maximum_spread>=3 then 'indeterminate'
    when cardinality(blocking_gate_codes)>0 then 'block' else 'pass' end;
  consensus_hash_value:=encode(extensions.digest(convert_to(jsonb_build_object(
    'blindGroupId',p_blind_group_id,'rubricHash',expected_rubric_hash,
    'ovs',round(ovs_value,3),'cvp',round(cvp_value,3),'pfs',round(pfs_value,3),
    'lcr',round(lcr_value,3),'confidence',round(confidence_value,3),
    'evidenceDensity',round(evidence_density_value,3),'maximumSpread',maximum_spread,
    'verdict',final_verdict,'gateCodes',to_jsonb(gate_codes))::text,'UTF8'),'sha256'),'hex');
  insert into private.preflight_plan_qc_consensus(
    workspace_id,preflight_run_id,stage_attempt_id,plan_bundle_id,blind_group_id,
    rubric_key,rubric_version,rubric_hash,ovs,cvp,pfs,lcr,confidence,evidence_density,
    maximum_parameter_spread,verdict,gate_codes,consensus_hash
  ) values(p_workspace_id,challenge.preflight_run_id,challenge.stage_attempt_id,
    challenge.plan_bundle_id,p_blind_group_id,challenge.rubric_key,challenge.rubric_version,
    expected_rubric_hash,round(ovs_value,3),round(cvp_value,3),round(pfs_value,3),
    round(lcr_value,3),round(confidence_value,3),round(evidence_density_value,3),
    maximum_spread,final_verdict,gate_codes,consensus_hash_value)
  returning id into consensus_id;
  update public.preflight_plan_bundles
    set state=case when final_verdict='pass' then 'qc_passed' else 'blocked' end
    where id=challenge.plan_bundle_id and workspace_id=p_workspace_id and state='candidate';
  if not found then raise exception 'plan bundle lifecycle is stale' using errcode='40001'; end if;
  return consensus_id;
end;
$$;

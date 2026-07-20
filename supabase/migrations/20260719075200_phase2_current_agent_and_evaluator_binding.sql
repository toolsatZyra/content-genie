-- Pin the currently authenticated OpenAI deployment identity and correct the
-- plan-evaluator seal: the workflow input envelope and generated plan are two
-- independent hashes, both of which must be carried, never equated.

alter table private.world_extraction_results
  drop constraint world_extraction_results_model_key_check;
alter table private.world_extraction_results
  add constraint world_extraction_results_model_key_check
  check(model_key in ('gpt-5.6','gpt-5.6-sol'));

create or replace function public.command_record_world_extraction_result(
  p_result_id uuid,p_stage_attempt_id uuid,p_authority_epoch bigint,
  p_fencing_token bigint,p_input_manifest_hash text,p_script_sha256 text,
  p_look_version_id uuid,p_extraction_json jsonb,p_model_request_hash text,
  p_provider_response_id_hash text,p_provider_request_id_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  config public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  prior private.world_extraction_results%rowtype;
  computed_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_script_sha256 !~ '^[a-f0-9]{64}$'
    or p_model_request_hash !~ '^[a-f0-9]{64}$'
    or p_provider_response_id_hash !~ '^[a-f0-9]{64}$'
    or (p_provider_request_id_hash is not null
      and p_provider_request_id_hash !~ '^[a-f0-9]{64}$')
    or p_extraction_json is null or jsonb_typeof(p_extraction_json)<>'object'
    or pg_column_size(p_extraction_json)>131072
    or p_extraction_json->>'schemaVersion'<>'genie.world-extraction.v1'
    or jsonb_typeof(p_extraction_json->'characters')<>'array'
    or jsonb_array_length(p_extraction_json->'characters') not between 1 and 16
    or jsonb_typeof(p_extraction_json->'locations')<>'array'
    or jsonb_array_length(p_extraction_json->'locations') not between 1 and 12
  then raise exception 'world extraction envelope is invalid' using errcode='22023'; end if;
  select * into attempt from public.preflight_stage_attempts where id=p_stage_attempt_id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  select * into run from public.preflight_runs where id=attempt.preflight_run_id for share;
  select * into config from public.episode_configuration_candidates where id=run.configuration_candidate_id for share;
  select * into script from public.script_revisions where id=run.script_revision_id for share;
  if attempt.id is null or stage.id is null or run.id is null
    or run.kind<>'world_anchor' or run.state<>'running'
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch<>p_authority_epoch or run.authority_epoch<>p_authority_epoch
    or attempt.fencing_token<>p_fencing_token or stage.highest_fencing_token<>p_fencing_token
    or attempt.input_manifest_hash<>p_input_manifest_hash
    or script.raw_utf8_sha256<>p_script_sha256 or config.look_version_id<>p_look_version_id
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=p_fencing_token and lease.expires_at>statement_timestamp())
  then raise exception 'world extraction authority is stale' using errcode='40001'; end if;
  computed_hash:=encode(extensions.digest(convert_to(p_extraction_json::text,'UTF8'),'sha256'),'hex');
  select * into prior from private.world_extraction_results where preflight_run_id=run.id;
  if prior.id is not null then
    if prior.extraction_hash<>computed_hash or prior.model_request_hash<>p_model_request_hash
      or prior.script_sha256<>p_script_sha256 or prior.look_version_id<>p_look_version_id
      or prior.model_key<>'gpt-5.6-sol'
    then raise exception 'world extraction replay differs' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,
      'resultId',prior.id,'extractionHash',prior.extraction_hash);
  end if;
  insert into private.world_extraction_results(
    id,workspace_id,preflight_run_id,stage_attempt_id,configuration_candidate_id,
    script_revision_id,script_sha256,look_version_id,schema_version,extraction_json,
    extraction_hash,model_key,model_request_hash,provider_response_id_hash,
    provider_request_id_hash
  ) values(
    p_result_id,run.workspace_id,run.id,attempt.id,run.configuration_candidate_id,
    run.script_revision_id,p_script_sha256,p_look_version_id,
    'genie.world-extraction.v1',p_extraction_json,computed_hash,'gpt-5.6-sol',
    p_model_request_hash,p_provider_response_id_hash,p_provider_request_id_hash
  );
  return jsonb_build_object('ok',true,'replayed',false,
    'resultId',p_result_id,'extractionHash',computed_hash);
end;
$$;
create or replace function public.command_issue_plan_evaluator_challenges(
  p_workspace_id uuid,p_preflight_run_id uuid,p_stage_attempt_id uuid,
  p_plan_bundle_id uuid,p_blind_group_id uuid,p_challenges jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare challenge jsonb; attempt public.preflight_stage_attempts%rowtype;
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
      where record.stage_attempt_id=attempt.id)
    or exists(select 1 from private.plan_evaluator_challenges existing
      where existing.stage_attempt_id=attempt.id)
    or (select count(distinct value->>'deploymentFamily')
      from jsonb_array_elements(p_challenges))<>2
    or (select count(distinct value->>'evaluatorKey')
      from jsonb_array_elements(p_challenges))<>2
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

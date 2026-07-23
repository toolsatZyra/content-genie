-- World extraction v3 carries a closed, explicit character identity manifest
-- for every form. Older immutable v1/v2 evidence remains readable but cannot
-- be replayed into a v3 attempt.

alter table private.world_extraction_results
  drop constraint if exists world_extraction_results_schema_version_check;
alter table private.world_extraction_results
  add constraint world_extraction_results_schema_version_check
  check (schema_version in (
    'genie.world-extraction.v1',
    'genie.world-extraction.v2',
    'genie.world-extraction.v3'
  ));

alter table private.world_extraction_results
  drop constraint if exists world_extraction_results_extraction_json_check;
alter table private.world_extraction_results
  add constraint world_extraction_results_extraction_json_check check (
    jsonb_typeof(extraction_json) = 'object'
    and pg_column_size(extraction_json) <= 131072
    and extraction_json->>'schemaVersion' in (
      'genie.world-extraction.v1',
      'genie.world-extraction.v2',
      'genie.world-extraction.v3'
    )
    and jsonb_typeof(extraction_json->'characters') = 'array'
    and jsonb_array_length(extraction_json->'characters') between 1 and 16
    and jsonb_typeof(extraction_json->'locations') = 'array'
    and jsonb_array_length(extraction_json->'locations') between 1 and 12
    and (
      extraction_json->>'schemaVersion' = 'genie.world-extraction.v1'
      or (
        jsonb_typeof(extraction_json->'props') = 'array'
        and jsonb_array_length(extraction_json->'props') between 0 and 12
      )
    )
  );

create or replace function public.command_record_world_extraction_result(
  p_result_id uuid,
  p_stage_attempt_id uuid,
  p_authority_epoch bigint,
  p_fencing_token bigint,
  p_input_manifest_hash text,
  p_script_sha256 text,
  p_look_version_id uuid,
  p_extraction_json jsonb,
  p_model_request_hash text,
  p_provider_response_id_hash text,
  p_provider_request_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_script_sha256 !~ '^[a-f0-9]{64}$'
    or p_model_request_hash !~ '^[a-f0-9]{64}$'
    or p_provider_response_id_hash !~ '^[a-f0-9]{64}$'
    or (p_provider_request_id_hash is not null
      and p_provider_request_id_hash !~ '^[a-f0-9]{64}$')
    or p_extraction_json is null
    or jsonb_typeof(p_extraction_json) <> 'object'
    or pg_column_size(p_extraction_json) > 131072
    or p_extraction_json->>'schemaVersion' <> 'genie.world-extraction.v3'
    or jsonb_typeof(p_extraction_json->'characters') <> 'array'
    or jsonb_array_length(p_extraction_json->'characters') not between 1 and 16
    or jsonb_typeof(p_extraction_json->'locations') <> 'array'
    or jsonb_array_length(p_extraction_json->'locations') not between 1 and 12
    or jsonb_typeof(p_extraction_json->'props') <> 'array'
    or jsonb_array_length(p_extraction_json->'props') not between 0 and 12
    or exists (
      select 1
      from jsonb_array_elements(p_extraction_json->'characters') character_value
      where jsonb_typeof(character_value->'forms') is distinct from 'array'
        or jsonb_array_length(character_value->'forms') not between 1 and 6
    )
    or exists (
      select 1
      from jsonb_array_elements(p_extraction_json->'characters') character_value
      cross join lateral jsonb_array_elements(character_value->'forms') form_value
      where jsonb_typeof(form_value->'identityManifest') is distinct from 'object'
        or form_value->'identityManifest'->>'schemaVersion'
          is distinct from 'genie-character-identity-manifest.v2'
    )
  then
    raise exception 'world extraction envelope is invalid' using errcode = '22023';
  end if;

  select * into attempt
  from public.preflight_stage_attempts
  where id = p_stage_attempt_id
  for update;
  select * into stage
  from public.preflight_stage_runs
  where id = attempt.preflight_stage_run_id
  for update;
  select * into run
  from public.preflight_runs
  where id = attempt.preflight_run_id
  for share;
  select * into config
  from public.episode_configuration_candidates
  where id = run.configuration_candidate_id
  for share;
  select * into script
  from public.script_revisions
  where id = run.script_revision_id
  for share;

  if attempt.id is null or stage.id is null or run.id is null
    or run.kind <> 'world_anchor'
    or run.state <> 'running'
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch <> p_authority_epoch
    or run.authority_epoch <> p_authority_epoch
    or attempt.fencing_token <> p_fencing_token
    or stage.highest_fencing_token <> p_fencing_token
    or attempt.input_manifest_hash <> p_input_manifest_hash
    or script.raw_utf8_sha256 <> p_script_sha256
    or config.look_version_id <> p_look_version_id
    or not exists (
      select 1
      from public.preflight_stage_leases lease
      where lease.stage_attempt_id = attempt.id
        and lease.state = 'active'
        and lease.fencing_token = p_fencing_token
        and lease.expires_at > statement_timestamp()
    )
  then
    raise exception 'preflight execution authority is stale' using errcode = '40001';
  end if;

  computed_hash := encode(
    extensions.digest(convert_to(p_extraction_json::text, 'UTF8'), 'sha256'),
    'hex'
  );
  select * into prior
  from private.world_extraction_results
  where preflight_run_id = run.id;
  if prior.id is not null then
    if prior.extraction_hash <> computed_hash
      or prior.model_request_hash <> p_model_request_hash
      or prior.script_sha256 <> p_script_sha256
      or prior.look_version_id <> p_look_version_id
      or prior.schema_version <> 'genie.world-extraction.v3'
    then
      raise exception 'world extraction replay differs' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'resultId', prior.id,
      'extractionHash', prior.extraction_hash
    );
  end if;

  insert into private.world_extraction_results(
    id, workspace_id, preflight_run_id, stage_attempt_id,
    configuration_candidate_id, script_revision_id, script_sha256,
    look_version_id, schema_version, extraction_json, extraction_hash,
    model_key, model_request_hash, provider_response_id_hash,
    provider_request_id_hash
  ) values (
    p_result_id, run.workspace_id, run.id, attempt.id,
    run.configuration_candidate_id, run.script_revision_id, p_script_sha256,
    p_look_version_id, 'genie.world-extraction.v3', p_extraction_json,
    computed_hash, 'gpt-5.6', p_model_request_hash,
    p_provider_response_id_hash, p_provider_request_id_hash
  );
  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'resultId', p_result_id,
    'extractionHash', computed_hash
  );
end;
$$;

create or replace function public.get_world_extraction_replay_result(
  p_stage_attempt_id uuid,
  p_authority_epoch bigint,
  p_fencing_token bigint,
  p_input_manifest_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  result private.world_extraction_results%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into attempt
  from public.preflight_stage_attempts
  where id = p_stage_attempt_id;
  select * into stage
  from public.preflight_stage_runs
  where id = attempt.preflight_stage_run_id;
  if attempt.id is null or stage.id is null
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch <> p_authority_epoch
    or attempt.fencing_token <> p_fencing_token
    or stage.highest_fencing_token <> p_fencing_token
    or attempt.input_manifest_hash <> p_input_manifest_hash
    or not exists (
      select 1
      from public.preflight_stage_leases lease
      where lease.stage_attempt_id = attempt.id
        and lease.state = 'active'
        and lease.fencing_token = p_fencing_token
        and lease.expires_at > statement_timestamp()
    )
  then
    raise exception 'world extraction replay authority is stale'
      using errcode = '40001';
  end if;

  select extraction.* into result
  from private.world_extraction_results extraction
  join public.preflight_stage_attempts source_attempt
    on source_attempt.id = extraction.stage_attempt_id
  where extraction.workspace_id = attempt.workspace_id
    and extraction.preflight_run_id = attempt.preflight_run_id
    and extraction.schema_version = 'genie.world-extraction.v3'
    and source_attempt.preflight_run_id = attempt.preflight_run_id
    and source_attempt.authority_epoch = attempt.authority_epoch
    and source_attempt.input_manifest_hash = attempt.input_manifest_hash
  order by extraction.created_at
  limit 1;
  if result.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'extractionHash', result.extraction_hash,
    'extractionJson', result.extraction_json,
    'resultId', result.id
  );
end;
$$;

revoke all on function public.command_record_world_extraction_result(
  uuid, uuid, bigint, bigint, text, text, uuid, jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.get_world_extraction_replay_result(
  uuid, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.command_record_world_extraction_result(
  uuid, uuid, bigint, bigint, text, text, uuid, jsonb, text, text, text
) to service_role;
grant execute on function public.get_world_extraction_replay_result(
  uuid, bigint, bigint, text
) to service_role;

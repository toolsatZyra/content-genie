-- A terminal World retry is still bound to the same immutable
-- configuration, script revision and look. Reuse a previously recorded v3
-- extraction under fresh run/attempt authority instead of paying for and
-- waiting on the same long structured-agent call again.

alter table private.world_extraction_results
  add column if not exists source_extraction_result_id uuid
    references private.world_extraction_results(id) on delete restrict;

create index if not exists world_extraction_results_replay_scope_idx
on private.world_extraction_results(
  configuration_candidate_id,
  script_revision_id,
  look_version_id,
  created_at desc
);

create or replace function public.get_world_extraction_replay_result(
  p_stage_attempt_id uuid,
  p_authority_epoch bigint,
  p_fencing_token bigint,
  p_input_manifest_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  configuration public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  result private.world_extraction_results%rowtype;
  prior private.world_extraction_results%rowtype;
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
  select * into run
  from public.preflight_runs
  where id = attempt.preflight_run_id;
  select * into configuration
  from public.episode_configuration_candidates
  where id = run.configuration_candidate_id;
  select * into script
  from public.script_revisions
  where id = run.script_revision_id;

  if attempt.id is null or stage.id is null or run.id is null
    or configuration.id is null or script.id is null
    or run.kind <> 'world_anchor'
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch <> p_authority_epoch
    or attempt.fencing_token <> p_fencing_token
    or stage.preflight_run_id <> run.id
    or stage.highest_fencing_token <> p_fencing_token
    or attempt.input_manifest_hash <> p_input_manifest_hash
    or run.configuration_candidate_id <> configuration.id
    or run.script_revision_id <> script.id
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
    and extraction.preflight_run_id = run.id
    and source_attempt.preflight_run_id = run.id
    and source_attempt.authority_epoch = attempt.authority_epoch
    and source_attempt.input_manifest_hash = attempt.input_manifest_hash
  order by extraction.created_at
  limit 1;

  if result.id is not null then
    if result.schema_version <> 'genie.world-extraction.v3' then
      return jsonb_build_object('upgradeRequired', true);
    end if;
    return jsonb_build_object(
      'extractionHash', result.extraction_hash,
      'extractionJson', result.extraction_json,
      'resultId', result.id
    );
  end if;

  select extraction.* into prior
  from private.world_extraction_results extraction
  join public.preflight_runs source_run
    on source_run.id = extraction.preflight_run_id
  where extraction.workspace_id = attempt.workspace_id
    and extraction.configuration_candidate_id = configuration.id
    and extraction.script_revision_id = script.id
    and extraction.script_sha256 = script.raw_utf8_sha256
    and extraction.look_version_id = configuration.look_version_id
    and extraction.schema_version = 'genie.world-extraction.v3'
    and extraction.preflight_run_id <> run.id
    and source_run.kind = 'world_anchor'
    and source_run.workspace_id = run.workspace_id
    and source_run.episode_id = run.episode_id
    and source_run.configuration_candidate_id = configuration.id
    and source_run.script_revision_id = script.id
    and extraction.extraction_hash = encode(extensions.digest(
      convert_to(extraction.extraction_json::text, 'UTF8'),
      'sha256'
    ), 'hex')
  order by extraction.created_at desc, extraction.id
  limit 1;

  if prior.id is null then
    return null;
  end if;

  insert into private.world_extraction_results(
    id,
    workspace_id,
    preflight_run_id,
    stage_attempt_id,
    configuration_candidate_id,
    script_revision_id,
    script_sha256,
    look_version_id,
    schema_version,
    extraction_json,
    extraction_hash,
    model_key,
    model_request_hash,
    provider_response_id_hash,
    provider_request_id_hash,
    source_extraction_result_id
  ) values (
    gen_random_uuid(),
    attempt.workspace_id,
    run.id,
    attempt.id,
    configuration.id,
    script.id,
    script.raw_utf8_sha256,
    configuration.look_version_id,
    prior.schema_version,
    prior.extraction_json,
    prior.extraction_hash,
    prior.model_key,
    prior.model_request_hash,
    prior.provider_response_id_hash,
    prior.provider_request_id_hash,
    prior.id
  )
  on conflict (preflight_run_id) do nothing;

  select extraction.* into result
  from private.world_extraction_results extraction
  where extraction.preflight_run_id = run.id
    and extraction.stage_attempt_id = attempt.id
    and extraction.configuration_candidate_id = configuration.id
    and extraction.script_revision_id = script.id
    and extraction.look_version_id = configuration.look_version_id
    and extraction.schema_version = 'genie.world-extraction.v3';

  if result.id is null then
    raise exception 'world extraction replay differs'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'extractionHash', result.extraction_hash,
    'extractionJson', result.extraction_json,
    'resultId', result.id
  );
end;
$$;

revoke all on function public.get_world_extraction_replay_result(
  uuid, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.get_world_extraction_replay_result(
  uuid, bigint, bigint, text
) to service_role;

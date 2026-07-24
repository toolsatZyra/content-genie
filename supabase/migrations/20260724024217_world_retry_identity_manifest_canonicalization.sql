-- Character identity manifests bind their presentation labels to the stable
-- Series character/form rows. When a retry differs only in punctuation, carry
-- the already-published labels into the additive candidate manifest and
-- recompute its canonical hash. Every semantic identity field remains exact.

create or replace function public.command_complete_world_anchor_job(
  p_provider_request_id uuid,
  p_promoted_asset_version_id uuid,
  p_world_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.world_anchor_jobs%rowtype;
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  candidate_result jsonb;
  output_id uuid;
  output_manifest jsonb;
  output_hash text;
  resolved_character_name text;
  resolved_form_name text;
  resolved_location_name text;
  resolved_character_manifest jsonb;
  resolved_character_manifest_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  select *
  into job
  from private.world_anchor_jobs
  where provider_request_id = p_provider_request_id
  for update;

  if job.state = 'promoted' then
    if job.promoted_asset_version_id <> p_promoted_asset_version_id then
      raise exception 'world anchor completion replay conflicts'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'jobId', job.id,
      'worldVersionId', job.world_version_id
    );
  end if;

  select *
  into run
  from public.preflight_runs
  where id = job.preflight_run_id
  for update;

  select *
  into attempt
  from public.preflight_stage_attempts
  where id = job.stage_attempt_id
  for update;

  select *
  into stage
  from public.preflight_stage_runs
  where id = attempt.preflight_stage_run_id
  for update;

  if job.id is null
    or job.state <> 'waiting_output'
    or run.state <> 'waiting_external'
    or attempt.state <> 'waiting_external'
    or stage.state <> 'waiting_external'
    or not exists (
      select 1
      from public.asset_versions version
      where version.id = p_promoted_asset_version_id
        and version.workspace_id = job.workspace_id
        and version.asset_id = job.target_asset_id
    )
  then
    raise exception 'world anchor promoted asset authority is stale'
      using errcode = '40001';
  end if;

  if job.entity_kind = 'character' then
    select coalesce((
      select character.display_name
      from public.characters character
      where character.id = job.character_id
        and character.workspace_id = job.workspace_id
        and character.canonical_key = job.character_key
    ), job.character_name)
    into resolved_character_name;

    select coalesce((
      select form.display_name
      from public.character_forms form
      where form.id = job.character_form_id
        and form.workspace_id = job.workspace_id
        and form.character_id = job.character_id
        and form.form_key = job.form_key
    ), job.form_name)
    into resolved_form_name;

    resolved_character_manifest := jsonb_set(
      jsonb_set(
        job.world_manifest,
        '{identity,canonicalName}',
        to_jsonb(resolved_character_name),
        false
      ),
      '{identity,formName}',
      to_jsonb(resolved_form_name),
      false
    );
    resolved_character_manifest_hash :=
      private.character_identity_manifest_sha256(resolved_character_manifest);

    candidate_result := public.command_record_character_candidate(
      job.workspace_id,
      run.configuration_candidate_id,
      job.character_id,
      job.character_form_id,
      job.character_key,
      resolved_character_name,
      job.form_key,
      resolved_form_name,
      p_world_version_id,
      'generated',
      job.prompt_text,
      job.prompt_sha256,
      job.negative_prompt_text,
      p_promoted_asset_version_id,
      resolved_character_manifest,
      resolved_character_manifest_hash,
      job.regeneration_request_id
    );
  else
    select coalesce((
      select location.display_name
      from public.locations location
      where location.id = job.location_id
        and location.workspace_id = job.workspace_id
        and location.canonical_key = job.location_key
        and location.named_temple = job.named_temple
        and location.real_place_name is not distinct from job.real_place_name
    ), job.location_name)
    into resolved_location_name;

    candidate_result := public.command_record_location_candidate(
      job.workspace_id,
      run.configuration_candidate_id,
      job.location_id,
      job.location_key,
      resolved_location_name,
      job.named_temple,
      job.real_place_name,
      p_world_version_id,
      'generated',
      job.prompt_text,
      job.prompt_sha256,
      job.negative_prompt_text,
      p_promoted_asset_version_id,
      job.world_manifest,
      job.world_manifest_hash,
      job.temple_evidence_set_hash,
      job.regeneration_request_id
    );
  end if;

  update private.world_anchor_jobs
  set state = 'promoted',
      promoted_asset_version_id = p_promoted_asset_version_id,
      world_version_id = p_world_version_id,
      completed_at = statement_timestamp()
  where id = job.id;

  if not exists (
    select 1
    from private.world_anchor_jobs remaining
    where remaining.preflight_run_id = run.id
      and remaining.state <> 'promoted'
  ) then
    output_id := gen_random_uuid();
    output_manifest := jsonb_build_object(
      'schemaVersion', 'genie.world-anchor-output.v1',
      'preflightRunId', run.id,
      'jobCount', (
        select count(*)
        from private.world_anchor_jobs completed
        where completed.preflight_run_id = run.id
      ),
      'worldVersionIds', (
        select jsonb_agg(completed.world_version_id order by completed.slot_key)
        from private.world_anchor_jobs completed
        where completed.preflight_run_id = run.id
      )
    );
    output_hash := encode(extensions.digest(
      convert_to(output_manifest::text, 'UTF8'),
      'sha256'
    ), 'hex');

    insert into private.preflight_output_manifests(
      id,
      workspace_id,
      preflight_run_id,
      stage_attempt_id,
      schema_version,
      manifest_json,
      manifest_hash
    ) values (
      output_id,
      run.workspace_id,
      run.id,
      attempt.id,
      'genie.preflight-output.v1',
      output_manifest,
      output_hash
    );

    update public.preflight_stage_attempts
    set state = 'succeeded',
        output_manifest_id = output_id,
        output_manifest_hash = output_hash,
        completed_at = statement_timestamp()
    where id = attempt.id;

    update public.preflight_stage_runs
    set state = 'succeeded',
        output_manifest_id = output_id,
        output_manifest_hash = output_hash,
        completed_at = statement_timestamp(),
        aggregate_version = aggregate_version + 1
    where id = stage.id;

    update public.preflight_runs
    set state = 'succeeded',
        completed_at = statement_timestamp(),
        reconciliation_due_at = null,
        aggregate_version = aggregate_version + 1
    where id = run.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'replayed', false,
    'jobId', job.id,
    'worldVersionId', p_world_version_id,
    'candidate', candidate_result
  );
end;
$$;

revoke all on function public.command_complete_world_anchor_job(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.command_complete_world_anchor_job(
  uuid,
  uuid,
  uuid
) to service_role;

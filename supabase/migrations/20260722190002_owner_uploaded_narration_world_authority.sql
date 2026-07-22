-- A confirmed owner upload is the narration authority even though the
-- generated-voice confirmation columns intentionally remain null.

do $$
declare
  candidate record;
  removed integer := 0;
begin
  for candidate in
    select constraint_entry.conname
    from pg_catalog.pg_constraint constraint_entry
    where constraint_entry.conrelid =
        'public.episode_configuration_candidates'::regclass
      and constraint_entry.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        ilike '%state%preflight%ready_to_lock%locked%'
      and pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        ilike '%voice_confirmed_at is not null%'
      and pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        ilike '%look_confirmed_at is not null%'
  loop
    execute pg_catalog.format(
      'alter table public.episode_configuration_candidates drop constraint %I',
      candidate.conname
    );
    removed := removed + 1;
  end loop;
  if removed <> 1 then
    raise exception 'expected one legacy configuration confirmation constraint, found %',
      removed;
  end if;
end;
$$;
alter table public.episode_configuration_candidates
  add constraint episode_configuration_source_confirmation_v2_check check (
    state not in ('preflight', 'ready_to_lock', 'locked')
    or (
      look_confirmed_by is not null
      and look_confirmed_at is not null
      and (
        (
          narration_source_kind = 'elevenlabs_v3'
          and voice_confirmed_by is not null
          and voice_confirmed_at is not null
        )
        or
        (
          narration_source_kind = 'uploaded_audio'
          and selected_narration_upload_version_id is not null
          and narration_source_confirmed_by is not null
          and narration_source_confirmed_at is not null
        )
      )
    )
  );

create or replace function private.configuration_has_confirmed_narration(
  candidate public.episode_configuration_candidates
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select case candidate.narration_source_kind
    when 'elevenlabs_v3' then
      candidate.voice_confirmed_by is not null
      and candidate.voice_confirmed_at is not null
    when 'uploaded_audio' then
      candidate.selected_narration_upload_version_id is not null
      and candidate.narration_source_confirmed_by is not null
      and candidate.narration_source_confirmed_at is not null
      and exists (
        select 1
        from public.episode_narration_upload_versions upload
        where upload.workspace_id = candidate.workspace_id
          and upload.episode_id = candidate.episode_id
          and upload.configuration_candidate_id = candidate.id
          and upload.id = candidate.selected_narration_upload_version_id
          and upload.state = 'confirmed'
          and upload.promoted_asset_version_id is not null
          and upload.confirmed_transcript_revision_id =
            candidate.script_revision_id
          and upload.confirmed_by = candidate.narration_source_confirmed_by
          and upload.confirmed_at = candidate.narration_source_confirmed_at
      )
    else false
  end
$$;

revoke all on function private.configuration_has_confirmed_narration(
  public.episode_configuration_candidates
) from public, anon, authenticated;

do $$
declare
  target record;
  target_oid oid;
  definition text;
  corrected text;
begin
  for target in
    select * from (values
      (
        'public',
        'command_authorize_world_build_intent',
        'candidate.voice_confirmed_at is null',
        'not private.configuration_has_confirmed_narration(candidate)'
      ),
      (
        'public',
        'get_preflight_control_execution_input',
        'config.voice_confirmed_at is null',
        'not private.configuration_has_confirmed_narration(config)'
      ),
      (
        'private',
        'assert_world_candidate_scope',
        'candidate.voice_confirmed_at is null',
        'not private.configuration_has_confirmed_narration(candidate)'
      ),
      (
        'public',
        'command_ensure_world_regeneration_authority',
        'configuration.voice_confirmed_at is null',
        'not private.configuration_has_confirmed_narration(configuration)'
      ),
      (
        'public',
        'command_lock_first_episode_world',
        'config.voice_confirmed_at is null',
        'not private.configuration_has_confirmed_narration(config)'
      )
    ) as replacements(schema_name, function_name, old_fragment, new_fragment)
  loop
    select procedure.oid into target_oid
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = target.schema_name
      and procedure.proname = target.function_name;
    if target_oid is null then
      raise exception 'required function %.% is unavailable',
        target.schema_name,
        target.function_name;
    end if;

    definition := pg_catalog.pg_get_functiondef(target_oid);
    corrected := pg_catalog.replace(
      definition,
      target.old_fragment,
      target.new_fragment
    );
    if corrected = definition then
      raise exception 'required confirmation guard was not found in %.%',
        target.schema_name,
        target.function_name;
    end if;
    execute corrected;
  end loop;
end;
$$;

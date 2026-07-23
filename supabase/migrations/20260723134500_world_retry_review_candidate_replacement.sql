-- A fresh fenced World run may replace an unaccepted candidate left by a
-- terminal predecessor. Accepted selections and all non-generated callers
-- retain the existing fail-closed stale-response rule.

create or replace function public.command_record_character_candidate(
  p_workspace_id uuid, p_configuration_candidate_id uuid,
  p_character_id uuid, p_character_form_id uuid,
  p_character_key text, p_character_name text,
  p_form_key text, p_form_name text,
  p_version_id uuid, p_source_kind text,
  p_prompt_text text, p_prompt_sha256 text, p_negative_prompt_text text,
  p_anchor_asset_version_id uuid, p_identity_manifest jsonb,
  p_identity_manifest_hash text, p_regeneration_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  next_version integer;
  selection public.character_selections%rowtype;
  valid_regeneration boolean := false;
  replaceable_retry boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  config := private.assert_world_candidate_scope(
    p_workspace_id,
    p_configuration_candidate_id
  );
  select * into episode from public.episodes where id = config.episode_id;
  if p_source_kind not in ('generated','uploaded','inherited')
    or p_prompt_sha256 !~ '^[a-f0-9]{64}$'
    or p_prompt_sha256 <> encode(extensions.digest(
      convert_to(p_prompt_text,'UTF8'),'sha256'),'hex')
    or p_identity_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_identity_manifest) <> 'object'
  then
    raise exception 'character candidate envelope is invalid'
      using errcode = '22023';
  end if;
  insert into public.characters (
    id, workspace_id, series_id, canonical_key, display_name
  ) values (
    p_character_id, p_workspace_id, episode.series_id,
    p_character_key, p_character_name
  ) on conflict (id) do nothing;
  if not exists (
    select 1 from public.characters
    where id = p_character_id
      and workspace_id = p_workspace_id
      and series_id = episode.series_id
      and canonical_key = p_character_key
      and display_name = p_character_name
  ) then
    raise exception 'character identity conflicts with existing world'
      using errcode = '40001';
  end if;
  insert into public.character_forms (
    id, workspace_id, character_id, form_key, display_name
  ) values (
    p_character_form_id, p_workspace_id, p_character_id,
    p_form_key, p_form_name
  ) on conflict (id) do nothing;
  if not exists (
    select 1 from public.character_forms
    where id = p_character_form_id
      and workspace_id = p_workspace_id
      and character_id = p_character_id
      and form_key = p_form_key
      and display_name = p_form_name
  ) then
    raise exception 'character form conflicts with existing world'
      using errcode = '40001';
  end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.character_versions
  where character_form_id = p_character_form_id;
  select * into selection
  from public.character_selections
  where configuration_candidate_id = config.id
    and character_form_id = p_character_form_id
  for update;
  if found then
    replaceable_retry :=
      p_source_kind = 'generated'
      and p_regeneration_request_id is null
      and selection.state = 'review_required'
      and selection.selected_version_id is null;
    valid_regeneration :=
      p_regeneration_request_id is not null
      and exists (
        select 1
        from private.world_regeneration_requests request
        where request.id = p_regeneration_request_id
          and request.workspace_id = p_workspace_id
          and request.configuration_candidate_id = config.id
          and request.entity_kind = 'character'
          and request.entity_id = p_character_form_id
          and request.state = 'queued'
      );
    if not replaceable_retry and not valid_regeneration then
      raise exception 'character generation response is stale'
        using errcode = '40001';
    end if;
  end if;
  insert into public.character_versions (
    id, workspace_id, character_id, character_form_id,
    configuration_candidate_id, script_revision_id, look_version_id,
    version_number, source_kind, prompt_text, prompt_sha256,
    negative_prompt_text, anchor_asset_version_id, identity_manifest,
    identity_manifest_hash
  ) values (
    p_version_id, p_workspace_id, p_character_id, p_character_form_id,
    config.id, config.script_revision_id, config.look_version_id,
    next_version, p_source_kind, p_prompt_text, p_prompt_sha256,
    p_negative_prompt_text, p_anchor_asset_version_id, p_identity_manifest,
    p_identity_manifest_hash
  );
  insert into public.character_selections (
    workspace_id, configuration_candidate_id, character_form_id,
    candidate_version_id, selected_version_id, state
  ) values (
    p_workspace_id, config.id, p_character_form_id,
    p_version_id, null, 'review_required'
  )
  on conflict (configuration_candidate_id, character_form_id) do update
  set candidate_version_id = excluded.candidate_version_id,
      selected_version_id = case
        when p_regeneration_request_id is null then null
        else public.character_selections.selected_version_id
      end,
      state = 'review_required',
      aggregate_version = public.character_selections.aggregate_version + 1,
      updated_at = statement_timestamp();
  if p_regeneration_request_id is not null then
    update private.world_regeneration_requests
    set state = 'completed', completed_at = statement_timestamp()
    where id = p_regeneration_request_id;
  end if;
  return jsonb_build_object(
    'ok',true,'characterVersionId',p_version_id,
    'versionNumber',next_version,'state','review_required'
  );
end;
$$;

create or replace function public.command_record_location_candidate(
  p_workspace_id uuid, p_configuration_candidate_id uuid,
  p_location_id uuid, p_location_key text, p_location_name text,
  p_named_temple boolean, p_real_place_name text,
  p_version_id uuid, p_source_kind text,
  p_prompt_text text, p_prompt_sha256 text, p_negative_prompt_text text,
  p_anchor_asset_version_id uuid, p_location_manifest jsonb,
  p_location_manifest_hash text, p_temple_evidence_set_hash text,
  p_regeneration_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  next_version integer;
  selection public.location_selections%rowtype;
  valid_regeneration boolean := false;
  replaceable_retry boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  config := private.assert_world_candidate_scope(
    p_workspace_id,
    p_configuration_candidate_id
  );
  select * into episode from public.episodes where id = config.episode_id;
  if p_source_kind not in ('generated','uploaded','inherited')
    or p_prompt_sha256 !~ '^[a-f0-9]{64}$'
    or p_prompt_sha256 <> encode(extensions.digest(
      convert_to(p_prompt_text,'UTF8'),'sha256'),'hex')
    or p_location_manifest_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_location_manifest) <> 'object'
    or (
      p_named_temple
      and (
        p_real_place_name is null
        or p_temple_evidence_set_hash is null
        or p_temple_evidence_set_hash !~ '^[a-f0-9]{64}$'
      )
    )
  then
    raise exception 'location candidate envelope is invalid'
      using errcode = '22023';
  end if;
  insert into public.locations (
    id, workspace_id, series_id, canonical_key,
    display_name, named_temple, real_place_name
  ) values (
    p_location_id, p_workspace_id, episode.series_id, p_location_key,
    p_location_name, p_named_temple, p_real_place_name
  ) on conflict (id) do nothing;
  if not exists (
    select 1 from public.locations
    where id = p_location_id
      and workspace_id = p_workspace_id
      and series_id = episode.series_id
      and canonical_key = p_location_key
      and display_name = p_location_name
      and named_temple = p_named_temple
      and real_place_name is not distinct from p_real_place_name
  ) then
    raise exception 'location identity conflicts with existing world'
      using errcode = '40001';
  end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.location_versions
  where location_id = p_location_id;
  select * into selection
  from public.location_selections
  where configuration_candidate_id = config.id
    and location_id = p_location_id
  for update;
  if found then
    replaceable_retry :=
      p_source_kind = 'generated'
      and p_regeneration_request_id is null
      and selection.state = 'review_required'
      and selection.selected_version_id is null;
    valid_regeneration :=
      p_regeneration_request_id is not null
      and exists (
        select 1
        from private.world_regeneration_requests request
        where request.id = p_regeneration_request_id
          and request.workspace_id = p_workspace_id
          and request.configuration_candidate_id = config.id
          and request.entity_kind = 'location'
          and request.entity_id = p_location_id
          and request.state = 'queued'
      );
    if not replaceable_retry and not valid_regeneration then
      raise exception 'location generation response is stale'
        using errcode = '40001';
    end if;
  end if;
  insert into public.location_versions (
    id, workspace_id, location_id, configuration_candidate_id,
    script_revision_id, look_version_id, version_number, source_kind,
    prompt_text, prompt_sha256, negative_prompt_text,
    empty_anchor_asset_version_id, location_manifest,
    location_manifest_hash, temple_evidence_set_hash
  ) values (
    p_version_id, p_workspace_id, p_location_id, config.id,
    config.script_revision_id, config.look_version_id, next_version,
    p_source_kind, p_prompt_text, p_prompt_sha256,
    p_negative_prompt_text, p_anchor_asset_version_id,
    p_location_manifest, p_location_manifest_hash,
    p_temple_evidence_set_hash
  );
  insert into public.location_selections (
    workspace_id, configuration_candidate_id, location_id,
    candidate_version_id, selected_version_id, state
  ) values (
    p_workspace_id, config.id, p_location_id,
    p_version_id, null, 'review_required'
  )
  on conflict (configuration_candidate_id, location_id) do update
  set candidate_version_id = excluded.candidate_version_id,
      selected_version_id = case
        when p_regeneration_request_id is null then null
        else public.location_selections.selected_version_id
      end,
      state = 'review_required',
      aggregate_version = public.location_selections.aggregate_version + 1,
      updated_at = statement_timestamp();
  if p_regeneration_request_id is not null then
    update private.world_regeneration_requests
    set state = 'completed', completed_at = statement_timestamp()
    where id = p_regeneration_request_id;
  end if;
  return jsonb_build_object(
    'ok',true,'locationVersionId',p_version_id,
    'versionNumber',next_version,'state','review_required'
  );
end;
$$;

revoke all on function public.command_record_character_candidate(
  uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,
  uuid,jsonb,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_record_character_candidate(
  uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,
  uuid,jsonb,text,uuid
) to service_role;

revoke all on function public.command_record_location_candidate(
  uuid,uuid,uuid,text,text,boolean,text,uuid,text,text,text,text,
  uuid,jsonb,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_record_location_candidate(
  uuid,uuid,uuid,text,text,boolean,text,uuid,text,text,text,text,
  uuid,jsonb,text,text,uuid
) to service_role;

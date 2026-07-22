-- Preserve exact active Series-release creative identity when ordinary script
-- revisions create a configuration candidate. Uploaded-audio transcript
-- revisions deliberately reuse the already-confirmed candidate instead.

create or replace function private.create_configuration_for_script_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  inherited_release_id uuid;
  inherited_series_id uuid;
  selected_gender public.narrator_gender;
  selected_look uuid;
  selected_voice uuid;
  next_candidate integer;
begin
  if new.source_kind = 'uploaded_audio_transcript' then
    return new;
  end if;

  select e.pinned_series_release_id, e.series_id
  into inherited_release_id, inherited_series_id
  from public.episodes e
  where e.workspace_id = new.workspace_id
    and e.id = new.episode_id
  for update;
  if not found then
    raise exception 'script Episode is unavailable' using errcode = '23503';
  end if;

  if inherited_release_id is null then
    select l.id into selected_look
    from public.look_versions l
    join public.look_version_availability a on a.look_version_id = l.id
    where l.look_key = 'glowing-divine-realism'
      and l.pack_version = 1
      and a.status = 'active';
    select v.gender, v.id into selected_gender, selected_voice
    from public.voice_versions v
    join public.voice_version_availability a on a.voice_version_id = v.id
    where v.gender = 'male'
      and v.registry_version = 1
      and a.status <> 'withdrawn';
  else
    select release.narrator_gender, release.look_version_id, release.voice_version_id
    into selected_gender, selected_look, selected_voice
    from public.series_releases release
    join public.series series_row
      on series_row.workspace_id = release.workspace_id
     and series_row.id = release.series_id
     and series_row.state = 'active'
     and series_row.active_release_id = release.id
    join public.series_release_statuses release_status
      on release_status.workspace_id = release.workspace_id
     and release_status.series_id = release.series_id
     and release_status.release_id = release.id
     and release_status.status = 'active'
    join public.look_version_availability look_availability
      on look_availability.look_version_id = release.look_version_id
     and look_availability.status = 'active'
    join public.voice_version_availability voice_availability
      on voice_availability.voice_version_id = release.voice_version_id
     and voice_availability.status <> 'withdrawn'
    where release.workspace_id = new.workspace_id
      and release.series_id = inherited_series_id
      and release.id = inherited_release_id
      and release.creative_identity_schema_version = 1;
  end if;

  if selected_look is null or selected_voice is null or selected_gender is null then
    raise exception 'exact inherited creative configuration is unavailable'
      using errcode = '55000';
  end if;

  update public.episode_configuration_candidates
  set state = 'superseded',
      superseded_at = statement_timestamp(),
      aggregate_version = aggregate_version + 1
  where episode_id = new.episode_id
    and state not in ('locked', 'superseded');

  select coalesce(max(candidate_number), 0) + 1 into next_candidate
  from public.episode_configuration_candidates
  where episode_id = new.episode_id;

  insert into public.episode_configuration_candidates (
    workspace_id,
    episode_id,
    candidate_number,
    script_revision_id,
    narrator_gender,
    voice_version_id,
    look_version_id,
    selected_by
  )
  values (
    new.workspace_id,
    new.episode_id,
    next_candidate,
    new.id,
    selected_gender,
    selected_voice,
    selected_look,
    new.created_by
  );
  return new;
end;
$$;

revoke all on function private.create_configuration_for_script_revision()
from public, anon, authenticated;

-- Phase 2 release truth correction: legacy immutable releases must remain
-- semantically incomplete. Only newly-authored schema-v1 releases may pin a
-- complete look/narrator/voice identity into an Episode.

alter table public.series_releases
  add column creative_identity_schema_version smallint not null default 0;

alter table public.series_releases
  alter column narrator_gender drop not null,
  alter column narrator_gender drop default,
  alter column voice_version_id drop not null,
  alter column voice_version_id drop default;

-- 21611 necessarily populated the new columns while adding them. That data was
-- not present in the immutable legacy manifest, so remove it without rewriting
-- the manifest or pretending that a historical creative choice was made.
alter table public.series_releases disable trigger series_releases_immutable;
update public.series_releases
set narrator_gender = null,
    voice_version_id = null
where creative_identity_schema_version = 0;
alter table public.series_releases enable trigger series_releases_immutable;

alter table public.series_releases
  alter column creative_identity_schema_version set default 1,
  add constraint series_releases_creative_identity_schema_check
  check (
    (
      creative_identity_schema_version = 0
      and narrator_gender is null
      and voice_version_id is null
    )
    or (
      creative_identity_schema_version = 1
      and look_version_id is not null
      and narrator_gender is not null
      and voice_version_id is not null
    )
  );

create or replace function private.guard_series_release_creative_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.creative_identity_schema_version <> 1 then
    raise exception 'new Series releases require creative identity schema version 1'
      using errcode = '23514';
  end if;
  if new.look_version_id is null
    or new.narrator_gender is null
    or new.voice_version_id is null
  then
    raise exception 'new Series releases require an exact look, narrator, and voice'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_series_release_creative_identity()
from public, anon, authenticated;

create trigger series_release_creative_identity_guard
before insert or update of creative_identity_schema_version, look_version_id,
  narrator_gender, voice_version_id
on public.series_releases
for each row execute function private.guard_series_release_creative_identity();

create or replace function private.guard_episode_pinned_voice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.pinned_series_release_id is null then
    return new;
  end if;
  perform 1
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
  join public.voice_versions voice
    on voice.id = release.voice_version_id
   and voice.gender = release.narrator_gender
  join public.voice_version_availability voice_availability
    on voice_availability.voice_version_id = release.voice_version_id
   and voice_availability.status <> 'withdrawn'
  where release.id = new.pinned_series_release_id
    and release.workspace_id = new.workspace_id
    and release.series_id = new.series_id
    and release.creative_identity_schema_version = 1;
  if not found then
    raise exception 'active Series release creative identity is unavailable'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_episode_pinned_voice()
from public, anon, authenticated;

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

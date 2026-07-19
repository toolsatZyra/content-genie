-- Phase 2 terminal correction: bind Series release continuity to the exact
-- workspace and Series, and fail Episode creation closed on stale release pins.

alter table public.series_releases
  drop constraint if exists series_release_continuity_fk;
alter table public.series_releases
  drop constraint if exists series_releases_continuity_workspace_series_fk;
alter table public.series_releases
  add constraint series_releases_continuity_workspace_series_fk
  foreign key (workspace_id, continuity_state_version_id, series_id)
  references public.continuity_state_versions (workspace_id, id, series_id)
  match simple
  on delete restrict;

create or replace function public.command_create_episode(
  p_workspace_id uuid,
  p_series_id uuid,
  p_title text,
  p_summary text,
  p_owner_user_id uuid,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  episode_id uuid;
  work_item_id uuid;
  event_id uuid;
  next_number integer;
  current_release uuid;
  current_release_status text;
  current_continuity uuid;
  current_look uuid;
  current_look_status public.look_version_availability_status;
  response jsonb;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_workspace_id::text || actor_id::text || p_idempotency_key,
      0
    )
  );
  response := private.existing_command_response(
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.create',
    p_request_hash
  );
  if response is not null then return response; end if;

  perform private.assert_active_session(p_workspace_id);
  if p_owner_user_id <> actor_id
    and not private.has_workspace_role(
      p_workspace_id,
      actor_id,
      array['admin']::public.membership_role[]
    )
  then
    raise exception 'only admins may assign another owner' using errcode = '42501';
  end if;
  if not private.is_active_member(p_workspace_id, p_owner_user_id) then
    raise exception 'owner must be an active workspace member' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('episode-number:' || p_series_id::text, 0)
  );
  select s.active_release_id
    into current_release
  from public.series s
  where s.id = p_series_id
    and s.workspace_id = p_workspace_id
    and s.state = 'active'
  for update of s;
  if not found then
    raise exception 'active Series not found' using errcode = 'P0002';
  end if;

  current_continuity := null;
  current_look := null;
  if current_release is not null then
    select r.continuity_state_version_id, r.look_version_id
      into current_continuity, current_look
    from public.series_releases r
    where r.id = current_release
      and r.workspace_id = p_workspace_id
      and r.series_id = p_series_id;
    if not found then
      raise exception 'active Series release is unavailable' using errcode = '23503';
    end if;

    select rs.status
      into current_release_status
    from public.series_release_statuses rs
    where rs.release_id = current_release
      and rs.workspace_id = p_workspace_id
      and rs.series_id = p_series_id
    for update of rs;
    if not found or current_release_status is distinct from 'active' then
      raise exception 'active Series release is unavailable' using errcode = '23503';
    end if;

    if current_look is not null then
      select availability.status
        into current_look_status
      from public.look_version_availability availability
      where availability.look_version_id = current_look
      for update of availability;
      if not found or current_look_status is distinct from 'active' then
        raise exception 'active Series look is unavailable' using errcode = '23503';
      end if;
    end if;

    if current_continuity is not null then
      perform 1
      from public.continuity_state_versions continuity
      where continuity.id = current_continuity
        and continuity.workspace_id = p_workspace_id
        and continuity.series_id = p_series_id;
      if not found then
        raise exception 'active Series continuity is unavailable'
          using errcode = '23503';
      end if;
    end if;
  end if;

  select coalesce(max(e.episode_number), 0) + 1
    into next_number
  from public.episodes e
  where e.workspace_id = p_workspace_id
    and e.series_id = p_series_id;

  insert into public.episodes (
    workspace_id,
    series_id,
    episode_number,
    title,
    summary,
    workflow_state,
    owner_user_id,
    pinned_series_release_id,
    pinned_continuity_version_id,
    created_by
  )
  values (
    p_workspace_id,
    p_series_id,
    next_number,
    p_title,
    coalesce(p_summary, ''),
    'draft',
    p_owner_user_id,
    current_release,
    current_continuity,
    actor_id
  )
  returning id into episode_id;

  insert into private.aggregate_versions (
    workspace_id,
    aggregate_type,
    aggregate_id,
    current_version
  ) values (p_workspace_id, 'episode', episode_id, 1);

  insert into public.work_items (
    workspace_id,
    episode_id,
    series_id,
    kind,
    required_role,
    assigned_user_id,
    dedupe_key,
    safe_summary,
    deep_link
  )
  values (
    p_workspace_id,
    episode_id,
    p_series_id,
    'episode.world_setup',
    'member',
    p_owner_user_id,
    'episode:' || episode_id::text || ':world_setup',
    'Set the script, look, characters, and locations',
    '/episodes/' || episode_id::text || '/create'
  )
  returning id into work_item_id;

  event_id := private.emit_domain_event(
    p_workspace_id,
    'episode.created.v1',
    'episode',
    episode_id,
    1,
    p_correlation_id,
    jsonb_build_object(
      'episodeId', episode_id,
      'seriesId', p_series_id,
      'episodeNumber', next_number
    )
  );

  insert into public.notifications (
    workspace_id,
    recipient_user_id,
    work_item_id,
    domain_event_id,
    material_key,
    title,
    safe_summary,
    deep_link
  ) values (
    p_workspace_id,
    p_owner_user_id,
    work_item_id,
    event_id,
    'episode:' || episode_id::text || ':world_setup',
    'Episode ready for world setup',
    'Start with the exact script and creative world.',
    '/episodes/' || episode_id::text || '/create'
  );

  response := jsonb_build_object(
    'ok', true,
    'episodeId', episode_id,
    'episodeNumber', next_number,
    'workItemId', work_item_id,
    'aggregateVersion', 1
  );
  perform private.record_command(
    p_command_id,
    p_workspace_id,
    actor_id,
    p_idempotency_key,
    'episode.create',
    'episode',
    episode_id,
    null,
    p_request_hash,
    response,
    p_correlation_id
  );
  perform private.insert_audit_event(
    p_workspace_id,
    'episode.create',
    'episode',
    episode_id,
    1,
    p_command_id,
    p_idempotency_key,
    p_correlation_id,
    'allow',
    'accepted'
  );
  return response;
end;
$$;

revoke all on function public.command_create_episode(
  uuid,uuid,text,text,uuid,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_create_episode(
  uuid,uuid,text,text,uuid,uuid,text,text,uuid
) to authenticated;

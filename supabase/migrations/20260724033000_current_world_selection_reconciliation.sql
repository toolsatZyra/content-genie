-- A retried World run may legitimately extract a different entity set while
-- prior candidates remain immutable audit evidence. Keep those historical
-- selections, but remove them from the active selection tables before building
-- the reference pack for the latest succeeded World run.

create table private.world_selection_history (
  selection_kind text not null
    check (selection_kind in ('character', 'location')),
  selection_id uuid not null,
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  world_entity_id uuid not null,
  authoritative_preflight_run_id uuid not null,
  snapshot_json jsonb not null,
  snapshot_sha256 text not null
    check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  archived_reason text not null
    check (archived_reason = 'not_in_latest_succeeded_world_run'),
  archived_at timestamptz not null default statement_timestamp(),
  primary key (selection_kind, selection_id),
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, authoritative_preflight_run_id)
    references public.preflight_runs(workspace_id, id)
    on delete restrict
);

create index world_selection_history_configuration_idx
  on private.world_selection_history(
    workspace_id,
    configuration_candidate_id,
    authoritative_preflight_run_id
  );

create or replace function private.reject_world_selection_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'world selection history is immutable' using errcode = '42501';
end;
$$;

create trigger world_selection_history_immutable
before update or delete on private.world_selection_history
for each row execute function private.reject_world_selection_history_mutation();

revoke all on table private.world_selection_history
  from public, anon, authenticated, service_role;
revoke all on function private.reject_world_selection_history_mutation()
  from public, anon, authenticated, service_role;

create or replace function public.command_reconcile_current_world_selections(
  p_workspace_id uuid,
  p_configuration_candidate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  authoritative_run public.preflight_runs%rowtype;
  archived_character_count integer := 0;
  archived_location_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  perform 1
  from public.episode_configuration_candidates candidate
  where candidate.id = p_configuration_candidate_id
    and candidate.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'World selection scope is unavailable' using errcode = '40001';
  end if;

  select run.*
  into authoritative_run
  from public.preflight_runs run
  where run.workspace_id = p_workspace_id
    and run.configuration_candidate_id = p_configuration_candidate_id
    and run.kind = 'world_anchor'
    and run.state = 'succeeded'
  order by run.run_number desc, run.id desc
  limit 1;

  -- Legacy/imported configurations that predate durable World execution retain
  -- their existing selection semantics. A live retry is reconciled only after
  -- its exact run has succeeded.
  if authoritative_run.id is null then
    return jsonb_build_object(
      'ok', true,
      'reconciled', false,
      'reason', 'no_succeeded_world_run',
      'archivedCharacterSelections', 0,
      'archivedLocationSelections', 0
    );
  end if;

  perform 1
  from public.preflight_runs run
  where run.id = authoritative_run.id
  for update;

  if not exists (
      select 1
      from public.world_build_progress_items progress
      where progress.workspace_id = p_workspace_id
        and progress.configuration_candidate_id = p_configuration_candidate_id
        and progress.preflight_run_id = authoritative_run.id
        and progress.item_kind <> 'system'
    )
    or exists (
      select 1
      from public.world_build_progress_items progress
      where progress.workspace_id = p_workspace_id
        and progress.configuration_candidate_id = p_configuration_candidate_id
        and progress.preflight_run_id = authoritative_run.id
        and progress.item_kind <> 'system'
        and (
          progress.world_entity_id is null
          or progress.state <> 'review_ready'
        )
    )
  then
    raise exception 'authoritative World entity scope is incomplete'
      using errcode = '40001';
  end if;

  lock table public.character_selections, public.location_selections
    in share row exclusive mode;

  insert into private.world_selection_history(
    selection_kind,
    selection_id,
    workspace_id,
    configuration_candidate_id,
    world_entity_id,
    authoritative_preflight_run_id,
    snapshot_json,
    snapshot_sha256,
    archived_reason
  )
  select
    'character',
    selection.id,
    selection.workspace_id,
    selection.configuration_candidate_id,
    selection.character_form_id,
    authoritative_run.id,
    to_jsonb(selection),
    encode(
      extensions.digest(
        convert_to(to_jsonb(selection)::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'not_in_latest_succeeded_world_run'
  from public.character_selections selection
  where selection.workspace_id = p_workspace_id
    and selection.configuration_candidate_id = p_configuration_candidate_id
    and not exists (
      select 1
      from public.world_build_progress_items progress
      where progress.workspace_id = selection.workspace_id
        and progress.configuration_candidate_id =
          selection.configuration_candidate_id
        and progress.preflight_run_id = authoritative_run.id
        and progress.item_kind = 'character'
        and progress.world_entity_id = selection.character_form_id
    )
  on conflict (selection_kind, selection_id) do nothing;
  get diagnostics archived_character_count = row_count;

  if exists (
    select 1
    from public.character_selections selection
    join private.world_selection_history history
      on history.selection_kind = 'character'
      and history.selection_id = selection.id
    where selection.workspace_id = p_workspace_id
      and selection.configuration_candidate_id = p_configuration_candidate_id
      and history.snapshot_sha256 <> encode(
        extensions.digest(
          convert_to(to_jsonb(selection)::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
  ) then
    raise exception 'World character selection archive conflicts'
      using errcode = '40001';
  end if;

  delete from public.character_selections selection
  where selection.workspace_id = p_workspace_id
    and selection.configuration_candidate_id = p_configuration_candidate_id
    and not exists (
      select 1
      from public.world_build_progress_items progress
      where progress.workspace_id = selection.workspace_id
        and progress.configuration_candidate_id =
          selection.configuration_candidate_id
        and progress.preflight_run_id = authoritative_run.id
        and progress.item_kind = 'character'
        and progress.world_entity_id = selection.character_form_id
    )
    and exists (
      select 1
      from private.world_selection_history history
      where history.selection_kind = 'character'
        and history.selection_id = selection.id
        and history.snapshot_sha256 = encode(
          extensions.digest(
            convert_to(to_jsonb(selection)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
    );

  insert into private.world_selection_history(
    selection_kind,
    selection_id,
    workspace_id,
    configuration_candidate_id,
    world_entity_id,
    authoritative_preflight_run_id,
    snapshot_json,
    snapshot_sha256,
    archived_reason
  )
  select
    'location',
    selection.id,
    selection.workspace_id,
    selection.configuration_candidate_id,
    selection.location_id,
    authoritative_run.id,
    to_jsonb(selection),
    encode(
      extensions.digest(
        convert_to(to_jsonb(selection)::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'not_in_latest_succeeded_world_run'
  from public.location_selections selection
  where selection.workspace_id = p_workspace_id
    and selection.configuration_candidate_id = p_configuration_candidate_id
    and not exists (
      select 1
      from public.world_build_progress_items progress
      where progress.workspace_id = selection.workspace_id
        and progress.configuration_candidate_id =
          selection.configuration_candidate_id
        and progress.preflight_run_id = authoritative_run.id
        and progress.item_kind in ('location', 'prop')
        and progress.world_entity_id = selection.location_id
    )
  on conflict (selection_kind, selection_id) do nothing;
  get diagnostics archived_location_count = row_count;

  if exists (
    select 1
    from public.location_selections selection
    join private.world_selection_history history
      on history.selection_kind = 'location'
      and history.selection_id = selection.id
    where selection.workspace_id = p_workspace_id
      and selection.configuration_candidate_id = p_configuration_candidate_id
      and history.snapshot_sha256 <> encode(
        extensions.digest(
          convert_to(to_jsonb(selection)::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )
  ) then
    raise exception 'World location selection archive conflicts'
      using errcode = '40001';
  end if;

  delete from public.location_selections selection
  where selection.workspace_id = p_workspace_id
    and selection.configuration_candidate_id = p_configuration_candidate_id
    and not exists (
      select 1
      from public.world_build_progress_items progress
      where progress.workspace_id = selection.workspace_id
        and progress.configuration_candidate_id =
          selection.configuration_candidate_id
        and progress.preflight_run_id = authoritative_run.id
        and progress.item_kind in ('location', 'prop')
        and progress.world_entity_id = selection.location_id
    )
    and exists (
      select 1
      from private.world_selection_history history
      where history.selection_kind = 'location'
        and history.selection_id = selection.id
        and history.snapshot_sha256 = encode(
          extensions.digest(
            convert_to(to_jsonb(selection)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        )
    );

  return jsonb_build_object(
    'ok', true,
    'reconciled', true,
    'authoritativePreflightRunId', authoritative_run.id,
    'archivedCharacterSelections', archived_character_count,
    'archivedLocationSelections', archived_location_count
  );
end;
$$;

revoke all on function public.command_reconcile_current_world_selections(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.command_reconcile_current_world_selections(uuid, uuid)
  to service_role;

-- Bind every owner rejection to one durable repair lineage. Repair planning and
-- artifact selection are append-only; prior masters, frames, and clips are
-- referenced in place and are never deleted or overwritten.

alter table public.mvp_master_reviews
  add constraint mvp_master_reviews_reject_feedback_required_check
  check (
    decision <> 'reject'
    or (feedback is not null and char_length(btrim(feedback)) between 1 and 4000)
  ) not valid;

alter table public.mvp_master_reviews
  add constraint mvp_master_reviews_repair_lineage_uq
  unique (id, workspace_id, episode_id, master_id, master_version);

alter table public.mvp_master_reviews
  drop constraint if exists mvp_master_reviews_actor_aal_check;
alter table public.mvp_master_reviews
  add constraint mvp_master_reviews_actor_aal_check
  check (actor_aal in ('aal1','aal2'));

alter table public.mvp_production_jobs
  drop constraint if exists mvp_production_jobs_state_check;
alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_state_check
  check (state in (
    'queued','repair_planning','generating','rendering','review_ready',
    'needs_repair','approved','export_ready','failed','canceled'
  ));

alter table public.mvp_episode_masters
  add constraint mvp_episode_masters_repair_lineage_uq
  unique (
    id, workspace_id, episode_id, production_run_id, attempt_number
  );

-- A repaired clip may intentionally animate a storyboard frame from the prior
-- attempt. Existing inserts remain compatible: the trigger binds an omitted
-- source attempt to the clip's own attempt.
alter table private.mvp_production_clips
  add column storyboard_source_attempt_number integer;
alter table private.mvp_production_clips
  add column storyboard_end_source_attempt_number integer;

update private.mvp_production_clips
set storyboard_source_attempt_number = attempt_number
where storyboard_frame_id is not null;
update private.mvp_production_clips
set storyboard_end_source_attempt_number = attempt_number
where storyboard_end_frame_id is not null;

alter table private.mvp_production_clips
  drop constraint mvp_production_clips_storyboard_frame_match_fk;
alter table private.mvp_production_clips
  drop constraint mvp_production_clips_storyboard_end_match_fk;

alter table private.mvp_production_clips
  add constraint mvp_production_clips_repair_lineage_uq
  unique (
    id, workspace_id, production_run_id, attempt_number, shot_number
  );

alter table private.mvp_production_clips
  add constraint mvp_production_clips_storyboard_end_source_attempt_check
  check (
    (storyboard_end_frame_id is null
      and storyboard_end_source_attempt_number is null)
    or
    (storyboard_end_frame_id is not null
      and storyboard_frame_id is not null
      and storyboard_end_source_attempt_number between 1 and attempt_number)
  );

alter table private.mvp_production_clips
  add constraint mvp_production_clips_storyboard_source_attempt_check
  check (
    (storyboard_frame_id is null and storyboard_source_attempt_number is null)
    or
    (storyboard_frame_id is not null
      and storyboard_source_attempt_number between 1 and attempt_number)
  );

alter table private.mvp_production_clips
  add constraint mvp_production_clips_storyboard_source_match_fk
  foreign key (
    storyboard_frame_id, workspace_id, production_run_id,
    storyboard_source_attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict;
alter table private.mvp_production_clips
  add constraint mvp_production_clips_storyboard_end_source_match_fk
  foreign key (
    storyboard_end_frame_id, workspace_id, production_run_id,
    storyboard_end_source_attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict;

create or replace function private.bind_mvp_clip_storyboard_source_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.storyboard_frame_id is null then
    new.storyboard_source_attempt_number := null;
  elsif new.storyboard_source_attempt_number is null then
    new.storyboard_source_attempt_number := new.attempt_number;
  end if;
  if new.storyboard_end_frame_id is null then
    new.storyboard_end_source_attempt_number := null;
  elsif new.storyboard_end_source_attempt_number is null then
    new.storyboard_end_source_attempt_number := new.attempt_number;
  end if;
  return new;
end;
$$;

create trigger mvp_clip_storyboard_source_attempt
before insert or update of storyboard_frame_id, storyboard_source_attempt_number,
  storyboard_end_frame_id, storyboard_end_source_attempt_number, attempt_number
on private.mvp_production_clips
for each row execute function private.bind_mvp_clip_storyboard_source_attempt();

create or replace view public.mvp_production_clip_worker
with (security_invoker = true)
as
select * from private.mvp_production_clips;

revoke all on public.mvp_production_clip_worker
from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_production_clip_worker
to service_role;

create or replace function private.guard_terminal_mvp_artifact_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'production artifacts cannot be deleted' using errcode = '55000';
  end if;
  if old.state in ('complete','failed') then
    raise exception 'terminal production artifacts are immutable'
      using errcode = '55000';
  end if;
  if to_jsonb(new) - array[
      'state','object_name','content_sha256','byte_length','media_mime',
      'width','height','duration_ms','completed_at','last_error_code',
      'last_error_summary'
    ]::text[]
    is distinct from
    to_jsonb(old) - array[
      'state','object_name','content_sha256','byte_length','media_mime',
      'width','height','duration_ms','completed_at','last_error_code',
      'last_error_summary'
    ]::text[]
  then
    raise exception 'production artifact inputs and lineage are immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger mvp_storyboard_frames_terminal_immutable
before update or delete on private.mvp_storyboard_frames
for each row execute function private.guard_terminal_mvp_artifact_mutation();

create trigger mvp_production_clips_terminal_immutable
before update or delete on private.mvp_production_clips
for each row execute function private.guard_terminal_mvp_artifact_mutation();

revoke all on function private.bind_mvp_clip_storyboard_source_attempt()
from public, anon, authenticated;
revoke all on function private.guard_terminal_mvp_artifact_mutation()
from public, anon, authenticated;

create table public.mvp_repair_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  production_run_id uuid not null,
  plan_bundle_id uuid not null,
  review_id uuid not null,
  source_master_id uuid not null,
  source_master_version bigint not null check (source_master_version > 0),
  source_attempt_number integer not null check (
    source_attempt_number between 1 and 20
  ),
  target_attempt_number integer check (
    target_attempt_number between 2 and 20
  ),
  opened_job_version bigint not null check (opened_job_version > 0),
  feedback_sha256 text not null check (feedback_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state in (
    'awaiting_retry','analyzing','planned','executing','complete','failed'
  )),
  version bigint not null default 1 check (version > 0),
  planner_lease_token uuid,
  planner_lease_expires_at timestamptz,
  planner_claimed_at timestamptz,
  total_shots integer not null default 0 check (total_shots between 0 and 80),
  affected_shots integer not null default 0 check (
    affected_shots between 0 and total_shots
  ),
  storyboards_reused integer not null default 0 check (
    storyboards_reused between 0 and total_shots
  ),
  storyboards_missing_legacy integer not null default 0 check (
    storyboards_missing_legacy between 0 and total_shots
  ),
  storyboards_to_regenerate integer not null default 0 check (
    storyboards_to_regenerate between 0 and total_shots
  ),
  storyboards_regenerated integer not null default 0 check (
    storyboards_regenerated between 0 and storyboards_to_regenerate
  ),
  clips_reused integer not null default 0 check (
    clips_reused between 0 and total_shots
  ),
  clips_to_regenerate integer not null default 0 check (
    clips_to_regenerate between 0 and total_shots
  ),
  clips_regenerated integer not null default 0 check (
    clips_regenerated between 0 and clips_to_regenerate
  ),
  shots_selected integer not null default 0 check (
    shots_selected between 0 and total_shots
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  last_error_summary text check (
    last_error_summary is null
    or char_length(last_error_summary) between 1 and 500
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  unique (review_id),
  unique (production_run_id, source_attempt_number),
  unique (production_run_id, target_attempt_number),
  unique (workspace_id, id),
  unique (id, workspace_id, production_run_id),
  unique (
    id, workspace_id, episode_id, production_run_id,
    source_attempt_number, target_attempt_number
  ),
  foreign key (workspace_id, production_run_id, episode_id, plan_bundle_id)
    references public.mvp_production_jobs(
      workspace_id, production_run_id, episode_id, plan_bundle_id
    ) on delete restrict,
  foreign key (
    review_id, workspace_id, episode_id, source_master_id,
    source_master_version
  ) references public.mvp_master_reviews(
    id, workspace_id, episode_id, master_id, master_version
  ) on delete restrict,
  foreign key (
    source_master_id, workspace_id, episode_id, production_run_id,
    source_attempt_number
  ) references public.mvp_episode_masters(
    id, workspace_id, episode_id, production_run_id, attempt_number
  ) on delete restrict,
  check (
    target_attempt_number is null
    or target_attempt_number = source_attempt_number + 1
  ),
  check (
    (planner_lease_token is null and planner_lease_expires_at is null)
    or (planner_lease_token is not null and planner_lease_expires_at is not null)
  ),
  check (
    (total_shots = 0
      and affected_shots = 0
      and storyboards_reused = 0
      and storyboards_missing_legacy = 0
      and storyboards_to_regenerate = 0
      and storyboards_regenerated = 0
      and clips_reused = 0
      and clips_to_regenerate = 0
      and clips_regenerated = 0
      and shots_selected = 0)
    or
    (total_shots > 0
      and storyboards_reused + storyboards_missing_legacy
        + storyboards_to_regenerate = total_shots
      and clips_reused + clips_to_regenerate = total_shots)
  ),
  check (completed_at is null or completed_at >= created_at)
);

alter table public.mvp_production_jobs
  add column active_repair_request_id uuid;

alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_active_repair_request_fk
  foreign key (
    active_repair_request_id, workspace_id, production_run_id
  ) references public.mvp_repair_requests(
    id, workspace_id, production_run_id
  ) on delete restrict;

create table private.mvp_repair_plan_versions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  production_run_id uuid not null,
  repair_request_id uuid not null,
  source_attempt_number integer not null check (
    source_attempt_number between 1 and 19
  ),
  target_attempt_number integer not null check (
    target_attempt_number between 2 and 20
  ),
  plan_version_number integer not null check (
    plan_version_number between 1 and 20
  ),
  schema_version text not null check (
    schema_version = 'genie.mvp-selective-repair.v1'
  ),
  source_edd_version_id uuid not null,
  source_repair_plan_version_id uuid,
  source_edd_content_sha256 text not null check (
    source_edd_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  feedback_sha256 text not null check (feedback_sha256 ~ '^[a-f0-9]{64}$'),
  input_manifest_sha256 text not null check (
    input_manifest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  prompt_sha256 text not null check (prompt_sha256 ~ '^[a-f0-9]{64}$'),
  model_version text not null check (char_length(model_version) between 3 and 160),
  model_result_sha256 text not null check (
    model_result_sha256 ~ '^[a-f0-9]{64}$'
  ),
  shot_decisions_sha256 text not null check (
    shot_decisions_sha256 ~ '^[a-f0-9]{64}$'
  ),
  repaired_edd_payload jsonb not null check (
    jsonb_typeof(repaired_edd_payload) = 'object'
    and pg_column_size(repaired_edd_payload) <= 524288
  ),
  repaired_edd_content_sha256 text not null check (
    repaired_edd_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  total_shots integer not null check (total_shots between 1 and 80),
  affected_shots integer not null check (
    affected_shots between 1 and total_shots
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (repair_request_id, plan_version_number),
  unique (repair_request_id, repaired_edd_content_sha256),
  unique (
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    source_attempt_number, target_attempt_number
  ),
  foreign key (
    repair_request_id, workspace_id, episode_id, production_run_id,
    source_attempt_number, target_attempt_number
  ) references public.mvp_repair_requests(
    id, workspace_id, episode_id, production_run_id,
    source_attempt_number, target_attempt_number
  ) on delete restrict,
  foreign key (workspace_id, source_edd_version_id)
    references public.preflight_plan_component_versions(workspace_id, id)
    on delete restrict,
  foreign key (source_repair_plan_version_id)
    references private.mvp_repair_plan_versions(id) on delete restrict,
  check (
    (source_attempt_number = 1 and source_repair_plan_version_id is null)
    or (source_attempt_number > 1 and source_repair_plan_version_id is not null)
  ),
  check (target_attempt_number = source_attempt_number + 1)
);

alter table public.mvp_repair_requests
  add column active_plan_version_id uuid;

alter table public.mvp_repair_requests
  add constraint mvp_repair_requests_active_plan_fk
  foreign key (
    active_plan_version_id, workspace_id, episode_id, production_run_id, id,
    source_attempt_number, target_attempt_number
  ) references private.mvp_repair_plan_versions(
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    source_attempt_number, target_attempt_number
  ) on delete restrict;

alter table public.mvp_repair_requests
  add constraint mvp_repair_requests_state_progress_check
  check (
    (state = 'awaiting_retry'
      and target_attempt_number is null
      and active_plan_version_id is null
      and started_at is null and completed_at is null
      and planner_lease_token is null and planner_lease_expires_at is null
      and planner_claimed_at is null
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'analyzing'
      and target_attempt_number is not null
      and active_plan_version_id is null
      and started_at is not null and completed_at is null
      and total_shots = 0
      and last_error_code is null and last_error_summary is null)
    or
    (state in ('planned','executing')
      and target_attempt_number is not null
      and active_plan_version_id is not null
      and started_at is not null and completed_at is null
      and total_shots > 0
      and planner_lease_token is null and planner_lease_expires_at is null
      and planner_claimed_at is not null
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'complete'
      and target_attempt_number is not null
      and active_plan_version_id is not null
      and started_at is not null and completed_at is not null
      and total_shots > 0 and shots_selected = total_shots
      and storyboards_regenerated = storyboards_to_regenerate
      and clips_regenerated = clips_to_regenerate
      and planner_lease_token is null and planner_lease_expires_at is null
      and planner_claimed_at is not null
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'failed'
      and completed_at is not null
      and planner_lease_token is null and planner_lease_expires_at is null
      and last_error_code is not null and last_error_summary is not null)
  );

create table private.mvp_repair_shot_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  production_run_id uuid not null,
  repair_request_id uuid not null,
  plan_version_id uuid not null,
  source_attempt_number integer not null check (
    source_attempt_number between 1 and 19
  ),
  target_attempt_number integer not null check (
    target_attempt_number between 2 and 20
  ),
  shot_number integer not null check (shot_number between 1 and 80),
  action text not null check (action in (
    'reuse_all','regenerate_storyboard_and_clip','regenerate_clip','reedit_only'
  )),
  reason text not null check (char_length(reason) between 1 and 2000),
  dependency_reason text check (
    dependency_reason is null
    or char_length(dependency_reason) between 1 and 2000
  ),
  source_storyboard_frame_id uuid,
  source_storyboard_attempt_number integer,
  source_storyboard_end_frame_id uuid,
  source_storyboard_end_attempt_number integer,
  source_clip_id uuid not null,
  source_clip_attempt_number integer not null,
  decision_sha256 text not null check (decision_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (plan_version_id, shot_number),
  unique (repair_request_id, shot_number),
  unique (
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    plan_version_id, source_attempt_number, target_attempt_number,
    shot_number, action
  ),
  foreign key (
    plan_version_id, workspace_id, episode_id, production_run_id,
    repair_request_id, source_attempt_number, target_attempt_number
  ) references private.mvp_repair_plan_versions(
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    source_attempt_number, target_attempt_number
  ) on delete restrict,
  foreign key (
    source_storyboard_frame_id, workspace_id, production_run_id,
    source_storyboard_attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict,
  foreign key (
    source_storyboard_end_frame_id, workspace_id, production_run_id,
    source_storyboard_end_attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict,
  foreign key (
    source_clip_id, workspace_id, production_run_id,
    source_clip_attempt_number, shot_number
  ) references private.mvp_production_clips(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict,
  check (target_attempt_number = source_attempt_number + 1),
  check (source_clip_attempt_number between 1 and source_attempt_number),
  check (
    (source_storyboard_frame_id is null
      and source_storyboard_attempt_number is null)
    or
    (source_storyboard_frame_id is not null
      and source_storyboard_attempt_number between 1 and source_attempt_number)
  ),
  check (
    (source_storyboard_end_frame_id is null
      and source_storyboard_end_attempt_number is null)
    or
    (source_storyboard_end_frame_id is not null
      and source_storyboard_frame_id is not null
      and source_storyboard_end_attempt_number between 1
        and source_attempt_number)
  ),
  check (action <> 'regenerate_clip' or source_storyboard_frame_id is not null)
);

create table private.mvp_attempt_shot_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  production_run_id uuid not null,
  repair_request_id uuid not null,
  plan_version_id uuid not null,
  decision_id uuid not null,
  source_attempt_number integer not null check (
    source_attempt_number between 1 and 19
  ),
  target_attempt_number integer not null check (
    target_attempt_number between 2 and 20
  ),
  shot_number integer not null check (shot_number between 1 and 80),
  decision_action text not null check (decision_action in (
    'reuse_all','regenerate_storyboard_and_clip','regenerate_clip','reedit_only'
  )),
  selected_storyboard_frame_id uuid,
  selected_storyboard_attempt_number integer,
  selected_storyboard_end_frame_id uuid,
  selected_storyboard_end_attempt_number integer,
  selected_clip_id uuid not null,
  selected_clip_attempt_number integer not null,
  selection_sha256 text not null check (selection_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (production_run_id, target_attempt_number, shot_number),
  unique (repair_request_id, shot_number),
  unique (decision_id),
  unique (workspace_id, id),
  foreign key (
    decision_id, workspace_id, episode_id, production_run_id,
    repair_request_id, plan_version_id, source_attempt_number,
    target_attempt_number, shot_number, decision_action
  ) references private.mvp_repair_shot_decisions(
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    plan_version_id, source_attempt_number, target_attempt_number,
    shot_number, action
  ) on delete restrict,
  foreign key (
    selected_storyboard_end_frame_id, workspace_id, production_run_id,
    selected_storyboard_end_attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict,
  foreign key (
    selected_storyboard_frame_id, workspace_id, production_run_id,
    selected_storyboard_attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict,
  foreign key (
    selected_clip_id, workspace_id, production_run_id,
    selected_clip_attempt_number, shot_number
  ) references private.mvp_production_clips(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict,
  check (target_attempt_number = source_attempt_number + 1),
  check (
    (selected_storyboard_frame_id is null
      and selected_storyboard_attempt_number is null)
    or
    (selected_storyboard_frame_id is not null
      and selected_storyboard_attempt_number between 1
        and target_attempt_number)
  ),
  check (
    (selected_storyboard_end_frame_id is null
      and selected_storyboard_end_attempt_number is null)
    or
    (selected_storyboard_end_frame_id is not null
      and selected_storyboard_frame_id is not null
      and selected_storyboard_end_attempt_number between 1
        and target_attempt_number)
  ),
  check (
    (decision_action in ('reuse_all','reedit_only')
      and selected_clip_attempt_number between 1 and source_attempt_number
      and (selected_storyboard_attempt_number is null
        or selected_storyboard_attempt_number between 1 and source_attempt_number)
      and (selected_storyboard_end_attempt_number is null
        or selected_storyboard_end_attempt_number between 1
          and source_attempt_number))
    or
    (decision_action = 'regenerate_clip'
      and selected_storyboard_attempt_number between 1 and source_attempt_number
      and (selected_storyboard_end_attempt_number is null
        or selected_storyboard_end_attempt_number between 1
          and source_attempt_number)
      and selected_clip_attempt_number = target_attempt_number)
    or
    (decision_action = 'regenerate_storyboard_and_clip'
      and selected_storyboard_attempt_number = target_attempt_number
      and (selected_storyboard_end_attempt_number is null
        or selected_storyboard_end_attempt_number = target_attempt_number)
      and selected_clip_attempt_number = target_attempt_number)
  )
);

create or replace function private.guard_mvp_repair_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.episode_id is distinct from old.episode_id
    or new.production_run_id is distinct from old.production_run_id
    or new.plan_bundle_id is distinct from old.plan_bundle_id
    or new.review_id is distinct from old.review_id
    or new.source_master_id is distinct from old.source_master_id
    or new.source_master_version is distinct from old.source_master_version
    or new.source_attempt_number is distinct from old.source_attempt_number
    or new.opened_job_version is distinct from old.opened_job_version
    or new.feedback_sha256 is distinct from old.feedback_sha256
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'repair request lineage is immutable' using errcode = '55000';
  end if;

  if new.version <> old.version + 1 then
    raise exception 'repair request version is not optimistic' using errcode = '40001';
  end if;

  if old.target_attempt_number is not null
    and new.target_attempt_number is distinct from old.target_attempt_number
  then
    raise exception 'repair target attempt is immutable' using errcode = '55000';
  end if;
  if old.target_attempt_number is null and new.target_attempt_number is not null
    and new.target_attempt_number <> old.source_attempt_number + 1
  then
    raise exception 'repair target attempt is invalid' using errcode = '23514';
  end if;

  if old.active_plan_version_id is not null
    and new.active_plan_version_id is distinct from old.active_plan_version_id
  then
    raise exception 'active repair plan is immutable' using errcode = '55000';
  end if;

  if not (
    new.state = old.state
    or (old.state = 'awaiting_retry' and new.state in ('analyzing','failed'))
    or (old.state = 'analyzing' and new.state in ('planned','failed'))
    or (old.state = 'planned' and new.state in ('executing','complete','failed'))
    or (old.state = 'executing' and new.state in ('complete','failed'))
  ) then
    raise exception 'repair request state transition is invalid'
      using errcode = '23514';
  end if;

  if old.total_shots > 0 and (
    new.total_shots is distinct from old.total_shots
    or new.affected_shots is distinct from old.affected_shots
    or new.storyboards_reused is distinct from old.storyboards_reused
    or new.storyboards_missing_legacy is distinct from old.storyboards_missing_legacy
    or new.storyboards_to_regenerate is distinct from old.storyboards_to_regenerate
    or new.clips_reused is distinct from old.clips_reused
    or new.clips_to_regenerate is distinct from old.clips_to_regenerate
  ) then
    raise exception 'repair plan totals are immutable' using errcode = '55000';
  end if;

  if new.storyboards_regenerated < old.storyboards_regenerated
    or new.clips_regenerated < old.clips_regenerated
    or new.shots_selected < old.shots_selected
  then
    raise exception 'repair progress cannot move backward' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger mvp_repair_requests_guard
before update on public.mvp_repair_requests
for each row execute function private.guard_mvp_repair_request_update();

create trigger mvp_repair_requests_updated_at
before update on public.mvp_repair_requests
for each row execute function private.set_updated_at();

create trigger mvp_repair_plan_versions_immutable
before update or delete on private.mvp_repair_plan_versions
for each row execute function private.reject_mutation();

create trigger mvp_repair_shot_decisions_immutable
before update or delete on private.mvp_repair_shot_decisions
for each row execute function private.reject_mutation();

create trigger mvp_attempt_shot_assets_immutable
before update or delete on private.mvp_attempt_shot_assets
for each row execute function private.reject_mutation();

revoke all on function private.guard_mvp_repair_request_update()
from public, anon, authenticated;

alter table public.mvp_repair_requests enable row level security;
alter table public.mvp_repair_requests force row level security;
alter table private.mvp_repair_plan_versions enable row level security;
alter table private.mvp_repair_plan_versions force row level security;
alter table private.mvp_repair_shot_decisions enable row level security;
alter table private.mvp_repair_shot_decisions force row level security;
alter table private.mvp_attempt_shot_assets enable row level security;
alter table private.mvp_attempt_shot_assets force row level security;

create policy mvp_repair_requests_member_select
on public.mvp_repair_requests for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

revoke all on public.mvp_repair_requests from public, anon, authenticated;
grant select (
  id, workspace_id, episode_id, production_run_id, source_attempt_number,
  target_attempt_number, state, version, total_shots, affected_shots,
  storyboards_reused, storyboards_missing_legacy,
  storyboards_to_regenerate, storyboards_regenerated, clips_reused,
  clips_to_regenerate, clips_regenerated, shots_selected, last_error_code,
  last_error_summary, created_at, started_at, completed_at, updated_at
) on public.mvp_repair_requests to authenticated;

revoke all on private.mvp_repair_plan_versions,
  private.mvp_repair_shot_decisions, private.mvp_attempt_shot_assets
from public, anon, authenticated;

revoke insert, update, delete on public.mvp_repair_requests from service_role;
revoke insert, update, delete on private.mvp_repair_plan_versions,
  private.mvp_repair_shot_decisions, private.mvp_attempt_shot_assets
from service_role;
revoke delete on public.mvp_storyboard_frame_worker,
  public.mvp_production_clip_worker from service_role;
revoke delete on private.mvp_storyboard_frames,
  private.mvp_production_clips from service_role;
grant select on public.mvp_repair_requests,
  private.mvp_repair_plan_versions, private.mvp_repair_shot_decisions,
  private.mvp_attempt_shot_assets to service_role;

create index mvp_repair_requests_state_idx
on public.mvp_repair_requests(state, updated_at, production_run_id);
create index mvp_repair_requests_episode_idx
on public.mvp_repair_requests(workspace_id, episode_id, created_at desc);
create index mvp_repair_requests_master_idx
on public.mvp_repair_requests(source_master_id);
create index mvp_repair_requests_created_by_idx
on public.mvp_repair_requests(created_by, created_at desc);
create index mvp_repair_requests_active_plan_idx
on public.mvp_repair_requests(active_plan_version_id)
where active_plan_version_id is not null;
create index mvp_production_jobs_active_repair_idx
on public.mvp_production_jobs(active_repair_request_id)
where active_repair_request_id is not null;
create index mvp_repair_plan_versions_source_edd_idx
on private.mvp_repair_plan_versions(source_edd_version_id);
create index mvp_repair_shot_decisions_source_frame_idx
on private.mvp_repair_shot_decisions(source_storyboard_frame_id)
where source_storyboard_frame_id is not null;
create index mvp_repair_shot_decisions_source_clip_idx
on private.mvp_repair_shot_decisions(source_clip_id);
create index mvp_attempt_shot_assets_frame_idx
on private.mvp_attempt_shot_assets(selected_storyboard_frame_id)
where selected_storyboard_frame_id is not null;
create index mvp_attempt_shot_assets_clip_idx
on private.mvp_attempt_shot_assets(selected_clip_id);
create index mvp_attempt_shot_assets_plan_idx
on private.mvp_attempt_shot_assets(plan_version_id, shot_number);

create or replace view public.mvp_repair_progress
with (security_invoker = true)
as
select
  id as repair_request_id,
  workspace_id,
  episode_id,
  production_run_id,
  source_attempt_number,
  target_attempt_number,
  state,
  version,
  total_shots,
  affected_shots,
  storyboards_reused,
  storyboards_missing_legacy,
  storyboards_to_regenerate,
  storyboards_regenerated,
  clips_reused,
  clips_to_regenerate,
  clips_regenerated,
  shots_selected,
  last_error_code,
  last_error_summary,
  created_at,
  started_at,
  completed_at,
  updated_at
from public.mvp_repair_requests;

grant select on public.mvp_repair_progress to authenticated;
revoke all on public.mvp_repair_progress from public, anon;

create or replace view public.mvp_repair_request_worker
with (security_invoker = true)
as
select
  request.*,
  review.feedback,
  master.object_name as source_master_object_name,
  master.content_sha256 as source_master_content_sha256,
  master.duration_ms as source_master_duration_ms
from public.mvp_repair_requests request
join public.mvp_master_reviews review on review.id = request.review_id
join public.mvp_episode_masters master on master.id = request.source_master_id;

create or replace view public.mvp_repair_plan_version_worker
with (security_invoker = true)
as
select * from private.mvp_repair_plan_versions;

create or replace view public.mvp_repair_shot_decision_worker
with (security_invoker = true)
as
select * from private.mvp_repair_shot_decisions;

create or replace view public.mvp_attempt_shot_asset_worker
with (security_invoker = true)
as
select * from private.mvp_attempt_shot_assets;

revoke all on public.mvp_repair_request_worker,
  public.mvp_repair_plan_version_worker,
  public.mvp_repair_shot_decision_worker,
  public.mvp_attempt_shot_asset_worker
from public, anon, authenticated;
grant select on public.mvp_repair_request_worker,
  public.mvp_repair_plan_version_worker,
  public.mvp_repair_shot_decision_worker,
  public.mvp_attempt_shot_asset_worker
to service_role;

create or replace function public.command_claim_next_mvp_repair(
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.mvp_repair_requests%rowtype;
  lease_value uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 60 and 600 then
    raise exception 'repair planner lease is invalid' using errcode = '22023';
  end if;

  select request.* into request_row
  from public.mvp_repair_requests request
  join public.mvp_production_jobs job
    on job.production_run_id = request.production_run_id
  where request.state = 'analyzing'
    and request.planner_lease_token is not null
    and request.planner_lease_expires_at <= statement_timestamp()
    and job.state = 'repair_planning'
    and job.active_repair_request_id = request.id
  order by request.planner_lease_expires_at, request.id
  for update of request skip locked
  limit 1;
  if found then
    update public.mvp_repair_requests
    set state = 'failed', version = version + 1,
        planner_lease_token = null, planner_lease_expires_at = null,
        completed_at = statement_timestamp(),
        last_error_code = 'REPAIR_PLANNER_RESULT_AMBIGUOUS',
        last_error_summary =
          'The repair-planner result became ambiguous after its lease expired; Genie will not repeat the model request automatically.'
    where id = request_row.id and version = request_row.version
      and state = 'analyzing'
      and planner_lease_expires_at <= statement_timestamp();
    update public.mvp_production_jobs
    set state = 'failed', version = version + 1,
        last_error_code = 'REPAIR_PLANNER_RESULT_AMBIGUOUS',
        last_error_summary =
          'The repair plan became ambiguous. The prior master and completed assets remain preserved.'
    where production_run_id = request_row.production_run_id
      and active_repair_request_id = request_row.id
      and state = 'repair_planning';
    update public.production_run_statuses
    set state = 'failed', version = version + 1,
        changed_at = statement_timestamp(),
        reason = 'Repair planner result became ambiguous'
    where production_run_id = request_row.production_run_id;
  end if;

  select request.* into request_row
  from public.mvp_repair_requests request
  join public.mvp_production_jobs job
    on job.production_run_id = request.production_run_id
  where request.state = 'analyzing'
    and request.planner_lease_token is null
    and job.state = 'repair_planning'
    and job.active_repair_request_id = request.id
    and job.attempt_number = request.target_attempt_number
  order by request.updated_at, request.id
  for update of request skip locked
  limit 1;
  if not found then
    return null;
  end if;

  update public.mvp_repair_requests
  set version = version + 1, planner_lease_token = lease_value,
      planner_lease_expires_at = statement_timestamp()
        + make_interval(secs => p_lease_seconds),
      planner_claimed_at = statement_timestamp()
  where id = request_row.id and version = request_row.version
    and state = 'analyzing' and planner_lease_token is null
  returning * into request_row;
  if not found then
    raise exception 'repair planner claim lost its optimistic race'
      using errcode = '40001';
  end if;
  return to_jsonb(request_row);
end;
$$;

create or replace function public.command_publish_mvp_repair_plan(
  p_repair_request_id uuid,
  p_expected_request_version bigint,
  p_planner_lease_token uuid,
  p_plan_version_id uuid,
  p_input_manifest_sha256 text,
  p_prompt_sha256 text,
  p_model_version text,
  p_model_result_sha256 text,
  p_repaired_edd_payload jsonb,
  p_shot_decisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.mvp_repair_requests%rowtype;
  source_edd public.preflight_plan_component_versions%rowtype;
  source_repair_plan private.mvp_repair_plan_versions%rowtype;
  existing_plan private.mvp_repair_plan_versions%rowtype;
  job_row public.mvp_production_jobs%rowtype;
  plan_number integer;
  plan_content_sha256 text;
  shot_decisions_hash text;
  total_shot_count integer;
  affected_count integer := 0;
  storyboards_reused_count integer := 0;
  storyboards_missing_count integer := 0;
  storyboards_regenerate_count integer := 0;
  clips_reused_count integer := 0;
  clips_regenerate_count integer := 0;
  decision_value jsonb;
  source_shot jsonb;
  repaired_shot jsonb;
  shot_number_value integer;
  action_value text;
  reason_value text;
  dependency_value text;
  source_frame_id_value uuid;
  source_end_frame_id_value uuid;
  source_clip_id_value uuid;
  source_frame private.mvp_storyboard_frames%rowtype;
  source_end_frame private.mvp_storyboard_frames%rowtype;
  source_clip private.mvp_production_clips%rowtype;
  prior_selection private.mvp_attempt_shot_assets%rowtype;
  decision_sha256 text;
  immutable_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_plan_version_id is null
    or p_planner_lease_token is null
    or p_expected_request_version < 1
    or p_input_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_prompt_sha256 !~ '^[a-f0-9]{64}$'
    or p_model_result_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(p_model_version) not between 3 and 160
    or p_repaired_edd_payload is null
    or jsonb_typeof(p_repaired_edd_payload) <> 'object'
    or pg_column_size(p_repaired_edd_payload) > 524288
    or p_shot_decisions is null
    or jsonb_typeof(p_shot_decisions) <> 'array'
  then
    raise exception 'repair plan envelope is invalid' using errcode = '22023';
  end if;

  plan_content_sha256 := encode(extensions.digest(
    convert_to(p_repaired_edd_payload::text, 'UTF8'), 'sha256'
  ), 'hex');
  shot_decisions_hash := encode(extensions.digest(
    convert_to(p_shot_decisions::text, 'UTF8'), 'sha256'
  ), 'hex');

  select * into request_row
  from public.mvp_repair_requests
  where id = p_repair_request_id
  for update;
  if not found then
    raise exception 'repair plan request is unavailable' using errcode = '40001';
  end if;
  select * into existing_plan
  from private.mvp_repair_plan_versions
  where id = p_plan_version_id;
  if existing_plan.id is not null then
    if request_row.active_plan_version_id = existing_plan.id
      and request_row.state in ('planned','executing','complete')
      and existing_plan.repair_request_id = request_row.id
      and existing_plan.input_manifest_sha256 = p_input_manifest_sha256
      and existing_plan.prompt_sha256 = p_prompt_sha256
      and existing_plan.model_version = p_model_version
      and existing_plan.model_result_sha256 = p_model_result_sha256
      and existing_plan.shot_decisions_sha256 = shot_decisions_hash
      and existing_plan.repaired_edd_content_sha256 = plan_content_sha256
    then
      return jsonb_build_object(
        'repairRequestId', request_row.id,
        'planVersionId', existing_plan.id,
        'state', request_row.state,
        'version', request_row.version,
        'totalShots', request_row.total_shots,
        'affectedShots', request_row.affected_shots,
        'replayed', true
      );
    end if;
    raise exception 'repair plan replay conflicts with committed evidence'
      using errcode = '40001';
  end if;
  if request_row.state <> 'analyzing'
    or request_row.version <> p_expected_request_version
    or request_row.planner_lease_token <> p_planner_lease_token
    or request_row.planner_lease_expires_at <= statement_timestamp()
    or request_row.target_attempt_number is null
    or request_row.active_plan_version_id is not null
  then
    raise exception 'repair plan publication is stale' using errcode = '40001';
  end if;

  select * into job_row from public.mvp_production_jobs
  where production_run_id = request_row.production_run_id
  for update;
  if not found or job_row.state <> 'repair_planning'
    or job_row.active_repair_request_id <> request_row.id
    or job_row.attempt_number <> request_row.target_attempt_number
  then
    raise exception 'repair production job is not fenced for planning'
      using errcode = '40001';
  end if;

  select component.* into source_edd
  from public.preflight_plan_bundles bundle
  join public.preflight_plan_component_versions component
    on component.workspace_id = bundle.workspace_id
    and component.id = bundle.edd_version_id
  where bundle.workspace_id = request_row.workspace_id
    and bundle.id = request_row.plan_bundle_id
    and component.component_kind = 'edd';
  if request_row.source_attempt_number > 1 then
    select plan.* into source_repair_plan
    from public.mvp_repair_requests prior_request
    join private.mvp_repair_plan_versions plan
      on plan.id = prior_request.active_plan_version_id
    where prior_request.production_run_id = request_row.production_run_id
      and prior_request.target_attempt_number = request_row.source_attempt_number
      and prior_request.state = 'complete';
  end if;
  if source_edd.id is null then
    raise exception 'repair EDD root lineage is invalid' using errcode = '23514';
  end if;
  if request_row.source_attempt_number > 1 and source_repair_plan.id is null then
    raise exception 'repair EDD source lineage is unavailable' using errcode = '23514';
  end if;
  if request_row.source_attempt_number > 1 then
    source_edd.payload := source_repair_plan.repaired_edd_payload;
    source_edd.content_hash := source_repair_plan.repaired_edd_content_sha256;
  end if;
  if jsonb_typeof(source_edd.payload->'shots') <> 'array'
    or p_repaired_edd_payload - 'shots' is distinct from source_edd.payload - 'shots'
    or jsonb_typeof(p_repaired_edd_payload->'shots') <> 'array'
  then
    raise exception 'repair EDD lineage is invalid' using errcode = '23514';
  end if;

  select count(*)::integer into total_shot_count
  from public.preflight_shots shot
  where shot.workspace_id = request_row.workspace_id
    and shot.plan_bundle_id = request_row.plan_bundle_id;
  if total_shot_count not between 1 and 80
    or jsonb_array_length(source_edd.payload->'shots') <> total_shot_count
    or jsonb_array_length(p_repaired_edd_payload->'shots') <> total_shot_count
    or jsonb_array_length(p_shot_decisions) <> total_shot_count
  then
    raise exception 'repair plan shot coverage is invalid' using errcode = '23514';
  end if;

  select count(*) filter (where value->>'action' <> 'reuse_all')::integer
  into affected_count
  from jsonb_array_elements(p_shot_decisions);
  if affected_count < 1 then
    raise exception 'repair plan does not affect any shot' using errcode = '23514';
  end if;

  select coalesce(max(plan_version_number), 0) + 1 into plan_number
  from private.mvp_repair_plan_versions
  where repair_request_id = request_row.id;

  insert into private.mvp_repair_plan_versions(
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    source_attempt_number, target_attempt_number, plan_version_number,
    schema_version, source_edd_version_id, source_repair_plan_version_id,
    source_edd_content_sha256,
    feedback_sha256, input_manifest_sha256, prompt_sha256, model_version,
    model_result_sha256, shot_decisions_sha256,
    repaired_edd_payload, repaired_edd_content_sha256,
    total_shots, affected_shots
  ) values(
    p_plan_version_id, request_row.workspace_id, request_row.episode_id,
    request_row.production_run_id, request_row.id,
    request_row.source_attempt_number, request_row.target_attempt_number,
    plan_number, 'genie.mvp-selective-repair.v1', source_edd.id,
    source_repair_plan.id,
    source_edd.content_hash, request_row.feedback_sha256,
    p_input_manifest_sha256, p_prompt_sha256, p_model_version,
    p_model_result_sha256, shot_decisions_hash,
    p_repaired_edd_payload, plan_content_sha256,
    total_shot_count, affected_count
  );

  for decision_value in select value from jsonb_array_elements(p_shot_decisions)
  loop
    source_frame := null;
    source_end_frame := null;
    source_clip := null;
    prior_selection := null;
    if jsonb_typeof(decision_value) <> 'object'
      or not (decision_value ?& array[
        'shotNumber','action','reason','dependencyReason',
        'sourceStoryboardFrameId','sourceStoryboardEndFrameId','sourceClipId'
      ])
      or (decision_value - array[
        'shotNumber','action','reason','dependencyReason',
        'sourceStoryboardFrameId','sourceStoryboardEndFrameId','sourceClipId'
      ]::text[]) <> '{}'::jsonb
    then
      raise exception 'repair shot decision is not exact' using errcode = '22023';
    end if;

    shot_number_value := (decision_value->>'shotNumber')::integer;
    action_value := decision_value->>'action';
    reason_value := btrim(decision_value->>'reason');
    dependency_value := nullif(btrim(decision_value->>'dependencyReason'), '');
    source_frame_id_value := nullif(
      btrim(decision_value->>'sourceStoryboardFrameId'), ''
    )::uuid;
    source_end_frame_id_value := nullif(
      btrim(decision_value->>'sourceStoryboardEndFrameId'), ''
    )::uuid;
    source_clip_id_value := nullif(
      btrim(decision_value->>'sourceClipId'), ''
    )::uuid;

    if action_value not in (
      'reuse_all','regenerate_storyboard_and_clip','regenerate_clip','reedit_only'
    ) or char_length(reason_value) not between 1 and 2000
      or (dependency_value is not null
        and char_length(dependency_value) not between 1 and 2000)
      or source_clip_id_value is null
      or not exists(
        select 1 from public.preflight_shots shot
        where shot.workspace_id = request_row.workspace_id
          and shot.plan_bundle_id = request_row.plan_bundle_id
          and shot.shot_number = shot_number_value
      )
    then
      raise exception 'repair shot decision is invalid' using errcode = '22023';
    end if;

    if (select count(*) from jsonb_array_elements(source_edd.payload->'shots') item
      where (item->>'shotNumber')::integer = shot_number_value) <> 1
      or (select count(*) from jsonb_array_elements(
        p_repaired_edd_payload->'shots'
      ) item where (item->>'shotNumber')::integer = shot_number_value) <> 1
    then
      raise exception 'repair EDD shot identity is ambiguous' using errcode = '23514';
    end if;
    select item into source_shot
    from jsonb_array_elements(source_edd.payload->'shots') item
    where (item->>'shotNumber')::integer = shot_number_value;
    select item into repaired_shot
    from jsonb_array_elements(p_repaired_edd_payload->'shots') item
    where (item->>'shotNumber')::integer = shot_number_value;

    foreach immutable_key in array array[
      'shotNumber','startMs','endMs','startScalar','endScalar','exactNarration'
    ] loop
      if source_shot->immutable_key is distinct from repaired_shot->immutable_key then
        raise exception 'repair EDD changed immutable narration timing'
          using errcode = '23514';
      end if;
    end loop;

    if action_value = 'reuse_all' and repaired_shot <> source_shot then
      raise exception 'unaffected repair shot was changed' using errcode = '23514';
    elsif action_value = 'reedit_only' and
      repaired_shot - array[
        'cutType','sfxCue','sfxDurationMs','sfxGainDb','sfxStartOffsetMs'
      ]::text[] <>
        source_shot - array[
          'cutType','sfxCue','sfxDurationMs','sfxGainDb','sfxStartOffsetMs'
        ]::text[]
    then
      raise exception 'edit-only repair changed a media prompt' using errcode = '23514';
    elsif action_value = 'regenerate_clip' and
      repaired_shot - array[
        'action','cameraMotion','motionPromptBlueprint','cutType','sfxCue',
        'sfxDurationMs','sfxGainDb','sfxStartOffsetMs'
      ]::text[] <>
        source_shot - array[
          'action','cameraMotion','motionPromptBlueprint','cutType','sfxCue',
          'sfxDurationMs','sfxGainDb','sfxStartOffsetMs'
        ]::text[]
    then
      raise exception 'motion-only repair changed a storyboard prompt'
        using errcode = '23514';
    elsif action_value = 'regenerate_storyboard_and_clip' and
      repaired_shot - array[
        'action','cameraAngleAndDistance','cameraMotion','cutType','lighting',
        'mood','narrativeFunction','motionPromptBlueprint','promptBlueprint',
        'sceneComposition','sfxCue','sfxDurationMs','sfxGainDb',
        'sfxStartOffsetMs','storyboardEndPromptBlueprint',
        'storyboardPromptBlueprint','storyboardStartPromptBlueprint','visualIntent'
      ]::text[] <>
        source_shot - array[
          'action','cameraAngleAndDistance','cameraMotion','cutType','lighting',
          'mood','narrativeFunction','motionPromptBlueprint','promptBlueprint',
        'sceneComposition','sfxCue','sfxDurationMs','sfxGainDb',
        'sfxStartOffsetMs','storyboardEndPromptBlueprint',
        'storyboardPromptBlueprint','storyboardStartPromptBlueprint','visualIntent'
        ]::text[]
    then
      raise exception 'storyboard repair changed a locked identity or reference'
        using errcode = '23514';
    end if;

    if request_row.source_attempt_number > 1 then
      select selected.* into prior_selection
      from private.mvp_attempt_shot_assets selected
      where selected.production_run_id = request_row.production_run_id
        and selected.target_attempt_number = request_row.source_attempt_number
        and selected.shot_number = shot_number_value;
      if prior_selection.id is null
        or prior_selection.selected_clip_id <> source_clip_id_value
        or prior_selection.selected_storyboard_frame_id
          is distinct from source_frame_id_value
        or prior_selection.selected_storyboard_end_frame_id
          is distinct from source_end_frame_id_value
      then
        raise exception 'source repair selection differs from the rendered source attempt'
          using errcode = '23514';
      end if;
    end if;

    select * into source_clip
    from private.mvp_production_clips clip
    where clip.id = source_clip_id_value
      and clip.workspace_id = request_row.workspace_id
      and clip.production_run_id = request_row.production_run_id
      and clip.attempt_number <= request_row.source_attempt_number
      and clip.shot_number = shot_number_value
      and clip.state = 'complete';
    if source_clip.id is null then
      raise exception 'source repair clip is unavailable' using errcode = '23514';
    end if;

    if source_frame_id_value is not null then
      select * into source_frame
      from private.mvp_storyboard_frames frame
      where frame.id = source_frame_id_value
        and frame.workspace_id = request_row.workspace_id
        and frame.production_run_id = request_row.production_run_id
        and frame.attempt_number <= request_row.source_attempt_number
        and frame.shot_number = shot_number_value
        and frame.state = 'complete';
      if source_frame.id is null then
        raise exception 'source repair storyboard is unavailable'
          using errcode = '23514';
      end if;
    end if;
    if source_end_frame_id_value is not null then
      select * into source_end_frame
      from private.mvp_storyboard_frames frame
      where frame.id = source_end_frame_id_value
        and frame.workspace_id = request_row.workspace_id
        and frame.production_run_id = request_row.production_run_id
        and frame.attempt_number <= request_row.source_attempt_number
        and frame.shot_number = shot_number_value
        and frame.frame_role = 'end'
        and frame.state = 'complete';
      if source_end_frame.id is null then
        raise exception 'source repair end storyboard is unavailable'
          using errcode = '23514';
      end if;
    end if;
    if source_clip.storyboard_frame_id is distinct from source_frame_id_value
      or source_clip.storyboard_end_frame_id
        is distinct from source_end_frame_id_value
      or (action_value = 'regenerate_clip' and source_frame_id_value is null)
    then
      raise exception 'source repair media lineage is inconsistent'
        using errcode = '23514';
    end if;

    decision_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
      'repairRequestId', request_row.id,
      'feedbackSha256', request_row.feedback_sha256,
      'shotNumber', shot_number_value,
      'action', action_value,
      'reason', reason_value,
      'dependencyReason', dependency_value,
      'sourceStoryboardFrameId', source_frame_id_value,
      'sourceStoryboardEndFrameId', source_end_frame_id_value,
      'sourceClipId', source_clip_id_value
    )::text, 'UTF8'), 'sha256'), 'hex');

    insert into private.mvp_repair_shot_decisions(
      workspace_id, episode_id, production_run_id, repair_request_id,
      plan_version_id, source_attempt_number, target_attempt_number,
      shot_number, action, reason, dependency_reason,
      source_storyboard_frame_id, source_storyboard_attempt_number,
      source_storyboard_end_frame_id, source_storyboard_end_attempt_number,
      source_clip_id, source_clip_attempt_number, decision_sha256
    ) values(
      request_row.workspace_id, request_row.episode_id,
      request_row.production_run_id, request_row.id, p_plan_version_id,
      request_row.source_attempt_number, request_row.target_attempt_number,
      shot_number_value, action_value, reason_value, dependency_value,
      source_frame_id_value,
      case when source_frame_id_value is null then null
        else source_frame.attempt_number end,
      source_end_frame_id_value,
      case when source_end_frame_id_value is null then null
        else source_end_frame.attempt_number end,
      source_clip_id_value, source_clip.attempt_number, decision_sha256
    );

    if action_value = 'regenerate_storyboard_and_clip' then
      storyboards_regenerate_count := storyboards_regenerate_count + 1;
    elsif source_frame_id_value is null then
      storyboards_missing_count := storyboards_missing_count + 1;
    else
      storyboards_reused_count := storyboards_reused_count + 1;
    end if;
    if action_value in ('regenerate_storyboard_and_clip','regenerate_clip') then
      clips_regenerate_count := clips_regenerate_count + 1;
    else
      clips_reused_count := clips_reused_count + 1;
    end if;
  end loop;

  update public.mvp_repair_requests
  set state = 'planned', version = version + 1,
      planner_lease_token = null, planner_lease_expires_at = null,
      active_plan_version_id = p_plan_version_id,
      total_shots = total_shot_count, affected_shots = affected_count,
      storyboards_reused = storyboards_reused_count,
      storyboards_missing_legacy = storyboards_missing_count,
      storyboards_to_regenerate = storyboards_regenerate_count,
      clips_reused = clips_reused_count,
      clips_to_regenerate = clips_regenerate_count
  where id = request_row.id and version = p_expected_request_version
  returning * into request_row;
  if not found then
    raise exception 'repair plan publication is stale' using errcode = '40001';
  end if;

  update public.mvp_production_jobs
  set state = 'queued', version = version + 1
  where production_run_id = request_row.production_run_id
    and active_repair_request_id = request_row.id
    and attempt_number = request_row.target_attempt_number
    and state = 'repair_planning';
  if not found then
    raise exception 'repair production activation is stale' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'repairRequestId', request_row.id,
    'planVersionId', p_plan_version_id,
    'state', request_row.state,
    'version', request_row.version,
    'totalShots', request_row.total_shots,
    'affectedShots', request_row.affected_shots,
    'replayed', false
  );
end;
$$;

create or replace function public.command_update_mvp_repair_progress(
  p_repair_request_id uuid,
  p_expected_request_version bigint,
  p_storyboards_regenerated integer,
  p_clips_regenerated integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare request_row public.mvp_repair_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into request_row from public.mvp_repair_requests
  where id = p_repair_request_id for update;
  if not found or request_row.version <> p_expected_request_version
    or request_row.state not in ('planned','executing')
    or p_storyboards_regenerated < request_row.storyboards_regenerated
    or p_storyboards_regenerated > request_row.storyboards_to_regenerate
    or p_clips_regenerated < request_row.clips_regenerated
    or p_clips_regenerated > request_row.clips_to_regenerate
  then
    raise exception 'repair progress update is stale or invalid'
      using errcode = '40001';
  end if;
  update public.mvp_repair_requests
  set state = 'executing', version = version + 1,
      storyboards_regenerated = p_storyboards_regenerated,
      clips_regenerated = p_clips_regenerated
  where id = p_repair_request_id and version = p_expected_request_version
  returning * into request_row;
  if not found then
    raise exception 'repair progress update is stale' using errcode = '40001';
  end if;
  return to_jsonb(request_row);
end;
$$;

create or replace function public.command_record_mvp_repair_shot_selection(
  p_repair_request_id uuid,
  p_expected_request_version bigint,
  p_plan_version_id uuid,
  p_shot_number integer,
  p_selected_storyboard_frame_id uuid,
  p_selected_storyboard_end_frame_id uuid,
  p_selected_clip_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.mvp_repair_requests%rowtype;
  decision_row private.mvp_repair_shot_decisions%rowtype;
  frame_row private.mvp_storyboard_frames%rowtype;
  end_frame_row private.mvp_storyboard_frames%rowtype;
  clip_row private.mvp_production_clips%rowtype;
  existing_row private.mvp_attempt_shot_assets%rowtype;
  selection_row private.mvp_attempt_shot_assets%rowtype;
  selected_count integer;
  regenerated_storyboard_count integer;
  regenerated_clip_count integer;
  selection_sha256 text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into request_row from public.mvp_repair_requests
  where id = p_repair_request_id for update;
  if not found or request_row.active_plan_version_id <> p_plan_version_id
  then
    raise exception 'repair shot selection is unavailable' using errcode = '40001';
  end if;

  select * into existing_row from private.mvp_attempt_shot_assets
  where repair_request_id = request_row.id and shot_number = p_shot_number;
  if existing_row.id is not null then
    if existing_row.plan_version_id = p_plan_version_id
      and existing_row.selected_storyboard_frame_id
        is not distinct from p_selected_storyboard_frame_id
      and existing_row.selected_storyboard_end_frame_id
        is not distinct from p_selected_storyboard_end_frame_id
      and existing_row.selected_clip_id = p_selected_clip_id
    then
      return jsonb_build_object(
        'selection', to_jsonb(existing_row),
        'repairRequestId', request_row.id,
        'state', request_row.state,
        'version', request_row.version,
        'shotsSelected', request_row.shots_selected,
        'totalShots', request_row.total_shots
      );
    end if;
    raise exception 'repair shot selection conflicts with prior evidence'
      using errcode = '40001';
  end if;
  if request_row.state not in ('planned','executing')
    or request_row.version <> p_expected_request_version
  then
    raise exception 'repair shot selection is stale' using errcode = '40001';
  end if;
  select * into decision_row from private.mvp_repair_shot_decisions
  where repair_request_id = request_row.id
    and plan_version_id = p_plan_version_id
    and shot_number = p_shot_number;
  if not found then
    raise exception 'repair shot decision is unavailable' using errcode = '23514';
  end if;

  select * into clip_row from private.mvp_production_clips clip
  where clip.id = p_selected_clip_id
    and clip.workspace_id = request_row.workspace_id
    and clip.production_run_id = request_row.production_run_id
    and clip.shot_number = p_shot_number
    and clip.state = 'complete';
  if not found then
    raise exception 'selected repair clip is unavailable' using errcode = '23514';
  end if;
  if p_selected_storyboard_frame_id is not null then
    select * into frame_row from private.mvp_storyboard_frames frame
    where frame.id = p_selected_storyboard_frame_id
      and frame.workspace_id = request_row.workspace_id
      and frame.production_run_id = request_row.production_run_id
      and frame.shot_number = p_shot_number
      and frame.state = 'complete';
    if not found then
      raise exception 'selected repair storyboard is unavailable'
        using errcode = '23514';
    end if;
  end if;
  if p_selected_storyboard_end_frame_id is not null then
    select * into end_frame_row from private.mvp_storyboard_frames frame
    where frame.id = p_selected_storyboard_end_frame_id
      and frame.workspace_id = request_row.workspace_id
      and frame.production_run_id = request_row.production_run_id
      and frame.shot_number = p_shot_number
      and frame.frame_role = 'end'
      and frame.state = 'complete';
    if not found then
      raise exception 'selected repair end storyboard is unavailable'
        using errcode = '23514';
    end if;
  end if;

  if decision_row.action in ('reuse_all','reedit_only') and (
      p_selected_storyboard_frame_id
        is distinct from decision_row.source_storyboard_frame_id
      or p_selected_storyboard_end_frame_id
        is distinct from decision_row.source_storyboard_end_frame_id
      or p_selected_clip_id <> decision_row.source_clip_id
    )
    or decision_row.action = 'regenerate_clip' and (
      p_selected_storyboard_frame_id
        is distinct from decision_row.source_storyboard_frame_id
      or p_selected_storyboard_end_frame_id
        is distinct from decision_row.source_storyboard_end_frame_id
      or clip_row.attempt_number <> request_row.target_attempt_number
      or clip_row.storyboard_frame_id
        is distinct from p_selected_storyboard_frame_id
      or clip_row.storyboard_end_frame_id
        is distinct from p_selected_storyboard_end_frame_id
    )
    or decision_row.action = 'regenerate_storyboard_and_clip' and (
      p_selected_storyboard_frame_id is null
      or frame_row.attempt_number <> request_row.target_attempt_number
      or (p_selected_storyboard_end_frame_id is not null
        and end_frame_row.attempt_number <> request_row.target_attempt_number)
      or clip_row.attempt_number <> request_row.target_attempt_number
      or clip_row.storyboard_frame_id
        is distinct from p_selected_storyboard_frame_id
      or clip_row.storyboard_end_frame_id
        is distinct from p_selected_storyboard_end_frame_id
    )
  then
    raise exception 'selected repair assets do not match the repair decision'
      using errcode = '23514';
  end if;

  selection_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
    'repairRequestId', request_row.id,
    'planVersionId', p_plan_version_id,
    'decisionId', decision_row.id,
    'decisionSha256', decision_row.decision_sha256,
    'shotNumber', p_shot_number,
    'selectedStoryboardFrameId', p_selected_storyboard_frame_id,
    'selectedStoryboardEndFrameId', p_selected_storyboard_end_frame_id,
    'selectedClipId', p_selected_clip_id
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into private.mvp_attempt_shot_assets(
    workspace_id, episode_id, production_run_id, repair_request_id,
    plan_version_id, decision_id, source_attempt_number,
    target_attempt_number, shot_number, decision_action,
    selected_storyboard_frame_id, selected_storyboard_attempt_number,
    selected_storyboard_end_frame_id, selected_storyboard_end_attempt_number,
    selected_clip_id, selected_clip_attempt_number, selection_sha256
  ) values(
    request_row.workspace_id, request_row.episode_id,
    request_row.production_run_id, request_row.id, p_plan_version_id,
    decision_row.id, request_row.source_attempt_number,
    request_row.target_attempt_number, p_shot_number, decision_row.action,
    p_selected_storyboard_frame_id,
    case when p_selected_storyboard_frame_id is null then null
      else frame_row.attempt_number end,
    p_selected_storyboard_end_frame_id,
    case when p_selected_storyboard_end_frame_id is null then null
      else end_frame_row.attempt_number end,
    p_selected_clip_id, clip_row.attempt_number, selection_sha256
  ) returning * into selection_row;

  select
    count(*)::integer,
    count(*) filter (
      where decision.action = 'regenerate_storyboard_and_clip'
    )::integer,
    count(*) filter (
      where decision.action in ('regenerate_storyboard_and_clip','regenerate_clip')
    )::integer
  into selected_count, regenerated_storyboard_count, regenerated_clip_count
  from private.mvp_attempt_shot_assets selected
  join private.mvp_repair_shot_decisions decision
    on decision.id = selected.decision_id
  where selected.repair_request_id = request_row.id;

  update public.mvp_repair_requests
  set state = case when selected_count = total_shots
        then 'complete' else 'executing' end,
      version = version + 1,
      shots_selected = selected_count,
      storyboards_regenerated = greatest(
        storyboards_regenerated, regenerated_storyboard_count
      ),
      clips_regenerated = greatest(clips_regenerated, regenerated_clip_count),
      completed_at = case when selected_count = total_shots
        then statement_timestamp() else null end
  where id = request_row.id and version = p_expected_request_version
  returning * into request_row;
  if not found then
    raise exception 'repair shot selection is stale' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'selection', to_jsonb(selection_row),
    'repairRequestId', request_row.id,
    'state', request_row.state,
    'version', request_row.version,
    'shotsSelected', request_row.shots_selected,
    'totalShots', request_row.total_shots
  );
end;
$$;

create or replace function public.command_fail_mvp_repair_request(
  p_repair_request_id uuid,
  p_expected_request_version bigint,
  p_planner_lease_token uuid,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare request_row public.mvp_repair_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    or char_length(btrim(p_error_summary)) < 1
  then
    raise exception 'repair failure is invalid' using errcode = '22023';
  end if;
  select * into request_row from public.mvp_repair_requests
  where id = p_repair_request_id for update;
  if not found or request_row.version <> p_expected_request_version
    or request_row.state not in ('analyzing','planned','executing')
    or (request_row.state = 'analyzing' and (
      p_planner_lease_token is null
      or request_row.planner_lease_token <> p_planner_lease_token
      or request_row.planner_lease_expires_at <= statement_timestamp()
    ))
    or (request_row.state <> 'analyzing' and p_planner_lease_token is not null)
  then
    raise exception 'repair failure is stale' using errcode = '40001';
  end if;
  update public.mvp_repair_requests
  set state = 'failed', version = version + 1,
      planner_lease_token = null, planner_lease_expires_at = null,
      last_error_code = p_error_code,
      last_error_summary = left(btrim(p_error_summary), 500),
      completed_at = statement_timestamp()
  where id = p_repair_request_id
    and version = p_expected_request_version
  returning * into request_row;
  if not found then
    raise exception 'repair failure is stale' using errcode = '40001';
  end if;
  update public.mvp_production_jobs
  set state = 'failed', version = version + 1,
      last_error_code = p_error_code,
      last_error_summary = left(btrim(p_error_summary), 500)
  where production_run_id = request_row.production_run_id
    and active_repair_request_id = request_row.id
    and attempt_number = request_row.target_attempt_number
    and state in ('repair_planning','queued','generating','rendering');
  update public.production_run_statuses
  set state = 'failed', version = version + 1,
      changed_at = statement_timestamp(),
      reason = left(btrim(p_error_summary), 1000)
  where production_run_id = request_row.production_run_id;
  return to_jsonb(request_row);
end;
$$;

-- Preserve the browser contract. Rejection now creates the exact repair request
-- in the same transaction as the review, master transition, and job transition.
create or replace function public.command_review_mvp_master(
  p_workspace_id uuid,
  p_master_id uuid,
  p_expected_version bigint,
  p_decision text,
  p_cultural_review_confirmed boolean,
  p_final_review_confirmed boolean,
  p_feedback text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  master_row public.mvp_episode_masters%rowtype;
  job_row public.mvp_production_jobs%rowtype;
  review_id_value uuid;
  repair_request_id_value uuid;
  export_id uuid;
  feedback_value text;
begin
  perform private.assert_aal2();
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_decision not in ('approve','reject') then
    raise exception 'review decision invalid' using errcode = '22023';
  end if;
  feedback_value := nullif(btrim(p_feedback), '');
  if p_feedback is not null and char_length(p_feedback) > 4000 then
    raise exception 'review feedback is invalid' using errcode = '22023';
  end if;
  if p_decision = 'reject' and feedback_value is null then
    raise exception 'repair feedback is required' using errcode = '23514';
  end if;

  select * into master_row from public.mvp_episode_masters
  where workspace_id = p_workspace_id and id = p_master_id
  for update;
  if not found or master_row.state <> 'pending_review'
    or master_row.version <> p_expected_version
  then
    raise exception 'master review is stale' using errcode = '40001';
  end if;
  if p_decision = 'reject' and master_row.attempt_number >= 20 then
    raise exception 'repair attempt limit reached' using errcode = '23514';
  end if;
  select * into job_row from public.mvp_production_jobs
  where workspace_id = p_workspace_id
    and production_run_id = master_row.production_run_id
  for update;
  if not found or job_row.episode_id <> master_row.episode_id
    or job_row.state <> 'review_ready'
    or job_row.attempt_number <> master_row.attempt_number
    or (master_row.attempt_number > 1 and (
      job_row.active_repair_request_id is null
      or not exists(
        select 1 from public.mvp_repair_requests request
        where request.id = job_row.active_repair_request_id
          and request.workspace_id = p_workspace_id
          and request.production_run_id = master_row.production_run_id
          and request.target_attempt_number = master_row.attempt_number
          and request.state = 'complete'
      )
    ))
  then
    raise exception 'master review lineage is stale' using errcode = '40001';
  end if;
  if p_decision = 'approve' and
    (not p_cultural_review_confirmed or not p_final_review_confirmed)
  then
    raise exception 'both owner reviews are required' using errcode = '23514';
  end if;

  insert into public.mvp_master_reviews(
    workspace_id, episode_id, master_id, master_version, decision,
    cultural_review_confirmed, final_review_confirmed, feedback,
    actor_user_id, actor_aal
  ) values(
    p_workspace_id, master_row.episode_id, master_row.id, master_row.version,
    p_decision, p_cultural_review_confirmed, p_final_review_confirmed,
    feedback_value, actor_id, coalesce(auth.jwt()->>'aal', 'aal1')
  ) returning id into review_id_value;

  if p_decision = 'reject' then
    repair_request_id_value := gen_random_uuid();
    insert into public.mvp_repair_requests(
      id, workspace_id, episode_id, production_run_id, plan_bundle_id,
      review_id, source_master_id, source_master_version,
      source_attempt_number, opened_job_version, feedback_sha256,
      state, created_by
    ) values(
      repair_request_id_value, p_workspace_id, master_row.episode_id,
      master_row.production_run_id, job_row.plan_bundle_id, review_id_value,
      master_row.id, master_row.version, master_row.attempt_number,
      job_row.version + 1,
      encode(extensions.digest(convert_to(feedback_value, 'UTF8'), 'sha256'), 'hex'),
      'awaiting_retry', actor_id
    );
  end if;

  update public.mvp_episode_masters
  set state = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      version = version + 1
  where id = master_row.id;

  if p_decision = 'approve' then
    insert into public.mvp_exports(
      workspace_id, episode_id, master_id, object_name, content_sha256,
      state, created_by
    ) values(
      p_workspace_id, master_row.episode_id, master_row.id,
      master_row.object_name, master_row.content_sha256, 'ready', actor_id
    ) returning id into export_id;
    update public.mvp_production_jobs
    set state = 'export_ready', version = version + 1,
        active_repair_request_id = null,
        completed_at = statement_timestamp()
    where production_run_id = master_row.production_run_id;
    update public.production_run_statuses
    set state = 'succeeded', version = version + 1,
        changed_at = statement_timestamp(), reason = null
    where production_run_id = master_row.production_run_id;
  else
    update public.mvp_production_jobs
    set state = 'needs_repair', version = version + 1,
        active_repair_request_id = repair_request_id_value
    where production_run_id = master_row.production_run_id;
  end if;

  return jsonb_build_object(
    'decision', p_decision,
    'exportId', export_id,
    'masterId', master_row.id,
    'reviewId', review_id_value,
    'repairRequestId', repair_request_id_value
  );
end;
$$;

-- Preserve the browser retry signature. The active request created by the
-- rejected review is the only authority that may receive the next attempt.
create or replace function public.command_retry_mvp_production(
  p_workspace_id uuid,
  p_production_run_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  job_row public.mvp_production_jobs%rowtype;
  request_row public.mvp_repair_requests%rowtype;
  target_attempt integer;
begin
  perform private.assert_aal2();
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;

  select * into job_row from public.mvp_production_jobs
  where workspace_id = p_workspace_id
    and production_run_id = p_production_run_id
  for update;
  if not found or job_row.state <> 'needs_repair'
    or job_row.version <> p_expected_version
    or job_row.attempt_number >= 20
    or job_row.active_repair_request_id is null
  then
    raise exception 'repair retry unavailable' using errcode = '40001';
  end if;

  select * into request_row from public.mvp_repair_requests
  where id = job_row.active_repair_request_id
    and workspace_id = p_workspace_id
    and production_run_id = p_production_run_id
  for update;
  if not found or request_row.state <> 'awaiting_retry'
    or request_row.version <> 1
    or request_row.target_attempt_number is not null
    or request_row.source_attempt_number <> job_row.attempt_number
    or request_row.opened_job_version <> job_row.version
  then
    raise exception 'repair request is stale' using errcode = '40001';
  end if;
  target_attempt := job_row.attempt_number + 1;

  update public.mvp_repair_requests
  set state = 'analyzing', version = version + 1,
      target_attempt_number = target_attempt,
      started_at = statement_timestamp()
  where id = request_row.id and version = request_row.version
  returning * into request_row;
  if not found then
    raise exception 'repair target assignment is stale' using errcode = '40001';
  end if;

  update public.mvp_episode_masters
  set state = 'superseded', version = version + 1
  where production_run_id = p_production_run_id and state = 'rejected';

  update public.mvp_production_jobs
  set state = 'repair_planning', version = version + 1,
      attempt_number = target_attempt,
      total_storyboards = 0, completed_storyboards = 0,
      total_clips = 0, completed_clips = 0,
      last_error_code = null, last_error_summary = null,
      started_at = null, completed_at = null
  where production_run_id = p_production_run_id
    and version = p_expected_version
  returning * into job_row;
  if not found then
    raise exception 'repair retry is stale' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'attemptNumber', job_row.attempt_number,
    'productionRunId', job_row.production_run_id,
    'repairRequestId', request_row.id,
    'repairRequestVersion', request_row.version,
    'state', job_row.state,
    'version', job_row.version
  );
end;
$$;

revoke all on function public.command_publish_mvp_repair_plan(
  uuid,bigint,uuid,uuid,text,text,text,text,jsonb,jsonb
), public.command_update_mvp_repair_progress(
  uuid,bigint,integer,integer
), public.command_record_mvp_repair_shot_selection(
  uuid,bigint,uuid,integer,uuid,uuid,uuid
), public.command_fail_mvp_repair_request(
  uuid,bigint,uuid,text,text
) from public, anon, authenticated;
revoke all on function public.command_claim_next_mvp_repair(integer)
from public, anon, authenticated;

grant execute on function public.command_publish_mvp_repair_plan(
  uuid,bigint,uuid,uuid,text,text,text,text,jsonb,jsonb
), public.command_update_mvp_repair_progress(
  uuid,bigint,integer,integer
), public.command_record_mvp_repair_shot_selection(
  uuid,bigint,uuid,integer,uuid,uuid,uuid
), public.command_fail_mvp_repair_request(
  uuid,bigint,uuid,text,text
) to service_role;
grant execute on function public.command_claim_next_mvp_repair(integer)
to service_role;

revoke all on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
), public.command_retry_mvp_production(uuid,uuid,bigint)
from public, anon;

grant execute on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
), public.command_retry_mvp_production(uuid,uuid,bigint)
to authenticated;

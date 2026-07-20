-- Owner-operated MVP production, review, and export state.

create table public.mvp_production_jobs (
  production_run_id uuid primary key references public.production_runs(id) on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  plan_bundle_id uuid not null references public.preflight_plan_bundles(id) on delete restrict,
  narration_asset_version_id uuid not null references public.asset_versions(id) on delete restrict,
  state text not null check (state in (
    'queued','generating','rendering','review_ready','needs_repair',
    'approved','export_ready','failed','canceled'
  )),
  version bigint not null default 1 check (version > 0),
  attempt_number integer not null default 1 check (attempt_number between 1 and 2),
  total_clips integer not null default 0 check (total_clips between 0 and 8),
  completed_clips integer not null default 0 check (
    completed_clips between 0 and total_clips
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  last_error_summary text check (
    last_error_summary is null or char_length(last_error_summary) between 1 and 500
  ),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, production_run_id),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id, id) on delete restrict,
  foreign key (workspace_id, narration_asset_version_id)
    references public.asset_versions(workspace_id, id) on delete restrict
);

create table private.mvp_production_clips (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  production_run_id uuid not null references public.mvp_production_jobs(production_run_id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 2),
  shot_number integer not null check (shot_number between 1 and 24),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  motion_class text not null check (motion_class in (
    'simple_camera_subject','camera_led','complex_general'
  )),
  model_key text not null check (char_length(model_key) between 3 and 180),
  prompt text not null check (char_length(prompt) between 1 and 16000),
  reference_asset_version_id uuid not null references public.asset_versions(id) on delete restrict,
  state text not null check (state in ('submitted','complete','failed')),
  external_request_id text not null check (char_length(external_request_id) between 6 and 200),
  status_url text not null check (char_length(status_url) between 12 and 2048),
  response_url text not null check (char_length(response_url) between 12 and 2048),
  object_name text,
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint check (byte_length is null or byte_length between 1024 and 104857600),
  duration_ms integer check (duration_ms is null or duration_ms between 1000 and 30000),
  width integer check (width is null or width between 720 and 4096),
  height integer check (height is null or height between 1280 and 4096),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (production_run_id, attempt_number, shot_number),
  unique (external_request_id),
  check (
    object_name is null or object_name =
      workspace_id::text || '/mvp-clips/' || production_run_id::text || '/' ||
      attempt_number::text || '/' || shot_number::text || '.mp4'
  )
);

create table public.mvp_episode_masters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  production_run_id uuid not null references public.production_runs(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 2),
  state text not null check (state in ('pending_review','approved','rejected','superseded')),
  version bigint not null default 1 check (version > 0),
  object_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint not null check (byte_length between 1024 and 104857600),
  duration_ms integer not null check (duration_ms between 60000 and 120000),
  width integer not null check (width = 1080),
  height integer not null check (height = 1920),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (production_run_id, attempt_number),
  check (
    object_name = workspace_id::text || '/mvp-masters/' ||
      production_run_id::text || '/' || attempt_number::text || '/master.mp4'
  ),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, production_run_id)
    references public.production_runs(workspace_id, id) on delete restrict
);

create unique index mvp_one_current_master_uq
on public.mvp_episode_masters(episode_id)
where state in ('pending_review','approved');

create table public.mvp_master_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  master_id uuid not null references public.mvp_episode_masters(id) on delete restrict,
  master_version bigint not null check (master_version > 0),
  decision text not null check (decision in ('approve','reject')),
  cultural_review_confirmed boolean not null,
  final_review_confirmed boolean not null,
  feedback text check (feedback is null or char_length(feedback) between 1 and 4000),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check (actor_aal = 'aal2'),
  created_at timestamptz not null default statement_timestamp(),
  unique (master_id, master_version),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, master_id)
    references public.mvp_episode_masters(workspace_id, id) on delete restrict,
  check (
    decision = 'reject' or (cultural_review_confirmed and final_review_confirmed)
  )
);

create table public.mvp_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  master_id uuid not null references public.mvp_episode_masters(id) on delete restrict,
  object_name text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check (state = 'ready'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  unique (master_id),
  unique (workspace_id, id),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, master_id)
    references public.mvp_episode_masters(workspace_id, id) on delete restrict
);

create trigger mvp_production_jobs_updated_at
before update on public.mvp_production_jobs
for each row execute function private.set_updated_at();

create or replace function public.command_start_mvp_production(
  p_workspace_id uuid,
  p_production_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.production_runs%rowtype;
  plan_id uuid;
  narration_id uuid;
  job_row public.mvp_production_jobs%rowtype;
begin
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  select * into run_row from public.production_runs
  where workspace_id = p_workspace_id and id = p_production_run_id;
  if not found or run_row.hard_ceiling_microusd > 50000000 then
    raise exception 'production authority unavailable' using errcode = '42501';
  end if;
  select quote.plan_bundle_id, clock.narration_asset_version_id
  into plan_id, narration_id
  from public.production_quotes quote
  join public.preflight_plan_bundles bundle
    on bundle.workspace_id = quote.workspace_id and bundle.id = quote.plan_bundle_id
  join public.narration_master_clock_versions clock
    on clock.workspace_id = bundle.workspace_id and clock.id = bundle.master_clock_version_id
  where quote.workspace_id = p_workspace_id and quote.id = run_row.production_quote_id
    and bundle.state = 'qc_passed' and clock.state = 'verified';
  if plan_id is null or narration_id is null then
    raise exception 'locked production inputs unavailable' using errcode = '23514';
  end if;
  insert into public.mvp_production_jobs(
    production_run_id, workspace_id, episode_id, plan_bundle_id,
    narration_asset_version_id, state
  ) values(
    run_row.id, p_workspace_id, run_row.episode_id, plan_id, narration_id, 'queued'
  ) on conflict(production_run_id) do nothing;
  select * into job_row from public.mvp_production_jobs
  where production_run_id = run_row.id;
  update public.production_run_statuses
  set state = case when state = 'authorized' then 'queued' else state end,
      version = case when state = 'authorized' then version + 1 else version end,
      changed_at = case when state = 'authorized' then statement_timestamp() else changed_at end
  where production_run_id = run_row.id;
  return jsonb_build_object(
    'productionRunId', job_row.production_run_id,
    'state', job_row.state,
    'version', job_row.version
  );
end;
$$;

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
  export_id uuid;
begin
  perform private.assert_aal2();
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_decision not in ('approve','reject') then
    raise exception 'review decision invalid' using errcode = '22023';
  end if;
  select * into master_row from public.mvp_episode_masters
  where workspace_id = p_workspace_id and id = p_master_id for update;
  if not found or master_row.state <> 'pending_review'
    or master_row.version <> p_expected_version then
    raise exception 'master review is stale' using errcode = '40001';
  end if;
  if p_decision = 'approve' and
    (not p_cultural_review_confirmed or not p_final_review_confirmed) then
    raise exception 'both owner reviews are required' using errcode = '23514';
  end if;
  insert into public.mvp_master_reviews(
    workspace_id, episode_id, master_id, master_version, decision,
    cultural_review_confirmed, final_review_confirmed, feedback,
    actor_user_id, actor_aal
  ) values(
    p_workspace_id, master_row.episode_id, master_row.id, master_row.version,
    p_decision, p_cultural_review_confirmed, p_final_review_confirmed,
    nullif(btrim(p_feedback), ''), actor_id, 'aal2'
  );
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
        completed_at = statement_timestamp()
    where production_run_id = master_row.production_run_id;
    update public.production_run_statuses
    set state = 'succeeded', version = version + 1,
        changed_at = statement_timestamp(), reason = null
    where production_run_id = master_row.production_run_id;
  else
    update public.mvp_production_jobs
    set state = 'needs_repair', version = version + 1
    where production_run_id = master_row.production_run_id;
  end if;
  return jsonb_build_object(
    'decision', p_decision,
    'exportId', export_id,
    'masterId', master_row.id
  );
end;
$$;

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
begin
  perform private.assert_aal2();
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  select * into job_row from public.mvp_production_jobs
  where workspace_id = p_workspace_id and production_run_id = p_production_run_id
  for update;
  if not found or job_row.state <> 'needs_repair'
    or job_row.version <> p_expected_version or job_row.attempt_number >= 2 then
    raise exception 'repair retry unavailable' using errcode = '40001';
  end if;
  delete from private.mvp_production_clips
  where production_run_id = p_production_run_id;
  update public.mvp_episode_masters set state = 'superseded', version = version + 1
  where production_run_id = p_production_run_id and state = 'rejected';
  update public.mvp_production_jobs
  set state = 'queued', version = version + 1,
      attempt_number = attempt_number + 1,
      total_clips = 0, completed_clips = 0,
      last_error_code = null, last_error_summary = null,
      started_at = null, completed_at = null
  where production_run_id = p_production_run_id
  returning * into job_row;
  return jsonb_build_object(
    'attemptNumber', job_row.attempt_number,
    'productionRunId', job_row.production_run_id,
    'state', job_row.state,
    'version', job_row.version
  );
end;
$$;

alter table public.mvp_production_jobs enable row level security;
alter table public.mvp_production_jobs force row level security;
alter table public.mvp_episode_masters enable row level security;
alter table public.mvp_episode_masters force row level security;
alter table public.mvp_master_reviews enable row level security;
alter table public.mvp_master_reviews force row level security;
alter table public.mvp_exports enable row level security;
alter table public.mvp_exports force row level security;
alter table private.mvp_production_clips enable row level security;
alter table private.mvp_production_clips force row level security;

create policy mvp_production_jobs_member_select on public.mvp_production_jobs
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy mvp_episode_masters_member_select on public.mvp_episode_masters
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy mvp_master_reviews_member_select on public.mvp_master_reviews
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy mvp_exports_member_select on public.mvp_exports
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

grant select on public.mvp_production_jobs, public.mvp_episode_masters,
  public.mvp_master_reviews, public.mvp_exports to authenticated;
grant execute on function public.command_start_mvp_production(uuid,uuid),
  public.command_review_mvp_master(uuid,uuid,bigint,text,boolean,boolean,text),
  public.command_retry_mvp_production(uuid,uuid,bigint) to authenticated;
revoke all on private.mvp_production_clips from anon, authenticated;

create index mvp_production_jobs_state_idx
on public.mvp_production_jobs(state, updated_at);
create index mvp_production_clips_run_state_idx
on private.mvp_production_clips(production_run_id, attempt_number, state, shot_number);
create index mvp_episode_masters_episode_idx
on public.mvp_episode_masters(episode_id, created_at desc);

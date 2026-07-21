-- Stage 6 is the durable Edit/review surface. Preserve every repair attempt and
-- prepare an owner-downloadable package only after the selected master is
-- approved. The generous numeric bounds below are operational safety rails,
-- not creative shot-count or repair-count targets.

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','audio/mpeg','audio/wav','video/mp4',
  'application/zip'
]::text[]
where id = 'workspace-media';

create or replace function public.authorize_storage_sign(
  p_bucket text,
  p_path text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  workspace_id uuid;
begin
  if p_bucket not in ('workspace-private', 'workspace-media') then
    raise exception 'storage access denied' using errcode = '42501';
  end if;
  workspace_id := private.storage_workspace_id(p_path);
  if workspace_id is null then
    raise exception 'storage access denied' using errcode = '42501';
  end if;
  perform private.assert_active_session(workspace_id);
  return true;
end;
$$;

revoke all on function public.authorize_storage_sign(text,text)
from public, anon, authenticated;
grant execute on function public.authorize_storage_sign(text,text) to authenticated;

alter table public.mvp_production_jobs
  drop constraint if exists mvp_production_jobs_attempt_number_check;
alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_attempt_number_check
  check (attempt_number between 1 and 20);

alter table public.mvp_production_jobs
  drop constraint if exists mvp_production_jobs_total_clips_check;
alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_total_clips_check
  check (total_clips between 0 and 200);

alter table private.mvp_production_clips
  drop constraint if exists mvp_production_clips_attempt_number_check;
alter table private.mvp_production_clips
  add constraint mvp_production_clips_attempt_number_check
  check (attempt_number between 1 and 20);

alter table private.mvp_production_clips
  drop constraint if exists mvp_production_clips_shot_number_check;
alter table private.mvp_production_clips
  add constraint mvp_production_clips_shot_number_check
  check (shot_number between 1 and 200);

alter table public.mvp_episode_masters
  drop constraint if exists mvp_episode_masters_attempt_number_check;
alter table public.mvp_episode_masters
  add constraint mvp_episode_masters_attempt_number_check
  check (attempt_number between 1 and 20);

create table public.mvp_edit_packages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  production_run_id uuid not null references public.production_runs(id) on delete restrict,
  master_id uuid not null references public.mvp_episode_masters(id) on delete restrict,
  master_version bigint not null check (master_version > 0),
  attempt_number integer not null check (attempt_number between 1 and 20),
  state text not null check (state in ('queued','building','ready','failed')),
  version bigint not null default 1 check (version > 0),
  object_name text,
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  byte_length bigint check (
    byte_length is null or byte_length between 1024 and 1073741824
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  last_error_summary text check (
    last_error_summary is null or char_length(last_error_summary) between 1 and 500
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  unique (master_id),
  unique (workspace_id, id),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, master_id)
    references public.mvp_episode_masters(workspace_id, id) on delete restrict,
  check (
    object_name is null or object_name =
      workspace_id::text || '/mvp-edit-packages/' || master_id::text || '/' ||
      master_version::text || '/approved-assets.zip'
  ),
  check (
    (state = 'ready' and object_name is not null and content_sha256 is not null
      and byte_length is not null and completed_at is not null)
    or
    (state <> 'ready' and object_name is null and content_sha256 is null
      and byte_length is null)
  )
);

create trigger mvp_edit_packages_updated_at
before update on public.mvp_edit_packages
for each row execute function private.set_updated_at();

alter table public.mvp_edit_packages enable row level security;
alter table public.mvp_edit_packages force row level security;

create policy mvp_edit_packages_member_select on public.mvp_edit_packages
for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

grant select on public.mvp_edit_packages to authenticated;
revoke insert, update, delete on public.mvp_edit_packages from public, anon, authenticated;

create index mvp_edit_packages_state_idx
on public.mvp_edit_packages(state, updated_at);

create or replace function private.enqueue_mvp_edit_package()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_actor uuid;
begin
  if new.state <> 'approved' or old.state = 'approved' then
    return new;
  end if;

  select review.actor_user_id into review_actor
  from public.mvp_master_reviews review
  where review.master_id = new.id and review.decision = 'approve'
  order by review.created_at desc
  limit 1;

  if review_actor is null then
    raise exception 'approved master has no owner approval' using errcode = '23514';
  end if;

  insert into public.mvp_edit_packages(
    workspace_id, episode_id, production_run_id, master_id, master_version,
    attempt_number, state, created_by
  ) values(
    new.workspace_id, new.episode_id, new.production_run_id, new.id, new.version,
    new.attempt_number, 'queued', review_actor
  ) on conflict(master_id) do nothing;

  return new;
end;
$$;

create trigger mvp_episode_master_enqueue_edit_package
after update of state on public.mvp_episode_masters
for each row execute function private.enqueue_mvp_edit_package();

revoke all on function private.enqueue_mvp_edit_package()
from public, anon, authenticated;

create or replace function public.claim_next_mvp_edit_package()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.mvp_edit_packages%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  select * into package_row
  from public.mvp_edit_packages
  where state = 'queued'
  order by created_at, id
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.mvp_edit_packages
  set state = 'building', version = version + 1,
      started_at = coalesce(started_at, statement_timestamp()),
      last_error_code = null, last_error_summary = null
  where id = package_row.id
  returning * into package_row;

  return to_jsonb(package_row);
end;
$$;

create or replace function public.complete_mvp_edit_package(
  p_package_id uuid,
  p_expected_version bigint,
  p_object_name text,
  p_content_sha256 text,
  p_byte_length bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.mvp_edit_packages%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.mvp_edit_packages
  set state = 'ready', version = version + 1,
      object_name = p_object_name, content_sha256 = p_content_sha256,
      byte_length = p_byte_length, completed_at = statement_timestamp(),
      last_error_code = null, last_error_summary = null
  where id = p_package_id and state = 'building' and version = p_expected_version
  returning * into package_row;

  if not found then
    raise exception 'edit package completion is stale' using errcode = '40001';
  end if;

  return to_jsonb(package_row);
end;
$$;

create or replace function public.fail_mvp_edit_package(
  p_package_id uuid,
  p_expected_version bigint,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.mvp_edit_packages%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.mvp_edit_packages
  set state = 'failed', version = version + 1,
      last_error_code = p_error_code,
      last_error_summary = left(p_error_summary, 500),
      completed_at = statement_timestamp()
  where id = p_package_id and state = 'building' and version = p_expected_version
  returning * into package_row;

  if not found then
    raise exception 'edit package failure is stale' using errcode = '40001';
  end if;

  return to_jsonb(package_row);
end;
$$;

revoke all on function public.claim_next_mvp_edit_package() from public, anon, authenticated;
revoke all on function public.complete_mvp_edit_package(uuid,bigint,text,text,bigint)
  from public, anon, authenticated;
revoke all on function public.fail_mvp_edit_package(uuid,bigint,text,text)
  from public, anon, authenticated;
grant execute on function public.claim_next_mvp_edit_package() to service_role;
grant execute on function public.complete_mvp_edit_package(uuid,bigint,text,text,bigint)
  to service_role;
grant execute on function public.fail_mvp_edit_package(uuid,bigint,text,text)
  to service_role;

-- Each owner feedback cycle is a new preserved attempt. Automatic work within
-- an attempt remains bounded by the worker; owner review is the only authority
-- that creates the next attempt.
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
    or job_row.version <> p_expected_version or job_row.attempt_number >= 20 then
    raise exception 'repair retry unavailable' using errcode = '40001';
  end if;

  update public.mvp_episode_masters
  set state = 'superseded', version = version + 1
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

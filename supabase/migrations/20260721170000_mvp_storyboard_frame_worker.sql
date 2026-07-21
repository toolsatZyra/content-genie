-- Persist the accepted storyboard frame for every production shot before any
-- video-model spend. Provider control receipts and promoted image evidence stay
-- service-only; browser roles never receive this worker ledger directly.

create unique index mvp_production_jobs_storyboard_link_uq
on public.mvp_production_jobs(
  workspace_id, production_run_id, episode_id, plan_bundle_id
);

create table private.mvp_storyboard_frames (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  production_run_id uuid not null,
  plan_bundle_id uuid not null references public.preflight_plan_bundles(id)
    on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 20),
  shot_number integer not null check (shot_number between 1 and 200),
  composition_mode text not null check (composition_mode in (
    'single_frame','split_screen_two_state'
  )),
  endpoint text not null check (endpoint in (
    'fal-ai/nano-banana-2','fal-ai/nano-banana-2/edit'
  )),
  model_key text not null check (model_key = 'fal-ai/nano-banana-2'),
  prompt text not null check (char_length(prompt) between 1 and 16000),
  system_prompt text check (
    system_prompt is null or char_length(system_prompt) between 1 and 16000
  ),
  binding_manifest jsonb not null check (
    jsonb_typeof(binding_manifest) = 'array'
    and jsonb_array_length(binding_manifest) between 0 and 14
    and octet_length(binding_manifest::text) between 2 and 65536
  ),
  state text not null check (state in ('submitted','complete','failed')),
  external_request_id text not null unique check (
    external_request_id ~ '^[A-Za-z0-9_-]{6,200}$'
  ),
  status_url text not null check (
    char_length(status_url) between 12 and 2048
    and status_url ~ '^https://queue[.]fal[.]run/'
    and strpos(status_url, '#') = 0
  ),
  response_url text not null check (
    char_length(response_url) between 12 and 2048
    and response_url ~ '^https://queue[.]fal[.]run/'
    and strpos(response_url, '#') = 0
  ),
  object_name text,
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  byte_length bigint check (
    byte_length is null or byte_length between 1024 and 52428800
  ),
  media_mime text check (
    media_mime is null or media_mime in ('image/png','image/jpeg','image/webp')
  ),
  width integer check (width is null or width between 512 and 4096),
  height integer check (height is null or height between 720 and 4096),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  last_error_summary text check (
    last_error_summary is null or char_length(last_error_summary) between 1 and 500
  ),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (production_run_id, attempt_number, shot_number),
  unique (
    id, workspace_id, production_run_id, attempt_number, shot_number
  ),
  foreign key (workspace_id, production_run_id, episode_id, plan_bundle_id)
    references public.mvp_production_jobs(
      workspace_id, production_run_id, episode_id, plan_bundle_id
    ) on delete restrict,
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id, id) on delete restrict,
  check (
    (endpoint = 'fal-ai/nano-banana-2'
      and jsonb_array_length(binding_manifest) = 0
      and system_prompt is null)
    or
    (endpoint = 'fal-ai/nano-banana-2/edit'
      and jsonb_array_length(binding_manifest) between 1 and 14
      and system_prompt is not null)
  ),
  check (
    object_name is null or object_name =
      workspace_id::text || '/mvp-storyboards/' || production_run_id::text ||
      '/' || attempt_number::text || '/' || shot_number::text ||
      case media_mime
        when 'image/png' then '.png'
        when 'image/jpeg' then '.jpg'
        when 'image/webp' then '.webp'
      end
  ),
  check (width is null or height is null or height > width),
  check (
    strpos(status_url, '/requests/' || external_request_id) > 0
    and strpos(response_url, '/requests/' || external_request_id) > 0
  ),
  check (completed_at is null or completed_at >= created_at),
  check (
    (state = 'submitted'
      and object_name is null and content_sha256 is null and byte_length is null
      and media_mime is null and width is null and height is null
      and completed_at is null and last_error_code is null
      and last_error_summary is null)
    or
    (state = 'complete'
      and object_name is not null and content_sha256 is not null
      and byte_length is not null and media_mime is not null
      and width is not null and height is not null and completed_at is not null
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'failed'
      and object_name is null and content_sha256 is null and byte_length is null
      and media_mime is null and width is null and height is null
      and completed_at is not null and last_error_code is not null
      and last_error_summary is not null)
  )
);

comment on column private.mvp_storyboard_frames.binding_manifest is
  'Ordered @ImageN binding records. Array position N-1 binds @ImageN; store durable asset identities and hashes, never signed URLs or credentials.';

alter table private.mvp_production_clips
  add column storyboard_frame_id uuid
  references private.mvp_storyboard_frames(id) on delete restrict;

alter table private.mvp_production_clips
  add constraint mvp_production_clips_storyboard_frame_match_fk
  foreign key (
    storyboard_frame_id, workspace_id, production_run_id,
    attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict;

alter table private.mvp_storyboard_frames enable row level security;
alter table private.mvp_storyboard_frames force row level security;

revoke all on private.mvp_storyboard_frames from public, anon, authenticated;

create index mvp_storyboard_frames_state_idx
on private.mvp_storyboard_frames(state, created_at, production_run_id);

create index mvp_storyboard_frames_episode_idx
on private.mvp_storyboard_frames(workspace_id, episode_id, created_at desc);

create index mvp_storyboard_frames_plan_idx
on private.mvp_storyboard_frames(workspace_id, plan_bundle_id, shot_number);

create index mvp_production_clips_storyboard_frame_idx
on private.mvp_production_clips(storyboard_frame_id)
where storyboard_frame_id is not null;

create or replace view public.mvp_storyboard_frame_worker
with (security_invoker = true)
as
select
  id,workspace_id,episode_id,production_run_id,plan_bundle_id,attempt_number,
  shot_number,composition_mode,endpoint,model_key,prompt,system_prompt,
  binding_manifest,state,external_request_id,status_url,response_url,object_name,
  content_sha256,byte_length,media_mime,width,height,last_error_code,
  last_error_summary,created_at,completed_at
from private.mvp_storyboard_frames;

create or replace view public.mvp_production_clip_worker
with (security_invoker = true)
as
select * from private.mvp_production_clips;

revoke all on public.mvp_storyboard_frame_worker
from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_storyboard_frame_worker
to service_role;
grant select, insert, update, delete on private.mvp_storyboard_frames
to service_role;

revoke all on public.mvp_production_clip_worker
from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_production_clip_worker
to service_role;

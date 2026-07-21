-- A two-state shot is represented by two clean full-frame storyboard assets.
-- Contact sheets and split-screen composites are never provider inputs.

alter table private.mvp_storyboard_frames
  add column frame_role text not null default 'single'
  check (frame_role in ('single','start','end'));

alter table private.mvp_storyboard_frames
  drop constraint mvp_storyboard_frames_composition_mode_check;
alter table private.mvp_storyboard_frames
  add constraint mvp_storyboard_frames_composition_mode_check
  check (composition_mode in (
    'single_frame','two_state_start_end','split_screen_two_state'
  ));

alter table private.mvp_storyboard_frames
  add constraint mvp_storyboard_frames_role_mode_check
  check (
    (composition_mode in ('single_frame','split_screen_two_state')
      and frame_role = 'single')
    or
    (composition_mode = 'two_state_start_end'
      and frame_role in ('start','end'))
  );

alter table private.mvp_storyboard_frames
  drop constraint mvp_storyboard_frames_production_run_id_attempt_number_shot_key;
alter table private.mvp_storyboard_frames
  add constraint mvp_storyboard_frames_run_attempt_shot_role_uq
  unique (production_run_id, attempt_number, shot_number, frame_role);

alter table private.mvp_storyboard_frames
  drop constraint mvp_storyboard_frames_check1;
alter table private.mvp_storyboard_frames
  add constraint mvp_storyboard_frames_object_role_check
  check (
    object_name is null
    or object_name =
      workspace_id::text || '/mvp-storyboards/' || production_run_id::text ||
      '/' || attempt_number::text || '/' || shot_number::text ||
      case when frame_role = 'single' then '' else '-' || frame_role end ||
      case media_mime
        when 'image/png' then '.png'
        when 'image/jpeg' then '.jpg'
        when 'image/webp' then '.webp'
      end
  );

alter table private.mvp_production_clips
  add column storyboard_end_frame_id uuid
    references private.mvp_storyboard_frames(id) on delete restrict;

alter table private.mvp_production_clips
  add constraint mvp_production_clips_storyboard_end_match_fk
  foreign key (
    storyboard_end_frame_id, workspace_id, production_run_id,
    attempt_number, shot_number
  ) references private.mvp_storyboard_frames(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict;

create or replace function private.enforce_mvp_clip_storyboard_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  start_role text;
  start_mode text;
  end_role text;
  end_mode text;
begin
  if new.storyboard_frame_id is not null then
    select frame_role, composition_mode into start_role, start_mode
    from private.mvp_storyboard_frames
    where id = new.storyboard_frame_id;
    if start_role not in ('single','start') then
      raise exception 'clip start storyboard role is invalid' using errcode = '23514';
    end if;
  end if;
  if new.storyboard_end_frame_id is not null then
    select frame_role, composition_mode into end_role, end_mode
    from private.mvp_storyboard_frames
    where id = new.storyboard_end_frame_id;
    if end_role <> 'end'
      or new.storyboard_frame_id is null
      or start_role <> 'start'
      or start_mode <> 'two_state_start_end'
      or end_mode <> 'two_state_start_end'
    then
      raise exception 'clip end storyboard role is invalid' using errcode = '23514';
    end if;
  elsif start_role = 'start' then
    raise exception 'two-state clip requires its clean end frame'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mvp_clip_storyboard_roles
before insert or update of storyboard_frame_id, storyboard_end_frame_id
on private.mvp_production_clips
for each row execute function private.enforce_mvp_clip_storyboard_roles();

create or replace view public.mvp_storyboard_frame_worker
with (security_invoker = true)
as
select
  id,workspace_id,episode_id,production_run_id,plan_bundle_id,attempt_number,
  shot_number,composition_mode,endpoint,model_key,prompt,
  system_prompt,binding_manifest,state,external_request_id,status_url,
  response_url,object_name,content_sha256,byte_length,media_mime,width,height,
  last_error_code,last_error_summary,created_at,completed_at,frame_role
from private.mvp_storyboard_frames;

create or replace view public.mvp_production_clip_worker
with (security_invoker = true)
as
select * from private.mvp_production_clips;

revoke all on public.mvp_storyboard_frame_worker
from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_storyboard_frame_worker
to service_role;
revoke all on public.mvp_production_clip_worker
from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_production_clip_worker
to service_role;
revoke all on function private.enforce_mvp_clip_storyboard_roles()
from public, anon, authenticated;

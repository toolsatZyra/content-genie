-- Worst-case MVP editorial coverage: one word-bound visual shot for every
-- three seconds of the locked 60-120 second narration (20-40 shots).

alter table public.mvp_production_jobs
  drop constraint if exists mvp_production_jobs_total_clips_check;

alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_total_clips_check
  check (total_clips between 0 and 40);

alter table private.mvp_production_clips
  drop constraint if exists mvp_production_clips_shot_number_check;

alter table private.mvp_production_clips
  add constraint mvp_production_clips_shot_number_check
  check (shot_number between 1 and 40);

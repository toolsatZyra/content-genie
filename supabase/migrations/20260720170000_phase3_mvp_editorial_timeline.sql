-- The owner-operated MVP renders up to twelve researched editorial beats.
-- The original six-clip proof was visually repetitive for a 60-120 second film.

alter table public.mvp_production_jobs
  drop constraint if exists mvp_production_jobs_total_clips_check;

alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_total_clips_check
  check (total_clips between 0 and 12);

-- Expose only aggregate storyboard progress through the already member-scoped
-- production job. Provider receipts and private frame paths remain service-only.

alter table public.mvp_production_jobs
  add column total_storyboards integer not null default 0,
  add column completed_storyboards integer not null default 0;

alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_storyboard_progress_check
  check (
    total_storyboards between 0 and 200
    and completed_storyboards between 0 and total_storyboards
  );

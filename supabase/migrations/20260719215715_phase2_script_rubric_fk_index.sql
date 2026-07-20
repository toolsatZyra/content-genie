-- Cover the exact composite foreign-key identity used by plan runs.

drop index if exists public.preflight_runs_script_rubric_run_idx;

create index preflight_runs_script_rubric_run_fk_idx
  on public.preflight_runs (
    workspace_id,
    episode_id,
    script_revision_id,
    script_rubric_run_id
  )
  where script_rubric_run_id is not null;

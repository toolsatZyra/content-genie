-- Environments created from the original table definition retain the
-- auto-named inline v1-only check in addition to the later named constraint.
-- Remove that historical duplicate so the reviewed v1/v2 profile constraint
-- is the sole authority.

alter table public.script_revisions
  drop constraint if exists script_revisions_duration_estimation_profile_check;

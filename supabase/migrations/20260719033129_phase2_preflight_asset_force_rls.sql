-- The application never relies on table-owner bypass for exposed Phase 2 data.
-- FORCE keeps direct SQL, test harnesses, and future maintenance code inside the
-- same workspace predicates as the API surface.
alter table public.preflight_runs force row level security;
alter table public.preflight_stage_runs force row level security;
alter table public.preflight_stage_dependencies force row level security;
alter table public.preflight_stage_attempts force row level security;
alter table public.preflight_stage_leases force row level security;

alter table public.assets force row level security;
alter table public.asset_versions force row level security;
alter table public.media_probes force row level security;
alter table public.asset_references force row level security;

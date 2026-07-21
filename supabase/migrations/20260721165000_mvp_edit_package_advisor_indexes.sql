-- Cover foreign keys used by package cleanup, Episode lookup, and ownership
-- audit without broadening any browser mutation authority.

create index mvp_edit_packages_episode_idx
on public.mvp_edit_packages(episode_id, created_at desc);

create index mvp_edit_packages_run_idx
on public.mvp_edit_packages(production_run_id, created_at desc);

create index mvp_edit_packages_created_by_idx
on public.mvp_edit_packages(created_by, created_at desc);

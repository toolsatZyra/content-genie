-- A cron wake-up is not worker ownership. Claim exactly one production job
-- with a lease and monotonically increasing fence before any stage runs.
-- Expired spend-bearing claims fail closed because a provider outcome may be
-- unknown; polling, SFX reconciliation, and rendering can be reclaimed.

alter table public.mvp_production_jobs add column worker_claim_token uuid;
alter table public.mvp_production_jobs add column worker_lease_expires_at timestamptz;
alter table public.mvp_production_jobs
  add column worker_fencing_token bigint not null default 0
  check (worker_fencing_token >= 0);

alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_worker_lease_shape_check
  check (
    (worker_claim_token is null and worker_lease_expires_at is null)
    or
    (worker_claim_token is not null and worker_lease_expires_at is not null
      and state in (
        'repair_planning','queued','generating','sound_designing','rendering'
      ))
  );

-- The public job projection is member-readable. A claim token is worker
-- authority, not browser progress, so retain column-level read access only for
-- the non-secret projection that existed before this migration.
revoke select on public.mvp_production_jobs from authenticated;
grant select (
  production_run_id,workspace_id,episode_id,plan_bundle_id,
  narration_asset_version_id,state,version,attempt_number,total_clips,
  completed_clips,last_error_code,last_error_summary,started_at,completed_at,
  created_at,updated_at,total_storyboards,completed_storyboards,
  active_repair_request_id,total_sfx,completed_sfx
) on public.mvp_production_jobs to authenticated;

create or replace function private.clear_terminal_mvp_production_job_lease()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state not in (
    'repair_planning','queued','generating','sound_designing','rendering'
  ) then
    new.worker_claim_token := null;
    new.worker_lease_expires_at := null;
  end if;
  return new;
end;
$$;

create trigger mvp_production_jobs_clear_terminal_worker_lease
before insert or update of state on public.mvp_production_jobs
for each row execute function private.clear_terminal_mvp_production_job_lease();

create index mvp_production_jobs_worker_claim_idx
on public.mvp_production_jobs(state, worker_lease_expires_at, updated_at)
where state in (
  'repair_planning','queued','generating','sound_designing','rendering'
);

create or replace function public.command_claim_next_mvp_production_job(
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.mvp_production_jobs%rowtype;
  next_token uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 60 and 900 then
    raise exception 'production job lease duration is invalid'
      using errcode = '22023';
  end if;

  -- A model/provider request may have crossed the network boundary before a
  -- crashed worker persisted its receipt. Never reissue that work blindly.
  update public.mvp_production_jobs
  set state = 'failed', version = version + 1,
      worker_claim_token = null, worker_lease_expires_at = null,
      last_error_code = 'PRODUCTION_OUTCOME_AMBIGUOUS',
      last_error_summary =
        'A spend-bearing worker lease expired with an unknown external outcome. Existing work is preserved and Genie will not spend twice automatically.'
  where state in ('repair_planning','queued')
    and worker_claim_token is not null
    and worker_lease_expires_at <= statement_timestamp();

  select job.* into job_row
  from public.mvp_production_jobs job
  where job.state in (
      'repair_planning','queued','generating','sound_designing','rendering'
    )
    and (
      job.worker_claim_token is null
      or job.worker_lease_expires_at <= statement_timestamp()
    )
  order by
    case when job.worker_claim_token is not null then 0 else 1 end,
    coalesce(job.worker_lease_expires_at, job.updated_at),
    job.production_run_id
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.mvp_production_jobs
  set worker_claim_token = next_token,
      worker_lease_expires_at = statement_timestamp()
        + make_interval(secs => p_lease_seconds),
      worker_fencing_token = worker_fencing_token + 1,
      version = version + 1
  where production_run_id = job_row.production_run_id
    and version = job_row.version
    and state = job_row.state
    and (
      worker_claim_token is null
      or worker_lease_expires_at <= statement_timestamp()
    )
  returning * into job_row;

  if not found then
    raise exception 'production job claim lost its optimistic race'
      using errcode = '40001';
  end if;
  return to_jsonb(job_row);
end;
$$;

create or replace function public.command_release_mvp_production_job(
  p_production_run_id uuid,
  p_worker_claim_token uuid,
  p_worker_fencing_token bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.mvp_production_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_production_run_id is null or p_worker_claim_token is null
    or p_worker_fencing_token is null or p_worker_fencing_token < 1
  then
    raise exception 'production job release evidence is invalid'
      using errcode = '22023';
  end if;

  update public.mvp_production_jobs
  set worker_claim_token = null, worker_lease_expires_at = null,
      version = version + 1
  where production_run_id = p_production_run_id
    and worker_claim_token = p_worker_claim_token
    and worker_fencing_token = p_worker_fencing_token
  returning * into job_row;

  if not found then
    raise exception 'production job release fence is stale'
      using errcode = '40001';
  end if;
  return to_jsonb(job_row);
end;
$$;

revoke all on function public.command_claim_next_mvp_production_job(integer)
from public, anon, authenticated;
revoke all on function public.command_release_mvp_production_job(uuid,uuid,bigint)
from public, anon, authenticated;
grant execute on function public.command_claim_next_mvp_production_job(integer)
to service_role;
grant execute on function public.command_release_mvp_production_job(uuid,uuid,bigint)
to service_role;

revoke all on function private.clear_terminal_mvp_production_job_lease()
from public, anon, authenticated;

-- Edit-package builds may outlive one server invocation or upload successfully
-- before the worker receives a response. Fence every claim with a renewable
-- lease token, reclaim expired work with a higher attempt/version, and make an
-- exact completion replay idempotent.

alter table public.mvp_edit_packages add column claim_token uuid;
alter table public.mvp_edit_packages add column lease_expires_at timestamptz;
alter table public.mvp_edit_packages
  add column claim_attempt integer not null default 0
  check (claim_attempt between 0 and 8);

-- An older worker has no token it can prove after this migration. Requeue its
-- non-terminal row; a deterministic object already uploaded at the canonical
-- path will be reconciled by the next fenced worker rather than overwritten.
update public.mvp_edit_packages
set state = 'queued', version = version + 1,
    claim_token = null, lease_expires_at = null,
    last_error_code = null, last_error_summary = null,
    completed_at = null
where state = 'building';

alter table public.mvp_edit_packages
  add constraint mvp_edit_packages_claim_lease_shape_check
  check (
    (state = 'building'
      and claim_token is not null
      and lease_expires_at is not null
      and claim_attempt > 0)
    or
    (state <> 'building'
      and claim_token is null
      and lease_expires_at is null)
  );

create index mvp_edit_packages_reclaim_idx
on public.mvp_edit_packages(state, lease_expires_at, created_at)
where state in ('queued','building');

create or replace function public.claim_next_mvp_edit_package()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.mvp_edit_packages%rowtype;
  next_token uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  update public.mvp_edit_packages
  set state = 'failed', version = version + 1,
      claim_token = null, lease_expires_at = null,
      completed_at = statement_timestamp(),
      last_error_code = 'EDIT_PACKAGE_RETRY_EXHAUSTED',
      last_error_summary =
        'The edit package exhausted its bounded worker claims; approved source media remains preserved.'
  where state = 'building'
    and lease_expires_at <= statement_timestamp()
    and claim_attempt >= 8;

  select package.* into package_row
  from public.mvp_edit_packages package
  where package.state = 'queued'
    or (
      package.state = 'building'
      and package.lease_expires_at <= statement_timestamp()
      and package.claim_attempt < 8
    )
  order by
    case when package.state = 'building' then 0 else 1 end,
    coalesce(package.lease_expires_at, package.created_at),
    package.id
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update public.mvp_edit_packages
  set state = 'building', version = version + 1,
      claim_token = next_token,
      lease_expires_at = statement_timestamp() + interval '15 minutes',
      claim_attempt = claim_attempt + 1,
      started_at = coalesce(started_at, statement_timestamp()),
      completed_at = null,
      last_error_code = null, last_error_summary = null
  where id = package_row.id
    and version = package_row.version
    and (
      state = 'queued'
      or (state = 'building' and lease_expires_at <= statement_timestamp())
    )
  returning * into package_row;

  if not found then
    raise exception 'edit package claim lost its optimistic race'
      using errcode = '40001';
  end if;
  return to_jsonb(package_row);
end;
$$;

revoke all on function public.complete_mvp_edit_package(
  uuid,bigint,text,text,bigint
) from public, anon, authenticated, service_role;
revoke all on function public.fail_mvp_edit_package(
  uuid,bigint,text,text
) from public, anon, authenticated, service_role;
drop function public.complete_mvp_edit_package(uuid,bigint,text,text,bigint);
drop function public.fail_mvp_edit_package(uuid,bigint,text,text);

create function public.complete_mvp_edit_package(
  p_package_id uuid,
  p_expected_version bigint,
  p_claim_token uuid,
  p_object_name text,
  p_content_sha256 text,
  p_byte_length bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.mvp_edit_packages%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_claim_token is null then
    raise exception 'edit package claim token is required' using errcode = '22023';
  end if;

  select * into package_row
  from public.mvp_edit_packages
  where id = p_package_id
  for update;
  if not found then
    raise exception 'edit package completion is stale' using errcode = '40001';
  end if;

  -- A committed completion whose HTTP response was lost is safe to replay only
  -- when every immutable output fact is identical.
  if package_row.state = 'ready' then
    if package_row.object_name = p_object_name
      and package_row.content_sha256 = p_content_sha256
      and package_row.byte_length = p_byte_length
    then
      return to_jsonb(package_row);
    end if;
    raise exception 'edit package completion conflicts with committed output'
      using errcode = '40001';
  end if;

  if package_row.state <> 'building'
    or package_row.version <> p_expected_version
    or package_row.claim_token <> p_claim_token
    or package_row.lease_expires_at <= statement_timestamp()
  then
    raise exception 'edit package completion is stale' using errcode = '40001';
  end if;

  update public.mvp_edit_packages
  set state = 'ready', version = version + 1,
      claim_token = null, lease_expires_at = null,
      object_name = p_object_name, content_sha256 = p_content_sha256,
      byte_length = p_byte_length, completed_at = statement_timestamp(),
      last_error_code = null, last_error_summary = null
  where id = p_package_id
    and state = 'building'
    and version = p_expected_version
    and claim_token = p_claim_token
    and lease_expires_at > statement_timestamp()
  returning * into package_row;

  if not found then
    raise exception 'edit package completion is stale' using errcode = '40001';
  end if;
  return to_jsonb(package_row);
end;
$$;

create function public.fail_mvp_edit_package(
  p_package_id uuid,
  p_expected_version bigint,
  p_claim_token uuid,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_row public.mvp_edit_packages%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_claim_token is null
    or p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    or char_length(btrim(p_error_summary)) < 1
  then
    raise exception 'edit package failure is invalid' using errcode = '22023';
  end if;

  update public.mvp_edit_packages
  set state = case when claim_attempt < 3 then 'queued' else 'failed' end,
      version = version + 1,
      claim_token = null, lease_expires_at = null,
      last_error_code = p_error_code,
      last_error_summary = left(btrim(p_error_summary), 500),
      completed_at = case when claim_attempt < 3
        then null else statement_timestamp() end
  where id = p_package_id
    and state = 'building'
    and version = p_expected_version
    and claim_token = p_claim_token
    and lease_expires_at > statement_timestamp()
  returning * into package_row;

  if not found then
    raise exception 'edit package failure is stale' using errcode = '40001';
  end if;
  return to_jsonb(package_row);
end;
$$;

revoke all on function public.claim_next_mvp_edit_package()
from public, anon, authenticated;
revoke all on function public.complete_mvp_edit_package(
  uuid,bigint,uuid,text,text,bigint
) from public, anon, authenticated;
revoke all on function public.fail_mvp_edit_package(
  uuid,bigint,uuid,text,text
) from public, anon, authenticated;
grant execute on function public.claim_next_mvp_edit_package() to service_role;
grant execute on function public.complete_mvp_edit_package(
  uuid,bigint,uuid,text,text,bigint
) to service_role;
grant execute on function public.fail_mvp_edit_package(
  uuid,bigint,uuid,text,text
) to service_role;

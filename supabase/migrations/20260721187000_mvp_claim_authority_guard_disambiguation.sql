-- Keep production-job and media-dispatch authority checks table-specific.
-- PL/pgSQL resolves record fields before boolean short-circuiting, so a shared
-- expression cannot safely mention columns that exist on only one trigger row.

create or replace function private.guard_mvp_claim_authority_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema = 'public'
    and tg_table_name = 'mvp_production_jobs'
  then
    if new.worker_claim_token is not null
      and new.worker_claim_token is distinct from old.worker_claim_token
    then
      perform private.assert_workspace_profile_epoch(
        new.workspace_id,new.authority_profile_id,new.authority_profile_epoch,
        new.authority_provenance,'mvp job claim'
      );
    end if;
  elsif tg_table_schema = 'private'
    and tg_table_name = 'mvp_media_dispatches'
  then
    if new.state = 'dispatching' and old.state <> 'dispatching'
    then
      perform private.assert_workspace_profile_epoch(
        new.workspace_id,new.authority_profile_id,new.authority_profile_epoch,
        new.authority_provenance,'media dispatch claim'
      );
    end if;
  else
    raise exception 'unsupported MVP authority guard trigger target'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_mvp_claim_authority_epoch()
from public,anon,authenticated;

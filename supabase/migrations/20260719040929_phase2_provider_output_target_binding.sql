-- A provider completion can only create evidence for the stable asset encoded
-- in its immutable input manifest. This prevents a valid paid request from
-- being reused to bless an unrelated asset or to close the wrong request.
create or replace function private.guard_quarantine_asset_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'quarantine'
      and o.name = new.object_name
      and (o.metadata ->> 'size')::bigint = new.byte_length
      and o.metadata ->> 'mimetype' = new.declared_mime
  ) then
    raise exception 'quarantine storage object metadata is not exact'
      using errcode = '55000';
  end if;
  if new.source_kind = 'provider_output' and not exists (
    select 1
    from private.provider_requests pr
    join private.provider_input_manifests manifest
      on manifest.id = pr.input_manifest_id
      and manifest.workspace_id = pr.workspace_id
    where pr.id = new.provider_request_id
      and pr.workspace_id = new.workspace_id
      and pr.state in ('accepted','polling')
      and manifest.payload_json ->> 'targetAssetId' = new.stable_asset_id::text
  ) then
    raise exception 'provider quarantine scope is invalid' using errcode = '40001';
  elsif new.source_kind = 'research_fetch' and not exists (
    select 1 from private.remote_fetch_requests rf
    where rf.id = new.remote_fetch_request_id
      and rf.workspace_id = new.workspace_id
      and rf.status = 'fetched'
      and rf.response_sha256 = new.source_sha256
  ) then
    raise exception 'research quarantine scope is invalid' using errcode = '40001';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_quarantine_asset_scope()
from public, anon, authenticated;

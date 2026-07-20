-- Preserve late provider evidence while binding live media to the provider
-- operation and preventing a promoted image from being mislabeled as narration.

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
      and manifest.payload_json ->> 'targetAssetId' = new.stable_asset_id::text
      and (
        (pr.operation in ('gen_image','edit_image')
          and new.declared_mime in ('image/jpeg','image/png','image/webp'))
        or (pr.operation = 'gen_speech'
          and new.declared_mime in ('audio/mpeg','audio/wav'))
      )
  ) then
    raise exception 'provider quarantine scope is invalid' using errcode = '40001';
  elsif new.source_kind = 'provider_output'
    and new.remote_fetch_request_id is not null
    and not exists (
      select 1
      from private.remote_fetch_requests rf
      join private.provider_output_candidates candidate
        on candidate.id = rf.provider_output_candidate_id
      where rf.id = new.remote_fetch_request_id
        and rf.workspace_id = new.workspace_id
        and rf.fetch_class = 'provider_output'
        and rf.status = 'fetched'
        and rf.response_sha256 = new.source_sha256
        and candidate.workspace_id = new.workspace_id
        and candidate.provider_request_id = new.provider_request_id
        and candidate.target_asset_id = new.stable_asset_id
        and candidate.state = 'claimed'
    )
  then
    raise exception 'provider remote fetch binding is invalid' using errcode = '40001';
  elsif new.source_kind = 'research_fetch' and not exists (
    select 1 from private.remote_fetch_requests rf
    where rf.id = new.remote_fetch_request_id
      and rf.workspace_id = new.workspace_id
      and rf.fetch_class = 'research_reference'
      and rf.status = 'fetched'
      and rf.response_sha256 = new.source_sha256
  ) then
    raise exception 'research quarantine scope is invalid' using errcode = '40001';
  end if;

  return new;
end;
$$;

create or replace function private.guard_asset_version_media_kind()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare kind text;
begin
  select asset.asset_kind into kind
  from public.assets asset
  where asset.id = new.asset_id and asset.workspace_id = new.workspace_id;

  if kind in ('character_anchor','location_anchor','generated_image','upload_reference')
      and new.media_mime not in ('image/jpeg','image/png','image/webp')
    or kind = 'narration' and new.media_mime not in ('audio/mpeg','audio/wav')
  then
    raise exception 'asset media kind binding is invalid' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger asset_versions_media_kind_guard
before insert on public.asset_versions
for each row execute function private.guard_asset_version_media_kind();

revoke all on function private.guard_quarantine_asset_scope(),
  private.guard_asset_version_media_kind()
from public, anon, authenticated;

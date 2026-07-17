-- Phase 1 / 0008: workspace-scoped private Storage paths and signed-access guard.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'workspace-private',
    'workspace-private',
    false,
    52428800,
    array[
      'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
      'audio/mpeg', 'audio/wav', 'video/mp4', 'text/plain',
      'application/json'
    ]::text[]
  ),
  (
    'workspace-exports',
    'workspace-exports',
    false,
    2147483648,
    array[
      'video/mp4', 'application/json', 'text/vtt', 'application/zip'
    ]::text[]
  )
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.storage_workspace_id(p_name text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  folders text[];
  candidate text;
begin
  if p_name is null
    or char_length(p_name) > 1024
    or p_name like '/%'
    or p_name like '%/'
    or p_name like '%//%'
    or position(chr(92) in p_name) > 0
    or position('%' in p_name) > 0
    or p_name ~ '[[:cntrl:]]'
    or p_name ~ '(^|/)\.{1,2}(/|$)'
  then
    return null;
  end if;
  folders := storage.foldername(p_name);
  if coalesce(array_length(folders, 1), 0) < 1 then
    return null;
  end if;
  candidate := folders[1];
  return candidate::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create or replace function private.can_access_storage_object(
  p_workspace_id uuid,
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.storage_workspace_id(p_name) = p_workspace_id
    and private.is_current_session_allowed(p_workspace_id);
$$;

drop policy if exists workspace_private_member_select on storage.objects;
create policy workspace_private_member_select on storage.objects
for select to authenticated
using (
  bucket_id = 'workspace-private'
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
);

drop policy if exists workspace_private_member_insert on storage.objects;
create policy workspace_private_member_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'workspace-private'
  and owner_id = (select auth.uid()::text)
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
);

drop policy if exists workspace_private_member_update on storage.objects;
create policy workspace_private_member_update on storage.objects
for update to authenticated
using (
  bucket_id = 'workspace-private'
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
)
with check (
  bucket_id = 'workspace-private'
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
);

drop policy if exists workspace_private_member_delete on storage.objects;
create policy workspace_private_member_delete on storage.objects
for delete to authenticated
using (
  bucket_id = 'workspace-private'
  and owner_id = (select auth.uid()::text)
  and private.can_access_storage_object(
    private.storage_workspace_id(name), name
  )
);

-- Exports deliberately have no authenticated object policy. The server checks
-- current membership and eligibility, then issues a short-lived signed URL.

grant execute on function private.storage_workspace_id(text) to authenticated;
grant execute on function private.can_access_storage_object(uuid,text) to authenticated;

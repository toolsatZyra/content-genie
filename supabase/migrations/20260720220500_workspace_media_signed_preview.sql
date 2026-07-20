-- Permit workspace members to mint short-lived URLs for promoted private media.
-- Object paths remain server-selected from authoritative asset-version rows.

drop policy if exists workspace_media_member_select on storage.objects;
create policy workspace_media_member_select
on storage.objects for select to authenticated
using (
  bucket_id = 'workspace-media'
  and private.can_access_storage_object(private.storage_workspace_id(name), name)
  and storage.allow_any_operation(array[
    'storage.object.list',
    'storage.object.list_v2',
    'storage.object.get_authenticated',
    'object.get_authenticated_info',
    'object.head_authenticated_info',
    'storage.object.sign',
    'storage.object.sign_many'
  ])
);

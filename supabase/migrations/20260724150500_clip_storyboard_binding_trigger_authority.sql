-- Clip lineage checks read private storyboard rows while service_role writes
-- through the narrowly granted public worker view. Keep the private schema
-- inaccessible to service_role and execute only this trigger check as its
-- trusted owner.

alter function private.enforce_mvp_clip_storyboard_roles()
  security definer;

revoke all on function private.enforce_mvp_clip_storyboard_roles()
from public, anon, authenticated, service_role;

comment on function private.enforce_mvp_clip_storyboard_roles() is
  'Trusted trigger-only validation of clip start/end storyboard roles. Runs as owner so the service worker does not require private schema access.';

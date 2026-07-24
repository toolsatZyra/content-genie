-- Keep the durable row constraint identical to the reservation command's
-- production compiler allowlist, including FAL's bytedance-namespaced
-- Seedance image-to-video endpoint.

alter table private.mvp_media_dispatches
  drop constraint mvp_media_dispatches_endpoint_check;

alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_endpoint_check
  check (endpoint in (
    'fal-ai/nano-banana-2',
    'fal-ai/nano-banana-2/edit',
    'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    'fal-ai/kling-video/v3/pro/image-to-video',
    'bytedance/seedance-2.0/image-to-video'
  ));

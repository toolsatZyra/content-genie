-- Exact FAL media hosts observed from authenticated Nano Banana queue results.
-- Keep this separate from research fetches and reject every unlisted host.
with created as (
  insert into private.remote_fetch_allowlist_versions(
    environment,fetch_class,version_number,manifest_hash,state
  )
  select environment,'provider_output',1,
    encode(extensions.digest(convert_to(
      jsonb_build_object(
        'environment',environment,
        'fetchClass','provider_output',
        'hosts',jsonb_build_array('cdn.fal.media','v3b.fal.media'),
        'version',1
      )::text,'UTF8'
    ),'sha256'),'hex'),
    'active'
  from unnest(array['development','preview','production','test']) as environment
  returning id
)
insert into private.remote_fetch_allowlist_entries(allowlist_version_id,exact_hostname)
select created.id,host
from created
cross join unnest(array['cdn.fal.media','v3b.fal.media']) as host;

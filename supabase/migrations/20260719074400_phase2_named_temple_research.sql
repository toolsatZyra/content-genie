-- Named temples are researched from rights-cleared, real photographs before
-- any generated anchor is dispatched. Metadata comes from the fixed English
-- Wikipedia API and media bytes may only come from Wikimedia's exact upload
-- host through the existing SSRF-safe research-reference ingest lane.

do $$
declare
  environment_name text;
  allowlist_id uuid;
  manifest jsonb := jsonb_build_object(
    'schemaVersion','genie.research-fetch-allowlist.v1',
    'sourceApi','https://en.wikipedia.org/w/api.php',
    'allowedHosts',jsonb_build_array('upload.wikimedia.org')
  );
begin
  foreach environment_name in array array['development','preview','production','test']
  loop
    if not exists (
      select 1 from private.remote_fetch_allowlist_versions
      where environment=environment_name and fetch_class='research_reference'
        and state='active'
    ) then
      insert into private.remote_fetch_allowlist_versions(
        environment,fetch_class,version_number,manifest_hash,state
      ) values(
        environment_name,'research_reference',1,
        encode(extensions.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex'),
        'active'
      ) returning id into allowlist_id;
      insert into private.remote_fetch_allowlist_entries(
        allowlist_version_id,exact_hostname
      ) values(allowlist_id,'upload.wikimedia.org');
    end if;
  end loop;
end $$;

create table public.temple_research_packets (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null references public.preflight_runs(id) on delete restrict,
  stage_attempt_id uuid not null references public.preflight_stage_attempts(id) on delete restrict,
  world_extraction_result_id uuid not null,
  location_key text not null check(location_key~'^[a-z0-9][a-z0-9_.-]{1,99}$'),
  real_place_name text not null check(char_length(real_place_name) between 2 and 300),
  source_api text not null check(source_api='https://en.wikipedia.org/w/api.php'),
  query_sha256 text not null check(query_sha256~'^[a-f0-9]{64}$'),
  api_response_sha256 text not null check(api_response_sha256~'^[a-f0-9]{64}$'),
  evidence_set_hash text not null check(evidence_set_hash~'^[a-f0-9]{64}$'),
  state text not null check(state='verified'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(world_extraction_result_id,location_key),
  unique(preflight_run_id,location_key),
  foreign key(workspace_id,preflight_run_id,stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id,preflight_run_id,id)
    on delete restrict,
  foreign key(world_extraction_result_id)
    references private.world_extraction_results(id) on delete restrict
);

create table public.temple_research_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  temple_research_packet_id uuid not null,
  ordinal integer not null check(ordinal between 1 and 4),
  asset_version_id uuid not null,
  canonical_title text not null check(char_length(canonical_title) between 6 and 500),
  source_page_url text not null check(
    source_page_url~'^https://commons\.wikimedia\.org/wiki/File:'
    and char_length(source_page_url)<=2048
  ),
  source_file_url text not null check(
    source_file_url~'^https://upload\.wikimedia\.org/wikipedia/commons/'
    and char_length(source_file_url)<=2048
  ),
  author_credit text not null check(char_length(author_credit) between 1 and 1000),
  license_short_name text not null check(char_length(license_short_name) between 2 and 100),
  license_url text not null check(
    license_url~'^https://(creativecommons\.org|commons\.wikimedia\.org)/'
    and char_length(license_url)<=2048
  ),
  attribution_required boolean not null,
  source_width integer not null check(source_width between 800 and 32768),
  source_height integer not null check(source_height between 800 and 32768),
  source_metadata_hash text not null check(source_metadata_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(temple_research_packet_id,ordinal),
  unique(temple_research_packet_id,asset_version_id),
  unique(temple_research_packet_id,source_page_url),
  foreign key(workspace_id,temple_research_packet_id)
    references public.temple_research_packets(workspace_id,id) on delete restrict,
  foreign key(workspace_id,asset_version_id)
    references public.asset_versions(workspace_id,id) on delete restrict
);

create trigger temple_research_packets_immutable
before update or delete on public.temple_research_packets
for each row execute function private.reject_mutation();

create trigger temple_research_references_immutable
before update or delete on public.temple_research_references
for each row execute function private.reject_mutation();

create or replace function public.command_record_temple_research_packet(
  p_packet_id uuid,p_workspace_id uuid,p_preflight_run_id uuid,
  p_stage_attempt_id uuid,p_world_extraction_result_id uuid,
  p_location_key text,p_real_place_name text,p_query_sha256 text,
  p_api_response_sha256 text,p_evidence_set_hash text,p_references jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  extraction private.world_extraction_results%rowtype;
  existing public.temple_research_packets%rowtype;
  reference_json jsonb;
  reference_number integer:=0;
  computed_hash text;
  asset_version public.asset_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  if jsonb_typeof(p_references)<>'array'
    or jsonb_array_length(p_references) not between 2 and 4
    or pg_column_size(p_references)>65536
    or p_query_sha256 !~ '^[a-f0-9]{64}$'
    or p_api_response_sha256 !~ '^[a-f0-9]{64}$'
    or p_evidence_set_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'temple research envelope is invalid' using errcode='22023'; end if;
  select * into existing from public.temple_research_packets
  where world_extraction_result_id=p_world_extraction_result_id
    and location_key=p_location_key;
  if found then
    if existing.workspace_id<>p_workspace_id
      or existing.preflight_run_id<>p_preflight_run_id
      or existing.stage_attempt_id<>p_stage_attempt_id
      or existing.real_place_name<>p_real_place_name
      or existing.query_sha256<>p_query_sha256
      or existing.api_response_sha256<>p_api_response_sha256
      or existing.evidence_set_hash<>p_evidence_set_hash
    then raise exception 'temple research replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'packetId',existing.id,
      'evidenceSetHash',existing.evidence_set_hash);
  end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and preflight_run_id=run.id;
  select * into extraction from private.world_extraction_results
    where id=p_world_extraction_result_id and preflight_run_id=run.id;
  if run.id is null or run.workspace_id<>p_workspace_id or run.kind<>'world_anchor'
    or run.state<>'running' or attempt.id is null or attempt.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch
    or extraction.id is null or extraction.stage_attempt_id<>attempt.id
    or not exists(
      select 1 from jsonb_array_elements(extraction.extraction_json->'locations') location
      where location->>'canonicalKey'=p_location_key
        and location->>'namedTemple'='true'
        and location->>'researchRequired'='true'
        and location->>'realPlaceName'=p_real_place_name
    )
  then raise exception 'temple research authority is stale' using errcode='40001'; end if;
  computed_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'schemaVersion','genie.temple-research-evidence.v1',
    'worldExtractionResultId',extraction.id,'locationKey',p_location_key,
    'realPlaceName',p_real_place_name,'querySha256',p_query_sha256,
    'apiResponseSha256',p_api_response_sha256,'references',p_references
  )::text,'UTF8'),'sha256'),'hex');
  if computed_hash<>p_evidence_set_hash then
    raise exception 'temple research evidence hash is invalid' using errcode='22023';
  end if;
  insert into public.temple_research_packets(
    id,workspace_id,preflight_run_id,stage_attempt_id,world_extraction_result_id,
    location_key,real_place_name,source_api,query_sha256,api_response_sha256,
    evidence_set_hash,state
  ) values(
    p_packet_id,p_workspace_id,run.id,attempt.id,extraction.id,p_location_key,
    p_real_place_name,'https://en.wikipedia.org/w/api.php',p_query_sha256,
    p_api_response_sha256,p_evidence_set_hash,'verified'
  );
  for reference_json in select value from jsonb_array_elements(p_references)
  loop
    reference_number:=reference_number+1;
    if jsonb_typeof(reference_json)<>'object'
      or (reference_json-array[
        'assetVersionId','canonicalTitle','sourcePageUrl','sourceFileUrl',
        'authorCredit','licenseShortName','licenseUrl','attributionRequired',
        'sourceWidth','sourceHeight','sourceMetadataHash'
      ]::text[])<>'{}'::jsonb
      or not(reference_json?&array[
        'assetVersionId','canonicalTitle','sourcePageUrl','sourceFileUrl',
        'authorCredit','licenseShortName','licenseUrl','attributionRequired',
        'sourceWidth','sourceHeight','sourceMetadataHash'
      ])
    then raise exception 'temple research reference is not exact' using errcode='22023'; end if;
    select version.* into asset_version
    from public.asset_versions version
    join public.assets asset on asset.id=version.asset_id
    where version.id=(reference_json->>'assetVersionId')::uuid
      and version.workspace_id=p_workspace_id
      and asset.asset_kind='research_reference';
    if asset_version.id is null
      or reference_json->>'sourceFileUrl' !~ '^https://upload\.wikimedia\.org/wikipedia/commons/'
      or reference_json->>'sourcePageUrl' !~ '^https://commons\.wikimedia\.org/wiki/File:'
      or reference_json->>'licenseShortName' !~* '^(CC0|CC BY|CC BY-SA|Public domain|PD)'
      or reference_json->>'licenseUrl' !~ '^https://(creativecommons\.org|commons\.wikimedia\.org)/'
      or reference_json->>'sourceMetadataHash' !~ '^[a-f0-9]{64}$'
    then raise exception 'temple research reference is not releasable' using errcode='40001'; end if;
    insert into public.temple_research_references(
      workspace_id,temple_research_packet_id,ordinal,asset_version_id,
      canonical_title,source_page_url,source_file_url,author_credit,
      license_short_name,license_url,attribution_required,source_width,
      source_height,source_metadata_hash
    ) values(
      p_workspace_id,p_packet_id,reference_number,asset_version.id,
      reference_json->>'canonicalTitle',reference_json->>'sourcePageUrl',
      reference_json->>'sourceFileUrl',reference_json->>'authorCredit',
      reference_json->>'licenseShortName',reference_json->>'licenseUrl',
      (reference_json->>'attributionRequired')::boolean,
      (reference_json->>'sourceWidth')::integer,
      (reference_json->>'sourceHeight')::integer,
      reference_json->>'sourceMetadataHash'
    );
  end loop;
  return jsonb_build_object('ok',true,'replayed',false,'packetId',p_packet_id,
    'evidenceSetHash',p_evidence_set_hash);
end;
$$;

create or replace function public.get_temple_research_replay_context(
  p_world_extraction_result_id uuid,p_location_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare packet public.temple_research_packets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into packet from public.temple_research_packets
  where world_extraction_result_id=p_world_extraction_result_id
    and location_key=p_location_key and state='verified';
  if packet.id is null then return null; end if;
  return jsonb_build_object(
    'packetId',packet.id,'evidenceSetHash',packet.evidence_set_hash,
    'references',(
      select jsonb_agg(jsonb_build_object(
        'assetVersionId',reference.asset_version_id,
        'objectName',version.object_name,
        'canonicalTitle',reference.canonical_title,
        'sourcePageUrl',reference.source_page_url,
        'licenseShortName',reference.license_short_name,
        'authorCredit',reference.author_credit
      ) order by reference.ordinal)
      from public.temple_research_references reference
      join public.asset_versions version on version.id=reference.asset_version_id
      where reference.temple_research_packet_id=packet.id
    )
  );
end;
$$;

alter table public.temple_research_packets enable row level security;
alter table public.temple_research_packets force row level security;
alter table public.temple_research_references enable row level security;
alter table public.temple_research_references force row level security;

create policy temple_research_packets_member_select
on public.temple_research_packets for select to authenticated
using(private.is_active_member(workspace_id,(select auth.uid())));

create policy temple_research_references_member_select
on public.temple_research_references for select to authenticated
using(private.is_active_member(workspace_id,(select auth.uid())));

revoke all on table public.temple_research_packets,
  public.temple_research_references from public,anon,authenticated;
grant select on table public.temple_research_packets,
  public.temple_research_references to authenticated;

revoke all on function public.command_record_temple_research_packet(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb
), public.get_temple_research_replay_context(uuid,text)
from public,anon,authenticated;

grant execute on function public.command_record_temple_research_packet(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb
), public.get_temple_research_replay_context(uuid,text)
to service_role;

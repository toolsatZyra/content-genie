-- Extend the existing rights-cleared temple-photo contract to explicitly named
-- public festivals and rituals without renaming durable Phase 2 evidence tables.

do $migration$
declare
  definition text;
  revised text;
begin
  definition:=pg_get_functiondef(
    'public.command_record_temple_research_packet(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb)'::regprocedure
  );
  revised:=replace(definition,
$$        and location->>'namedTemple'='true'
        and location->>'researchRequired'='true'
        and location->>'realPlaceName'=p_real_place_name$$,
$$        and location->>'researchRequired'='true'
        and coalesce(
          location->>'realWorldSubjectKind',
          case when location->>'namedTemple'='true' then 'temple' else 'none' end
        ) in ('temple','festival','ritual')
        and location->>'realPlaceName'=p_real_place_name$$);
  if revised=definition then
    raise exception 'real-world research authority patch target was not found';
  end if;
  execute revised;
end;
$migration$;

do $migration$
declare
  definition text;
  revised text;
begin
  definition:=pg_get_functiondef(
    'public.command_prepare_world_anchor_jobs(uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  );
  revised:=replace(definition,
$$      or ((job->>'namedTemple')::boolean and (
        job->>'operation'<>'edit_image'
        or job->>'templeEvidenceSetHash' !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(job->'providerPayload'->'imageUrls')<>'array'
        or jsonb_array_length(job->'providerPayload'->'imageUrls') not between 2 and 4
      ))
      or (not (job->>'namedTemple')::boolean and (
        job->>'operation'<>'gen_image' or job->>'templeEvidenceSetHash' is not null
      ))$$,
$$      or (job->>'templeEvidenceSetHash' is not null and (
        job->>'entityKind'<>'location'
        or job->>'operation'<>'edit_image'
        or job->>'templeEvidenceSetHash' !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(job->'providerPayload'->'imageUrls')<>'array'
        or jsonb_array_length(job->'providerPayload'->'imageUrls') not between 2 and 4
      ))
      or (job->>'templeEvidenceSetHash' is null and job->>'operation'<>'gen_image')$$);
  if revised=definition then
    raise exception 'real-world world-anchor patch target was not found';
  end if;
  execute revised;
end;
$migration$;

do $migration$
declare
  definition text;
  revised text;
begin
  definition:=pg_get_functiondef(
    'public.get_plan_preflight_input(uuid,uuid,uuid,uuid[])'::regprocedure
  );
  revised:=replace(definition,
$$    'templeEvidenceSetHash',version.temple_evidence_set_hash$$,
$$    'templeEvidenceSetHash',version.temple_evidence_set_hash,
    'researchReferences',coalesce((
      select jsonb_agg(jsonb_build_object(
        'assetVersionId',reference.asset_version_id,
        'authorCredit',reference.author_credit,
        'canonicalTitle',reference.canonical_title,
        'licenseShortName',reference.license_short_name,
        'sourcePageUrl',reference.source_page_url
      ) order by reference.ordinal)
      from public.temple_research_packets research
      join public.temple_research_references reference
        on reference.temple_research_packet_id=research.id
      where research.workspace_id=p_workspace_id
        and research.evidence_set_hash=version.temple_evidence_set_hash
        and research.state='verified'
    ),'[]'::jsonb)$$);
  if revised=definition then
    raise exception 'plan research-reference projection patch target was not found';
  end if;
  execute revised;
end;
$migration$;

comment on function public.command_record_temple_research_packet(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,jsonb
) is 'Records 2-4 rights-cleared public photographs for an explicitly named temple, festival, or ritual.';

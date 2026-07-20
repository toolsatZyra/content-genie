-- Bind each Director-selected public photograph into the executable reference
-- graph and verify that it belongs to the researched packet for that shot's
-- accepted location.

alter table public.preflight_reference_edges
  drop constraint preflight_reference_edges_reference_kind_check;
alter table public.preflight_reference_edges
  add constraint preflight_reference_edges_reference_kind_check
  check(reference_kind in ('real_world','character','continuity','location_master'));

do $migration$
declare
  definition text;
  revised text;
begin
  definition:=pg_get_functiondef(
    'public.get_plan_preflight_input(uuid,uuid,uuid,uuid[])'::regprocedure
  );
  revised:=replace(definition,
$$        'canonicalTitle',reference.canonical_title,
        'licenseShortName',reference.license_short_name,$$,
$$        'canonicalTitle',reference.canonical_title,
        'contentHash',(select version.content_sha256
          from public.asset_versions version
          where version.id=reference.asset_version_id
            and version.workspace_id=p_workspace_id),
        'licenseShortName',reference.license_short_name,$$);
  if revised=definition then
    raise exception 'research-reference content hash patch target was not found';
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
    'public.command_record_preflight_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb)'::regprocedure
  );
  revised:=replace(
    definition,
    $$case edge.reference_kind when 'character' then 1 when 'continuity' then 2 else 3 end$$,
    $$case edge.reference_kind when 'real_world' then 1 when 'character' then 2 when 'continuity' then 3 else 4 end$$
  );
  if revised=definition then
    raise exception 'reference-order patch target was not found';
  end if;
  definition:=revised;
  revised:=replace(definition,
$$      or (edge.reference_kind='location_master' and not exists($$,
$$      or (edge.reference_kind='real_world' and not exists(
        select 1
        from public.preflight_shots shot
        join public.location_versions version
          on version.id=shot.location_version_id
          and version.workspace_id=p_workspace_id
        join public.temple_research_packets research
          on research.evidence_set_hash=version.temple_evidence_set_hash
          and research.workspace_id=p_workspace_id
          and research.state='verified'
        join public.temple_research_references reference
          on reference.temple_research_packet_id=research.id
          and reference.workspace_id=p_workspace_id
        where shot.plan_bundle_id=p_plan_bundle_id
          and shot.shot_number=edge.shot_number
          and reference.asset_version_id=edge.asset_version_id))
      or (edge.reference_kind='location_master' and not exists($$);
  if revised=definition then
    raise exception 'real-world accepted-reference patch target was not found';
  end if;
  execute revised;
end;
$migration$;

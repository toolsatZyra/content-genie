-- A verified image capability must retain both the official request-schema
-- evidence and the authenticated account canary that qualified it.

alter table private.provider_capabilities
  add column canary_evidence_snapshot_id uuid not null
    references private.provider_evidence_snapshots(id) on delete restrict;

create index provider_capabilities_canary_evidence_idx
  on private.provider_capabilities(canary_evidence_snapshot_id);

do $migration$
declare function_definition text; rewritten text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_ensure_fal_world_capability(uuid,text,text,text,text,text,timestamptz,timestamptz)'::regprocedure
  ) into function_definition;
  rewritten:=regexp_replace(function_definition,
    'schema_version,\s*evidence_snapshot_id,\s*currency',
    'schema_version,evidence_snapshot_id,canary_evidence_snapshot_id,currency');
  rewritten:=regexp_replace(rewritten,
    'schema_evidence\.id,\s*''USD''',
    'schema_evidence.id,canary_evidence.id,''USD''');
  rewritten:=regexp_replace(rewritten,
    'capability\.unit_price_minor\s*<>\s*12\s+or\s+capability\.maximum_request_minor\s*<>\s*12',
    'capability.unit_price_minor<>12 or capability.maximum_request_minor<>12 or capability.canary_evidence_snapshot_id<>canary_evidence.id',
    'i');
  if rewritten=function_definition
    or rewritten not like '%canary_evidence_snapshot_id%'
    or rewritten not like '%capability.canary_evidence_snapshot_id%'
  then raise exception 'fal capability registration predecessor is unexpected'; end if;
  execute rewritten;
end;
$migration$;

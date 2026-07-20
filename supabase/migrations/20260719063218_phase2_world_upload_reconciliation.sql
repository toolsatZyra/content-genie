-- Forward-only retry reconciliation for upload steps whose HTTP response can be
-- lost after durable work completed. Every step returns its earlier immutable
-- result when the same intake/output evidence is presented again.

create or replace function public.command_ensure_world_upload_quarantine(
  p_workspace_id uuid,p_intake_id uuid,p_object_name text,p_provenance_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  intake private.world_upload_intakes%rowtype;
  quarantine private.quarantine_assets%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into intake from private.world_upload_intakes
    where id=p_intake_id and workspace_id=p_workspace_id;
  if intake.id is null
    or p_object_name<>p_workspace_id::text||'/quarantine/'||
      intake.stable_asset_id::text||'/'||intake.quarantine_asset_version_id::text||'/source'
    or p_provenance_hash!~'^[a-f0-9]{64}$'
  then raise exception 'world upload quarantine binding is invalid' using errcode='40001';
  end if;
  select * into quarantine from private.quarantine_assets
    where id=intake.quarantine_asset_version_id;
  if quarantine.id is not null then
    if quarantine.workspace_id<>p_workspace_id
      or quarantine.stable_asset_id<>intake.stable_asset_id
      or quarantine.source_kind<>'upload'
      or quarantine.object_name<>p_object_name
      or quarantine.declared_mime<>intake.declared_mime
      or quarantine.byte_length<>intake.byte_length
      or quarantine.source_sha256<>intake.source_sha256
      or quarantine.provenance_hash<>p_provenance_hash
    then raise exception 'world upload quarantine conflicts' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,
      'quarantineAssetVersionId',quarantine.id,'state',quarantine.state);
  end if;
  return public.command_register_quarantine_asset(
    intake.quarantine_asset_version_id,p_workspace_id,intake.stable_asset_id,
    null,null,'upload',p_object_name,intake.display_filename,
    intake.declared_mime,intake.byte_length,intake.source_sha256,p_provenance_hash
  );
end;
$$;

create or replace function public.command_mark_world_upload_scanning(
  p_workspace_id uuid,p_intake_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare current_state private.world_upload_state;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select state into current_state from private.world_upload_intakes
    where id=p_intake_id and workspace_id=p_workspace_id for update;
  if current_state='registered' then
    update private.world_upload_intakes set state='scanning' where id=p_intake_id;
  elsif current_state<>'scanning' then
    raise exception 'world upload intake is not scannable' using errcode='40001';
  end if;
end;
$$;

create or replace function public.command_ensure_world_upload_attestation(
  p_workspace_id uuid,p_intake_id uuid,p_policy_version_id uuid,
  p_scan_engine text,p_scan_version text,p_magic_mime text,
  p_decompressed_bytes bigint,p_width integer,p_height integer,
  p_probe_sha256 text,p_output_sha256 text,p_output_byte_length bigint,
  p_scanner_task_id text,p_scanner_task_version text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  intake private.world_upload_intakes%rowtype;
  attestation private.media_ingest_attestations%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into intake from private.world_upload_intakes
    where id=p_intake_id and workspace_id=p_workspace_id;
  if intake.id is null or intake.state<>'scanning' then
    raise exception 'world upload intake is not scanning' using errcode='40001';
  end if;
  select * into attestation from private.media_ingest_attestations
    where quarantine_asset_version_id=intake.quarantine_asset_version_id
      and output_sha256=p_output_sha256;
  if attestation.id is not null then
    if attestation.workspace_id<>p_workspace_id
      or attestation.policy_version_id<>p_policy_version_id
      or attestation.scan_engine<>p_scan_engine
      or attestation.scan_version<>p_scan_version
      or attestation.malware_status<>'clean'
      or not attestation.parser_sandboxed or not attestation.metadata_stripped
      or attestation.magic_mime<>p_magic_mime
      or attestation.reencoded_mime<>p_magic_mime
      or attestation.decompressed_bytes<>p_decompressed_bytes
      or attestation.width<>p_width or attestation.height<>p_height
      or attestation.duration_ms is not null or attestation.frame_count is not null
      or attestation.probe_sha256<>p_probe_sha256
      or attestation.output_byte_length<>p_output_byte_length
      or attestation.scanner_task_id<>p_scanner_task_id
      or attestation.scanner_task_version<>p_scanner_task_version
    then raise exception 'world upload attestation conflicts' using errcode='40001';
    end if;
    return attestation.id;
  end if;
  return public.command_record_ingest_attestation(
    p_workspace_id,intake.quarantine_asset_version_id,p_policy_version_id,
    p_scan_engine,p_scan_version,'clean',true,true,p_magic_mime,p_magic_mime,
    p_decompressed_bytes,p_width,p_height,null,null,p_probe_sha256,
    p_output_sha256,p_output_byte_length,p_scanner_task_id,p_scanner_task_version
  );
end;
$$;

create or replace function public.command_ensure_world_upload_promotion(
  p_workspace_id uuid,p_intake_id uuid,p_ingest_attestation_id uuid,
  p_asset_kind text,p_asset_version_id uuid,p_final_object_name text,
  p_storage_version text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  intake private.world_upload_intakes%rowtype;
  promoted public.asset_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into intake from private.world_upload_intakes
    where id=p_intake_id and workspace_id=p_workspace_id;
  if intake.id is null then
    raise exception 'world upload intake is unavailable' using errcode='P0002';
  end if;
  select * into promoted from public.asset_versions asset
    where asset.source_quarantine_version_id=intake.quarantine_asset_version_id;
  if promoted.id is not null then
    if promoted.workspace_id<>p_workspace_id
      or promoted.asset_id<>intake.stable_asset_id
      or not exists(select 1 from public.assets stable
        where stable.id=promoted.asset_id and stable.asset_kind=p_asset_kind)
    then raise exception 'world upload promotion conflicts' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'assetId',promoted.asset_id,
      'assetVersionId',promoted.id,'versionNumber',promoted.version_number,
      'providerRequestId',null);
  end if;
  return public.command_promote_quarantine_asset(
    p_workspace_id,intake.quarantine_asset_version_id,p_ingest_attestation_id,
    p_asset_kind,p_asset_version_id,p_final_object_name,p_storage_version
  );
end;
$$;

do $migration$
declare function_definition text; occurrence_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_complete_world_upload(uuid,uuid,uuid,uuid)'::regprocedure
  ) into function_definition;
  select count(*) into occurrence_count from regexp_matches(
    function_definition,
    E'if intake\\.id is null or intake\\.state<>''scanning''',
    'g'
  );
  if occurrence_count<>1 then
    raise exception 'world upload completion predecessor is unexpected';
  end if;
  function_definition:=replace(
    function_definition,
    E'if intake.id is null or intake.state<>''scanning''',
    E'if intake.id is not null and intake.state=''promoted'' then\n    return intake.response_json;\n  end if;\n  if intake.id is null or intake.state<>''scanning'''
  );
  execute function_definition;
end;
$migration$;

revoke all on function
  public.command_ensure_world_upload_quarantine(uuid,uuid,text,text),
  public.command_ensure_world_upload_attestation(uuid,uuid,uuid,text,text,text,bigint,integer,integer,text,text,bigint,text,text),
  public.command_ensure_world_upload_promotion(uuid,uuid,uuid,text,uuid,text,text)
from public,anon,authenticated;
grant execute on function
  public.command_ensure_world_upload_quarantine(uuid,uuid,text,text),
  public.command_ensure_world_upload_attestation(uuid,uuid,uuid,text,text,text,bigint,integer,integer,text,text,bigint,text,text),
  public.command_ensure_world_upload_promotion(uuid,uuid,uuid,text,uuid,text,text)
to service_role;

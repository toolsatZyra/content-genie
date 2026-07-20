-- Phase 2 forward migration: preserve uploaded script source bytes and route
-- both browser and uploaded text through the established atomic script lock.

create or replace function private.decode_uploaded_script_source_v1(
  p_source_bytes bytea,
  p_evidence jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  bom_kind text;
  code_point integer;
  code_unit integer;
  encoding_kind text;
  evidence_byte_length integer;
  next_code_unit integer;
  result text := '';
  source_length integer := octet_length(p_source_bytes);
  source_offset integer := 0;
begin
  if source_length not between 1 and 24576
    or jsonb_typeof(p_evidence) <> 'object'
    or not (p_evidence ?& array[
      'bom','byteLength','decoderProfile','encoding','originalSha256'
    ])
    or (
      p_evidence - array[
        'bom','byteLength','decoderProfile','encoding','originalSha256'
      ]::text[]
    ) <> '{}'::jsonb
    or jsonb_typeof(p_evidence -> 'bom') <> 'string'
    or jsonb_typeof(p_evidence -> 'byteLength') <> 'number'
    or jsonb_typeof(p_evidence -> 'decoderProfile') <> 'string'
    or jsonb_typeof(p_evidence -> 'encoding') <> 'string'
    or jsonb_typeof(p_evidence -> 'originalSha256') <> 'string'
    or (p_evidence -> 'byteLength')::text !~ '^[1-9][0-9]{0,5}$'
  then
    raise exception 'uploaded script encoding evidence rejected'
      using errcode = '22023';
  end if;

  evidence_byte_length := (p_evidence ->> 'byteLength')::integer;
  bom_kind := p_evidence ->> 'bom';
  encoding_kind := p_evidence ->> 'encoding';
  if evidence_byte_length <> source_length
    or p_evidence ->> 'decoderProfile' <> 'genie-uploaded-script-decoder.v1'
    or p_evidence ->> 'originalSha256' <>
      encode(extensions.digest(p_source_bytes, 'sha256'), 'hex')
    or encoding_kind not in ('utf-8','utf-16le','utf-16be')
    or bom_kind not in ('none','utf-8','utf-16le','utf-16be')
  then
    raise exception 'uploaded script encoding evidence rejected'
      using errcode = '22023';
  end if;

  if encoding_kind = 'utf-8' then
    if bom_kind = 'utf-8' then
      if source_length < 3
        or get_byte(p_source_bytes, 0) <> 239
        or get_byte(p_source_bytes, 1) <> 187
        or get_byte(p_source_bytes, 2) <> 191
      then
        raise exception 'uploaded script BOM rejected' using errcode = '22023';
      end if;
      source_offset := 3;
    elsif bom_kind <> 'none' then
      raise exception 'uploaded script BOM rejected' using errcode = '22023';
    end if;
    result := convert_from(
      pg_catalog.substring(p_source_bytes, source_offset + 1),
      'UTF8'
    );
  else
    if encoding_kind = 'utf-16le' then
      if bom_kind <> 'utf-16le'
        or source_length < 2
        or get_byte(p_source_bytes, 0) <> 255
        or get_byte(p_source_bytes, 1) <> 254
      then
        raise exception 'uploaded script BOM rejected' using errcode = '22023';
      end if;
    elsif bom_kind <> 'utf-16be'
      or source_length < 2
      or get_byte(p_source_bytes, 0) <> 254
      or get_byte(p_source_bytes, 1) <> 255
    then
      raise exception 'uploaded script BOM rejected' using errcode = '22023';
    end if;

    source_offset := 2;
    if (source_length - source_offset) % 2 <> 0 then
      raise exception 'uploaded script UTF-16 length rejected'
        using errcode = '22023';
    end if;
    while source_offset < source_length loop
      if encoding_kind = 'utf-16le' then
        code_unit :=
          get_byte(p_source_bytes, source_offset)
          + get_byte(p_source_bytes, source_offset + 1) * 256;
      else
        code_unit :=
          get_byte(p_source_bytes, source_offset) * 256
          + get_byte(p_source_bytes, source_offset + 1);
      end if;
      source_offset := source_offset + 2;

      if code_unit between 55296 and 56319 then
        if source_offset >= source_length then
          raise exception 'uploaded script UTF-16 surrogate rejected'
            using errcode = '22023';
        end if;
        if encoding_kind = 'utf-16le' then
          next_code_unit :=
            get_byte(p_source_bytes, source_offset)
            + get_byte(p_source_bytes, source_offset + 1) * 256;
        else
          next_code_unit :=
            get_byte(p_source_bytes, source_offset) * 256
            + get_byte(p_source_bytes, source_offset + 1);
        end if;
        if next_code_unit not between 56320 and 57343 then
          raise exception 'uploaded script UTF-16 surrogate rejected'
            using errcode = '22023';
        end if;
        code_point :=
          65536 + (code_unit - 55296) * 1024 + (next_code_unit - 56320);
        source_offset := source_offset + 2;
      elsif code_unit between 56320 and 57343 then
        raise exception 'uploaded script UTF-16 surrogate rejected'
          using errcode = '22023';
      else
        code_point := code_unit;
      end if;
      result := result || chr(code_point);
    end loop;
  end if;

  return result;
exception
  when data_exception then
    raise exception 'uploaded script source bytes rejected' using errcode = '22023';
end;
$$;

revoke all on function private.decode_uploaded_script_source_v1(bytea,jsonb)
from public, anon, authenticated;

alter table public.script_revisions
  add column if not exists original_source_bytes bytea,
  add column if not exists original_source_sha256 text;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select constraint_entry.conname
    from pg_catalog.pg_constraint constraint_entry
    where constraint_entry.conrelid = 'public.script_revisions'::regclass
      and constraint_entry.contype = 'c'
      and pg_catalog.pg_get_constraintdef(constraint_entry.oid)
        like '%source_kind%browser_text%uploaded_asset_version_id%'
  loop
    execute pg_catalog.format(
      'alter table public.script_revisions drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.script_revisions
  add constraint script_revisions_source_envelope_v1_check check (
    (
      source_kind = 'browser_text'
      and uploaded_asset_version_id is null
      and original_source_bytes is null
      and original_source_sha256 is null
      and source_encoding_evidence = '{"kind":"browser-utf16"}'::jsonb
    )
    or
    (
      source_kind = 'uploaded_text'
      and uploaded_asset_version_id is null
      and original_source_bytes is not null
      and octet_length(original_source_bytes) between 1 and 24576
      and original_source_sha256 ~ '^[a-f0-9]{64}$'
      and original_source_sha256 =
        encode(extensions.digest(original_source_bytes, 'sha256'), 'hex')
      and private.decode_uploaded_script_source_v1(
        original_source_bytes,
        source_encoding_evidence
      ) = raw_text
    )
  );

create or replace function private.apply_uploaded_script_source_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context jsonb;
  original_bytes bytea;
begin
  begin
    context := nullif(
      pg_catalog.current_setting('genie.uploaded_script_source', true),
      ''
    )::jsonb;
  exception
    when others then
      raise exception 'uploaded script transaction context rejected'
        using errcode = '22023';
  end;
  if context is null then
    return new;
  end if;
  if jsonb_typeof(context) <> 'object'
    or not (context ?& array[
      'actorUserId','encodingEvidence','episodeId','originalHex',
      'originalSha256','rawUtf8Sha256','workspaceId'
    ])
    or (
      context - array[
        'actorUserId','encodingEvidence','episodeId','originalHex',
        'originalSha256','rawUtf8Sha256','workspaceId'
      ]::text[]
    ) <> '{}'::jsonb
    or context ->> 'actorUserId' <> new.created_by::text
    or context ->> 'workspaceId' <> new.workspace_id::text
    or context ->> 'episodeId' <> new.episode_id::text
    or context ->> 'rawUtf8Sha256' <> new.raw_utf8_sha256
    or context ->> 'originalHex' !~ '^[a-f0-9]+$'
  then
    raise exception 'uploaded script transaction context rejected'
      using errcode = '22023';
  end if;

  original_bytes := decode(context ->> 'originalHex', 'hex');
  if private.decode_uploaded_script_source_v1(
    original_bytes,
    context -> 'encodingEvidence'
  ) <> new.raw_text
    or context ->> 'originalSha256' <>
      encode(extensions.digest(original_bytes, 'sha256'), 'hex')
  then
    raise exception 'uploaded script source does not match decoded text'
      using errcode = '22023';
  end if;

  new.source_kind := 'uploaded_text';
  new.original_source_bytes := original_bytes;
  new.original_source_sha256 := context ->> 'originalSha256';
  new.source_encoding_evidence := context -> 'encodingEvidence';
  perform pg_catalog.set_config('genie.uploaded_script_source', '', true);
  return new;
end;
$$;

revoke all on function private.apply_uploaded_script_source_v1()
from public, anon, authenticated;

create trigger script_revisions_uploaded_source
before insert on public.script_revisions
for each row execute function private.apply_uploaded_script_source_v1();

create or replace function public.command_lock_episode_script_v2(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_expected_episode_version bigint,
  p_raw_text text,
  p_raw_utf8 bytea,
  p_raw_utf8_sha256 text,
  p_processing_text text,
  p_processing_utf8_sha256 text,
  p_processing_profile text,
  p_coordinate_map jsonb,
  p_runtime_evidence jsonb,
  p_raw_utf16_code_units integer,
  p_raw_scalar_count integer,
  p_raw_grapheme_count integer,
  p_processing_utf16_code_units integer,
  p_processing_scalar_count integer,
  p_processing_grapheme_count integer,
  p_duration_acknowledged boolean,
  p_coordinate_attestation_id uuid,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid,
  p_source_kind public.script_source_kind,
  p_original_source_bytes bytea,
  p_original_source_sha256 text,
  p_source_encoding_evidence jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  decoded_source text;
begin
  perform pg_catalog.set_config('genie.uploaded_script_source', '', true);
  if p_source_kind = 'browser_text' then
    if p_original_source_bytes is not null
      or p_original_source_sha256 is not null
      or p_source_encoding_evidence <> '{"kind":"browser-utf16"}'::jsonb
    then
      raise exception 'browser script source envelope rejected'
        using errcode = '22023';
    end if;
  elsif p_source_kind = 'uploaded_text' then
    if p_original_source_bytes is null
      or p_original_source_sha256 is null
      or p_source_encoding_evidence is null
    then
      raise exception 'uploaded script source envelope required'
        using errcode = '22023';
    end if;
    decoded_source := private.decode_uploaded_script_source_v1(
      p_original_source_bytes,
      p_source_encoding_evidence
    );
    if decoded_source <> p_raw_text
      or p_original_source_sha256 <>
        encode(extensions.digest(p_original_source_bytes, 'sha256'), 'hex')
    then
      raise exception 'uploaded script source does not match decoded text'
        using errcode = '22023';
    end if;
    perform pg_catalog.set_config(
      'genie.uploaded_script_source',
      jsonb_build_object(
        'actorUserId', auth.uid(),
        'encodingEvidence', p_source_encoding_evidence,
        'episodeId', p_episode_id,
        'originalHex', encode(p_original_source_bytes, 'hex'),
        'originalSha256', p_original_source_sha256,
        'rawUtf8Sha256', p_raw_utf8_sha256,
        'workspaceId', p_workspace_id
      )::text,
      true
    );
  else
    raise exception 'script source kind rejected' using errcode = '22023';
  end if;

  return public.command_lock_episode_script(
    p_workspace_id,
    p_episode_id,
    p_expected_episode_version,
    p_raw_text,
    p_raw_utf8,
    p_raw_utf8_sha256,
    p_processing_text,
    p_processing_utf8_sha256,
    p_processing_profile,
    p_coordinate_map,
    p_runtime_evidence,
    p_raw_utf16_code_units,
    p_raw_scalar_count,
    p_raw_grapheme_count,
    p_processing_utf16_code_units,
    p_processing_scalar_count,
    p_processing_grapheme_count,
    p_duration_acknowledged,
    p_coordinate_attestation_id,
    p_command_id,
    p_idempotency_key,
    p_request_hash,
    p_correlation_id
  );
end;
$$;

revoke all on function public.command_lock_episode_script_v2(
  uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,
  integer,integer,integer,integer,integer,integer,boolean,
  uuid,uuid,text,text,uuid,public.script_source_kind,bytea,text,jsonb
) from public, anon, authenticated;
grant execute on function public.command_lock_episode_script_v2(
  uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,
  integer,integer,integer,integer,integer,integer,boolean,
  uuid,uuid,text,text,uuid,public.script_source_kind,bytea,text,jsonb
) to authenticated;

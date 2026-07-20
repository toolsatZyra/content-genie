-- Phase 2 secure replacement uploads. Bytes enter an inaccessible quarantine,
-- are inspected and re-encoded in an isolated scanner, and only the promoted
-- derivative can become a character/location candidate.

create type private.world_upload_state as enum (
  'registered','scanning','promoted','rejected'
);

create table private.media_ingest_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version_number integer not null unique check(version_number>0),
  policy_hash text not null unique check(policy_hash~'^[a-f0-9]{64}$'),
  policy_json jsonb not null check(
    jsonb_typeof(policy_json)='object' and pg_column_size(policy_json)<=16384
  ),
  state text not null check(state in ('active','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  withdrawn_at timestamptz,
  check((state='withdrawn')=(withdrawn_at is not null))
);

create unique index media_ingest_one_active_policy_uq
  on private.media_ingest_policy_versions((true)) where state='active';

insert into private.media_ingest_policy_versions(
  version_number,policy_hash,policy_json,state
)
select 1,
  encode(extensions.digest(convert_to(policy::text,'UTF8'),'sha256'),'hex'),
  policy,'active'
from (values(jsonb_build_object(
  'schemaVersion','genie.media-ingest-policy.v1',
  'allowedMimes',jsonb_build_array('image/jpeg','image/png','image/webp'),
  'maximumBytes',26214400,
  'maximumPixels',40000000,
  'maximumDecompressedBytes',268435456,
  'singleFrameOnly',true,
  'malwareScanRequired',true,
  'metadataStripRequired',true,
  'parserSandboxRequired',true,
  'scannerTaskVersion','genie-world-image-sandbox-v1'
))) as configured(policy);

create trigger media_ingest_policies_immutable
before update or delete on private.media_ingest_policy_versions
for each row execute function private.reject_mutation();

create table private.world_upload_intakes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  configuration_candidate_id uuid not null,
  entity_kind text not null check(entity_kind in ('character','location')),
  entity_id uuid not null,
  prior_version_id uuid not null,
  regeneration_request_id uuid not null unique
    references private.world_regeneration_requests(id) on delete restrict,
  stable_asset_id uuid not null,
  quarantine_asset_version_id uuid not null unique,
  declared_mime text not null check(declared_mime in (
    'image/jpeg','image/png','image/webp'
  )),
  byte_length bigint not null check(byte_length between 1 and 26214400),
  source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),
  display_filename text not null check(
    char_length(display_filename) between 1 and 255
    and display_filename!~'[[:cntrl:]]'
  ),
  state private.world_upload_state not null default 'registered',
  requested_by uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null unique,
  idempotency_key text not null check(char_length(idempotency_key) between 8 and 200),
  request_hash text not null check(request_hash~'^[a-f0-9]{64}$'),
  response_json jsonb not null check(jsonb_typeof(response_json)='object'),
  safe_failure_class text check(
    safe_failure_class is null or safe_failure_class~'^[a-z][a-z0-9_.-]{2,100}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique(workspace_id,id),
  unique(workspace_id,requested_by,idempotency_key),
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id)
    on delete restrict,
  check(
    (state in ('promoted','rejected') and completed_at is not null)
    or (state in ('registered','scanning') and completed_at is null)
  )
);

create index world_upload_intakes_pending_idx
  on private.world_upload_intakes(state,created_at)
  where state in ('registered','scanning');

create or replace function public.get_active_media_ingest_policy()
returns jsonb
language plpgsql
security definer
set search_path=''
stable
as $$
declare policy private.media_ingest_policy_versions%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into policy from private.media_ingest_policy_versions where state='active';
  if policy.id is null then
    raise exception 'active media ingest policy unavailable' using errcode='P0002';
  end if;
  return jsonb_build_object(
    'id',policy.id,'policyHash',policy.policy_hash,'policy',policy.policy_json
  );
end;
$$;

create or replace function public.command_prepare_world_upload(
  p_workspace_id uuid,p_configuration_candidate_id uuid,
  p_entity_kind text,p_entity_id uuid,p_candidate_version_id uuid,
  p_expected_selection_version bigint,p_intake_id uuid,
  p_regeneration_request_id uuid,p_stable_asset_id uuid,
  p_quarantine_asset_version_id uuid,p_declared_mime text,
  p_byte_length bigint,p_source_sha256 text,p_display_filename text,
  p_command_id uuid,p_idempotency_key text,p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  existing private.world_upload_intakes%rowtype;
  prompt_text_value text;
  prompt_sha256_value text;
  next_selection_version bigint;
  response jsonb;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_world_candidate_scope(
    p_workspace_id,p_configuration_candidate_id
  );
  if p_entity_kind not in ('character','location')
    or p_declared_mime not in ('image/jpeg','image/png','image/webp')
    or p_byte_length not between 1 and 26214400
    or p_source_sha256!~'^[a-f0-9]{64}$'
    or p_request_hash!~'^[a-f0-9]{64}$'
    or char_length(p_display_filename) not between 1 and 255
    or p_display_filename~'[[:cntrl:]]'
  then raise exception 'world upload envelope is invalid' using errcode='22023';
  end if;

  select * into existing from private.world_upload_intakes intake
  where intake.workspace_id=p_workspace_id and intake.requested_by=actor_id
    and intake.idempotency_key=p_idempotency_key;
  if found then
    if existing.request_hash is distinct from p_request_hash then
      raise exception 'world upload idempotency key conflicts' using errcode='40001';
    end if;
    return existing.response_json;
  end if;

  if p_entity_kind='character' then
    update public.character_selections selection
    set state='generating',aggregate_version=selection.aggregate_version+1,
      updated_at=statement_timestamp()
    where selection.workspace_id=p_workspace_id
      and selection.configuration_candidate_id=p_configuration_candidate_id
      and selection.character_form_id=p_entity_id
      and selection.candidate_version_id=p_candidate_version_id
      and selection.aggregate_version=p_expected_selection_version
      and selection.state in ('review_required','accepted')
    returning selection.aggregate_version into next_selection_version;
    select candidate.prompt_text,candidate.prompt_sha256
      into prompt_text_value,prompt_sha256_value
    from public.character_versions candidate
    where candidate.id=p_candidate_version_id
      and candidate.workspace_id=p_workspace_id
      and candidate.character_form_id=p_entity_id;
  else
    update public.location_selections selection
    set state='generating',aggregate_version=selection.aggregate_version+1,
      updated_at=statement_timestamp()
    where selection.workspace_id=p_workspace_id
      and selection.configuration_candidate_id=p_configuration_candidate_id
      and selection.location_id=p_entity_id
      and selection.candidate_version_id=p_candidate_version_id
      and selection.aggregate_version=p_expected_selection_version
      and selection.state in ('review_required','accepted')
    returning selection.aggregate_version into next_selection_version;
    select candidate.prompt_text,candidate.prompt_sha256
      into prompt_text_value,prompt_sha256_value
    from public.location_versions candidate
    where candidate.id=p_candidate_version_id
      and candidate.workspace_id=p_workspace_id
      and candidate.location_id=p_entity_id;
  end if;
  if next_selection_version is null or prompt_text_value is null then
    raise exception 'world upload selection is stale' using errcode='40001';
  end if;

  response:=jsonb_build_object(
    'ok',true,'intakeId',p_intake_id,
    'regenerationRequestId',p_regeneration_request_id,
    'stableAssetId',p_stable_asset_id,
    'quarantineAssetVersionId',p_quarantine_asset_version_id,
    'selectionVersion',next_selection_version,'state','registered'
  );
  insert into private.world_regeneration_requests(
    id,workspace_id,configuration_candidate_id,entity_kind,entity_id,
    prior_version_id,revised_prompt_text,revised_prompt_sha256,state,
    requested_by,command_id,idempotency_key,request_hash,response_json
  ) values(
    p_regeneration_request_id,p_workspace_id,p_configuration_candidate_id,
    p_entity_kind,p_entity_id,p_candidate_version_id,prompt_text_value,
    prompt_sha256_value,'queued',actor_id,p_command_id,
    'upload-regen:'||p_idempotency_key,p_request_hash,response
  );
  insert into private.world_upload_intakes(
    id,workspace_id,configuration_candidate_id,entity_kind,entity_id,
    prior_version_id,regeneration_request_id,stable_asset_id,
    quarantine_asset_version_id,declared_mime,byte_length,source_sha256,
    display_filename,requested_by,command_id,idempotency_key,request_hash,
    response_json
  ) values(
    p_intake_id,p_workspace_id,p_configuration_candidate_id,p_entity_kind,
    p_entity_id,p_candidate_version_id,p_regeneration_request_id,p_stable_asset_id,
    p_quarantine_asset_version_id,p_declared_mime,p_byte_length,p_source_sha256,
    p_display_filename,actor_id,p_command_id,p_idempotency_key,p_request_hash,
    response
  );
  perform private.insert_audit_event(
    p_workspace_id,'world.upload.registered',p_entity_kind,p_entity_id,
    next_selection_version,p_command_id,p_idempotency_key,p_correlation_id,
    'allow','accepted'
  );
  return response;
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
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  update private.world_upload_intakes
    set state='scanning'
  where id=p_intake_id and workspace_id=p_workspace_id and state='registered';
  if not found then
    raise exception 'world upload intake is not registered' using errcode='40001';
  end if;
end;
$$;

create or replace function public.command_complete_world_upload(
  p_workspace_id uuid,p_intake_id uuid,p_asset_version_id uuid,
  p_world_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  intake private.world_upload_intakes%rowtype;
  character_candidate public.character_versions%rowtype;
  character_record public.characters%rowtype;
  form_record public.character_forms%rowtype;
  location_candidate public.location_versions%rowtype;
  location_record public.locations%rowtype;
  result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into intake from private.world_upload_intakes
  where id=p_intake_id and workspace_id=p_workspace_id for update;
  if intake.id is null or intake.state<>'scanning' or not exists(
    select 1 from public.asset_versions asset
    where asset.id=p_asset_version_id and asset.workspace_id=p_workspace_id
      and asset.asset_id=intake.stable_asset_id
      and asset.source_quarantine_version_id=intake.quarantine_asset_version_id
  ) then raise exception 'world upload promotion is not bound' using errcode='40001';
  end if;

  if intake.entity_kind='character' then
    select * into character_candidate from public.character_versions
      where id=intake.prior_version_id and workspace_id=p_workspace_id;
    select * into form_record from public.character_forms
      where id=intake.entity_id and workspace_id=p_workspace_id;
    select * into character_record from public.characters
      where id=form_record.character_id and workspace_id=p_workspace_id;
    if character_candidate.id is null or form_record.id is null
      or character_record.id is null
    then raise exception 'prior character candidate is unavailable' using errcode='P0002';
    end if;
    result:=public.command_record_character_candidate(
      p_workspace_id,intake.configuration_candidate_id,character_record.id,
      form_record.id,character_record.canonical_key,character_record.display_name,
      form_record.form_key,form_record.display_name,p_world_version_id,'uploaded',
      character_candidate.prompt_text,character_candidate.prompt_sha256,
      character_candidate.negative_prompt_text,p_asset_version_id,
      character_candidate.identity_manifest,character_candidate.identity_manifest_hash,
      intake.regeneration_request_id
    );
  else
    select * into location_candidate from public.location_versions
      where id=intake.prior_version_id and workspace_id=p_workspace_id;
    select * into location_record from public.locations
      where id=intake.entity_id and workspace_id=p_workspace_id;
    if location_candidate.id is null or location_record.id is null then
      raise exception 'prior location candidate is unavailable' using errcode='P0002';
    end if;
    result:=public.command_record_location_candidate(
      p_workspace_id,intake.configuration_candidate_id,location_record.id,
      location_record.canonical_key,location_record.display_name,
      location_record.named_temple,location_record.real_place_name,
      p_world_version_id,'uploaded',location_candidate.prompt_text,
      location_candidate.prompt_sha256,location_candidate.negative_prompt_text,
      p_asset_version_id,location_candidate.location_manifest,
      location_candidate.location_manifest_hash,
      location_candidate.temple_evidence_set_hash,intake.regeneration_request_id
    );
  end if;
  update private.world_upload_intakes
    set state='promoted',completed_at=statement_timestamp(),
      response_json=response_json||jsonb_build_object(
        'state','promoted','assetVersionId',p_asset_version_id,
        'worldVersionId',p_world_version_id
      )
  where id=intake.id;
  return result||jsonb_build_object(
    'intakeId',intake.id,'assetVersionId',p_asset_version_id,
    'state','review_required'
  );
end;
$$;

create or replace function public.command_fail_world_upload(
  p_workspace_id uuid,p_intake_id uuid,p_safe_failure_class text
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare intake private.world_upload_intakes%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  if p_safe_failure_class!~'^[a-z][a-z0-9_.-]{2,100}$' then
    raise exception 'safe failure class is invalid' using errcode='22023';
  end if;
  select * into intake from private.world_upload_intakes
  where id=p_intake_id and workspace_id=p_workspace_id for update;
  if intake.id is null or intake.state in ('promoted','rejected') then return; end if;
  update private.world_upload_intakes set state='rejected',
    safe_failure_class=p_safe_failure_class,completed_at=statement_timestamp()
  where id=intake.id;
  update private.world_regeneration_requests set state='superseded'
  where id=intake.regeneration_request_id and state='queued';
  if intake.entity_kind='character' then
    update public.character_selections selection
    set state=case when selected_version_id is null then 'blocked' else 'accepted' end,
      aggregate_version=selection.aggregate_version+1,
      updated_at=statement_timestamp()
    where configuration_candidate_id=intake.configuration_candidate_id
      and character_form_id=intake.entity_id
      and candidate_version_id=intake.prior_version_id
      and state='generating';
  else
    update public.location_selections selection
    set state=case when selected_version_id is null then 'blocked' else 'accepted' end,
      aggregate_version=selection.aggregate_version+1,
      updated_at=statement_timestamp()
    where configuration_candidate_id=intake.configuration_candidate_id
      and location_id=intake.entity_id
      and candidate_version_id=intake.prior_version_id
      and state='generating';
  end if;
end;
$$;

revoke all on function
  public.get_active_media_ingest_policy(),
  public.command_prepare_world_upload(uuid,uuid,text,uuid,uuid,bigint,uuid,uuid,uuid,uuid,text,bigint,text,text,uuid,text,text,uuid),
  public.command_mark_world_upload_scanning(uuid,uuid),
  public.command_complete_world_upload(uuid,uuid,uuid,uuid),
  public.command_fail_world_upload(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function
  public.command_prepare_world_upload(uuid,uuid,text,uuid,uuid,bigint,uuid,uuid,uuid,uuid,text,bigint,text,text,uuid,text,text,uuid)
to authenticated;
grant execute on function
  public.get_active_media_ingest_policy(),
  public.command_mark_world_upload_scanning(uuid,uuid),
  public.command_complete_world_upload(uuid,uuid,uuid,uuid),
  public.command_fail_world_upload(uuid,uuid,text)
to service_role;

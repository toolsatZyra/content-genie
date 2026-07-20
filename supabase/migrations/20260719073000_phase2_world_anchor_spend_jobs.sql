-- Durable one-click World-build authority and per-anchor provider work.
-- The human authorizes a fixed $3.84 ceiling before extraction; the service
-- may consume only the exact <=32 image slots produced by the immutable script.

create type private.world_build_intent_state as enum (
  'active','consumed','revoked','expired'
);
create type private.world_anchor_job_state as enum (
  'reserved','dispatching','waiting_output','promoted','failed'
);

create table private.world_build_spend_intents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  look_version_id uuid not null references public.look_versions(id) on delete restrict,
  authorized_by uuid not null references auth.users(id) on delete restrict,
  actor_authority_epoch bigint not null check (actor_authority_epoch > 0),
  aal text not null check (aal = 'aal2'),
  hard_ceiling_minor bigint not null check (hard_ceiling_minor = 384),
  state private.world_build_intent_state not null default 'active',
  command_id uuid not null unique,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  unique (workspace_id, authorized_by, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id,id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key (workspace_id,episode_id,script_revision_id)
    references public.script_revisions(workspace_id,episode_id,id) on delete restrict,
  check (expires_at > created_at),
  check ((state = 'consumed') = (consumed_at is not null))
);

create unique index world_build_one_active_intent_uq
  on private.world_build_spend_intents(configuration_candidate_id)
  where state = 'active';

create table private.world_anchor_preparations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  world_extraction_result_id uuid not null references private.world_extraction_results(id) on delete restrict,
  spend_intent_id uuid not null references private.world_build_spend_intents(id) on delete restrict,
  provider_capability_id uuid not null references private.provider_capabilities(id) on delete restrict,
  micro_quote_id uuid not null references private.micro_quotes(id) on delete restrict,
  micro_authorization_id uuid not null references private.micro_authorizations(id) on delete restrict,
  micro_reservation_id uuid not null references private.micro_reservations(id) on delete restrict,
  job_count integer not null check (job_count between 1 and 32),
  preparation_hash text not null check (preparation_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (preflight_run_id),
  unique (world_extraction_result_id),
  unique (workspace_id,id),
  foreign key (workspace_id,preflight_run_id,stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id,preflight_run_id,id) on delete restrict
);

create table private.world_anchor_jobs (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preparation_id uuid not null references private.world_anchor_preparations(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  slot_key text not null check (slot_key ~ '^[a-z][a-z0-9_.:-]{2,140}$'),
  entity_kind text not null check (entity_kind in ('character','location')),
  character_id uuid,
  character_form_id uuid,
  character_key text check (character_key is null or character_key ~ '^[a-z0-9][a-z0-9_.-]{1,99}$'),
  character_name text check (character_name is null or char_length(character_name) between 1 and 200),
  form_key text check (form_key is null or form_key ~ '^[a-z0-9][a-z0-9_.-]{1,99}$'),
  form_name text check (form_name is null or char_length(form_name) between 1 and 200),
  location_id uuid,
  location_key text check (location_key is null or location_key ~ '^[a-z0-9][a-z0-9_.-]{1,99}$'),
  location_name text check (location_name is null or char_length(location_name) between 1 and 240),
  named_temple boolean not null default false,
  real_place_name text check (real_place_name is null or char_length(real_place_name) between 1 and 300),
  prompt_text text not null check (char_length(prompt_text) between 1 and 16000),
  prompt_sha256 text not null check (prompt_sha256 ~ '^[a-f0-9]{64}$'),
  negative_prompt_text text not null check (char_length(negative_prompt_text) <= 8000),
  world_manifest jsonb not null check (jsonb_typeof(world_manifest) = 'object' and pg_column_size(world_manifest) <= 65536),
  world_manifest_hash text not null check (world_manifest_hash ~ '^[a-f0-9]{64}$'),
  temple_evidence_set_hash text check (temple_evidence_set_hash is null or temple_evidence_set_hash ~ '^[a-f0-9]{64}$'),
  target_asset_id uuid not null,
  micro_quote_line_id uuid not null references private.micro_quote_lines(id) on delete restrict,
  input_manifest_id uuid not null,
  input_manifest_hash text not null check (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  capability_jti uuid not null unique,
  provider_request_id uuid references private.provider_requests(id) on delete restrict,
  capability_grant_id uuid references private.worker_capability_grants(id) on delete restrict,
  promoted_asset_version_id uuid,
  world_version_id uuid,
  state private.world_anchor_job_state not null default 'reserved',
  safe_failure_class text check (safe_failure_class is null or safe_failure_class ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (preparation_id,slot_key),
  unique (micro_quote_line_id),
  unique (workspace_id,id),
  unique (provider_request_id),
  foreign key (workspace_id,preflight_run_id,stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id,preflight_run_id,id) on delete restrict,
  foreign key (workspace_id,input_manifest_id)
    references private.provider_input_manifests(workspace_id,id) on delete restrict,
  check (
    (entity_kind='character' and num_nonnulls(character_id,character_form_id,character_key,character_name,form_key,form_name)=6
      and num_nonnulls(location_id,location_key,location_name)=0 and not named_temple and real_place_name is null)
    or
    (entity_kind='location' and num_nonnulls(character_id,character_form_id,character_key,character_name,form_key,form_name)=0
      and num_nonnulls(location_id,location_key,location_name)=3)
  ),
  check (not named_temple or (real_place_name is not null and temple_evidence_set_hash is not null)),
  check ((state='promoted')=(completed_at is not null)),
  check ((provider_request_id is null)=(capability_grant_id is null)),
  check ((state='reserved')=(provider_request_id is null)),
  check (state<>'promoted' or num_nonnulls(promoted_asset_version_id,world_version_id)=2)
);

create trigger world_anchor_preparations_immutable
before update or delete on private.world_anchor_preparations
for each row execute function private.reject_mutation();

create or replace function public.command_authorize_world_build_intent(
  p_workspace_id uuid,p_episode_id uuid,p_configuration_candidate_id uuid,
  p_expected_configuration_version bigint,p_hard_ceiling_minor bigint,
  p_command_id uuid,p_idempotency_key text,p_request_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor_id uuid:=auth.uid(); actor_epoch bigint;
  candidate public.episode_configuration_candidates%rowtype;
  intent private.world_build_spend_intents%rowtype;
begin
  if actor_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_aal2();
  select authority_epoch into actor_epoch from public.memberships
    where workspace_id=p_workspace_id and user_id=actor_id and status='active';
  if actor_epoch is null then raise exception 'active membership required' using errcode='42501'; end if;
  if p_hard_ceiling_minor<>384 or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  then raise exception 'world build intent envelope is invalid' using errcode='22023'; end if;
  select * into intent from private.world_build_spend_intents
    where workspace_id=p_workspace_id and authorized_by=actor_id and idempotency_key=p_idempotency_key;
  if found then
    if intent.request_hash<>p_request_hash then
      raise exception 'world build intent idempotency conflict' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'intentId',intent.id,
      'hardCeilingMinor',intent.hard_ceiling_minor,'expiresAt',intent.expires_at);
  end if;
  select * into candidate from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id
      and episode_id=p_episode_id for update;
  if candidate.id is null or candidate.aggregate_version<>p_expected_configuration_version
    or candidate.state<>'world_design' or candidate.voice_confirmed_at is null
    or candidate.look_confirmed_at is null
  then raise exception 'world build configuration is stale' using errcode='40001'; end if;
  update private.world_build_spend_intents set state='expired'
    where configuration_candidate_id=candidate.id and state='active'
      and expires_at<=statement_timestamp();
  insert into private.world_build_spend_intents(
    workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    look_version_id,authorized_by,actor_authority_epoch,aal,hard_ceiling_minor,
    command_id,idempotency_key,request_hash,expires_at
  ) values(
    p_workspace_id,p_episode_id,candidate.id,candidate.script_revision_id,
    candidate.look_version_id,actor_id,actor_epoch,'aal2',384,p_command_id,
    p_idempotency_key,p_request_hash,statement_timestamp()+interval '24 hours'
  ) returning * into intent;
  return jsonb_build_object('ok',true,'replayed',false,'intentId',intent.id,
    'hardCeilingMinor',intent.hard_ceiling_minor,'expiresAt',intent.expires_at);
end;
$$;

create or replace function public.command_ensure_fal_world_capability(
  p_workspace_id uuid,p_environment text,p_schema_raw_sha256 text,
  p_schema_canonical_hash text,p_canary_raw_sha256 text,p_canary_canonical_hash text,
  p_retrieved_at timestamptz,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare account private.provider_accounts%rowtype;
  schema_evidence private.provider_evidence_snapshots%rowtype;
  canary_evidence private.provider_evidence_snapshots%rowtype;
  capability private.provider_capabilities%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_schema_raw_sha256 !~ '^[a-f0-9]{64}$' or p_schema_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_canary_raw_sha256 !~ '^[a-f0-9]{64}$' or p_canary_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at<=p_retrieved_at or p_expires_at>p_retrieved_at+interval '90 days'
  then raise exception 'fal world capability evidence is invalid' using errcode='22023'; end if;
  insert into private.provider_accounts(
    workspace_id,environment,provider,account_key,credential_secret_ref,region,state
  ) values(p_workspace_id,p_environment,'fal','fal-world-images','FAL_KEY','global','active')
  on conflict(workspace_id,environment,account_key) do update
    set state='active',aggregate_version=private.provider_accounts.aggregate_version+1
  returning * into account;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(account.id,'official_schema',
    encode(extensions.digest(convert_to('https://fal.ai/models/fal-ai/nano-banana-2','UTF8'),'sha256'),'hex'),
    p_schema_raw_sha256,p_schema_canonical_hash,
    'provider-evidence/fal/nano-banana-2/schema-'||p_schema_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at)
  on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into schema_evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='official_schema'
      and canonical_hash=p_schema_canonical_hash;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(account.id,'canary',
    encode(extensions.digest(convert_to('fal-account-canary:2026-07-19','UTF8'),'sha256'),'hex'),
    p_canary_raw_sha256,p_canary_canonical_hash,
    'provider-evidence/fal/nano-banana-2/canary-'||p_canary_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at)
  on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into canary_evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='canary'
      and canonical_hash=p_canary_canonical_hash;
  select * into capability from private.provider_capabilities
    where provider_account_id=account.id and capability='gen_image'
      and model_key='fal-ai/nano-banana-2'
      and schema_version='genie.fal-nano-banana-2.v1';
  if capability.id is null then
    insert into private.provider_capabilities(
      provider_account_id,capability,model_key,model_version,endpoint_key,
      schema_version,evidence_snapshot_id,currency,unit_name,unit_price_minor,
      maximum_request_minor,retention_class,verified_at,expires_at,status
    ) values(account.id,'gen_image','fal-ai/nano-banana-2','2026-07-19',
      'nano-banana-2','genie.fal-nano-banana-2.v1',schema_evidence.id,'USD',
      'image',12,12,'account_opt_out',greatest(p_retrieved_at,canary_evidence.retrieved_at),
      least(p_expires_at,schema_evidence.expires_at,canary_evidence.expires_at),'verified')
    returning * into capability;
  end if;
  if capability.status<>'verified' or capability.expires_at<=statement_timestamp()
    or capability.unit_price_minor<>12 or capability.maximum_request_minor<>12
  then raise exception 'fal world capability is not current' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'providerAccountId',account.id,
    'capabilityId',capability.id,'schemaEvidenceId',schema_evidence.id,
    'canaryEvidenceId',canary_evidence.id,'unitPriceMinor',capability.unit_price_minor,
    'expiresAt',capability.expires_at);
end;
$$;

create or replace function public.command_prepare_world_anchor_jobs(
  p_preflight_run_id uuid,p_stage_attempt_id uuid,p_world_extraction_result_id uuid,
  p_provider_capability_id uuid,p_jobs jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  extraction private.world_extraction_results%rowtype;
  intent private.world_build_spend_intents%rowtype;
  capability private.provider_capabilities%rowtype;
  preparation private.world_anchor_preparations%rowtype;
  quote_id uuid:=gen_random_uuid(); authorization_id uuid:=gen_random_uuid();
  reservation_id uuid:=gen_random_uuid(); prep_id uuid:=gen_random_uuid();
  job jsonb; line_id uuid; manifest_id uuid; manifest_hash text; prompt_hash text;
  manifest_hash_world text; quote_hash text; rate_hash text; job_count integer; line_no integer:=0;
  total_minor bigint; preparation_hash text; response_jobs jsonb:='[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if jsonb_typeof(p_jobs)<>'array' or jsonb_array_length(p_jobs) not between 1 and 32
    or pg_column_size(p_jobs)>524288
  then raise exception 'world anchor jobs envelope is invalid' using errcode='22023'; end if;
  select * into preparation from private.world_anchor_preparations
    where preflight_run_id=p_preflight_run_id;
  if found then
    if preparation.world_extraction_result_id<>p_world_extraction_result_id
      or preparation.stage_attempt_id<>p_stage_attempt_id
    then raise exception 'world anchor preparation replay conflicts' using errcode='40001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'jobId',j.id,'slotKey',j.slot_key,'state',j.state,'providerRequestId',j.provider_request_id,
      'capabilityGrantId',j.capability_grant_id,'capabilityJti',j.capability_jti,
      'inputManifestId',j.input_manifest_id,'inputManifestHash',j.input_manifest_hash,
      'quoteLineId',j.micro_quote_line_id,'targetAssetId',j.target_asset_id
    ) order by j.slot_key),'[]'::jsonb) into response_jobs
    from private.world_anchor_jobs j where j.preparation_id=preparation.id;
    return jsonb_build_object('ok',true,'replayed',true,'preparationId',preparation.id,
      'jobs',response_jobs,'totalMinor',(select total_minor from private.micro_quotes where id=preparation.micro_quote_id));
  end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and preflight_run_id=run.id for update;
  select * into extraction from private.world_extraction_results
    where id=p_world_extraction_result_id and preflight_run_id=run.id;
  select * into capability from private.provider_capabilities
    where id=p_provider_capability_id and capability='gen_image' and model_key='fal-ai/nano-banana-2'
      and schema_version='genie.fal-nano-banana-2.v1' and status='verified'
      and expires_at>statement_timestamp();
  select * into intent from private.world_build_spend_intents
    where configuration_candidate_id=run.configuration_candidate_id and state='active'
      and expires_at>statement_timestamp() for update;
  if run.id is null or run.kind<>'world_anchor' or run.state<>'running'
    or attempt.id is null or attempt.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch
    or extraction.id is null or extraction.script_revision_id<>run.script_revision_id
    or extraction.look_version_id<>intent.look_version_id
    or intent.id is null or intent.workspace_id<>run.workspace_id
    or intent.episode_id<>run.episode_id or intent.script_revision_id<>run.script_revision_id
    or capability.id is null or capability.unit_price_minor<>12
  then raise exception 'world anchor preparation authority is stale' using errcode='40001'; end if;
  job_count:=jsonb_array_length(p_jobs); total_minor:=job_count*capability.unit_price_minor;
  if total_minor>intent.hard_ceiling_minor then
    raise exception 'world anchor jobs exceed human ceiling' using errcode='54000'; end if;
  quote_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'configurationCandidateId',run.configuration_candidate_id,'extractionHash',extraction.extraction_hash,
    'capabilityId',capability.id,'jobs',p_jobs,'totalMinor',total_minor)::text,'UTF8'),'sha256'),'hex');
  rate_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'capabilityId',capability.id,'unitPriceMinor',capability.unit_price_minor,
    'schemaVersion',capability.schema_version,'expiresAt',capability.expires_at)::text,'UTF8'),'sha256'),'hex');
  insert into private.micro_quotes(id,workspace_id,episode_id,configuration_candidate_id,
    script_revision_id,preflight_kind,quote_number,quote_hash,rate_snapshot_hash,
    currency,total_minor,state,expires_at,confirmed_at)
  values(quote_id,run.workspace_id,run.episode_id,run.configuration_candidate_id,
    run.script_revision_id,'world_anchor',coalesce((select max(q.quote_number)+1 from private.micro_quotes q
      where q.configuration_candidate_id=run.configuration_candidate_id and q.preflight_kind='world_anchor'),1),
    quote_hash,rate_hash,'USD',total_minor,'confirmed',least(intent.expires_at,statement_timestamp()+interval '24 hours'),statement_timestamp());
  insert into private.micro_authorizations(id,workspace_id,micro_quote_id,configuration_candidate_id,
    script_revision_id,authorized_by,actor_authority_epoch,aal,quote_hash,hard_ceiling_minor,state,expires_at)
  values(authorization_id,run.workspace_id,quote_id,run.configuration_candidate_id,run.script_revision_id,
    intent.authorized_by,intent.actor_authority_epoch,'aal2',quote_hash,total_minor,'active',
    least(intent.expires_at,statement_timestamp()+interval '24 hours'));
  insert into private.micro_reservations(id,workspace_id,micro_quote_id,micro_authorization_id,
    amount_minor,state,expires_at)
  values(reservation_id,run.workspace_id,quote_id,authorization_id,total_minor,'held',
    least(intent.expires_at,statement_timestamp()+interval '24 hours'));
  update public.preflight_runs set requires_micro_authority=true,micro_quote_id=quote_id,
    micro_authorization_id=authorization_id,micro_reservation_id=reservation_id,
    aggregate_version=aggregate_version+1 where id=run.id returning * into run;
  preparation_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'runId',run.id,'attemptId',attempt.id,'extractionId',extraction.id,'quoteHash',quote_hash,'jobs',p_jobs)::text,
    'UTF8'),'sha256'),'hex');
  insert into private.world_anchor_preparations(id,workspace_id,preflight_run_id,stage_attempt_id,
    world_extraction_result_id,spend_intent_id,provider_capability_id,micro_quote_id,
    micro_authorization_id,micro_reservation_id,job_count,preparation_hash)
  values(prep_id,run.workspace_id,run.id,attempt.id,extraction.id,intent.id,capability.id,
    quote_id,authorization_id,reservation_id,job_count,preparation_hash)
  returning * into preparation;
  for job in select * from jsonb_array_elements(p_jobs)
  loop
    line_no:=line_no+1;
    if jsonb_typeof(job)<>'object' or (job-array[
      'jobId','slotKey','entityKind','characterId','characterFormId','characterKey','characterName',
      'formKey','formName','locationId','locationKey','locationName','namedTemple','realPlaceName',
      'promptText','negativePromptText','worldManifest','worldManifestHash','templeEvidenceSetHash',
      'targetAssetId','capabilityJti','providerPayload'
    ]::text[])<>'{}'::jsonb or not (job ?& array[
      'jobId','slotKey','entityKind','characterId','characterFormId','characterKey','characterName',
      'formKey','formName','locationId','locationKey','locationName','namedTemple','realPlaceName',
      'promptText','negativePromptText','worldManifest','worldManifestHash','templeEvidenceSetHash',
      'targetAssetId','capabilityJti','providerPayload'
    ]) or job->>'slotKey' !~ '^[a-z][a-z0-9_.:-]{2,140}$'
      or job->>'entityKind' not in ('character','location')
      or job->>'promptText' is null or char_length(job->>'promptText') not between 1 and 16000
      or jsonb_typeof(job->'providerPayload')<>'object' or jsonb_typeof(job->'worldManifest')<>'object'
      or (job->>'namedTemple')::boolean
    then raise exception 'world anchor job is invalid or requires temple research' using errcode='22023'; end if;
    prompt_hash:=encode(extensions.digest(convert_to(job->>'promptText','UTF8'),'sha256'),'hex');
    manifest_hash_world:=encode(extensions.digest(convert_to((job->'worldManifest')::text,'UTF8'),'sha256'),'hex');
    if job->>'worldManifestHash'<>manifest_hash_world then
      raise exception 'world anchor manifest hash is invalid' using errcode='22023'; end if;
    manifest_id:=gen_random_uuid(); line_id:=gen_random_uuid();
    manifest_hash:=encode(extensions.digest(convert_to((job->'providerPayload')::text,'UTF8'),'sha256'),'hex');
    insert into private.micro_quote_lines(id,micro_quote_id,line_number,slot_key,capability_id,
      operation,quantity,unit_price_minor,amount_minor,request_schema_hash)
    values(line_id,quote_id,line_no,job->>'slotKey',capability.id,'gen_image',1,
      capability.unit_price_minor,capability.unit_price_minor,
      encode(extensions.digest(convert_to(capability.schema_version,'UTF8'),'sha256'),'hex'));
    insert into private.provider_input_manifests(id,workspace_id,operation,payload_schema_version,payload_json,content_hash)
    values(manifest_id,run.workspace_id,'gen_image',capability.schema_version,job->'providerPayload',manifest_hash);
    insert into private.world_anchor_jobs(
      id,workspace_id,preparation_id,preflight_run_id,stage_attempt_id,slot_key,entity_kind,
      character_id,character_form_id,character_key,character_name,form_key,form_name,
      location_id,location_key,location_name,named_temple,real_place_name,prompt_text,prompt_sha256,
      negative_prompt_text,world_manifest,world_manifest_hash,temple_evidence_set_hash,target_asset_id,
      micro_quote_line_id,input_manifest_id,input_manifest_hash,capability_jti
    ) values((job->>'jobId')::uuid,run.workspace_id,prep_id,run.id,attempt.id,job->>'slotKey',job->>'entityKind',
      (job->>'characterId')::uuid,(job->>'characterFormId')::uuid,job->>'characterKey',job->>'characterName',
      job->>'formKey',job->>'formName',(job->>'locationId')::uuid,job->>'locationKey',job->>'locationName',
      (job->>'namedTemple')::boolean,job->>'realPlaceName',job->>'promptText',prompt_hash,
      job->>'negativePromptText',job->'worldManifest',manifest_hash_world,job->>'templeEvidenceSetHash',
      (job->>'targetAssetId')::uuid,line_id,manifest_id,manifest_hash,(job->>'capabilityJti')::uuid);
    response_jobs:=response_jobs||jsonb_build_array(jsonb_build_object(
      'jobId',job->>'jobId','slotKey',job->>'slotKey','state','reserved','providerRequestId',null,
      'capabilityGrantId',null,'capabilityJti',job->>'capabilityJti','inputManifestId',manifest_id,
      'inputManifestHash',manifest_hash,'quoteLineId',line_id,'targetAssetId',job->>'targetAssetId'));
  end loop;
  update private.world_build_spend_intents set state='consumed',consumed_at=statement_timestamp()
    where id=intent.id;
  return jsonb_build_object('ok',true,'replayed',false,'preparationId',preparation.id,
    'jobs',response_jobs,'totalMinor',total_minor);
end;
$$;

create or replace function public.command_claim_world_anchor_provider_job(
  p_job_id uuid,p_idempotency_key text,p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.world_anchor_jobs%rowtype; run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype; capability private.provider_capabilities%rowtype;
  request private.provider_requests%rowtype; grant_id uuid; scope_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.world_anchor_jobs where id=p_job_id for update;
  if job.provider_request_id is not null then
    select * into request from private.provider_requests where id=job.provider_request_id;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'providerRequestId',request.id,
      'providerRequestState',request.state,'capabilityGrantId',job.capability_grant_id,
      'capabilityJti',job.capability_jti,'workspaceId',job.workspace_id,'preflightRunId',job.preflight_run_id,
      'stageAttemptId',job.stage_attempt_id,'stageRunId',(select preflight_stage_run_id from public.preflight_stage_attempts where id=job.stage_attempt_id),
      'authorityEpoch',(select authority_epoch from public.preflight_stage_attempts where id=job.stage_attempt_id),
      'fencingToken',(select fencing_token from public.preflight_stage_attempts where id=job.stage_attempt_id),
      'inputManifestId',job.input_manifest_id,'inputManifestHash',job.input_manifest_hash,
      'quoteLineId',job.micro_quote_line_id);
  end if;
  select * into run from public.preflight_runs where id=job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id for update;
  select capability.* into capability from private.world_anchor_preparations prep
    join private.provider_capabilities capability on capability.id=prep.provider_capability_id
    where prep.id=job.preparation_id;
  if job.id is null or job.state<>'reserved' or run.state<>'running'
    or not run.requires_micro_authority or attempt.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch
    or attempt.fencing_token<>(select highest_fencing_token from public.preflight_stage_runs where id=attempt.preflight_stage_run_id)
    or capability.status<>'verified' or capability.expires_at<=statement_timestamp()
    or not exists(select 1 from private.micro_quote_lines l where l.id=job.micro_quote_line_id
      and l.micro_quote_id=run.micro_quote_id and l.capability_id=capability.id)
  then raise exception 'world anchor provider job authority is stale' using errcode='40001'; end if;
  insert into private.provider_requests(workspace_id,preflight_run_id,stage_attempt_id,
    provider_account_id,provider_capability_id,operation,request_schema_version,input_manifest_id,
    input_manifest_hash,idempotency_key,correlation_id,expected_cost_minor,maximum_cost_minor)
  values(job.workspace_id,run.id,attempt.id,capability.provider_account_id,capability.id,'gen_image',
    capability.schema_version,job.input_manifest_id,job.input_manifest_hash,p_idempotency_key,p_correlation_id,
    capability.unit_price_minor,capability.maximum_request_minor) returning * into request;
  insert into private.provider_request_quote_claims(workspace_id,provider_request_id,preflight_run_id,
    micro_quote_line_id,micro_authorization_id,micro_reservation_id,authority_epoch,fencing_token)
  values(job.workspace_id,request.id,run.id,job.micro_quote_line_id,run.micro_authorization_id,
    run.micro_reservation_id,run.authority_epoch,attempt.fencing_token);
  scope_hash:=encode(extensions.digest(convert_to(jsonb_build_object('jobId',job.id,
    'targetAssetId',job.target_asset_id,'inputManifestHash',job.input_manifest_hash)::text,'UTF8'),'sha256'),'hex');
  insert into private.worker_capability_grants(workspace_id,preflight_run_id,stage_attempt_id,
    provider_request_id,micro_quote_line_id,capability,authority_epoch,fencing_token,input_manifest_hash,
    token_jti_hash,allowed_rpc,allowed_object_scope_hash,expires_at)
  values(job.workspace_id,run.id,attempt.id,request.id,job.micro_quote_line_id,'gen_image',run.authority_epoch,
    attempt.fencing_token,job.input_manifest_hash,
    encode(extensions.digest(convert_to(job.capability_jti::text,'UTF8'),'sha256'),'hex'),
    'provider.submit_exact_request',scope_hash,statement_timestamp()+interval '5 minutes') returning id into grant_id;
  update private.world_anchor_jobs set provider_request_id=request.id,capability_grant_id=grant_id,
    state='dispatching' where id=job.id returning * into job;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,'providerRequestId',request.id,
    'providerRequestState',request.state,'capabilityGrantId',grant_id,'capabilityJti',job.capability_jti,
    'workspaceId',job.workspace_id,'preflightRunId',job.preflight_run_id,'stageAttemptId',job.stage_attempt_id,
    'stageRunId',attempt.preflight_stage_run_id,'authorityEpoch',attempt.authority_epoch,
    'fencingToken',attempt.fencing_token,'inputManifestId',job.input_manifest_id,
    'inputManifestHash',job.input_manifest_hash,'quoteLineId',job.micro_quote_line_id);
end;
$$;

create or replace function public.command_mark_world_anchor_waiting_external(
  p_preflight_run_id uuid,p_stage_attempt_id uuid,p_trigger_task_id text,p_trigger_run_id text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=p_stage_attempt_id and preflight_run_id=run.id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  if run.state='waiting_external' and attempt.state='waiting_external' then
    return jsonb_build_object('ok',true,'replayed',true,'state','waiting_external');
  end if;
  if run.state<>'running' or attempt.state<>'claimed' or stage.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch or attempt.fencing_token<>stage.highest_fencing_token
    or exists(select 1 from private.world_anchor_jobs j where j.preflight_run_id=run.id
      and (j.provider_request_id is null or j.state<>'dispatching'))
  then raise exception 'world anchor external wait is stale' using errcode='40001'; end if;
  update public.preflight_stage_attempts set state='waiting_external',trigger_task_id=p_trigger_task_id,
    trigger_run_id=p_trigger_run_id,started_at=coalesce(started_at,statement_timestamp()) where id=attempt.id;
  update public.preflight_stage_leases set state='consumed',closed_at=statement_timestamp()
    where stage_attempt_id=attempt.id and state='active';
  update public.preflight_stage_runs set state='waiting_external',aggregate_version=aggregate_version+1 where id=stage.id;
  update public.preflight_runs set state='waiting_external',reconciliation_due_at=statement_timestamp()+interval '5 minutes',
    aggregate_version=aggregate_version+1 where id=run.id;
  update private.world_anchor_jobs set state='waiting_output' where preflight_run_id=run.id and state='dispatching';
  return jsonb_build_object('ok',true,'replayed',false,'state','waiting_external');
end;
$$;

create or replace function public.command_complete_world_anchor_job(
  p_provider_request_id uuid,p_promoted_asset_version_id uuid,p_world_version_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.world_anchor_jobs%rowtype; run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype; stage public.preflight_stage_runs%rowtype;
  candidate_result jsonb; output_id uuid; output_manifest jsonb; output_hash text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.world_anchor_jobs where provider_request_id=p_provider_request_id for update;
  if job.state='promoted' then
    if job.promoted_asset_version_id<>p_promoted_asset_version_id then
      raise exception 'world anchor completion replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'worldVersionId',job.world_version_id);
  end if;
  select * into run from public.preflight_runs where id=job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id for update;
  select * into stage from public.preflight_stage_runs where id=attempt.preflight_stage_run_id for update;
  if job.id is null or job.state<>'waiting_output' or run.state<>'waiting_external'
    or attempt.state<>'waiting_external' or stage.state<>'waiting_external'
    or not exists(select 1 from public.asset_versions v where v.id=p_promoted_asset_version_id
      and v.workspace_id=job.workspace_id and v.asset_id=job.target_asset_id)
  then raise exception 'world anchor promoted asset authority is stale' using errcode='40001'; end if;
  if job.entity_kind='character' then
    candidate_result:=public.command_record_character_candidate(job.workspace_id,
      (select configuration_candidate_id from public.preflight_runs where id=job.preflight_run_id),
      job.character_id,job.character_form_id,job.character_key,job.character_name,job.form_key,job.form_name,
      p_world_version_id,'generated',job.prompt_text,job.prompt_sha256,job.negative_prompt_text,
      p_promoted_asset_version_id,job.world_manifest,job.world_manifest_hash,null);
  else
    candidate_result:=public.command_record_location_candidate(job.workspace_id,
      (select configuration_candidate_id from public.preflight_runs where id=job.preflight_run_id),
      job.location_id,job.location_key,job.location_name,job.named_temple,job.real_place_name,
      p_world_version_id,'generated',job.prompt_text,job.prompt_sha256,job.negative_prompt_text,
      p_promoted_asset_version_id,job.world_manifest,job.world_manifest_hash,job.temple_evidence_set_hash,null);
  end if;
  update private.world_anchor_jobs set state='promoted',promoted_asset_version_id=p_promoted_asset_version_id,
    world_version_id=p_world_version_id,completed_at=statement_timestamp() where id=job.id;
  if not exists(select 1 from private.world_anchor_jobs j where j.preflight_run_id=run.id and j.state<>'promoted') then
    output_id:=gen_random_uuid();
    output_manifest:=jsonb_build_object('schemaVersion','genie.world-anchor-output.v1',
      'preflightRunId',run.id,'jobCount',(select count(*) from private.world_anchor_jobs j where j.preflight_run_id=run.id),
      'worldVersionIds',(select jsonb_agg(j.world_version_id order by j.slot_key) from private.world_anchor_jobs j where j.preflight_run_id=run.id));
    output_hash:=encode(extensions.digest(convert_to(output_manifest::text,'UTF8'),'sha256'),'hex');
    insert into private.preflight_output_manifests(id,workspace_id,preflight_run_id,stage_attempt_id,
      schema_version,manifest_json,manifest_hash)
    values(output_id,run.workspace_id,run.id,attempt.id,'genie.preflight-output.v1',output_manifest,output_hash);
    update public.preflight_stage_attempts set state='succeeded',output_manifest_id=output_id,
      output_manifest_hash=output_hash,completed_at=statement_timestamp() where id=attempt.id;
    update public.preflight_stage_runs set state='succeeded',output_manifest_id=output_id,
      output_manifest_hash=output_hash,completed_at=statement_timestamp(),aggregate_version=aggregate_version+1 where id=stage.id;
    update public.preflight_runs set state='succeeded',completed_at=statement_timestamp(),
      reconciliation_due_at=null,aggregate_version=aggregate_version+1 where id=run.id;
  end if;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,
    'worldVersionId',p_world_version_id,'candidate',candidate_result);
end;
$$;

revoke all on table private.world_build_spend_intents,private.world_anchor_preparations,
  private.world_anchor_jobs from public,anon,authenticated;
revoke all on function public.command_authorize_world_build_intent(uuid,uuid,uuid,bigint,bigint,uuid,text,text),
  public.command_ensure_fal_world_capability(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.command_prepare_world_anchor_jobs(uuid,uuid,uuid,uuid,jsonb),
  public.command_claim_world_anchor_provider_job(uuid,text,uuid),
  public.command_mark_world_anchor_waiting_external(uuid,uuid,text,text),
  public.command_complete_world_anchor_job(uuid,uuid,uuid)
from public,anon,authenticated;
grant execute on function public.command_authorize_world_build_intent(uuid,uuid,uuid,bigint,bigint,uuid,text,text)
  to authenticated;
grant execute on function public.command_ensure_fal_world_capability(uuid,text,text,text,text,text,timestamptz,timestamptz),
  public.command_prepare_world_anchor_jobs(uuid,uuid,uuid,uuid,jsonb),
  public.command_claim_world_anchor_provider_job(uuid,text,uuid),
  public.command_mark_world_anchor_waiting_external(uuid,uuid,text,text),
  public.command_complete_world_anchor_job(uuid,uuid,uuid)
to service_role;

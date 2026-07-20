-- Extend the one-click AAL2 pre-lock envelope to cover both World anchors and
-- one bounded narration request. Image and speech spend remain separate,
-- immutable micro quotes/reservations and cannot claim one another's slots.

alter table private.world_build_spend_intents
  drop constraint world_build_spend_intents_hard_ceiling_minor_check;

update private.world_build_spend_intents set hard_ceiling_minor = 500
where hard_ceiling_minor = 384;

alter table private.world_build_spend_intents
  add column world_ceiling_minor bigint not null default 384
    check (world_ceiling_minor = 384),
  add column narration_ceiling_minor bigint not null default 116
    check (narration_ceiling_minor = 116),
  add constraint world_build_spend_intents_hard_ceiling_minor_check
    check (hard_ceiling_minor = 500),
  add constraint world_build_spend_intents_partitioned_ceiling_check
    check (world_ceiling_minor + narration_ceiling_minor = hard_ceiling_minor);

create type private.narration_job_state as enum (
  'reserved','dispatching','quarantined','scanning','promoted','failed'
);

create table private.narration_generation_jobs (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  spend_intent_id uuid not null
    references private.world_build_spend_intents(id) on delete restrict,
  audio_identity_selection_id uuid not null,
  provider_capability_id uuid not null
    references private.provider_capabilities(id) on delete restrict,
  target_asset_id uuid not null,
  micro_quote_line_id uuid not null
    references private.micro_quote_lines(id) on delete restrict,
  input_manifest_id uuid not null,
  input_manifest_hash text not null check (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  capability_jti uuid not null unique,
  provider_request_id uuid references private.provider_requests(id) on delete restrict,
  capability_grant_id uuid references private.worker_capability_grants(id) on delete restrict,
  quarantine_asset_version_id uuid references private.quarantine_assets(id) on delete restrict,
  provider_response_hash text check (
    provider_response_hash is null or provider_response_hash ~ '^[a-f0-9]{64}$'
  ),
  source_audio_sha256 text check (
    source_audio_sha256 is null or source_audio_sha256 ~ '^[a-f0-9]{64}$'
  ),
  alignment jsonb check (
    alignment is null or (jsonb_typeof(alignment) = 'object' and pg_column_size(alignment) <= 2097152)
  ),
  alignment_hash text check (
    alignment_hash is null or alignment_hash ~ '^[a-f0-9]{64}$'
  ),
  promoted_asset_version_id uuid,
  master_clock_version_id uuid,
  state private.narration_job_state not null default 'reserved',
  ingest_lease_token uuid,
  ingest_lease_expires_at timestamptz,
  safe_failure_class text check (
    safe_failure_class is null or safe_failure_class ~ '^[a-z][a-z0-9_.-]{2,100}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (preflight_run_id),
  unique (provider_request_id),
  unique (micro_quote_line_id),
  unique (workspace_id,id),
  foreign key (workspace_id,preflight_run_id,stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id,preflight_run_id,id) on delete restrict,
  foreign key (workspace_id,audio_identity_selection_id)
    references public.preflight_audio_identity_selections(workspace_id,id) on delete restrict,
  foreign key (workspace_id,input_manifest_id)
    references private.provider_input_manifests(workspace_id,id) on delete restrict,
  foreign key (workspace_id,promoted_asset_version_id)
    references public.asset_versions(workspace_id,id) on delete restrict,
  foreign key (workspace_id,master_clock_version_id)
    references public.narration_master_clock_versions(workspace_id,id) on delete restrict,
  check ((provider_request_id is null) = (capability_grant_id is null)),
  check ((state = 'reserved') = (provider_request_id is null)),
  check ((state in ('quarantined','scanning','promoted','failed')) = (quarantine_asset_version_id is not null)),
  check ((alignment is null) = (alignment_hash is null)),
  check ((alignment is null) = (provider_response_hash is null)),
  check ((alignment is null) = (source_audio_sha256 is null)),
  check ((ingest_lease_token is null) = (ingest_lease_expires_at is null)),
  check ((state = 'promoted') = (num_nonnulls(promoted_asset_version_id,master_clock_version_id,completed_at) = 3))
);

create index narration_jobs_ingest_idx
  on private.narration_generation_jobs(state,ingest_lease_expires_at,created_at);

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
  if p_hard_ceiling_minor<>500 or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  then raise exception 'pre-lock build intent envelope is invalid' using errcode='22023'; end if;
  select * into intent from private.world_build_spend_intents
    where workspace_id=p_workspace_id and authorized_by=actor_id and idempotency_key=p_idempotency_key;
  if found then
    if intent.request_hash<>p_request_hash then
      raise exception 'pre-lock build intent idempotency conflict' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'intentId',intent.id,
      'hardCeilingMinor',intent.hard_ceiling_minor,'worldCeilingMinor',intent.world_ceiling_minor,
      'narrationCeilingMinor',intent.narration_ceiling_minor,'expiresAt',intent.expires_at);
  end if;
  select * into candidate from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id
      and episode_id=p_episode_id for update;
  if candidate.id is null or candidate.aggregate_version<>p_expected_configuration_version
    or candidate.state<>'world_design' or candidate.voice_confirmed_at is null
    or candidate.look_confirmed_at is null
  then raise exception 'pre-lock build configuration is stale' using errcode='40001'; end if;
  update private.world_build_spend_intents set state='expired'
    where configuration_candidate_id=candidate.id and state='active'
      and expires_at<=statement_timestamp();
  insert into private.world_build_spend_intents(
    workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    look_version_id,authorized_by,actor_authority_epoch,aal,hard_ceiling_minor,
    world_ceiling_minor,narration_ceiling_minor,command_id,idempotency_key,
    request_hash,expires_at
  ) values(
    p_workspace_id,p_episode_id,candidate.id,candidate.script_revision_id,
    candidate.look_version_id,actor_id,actor_epoch,'aal2',500,384,116,p_command_id,
    p_idempotency_key,p_request_hash,statement_timestamp()+interval '24 hours'
  ) returning * into intent;
  return jsonb_build_object('ok',true,'replayed',false,'intentId',intent.id,
    'hardCeilingMinor',intent.hard_ceiling_minor,'worldCeilingMinor',intent.world_ceiling_minor,
    'narrationCeilingMinor',intent.narration_ceiling_minor,'expiresAt',intent.expires_at);
end;
$$;

create or replace function public.command_ensure_elevenlabs_narration_capability(
  p_workspace_id uuid,p_environment text,p_voice_version_id uuid,
  p_schema_raw_sha256 text,p_schema_canonical_hash text,
  p_retrieved_at timestamptz,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare account private.provider_accounts%rowtype;
  schema_evidence private.provider_evidence_snapshots%rowtype;
  canary_evidence private.provider_evidence_snapshots%rowtype;
  capability private.provider_capabilities%rowtype;
  voice_config private.voice_provider_configurations%rowtype;
  canary private.voice_authenticated_canaries%rowtype;
  model_version text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_schema_raw_sha256 !~ '^[a-f0-9]{64}$'
    or p_schema_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at<=p_retrieved_at or p_expires_at>p_retrieved_at+interval '90 days'
  then raise exception 'ElevenLabs capability evidence is invalid' using errcode='22023'; end if;
  select * into voice_config from private.voice_provider_configurations
    where voice_version_id=p_voice_version_id;
  select * into canary from private.voice_authenticated_canaries
    where voice_version_id=p_voice_version_id and expires_at>statement_timestamp()
    order by checked_at desc limit 1;
  if voice_config.voice_version_id is null or voice_config.provider<>'elevenlabs'
    or canary.id is null or canary.external_voice_id<>voice_config.external_voice_id
    or canary.model_id<>'eleven_multilingual_v2' or canary.output_format<>'mp3_44100_128'
  then raise exception 'authenticated voice evidence is stale' using errcode='40001'; end if;
  insert into private.provider_accounts(
    workspace_id,environment,provider,account_key,credential_secret_ref,region,state
  ) values(p_workspace_id,p_environment,'elevenlabs','elevenlabs-narration',
    'ELEVENLABS_API_KEY','global','active')
  on conflict(workspace_id,environment,account_key) do update
    set state='active',aggregate_version=private.provider_accounts.aggregate_version+1
  returning * into account;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(account.id,'official_schema',
    encode(extensions.digest(convert_to('https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps','UTF8'),'sha256'),'hex'),
    p_schema_raw_sha256,p_schema_canonical_hash,
    'provider-evidence/elevenlabs/with-timestamps/schema-'||p_schema_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at)
  on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into schema_evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='official_schema'
      and canonical_hash=p_schema_canonical_hash;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(account.id,'canary',
    encode(extensions.digest(convert_to('elevenlabs-voice-canary:'||p_voice_version_id::text,'UTF8'),'sha256'),'hex'),
    canary.audio_sha256,canary.audio_sha256,
    'provider-evidence/elevenlabs/voices/'||p_voice_version_id::text||'/canary-'||canary.audio_sha256||'.json',
    'verified',canary.checked_at,canary.expires_at)
  on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into canary_evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='canary'
      and canonical_hash=canary.audio_sha256;
  model_version:='2026-07-19:'||voice_config.external_voice_id;
  select * into capability from private.provider_capabilities
    where provider_account_id=account.id and capability='gen_speech'
      and model_key='eleven_multilingual_v2' and private.provider_capabilities.model_version=model_version
      and endpoint_key='tts-with-timestamps' and schema_version='genie.elevenlabs-tts-timestamps.v1';
  if capability.id is null then
    insert into private.provider_capabilities(
      provider_account_id,capability,model_key,model_version,endpoint_key,
      schema_version,evidence_snapshot_id,canary_evidence_snapshot_id,currency,
      unit_name,unit_price_minor,maximum_request_minor,retention_class,
      verified_at,expires_at,status
    ) values(account.id,'gen_speech','eleven_multilingual_v2',model_version,
      'tts-with-timestamps','genie.elevenlabs-tts-timestamps.v1',schema_evidence.id,
      canary_evidence.id,'USD','request',116,116,'account_opt_out',
      greatest(p_retrieved_at,canary.checked_at),
      least(p_expires_at,schema_evidence.expires_at,canary.expires_at),'verified')
    returning * into capability;
  end if;
  if capability.status<>'verified' or capability.expires_at<=statement_timestamp()
    or capability.unit_price_minor<>116 or capability.maximum_request_minor<>116
    or capability.canary_evidence_snapshot_id<>canary_evidence.id
  then raise exception 'ElevenLabs narration capability is not current' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'providerAccountId',account.id,
    'capabilityId',capability.id,'voiceVersionId',p_voice_version_id,
    'externalVoiceId',voice_config.external_voice_id,'modelId','eleven_multilingual_v2',
    'outputFormat','mp3_44100_128','unitPriceMinor',capability.unit_price_minor,
    'expiresAt',capability.expires_at);
end;
$$;

create or replace function public.command_prepare_narration_job(
  p_preflight_run_id uuid,p_stage_attempt_id uuid,p_audio_identity_selection_id uuid,
  p_provider_capability_id uuid,p_job_id uuid,p_target_asset_id uuid,
  p_capability_jti uuid,p_provider_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  selection public.preflight_audio_identity_selections%rowtype;
  script public.script_revisions%rowtype;
  intent private.world_build_spend_intents%rowtype;
  capability private.provider_capabilities%rowtype;
  voice_config private.voice_provider_configurations%rowtype;
  existing private.narration_generation_jobs%rowtype;
  quote_id uuid:=gen_random_uuid(); authorization_id uuid:=gen_random_uuid();
  reservation_id uuid:=gen_random_uuid(); line_id uuid:=gen_random_uuid();
  manifest_id uuid:=gen_random_uuid(); quote_hash text; rate_hash text;
  manifest_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into existing from private.narration_generation_jobs
    where preflight_run_id=p_preflight_run_id;
  if found then
    if existing.stage_attempt_id<>p_stage_attempt_id
      or existing.audio_identity_selection_id<>p_audio_identity_selection_id
      or existing.provider_capability_id<>p_provider_capability_id
    then raise exception 'narration preparation replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',existing.id,
      'providerRequestId',existing.provider_request_id,'capabilityGrantId',existing.capability_grant_id,
      'capabilityJti',existing.capability_jti,'inputManifestId',existing.input_manifest_id,
      'inputManifestHash',existing.input_manifest_hash,'quoteLineId',existing.micro_quote_line_id,
      'targetAssetId',existing.target_asset_id,'totalMinor',116);
  end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and preflight_run_id=run.id for update;
  select * into selection from public.preflight_audio_identity_selections
    where id=p_audio_identity_selection_id and workspace_id=run.workspace_id;
  select * into script from public.script_revisions where id=run.script_revision_id;
  select * into intent from private.world_build_spend_intents
    where configuration_candidate_id=run.configuration_candidate_id
      and state='consumed' and expires_at>statement_timestamp() for update;
  select * into capability from private.provider_capabilities
    where id=p_provider_capability_id and capability='gen_speech'
      and model_key='eleven_multilingual_v2'
      and schema_version='genie.elevenlabs-tts-timestamps.v1'
      and status='verified' and expires_at>statement_timestamp();
  select * into voice_config from private.voice_provider_configurations
    where voice_version_id=selection.voice_version_id;
  if run.id is null or run.kind<>'narration_clock' or run.state<>'running'
    or attempt.id is null or attempt.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch
    or selection.id is null or selection.configuration_candidate_id<>run.configuration_candidate_id
    or selection.state<>'verified' or script.id is null
    or intent.id is null or intent.workspace_id<>run.workspace_id
    or intent.episode_id<>run.episode_id or intent.script_revision_id<>run.script_revision_id
    or intent.hard_ceiling_minor<>500 or intent.narration_ceiling_minor<>116
    or capability.id is null or capability.unit_price_minor<>116
    or voice_config.voice_version_id is null
    or p_provider_payload is null or jsonb_typeof(p_provider_payload)<>'object'
    or (p_provider_payload-array['modelId','outputFormat','targetAssetId','text','voiceId','voiceSettings']::text[])<>'{}'::jsonb
    or not(p_provider_payload?&array['modelId','outputFormat','targetAssetId','text','voiceId','voiceSettings'])
    or p_provider_payload->>'modelId'<>'eleven_multilingual_v2'
    or p_provider_payload->>'outputFormat'<>'mp3_44100_128'
    or p_provider_payload->>'targetAssetId'<>p_target_asset_id::text
    or p_provider_payload->>'text'<>script.processing_text
    or p_provider_payload->>'voiceId'<>voice_config.external_voice_id
  then raise exception 'narration preparation authority is stale' using errcode='40001'; end if;
  quote_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'configurationCandidateId',run.configuration_candidate_id,
    'audioIdentitySelectionId',selection.id,'capabilityId',capability.id,
    'providerPayload',p_provider_payload,'totalMinor',116)::text,'UTF8'),'sha256'),'hex');
  rate_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'capabilityId',capability.id,'unitPriceMinor',116,'schemaVersion',capability.schema_version,
    'expiresAt',capability.expires_at)::text,'UTF8'),'sha256'),'hex');
  manifest_hash:=encode(extensions.digest(convert_to(p_provider_payload::text,'UTF8'),'sha256'),'hex');
  insert into private.micro_quotes(id,workspace_id,episode_id,configuration_candidate_id,
    script_revision_id,preflight_kind,quote_number,quote_hash,rate_snapshot_hash,
    currency,total_minor,state,expires_at,confirmed_at)
  values(quote_id,run.workspace_id,run.episode_id,run.configuration_candidate_id,
    run.script_revision_id,'narration_clock',coalesce((select max(q.quote_number)+1
      from private.micro_quotes q where q.configuration_candidate_id=run.configuration_candidate_id
      and q.preflight_kind='narration_clock'),1),quote_hash,rate_hash,'USD',116,'confirmed',
    least(intent.expires_at,capability.expires_at),statement_timestamp());
  insert into private.micro_authorizations(id,workspace_id,micro_quote_id,configuration_candidate_id,
    script_revision_id,authorized_by,actor_authority_epoch,aal,quote_hash,
    hard_ceiling_minor,state,expires_at)
  values(authorization_id,run.workspace_id,quote_id,run.configuration_candidate_id,
    run.script_revision_id,intent.authorized_by,intent.actor_authority_epoch,'aal2',quote_hash,
    116,'active',least(intent.expires_at,capability.expires_at));
  insert into private.micro_reservations(id,workspace_id,micro_quote_id,micro_authorization_id,
    amount_minor,state,expires_at)
  values(reservation_id,run.workspace_id,quote_id,authorization_id,116,'held',
    least(intent.expires_at,capability.expires_at));
  insert into private.micro_quote_lines(id,micro_quote_id,line_number,slot_key,capability_id,
    operation,quantity,unit_price_minor,amount_minor,request_schema_hash)
  values(line_id,quote_id,1,'narration.primary',capability.id,'gen_speech',1,116,116,
    encode(extensions.digest(convert_to(capability.schema_version,'UTF8'),'sha256'),'hex'));
  insert into private.provider_input_manifests(id,workspace_id,operation,payload_schema_version,
    payload_json,content_hash)
  values(manifest_id,run.workspace_id,'gen_speech',capability.schema_version,
    p_provider_payload,manifest_hash);
  update public.preflight_runs set requires_micro_authority=true,micro_quote_id=quote_id,
    micro_authorization_id=authorization_id,micro_reservation_id=reservation_id,
    aggregate_version=aggregate_version+1 where id=run.id;
  insert into private.narration_generation_jobs(
    id,workspace_id,preflight_run_id,stage_attempt_id,spend_intent_id,
    audio_identity_selection_id,provider_capability_id,target_asset_id,
    micro_quote_line_id,input_manifest_id,input_manifest_hash,capability_jti
  ) values(p_job_id,run.workspace_id,run.id,attempt.id,intent.id,selection.id,
    capability.id,p_target_asset_id,line_id,manifest_id,manifest_hash,p_capability_jti)
  returning * into existing;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',existing.id,
    'providerRequestId',null,'capabilityGrantId',null,'capabilityJti',existing.capability_jti,
    'inputManifestId',manifest_id,'inputManifestHash',manifest_hash,
    'quoteLineId',line_id,'targetAssetId',p_target_asset_id,'totalMinor',116);
end;
$$;

create or replace function public.command_bind_narration_provider_request(
  p_job_id uuid,p_provider_request_id uuid,p_capability_grant_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.id is null then raise exception 'narration job not found' using errcode='P0002'; end if;
  if job.provider_request_id is not null then
    if job.provider_request_id<>p_provider_request_id or job.capability_grant_id<>p_capability_grant_id
    then raise exception 'narration request replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'state',job.state);
  end if;
  if job.state<>'reserved'
    or not exists(select 1 from private.provider_requests request
      join private.provider_request_quote_claims claim on claim.provider_request_id=request.id
      where request.id=p_provider_request_id and request.preflight_run_id=job.preflight_run_id
        and request.stage_attempt_id=job.stage_attempt_id and request.input_manifest_id=job.input_manifest_id
        and request.input_manifest_hash=job.input_manifest_hash and request.operation='gen_speech'
        and request.state='reserved' and claim.micro_quote_line_id=job.micro_quote_line_id)
    or not exists(select 1 from private.worker_capability_grants grant_row
      where grant_row.id=p_capability_grant_id and grant_row.provider_request_id=p_provider_request_id
        and grant_row.token_jti_hash=encode(extensions.digest(convert_to(job.capability_jti::text,'UTF8'),'sha256'),'hex')
        and grant_row.state='active')
  then raise exception 'narration request binding is invalid' using errcode='40001'; end if;
  update private.narration_generation_jobs set provider_request_id=p_provider_request_id,
    capability_grant_id=p_capability_grant_id,state='dispatching' where id=job.id;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,'state','dispatching');
end;
$$;

create or replace function public.command_record_narration_provider_output(
  p_provider_request_id uuid,p_quarantine_asset_version_id uuid,
  p_provider_response_hash text,p_source_audio_sha256 text,p_alignment jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype; alignment_hash text;
  character_count integer; start_count integer; end_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs
    where provider_request_id=p_provider_request_id for update;
  if job.id is null or p_provider_response_hash !~ '^[a-f0-9]{64}$'
    or p_source_audio_sha256 !~ '^[a-f0-9]{64}$'
    or p_alignment is null or jsonb_typeof(p_alignment)<>'object'
    or (p_alignment-array['characters','characterStartTimesSeconds','characterEndTimesSeconds']::text[])<>'{}'::jsonb
    or not(p_alignment?&array['characters','characterStartTimesSeconds','characterEndTimesSeconds'])
    or jsonb_typeof(p_alignment->'characters')<>'array'
    or jsonb_typeof(p_alignment->'characterStartTimesSeconds')<>'array'
    or jsonb_typeof(p_alignment->'characterEndTimesSeconds')<>'array'
  then raise exception 'narration provider output envelope is invalid' using errcode='22023'; end if;
  character_count:=jsonb_array_length(p_alignment->'characters');
  start_count:=jsonb_array_length(p_alignment->'characterStartTimesSeconds');
  end_count:=jsonb_array_length(p_alignment->'characterEndTimesSeconds');
  if character_count not between 1 and 20000 or start_count<>character_count or end_count<>character_count
    or not exists(select 1 from private.quarantine_assets quarantine
      where quarantine.id=p_quarantine_asset_version_id and quarantine.workspace_id=job.workspace_id
        and quarantine.provider_request_id=p_provider_request_id
        and quarantine.source_sha256=p_source_audio_sha256
        and quarantine.declared_mime='audio/mpeg' and quarantine.state='quarantined')
  then raise exception 'narration provider output is stale' using errcode='40001'; end if;
  alignment_hash:=encode(extensions.digest(convert_to(p_alignment::text,'UTF8'),'sha256'),'hex');
  if job.state='quarantined' then
    if job.quarantine_asset_version_id<>p_quarantine_asset_version_id
      or job.provider_response_hash<>p_provider_response_hash or job.alignment_hash<>alignment_hash
    then raise exception 'narration output replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'state',job.state);
  end if;
  if job.state<>'dispatching' then
    raise exception 'narration output arrived outside active authority' using errcode='40001'; end if;
  update private.narration_generation_jobs set
    quarantine_asset_version_id=p_quarantine_asset_version_id,
    provider_response_hash=p_provider_response_hash,source_audio_sha256=p_source_audio_sha256,
    alignment=p_alignment,alignment_hash=alignment_hash,state='quarantined'
  where id=job.id;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,'state','quarantined');
end;
$$;

create or replace function public.command_claim_narration_ingest(p_job_id uuid default null)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  quarantine private.quarantine_assets%rowtype; lease_token uuid:=gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs
    where (p_job_id is null or id=p_job_id)
      and (state='quarantined' or (state='scanning' and ingest_lease_expires_at<=statement_timestamp()))
    order by created_at for update skip locked limit 1;
  if job.id is null then return null; end if;
  select * into quarantine from private.quarantine_assets
    where id=job.quarantine_asset_version_id;
  if quarantine.id is null or quarantine.state not in ('quarantined','scanning')
  then raise exception 'narration quarantine is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs set state='scanning',ingest_lease_token=lease_token,
    ingest_lease_expires_at=statement_timestamp()+interval '10 minutes' where id=job.id;
  return jsonb_build_object('jobId',job.id,'workspaceId',job.workspace_id,
    'preflightRunId',job.preflight_run_id,'stageAttemptId',job.stage_attempt_id,
    'audioIdentitySelectionId',job.audio_identity_selection_id,
    'targetAssetId',job.target_asset_id,'providerRequestId',job.provider_request_id,
    'quarantineAssetVersionId',job.quarantine_asset_version_id,
    'objectName',quarantine.object_name,'sourceAudioSha256',job.source_audio_sha256,
    'alignment',job.alignment,'alignmentHash',job.alignment_hash,
    'leaseToken',lease_token,'leaseExpiresAt',statement_timestamp()+interval '10 minutes');
end;
$$;

create or replace function public.command_complete_narration_ingest(
  p_job_id uuid,p_lease_token uuid,p_promoted_asset_version_id uuid,
  p_master_clock_version_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp()
    or not exists(select 1 from public.narration_master_clock_versions clock
      where clock.id=p_master_clock_version_id and clock.workspace_id=job.workspace_id
        and clock.preflight_run_id=job.preflight_run_id
        and clock.audio_identity_selection_id=job.audio_identity_selection_id
        and clock.narration_asset_version_id=p_promoted_asset_version_id
        and clock.state='verified')
  then raise exception 'narration completion evidence is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs set state='promoted',
    promoted_asset_version_id=p_promoted_asset_version_id,
    master_clock_version_id=p_master_clock_version_id,completed_at=statement_timestamp(),
    ingest_lease_token=null,ingest_lease_expires_at=null where id=job.id;
  return jsonb_build_object('ok',true,'jobId',job.id,'state','promoted',
    'assetVersionId',p_promoted_asset_version_id,'masterClockVersionId',p_master_clock_version_id);
end;
$$;

create or replace function public.command_fail_narration_ingest(
  p_job_id uuid,p_lease_token uuid,p_safe_failure_class text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or p_safe_failure_class !~ '^[a-z][a-z0-9_.-]{2,100}$'
  then raise exception 'narration failure authority is stale' using errcode='40001'; end if;
  update private.narration_generation_jobs set state='failed',
    safe_failure_class=p_safe_failure_class,completed_at=statement_timestamp(),
    ingest_lease_token=null,ingest_lease_expires_at=null where id=job.id;
  return jsonb_build_object('ok',true,'jobId',job.id,'state','failed');
end;
$$;

revoke all on table private.narration_generation_jobs from public,anon,authenticated;
revoke all on function
  public.command_ensure_elevenlabs_narration_capability(uuid,text,uuid,text,text,timestamptz,timestamptz),
  public.command_prepare_narration_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),
  public.command_bind_narration_provider_request(uuid,uuid,uuid),
  public.command_record_narration_provider_output(uuid,uuid,text,text,jsonb),
  public.command_claim_narration_ingest(uuid),
  public.command_complete_narration_ingest(uuid,uuid,uuid,uuid),
  public.command_fail_narration_ingest(uuid,uuid,text)
from public,anon,authenticated;
grant execute on function
  public.command_ensure_elevenlabs_narration_capability(uuid,text,uuid,text,text,timestamptz,timestamptz),
  public.command_prepare_narration_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),
  public.command_bind_narration_provider_request(uuid,uuid,uuid),
  public.command_record_narration_provider_output(uuid,uuid,text,text,jsonb),
  public.command_claim_narration_ingest(uuid),
  public.command_complete_narration_ingest(uuid,uuid,uuid,uuid),
  public.command_fail_narration_ingest(uuid,uuid,text)
to service_role;

revoke all on function public.command_authorize_world_build_intent(
  uuid,uuid,uuid,bigint,bigint,uuid,text,text
) from public,anon;
grant execute on function public.command_authorize_world_build_intent(
  uuid,uuid,uuid,bigint,bigint,uuid,text,text
) to authenticated,service_role;

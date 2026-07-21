-- Narration quality is independently heard, not inferred from provider pins.
-- The existing $1.16 narration ceiling is partitioned into one ElevenLabs
-- synthesis request plus OpenAI ASR and audio-judge requests. Every provider
-- call owns one immutable quote line, input manifest, and terminal request.

alter table private.provider_accounts
  drop constraint provider_accounts_provider_check,
  add constraint provider_accounts_provider_check check (
    provider in ('fal','elevenlabs','google','seedance','openai')
  );

alter table private.provider_capabilities
  drop constraint provider_capabilities_capability_check,
  add constraint provider_capabilities_capability_check check (
    capability in (
      'gen_image','edit_image','gen_speech','align_speech','asr','audio_judge',
      'gen_music_preview','gen_sfx_preview','zero_cost'
    )
  );

alter table private.micro_quote_lines
  drop constraint micro_quote_lines_operation_check,
  add constraint micro_quote_lines_operation_check check (
    operation in (
      'gen_image','edit_image','gen_speech','align_speech','asr','audio_judge',
      'gen_music_preview','gen_sfx_preview','zero_cost'
    )
  );

alter table private.provider_requests
  drop constraint provider_requests_operation_check,
  add constraint provider_requests_operation_check check (
    operation in (
      'gen_image','edit_image','gen_speech','align_speech','asr','audio_judge',
      'gen_music_preview','gen_sfx_preview','zero_cost'
    )
  );

alter table private.provider_input_manifests
  drop constraint provider_input_manifests_operation_check,
  add constraint provider_input_manifests_operation_check check (
    operation in (
      'gen_image','edit_image','gen_speech','align_speech','asr','audio_judge',
      'gen_music_preview','gen_sfx_preview','zero_cost'
    )
  );

alter table private.worker_capability_grants
  drop constraint worker_capability_grants_capability_check,
  add constraint worker_capability_grants_capability_check check (
    capability in (
      'gen_image','edit_image','gen_speech','align_speech','asr','audio_judge',
      'gen_music_preview','gen_sfx_preview','zero_cost'
    )
  );

alter table private.narration_generation_jobs
  add column asr_provider_capability_id uuid not null
    references private.provider_capabilities(id) on delete restrict,
  add column audio_judge_provider_capability_id uuid not null
    references private.provider_capabilities(id) on delete restrict,
  add column asr_micro_quote_line_id uuid not null
    references private.micro_quote_lines(id) on delete restrict,
  add column audio_judge_micro_quote_line_id uuid not null
    references private.micro_quote_lines(id) on delete restrict,
  add constraint narration_job_distinct_qc_lines_check check (
    micro_quote_line_id<>asr_micro_quote_line_id
    and micro_quote_line_id<>audio_judge_micro_quote_line_id
    and asr_micro_quote_line_id<>audio_judge_micro_quote_line_id
  ),
  add unique(asr_micro_quote_line_id),
  add unique(audio_judge_micro_quote_line_id);

create table private.narration_qc_runs (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  narration_job_id uuid not null unique
    references private.narration_generation_jobs(id) on delete restrict,
  asr_provider_request_id uuid unique
    references private.provider_requests(id) on delete restrict,
  audio_judge_provider_request_id uuid unique
    references private.provider_requests(id) on delete restrict,
  narration_asset_version_id uuid not null,
  audio_sha256 text not null check(audio_sha256~'^[a-f0-9]{64}$'),
  processing_text_sha256 text not null check(processing_text_sha256~'^[a-f0-9]{64}$'),
  narrator_gender public.narrator_gender not null,
  pronunciation_manifest_hash text not null
    check(pronunciation_manifest_hash~'^[a-f0-9]{64}$'),
  state text not null check(state in (
    'asr_reserved','asr_submitted','asr_verified','judge_reserved',
    'judge_submitted','verified','failed'
  )),
  asr_transcript text check(
    asr_transcript is null or char_length(asr_transcript) between 1 and 20000
  ),
  asr_transcript_sha256 text check(
    asr_transcript_sha256 is null or asr_transcript_sha256~'^[a-f0-9]{64}$'
  ),
  normalized_expected_sha256 text check(
    normalized_expected_sha256 is null or normalized_expected_sha256~'^[a-f0-9]{64}$'
  ),
  normalized_transcript_sha256 text check(
    normalized_transcript_sha256 is null or normalized_transcript_sha256~'^[a-f0-9]{64}$'
  ),
  asr_similarity numeric(7,6) check(asr_similarity is null or asr_similarity between 0 and 1),
  asr_edit_distance integer check(asr_edit_distance is null or asr_edit_distance between 0 and 20000),
  asr_length_ratio numeric(9,6) check(asr_length_ratio is null or asr_length_ratio between 0 and 10),
  asr_response_id_hash text check(
    asr_response_id_hash is null or asr_response_id_hash~'^[a-f0-9]{64}$'
  ),
  judge_evidence jsonb check(
    judge_evidence is null or (
      jsonb_typeof(judge_evidence)='object' and pg_column_size(judge_evidence)<=32768
    )
  ),
  judge_evidence_hash text check(
    judge_evidence_hash is null or judge_evidence_hash~'^[a-f0-9]{64}$'
  ),
  judge_response_id_hash text check(
    judge_response_id_hash is null or judge_response_id_hash~'^[a-f0-9]{64}$'
  ),
  final_audio_evidence jsonb check(
    final_audio_evidence is null or (
      jsonb_typeof(final_audio_evidence)='object'
      and pg_column_size(final_audio_evidence)<=32768
    )
  ),
  final_audio_evidence_hash text check(
    final_audio_evidence_hash is null or final_audio_evidence_hash~'^[a-f0-9]{64}$'
  ),
  safe_failure_class text check(
    safe_failure_class is null or safe_failure_class~'^[a-z][a-z0-9_.-]{2,100}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique(workspace_id,id),
  foreign key(workspace_id,narration_asset_version_id)
    references public.asset_versions(workspace_id,id) on delete restrict,
  check((asr_transcript is null)=(asr_transcript_sha256 is null)),
  check((judge_evidence is null)=(judge_evidence_hash is null)),
  check((final_audio_evidence is null)=(final_audio_evidence_hash is null)),
  check((state in ('verified','failed'))=(completed_at is not null)),
  check((state='verified')=(final_audio_evidence is not null))
);

create index narration_qc_runs_state_idx
  on private.narration_qc_runs(state,created_at);

create or replace function private.guard_verified_narration_qc()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.state in ('verified','failed') then
    raise exception 'terminal narration QC is immutable' using errcode='55000';
  end if;
  return new;
end;
$$;

create trigger narration_qc_terminal_immutable
before update or delete on private.narration_qc_runs
for each row execute function private.guard_verified_narration_qc();

create or replace function private.require_verified_narration_qc_for_clock()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if not exists(
    select 1 from private.narration_qc_runs qc
    where qc.workspace_id=new.workspace_id
      and qc.narration_asset_version_id=new.narration_asset_version_id
      and qc.state='verified'
      and qc.final_audio_evidence_hash=new.audio_evidence_hash
  ) then
    raise exception 'verified independent narration QC is required' using errcode='40001';
  end if;
  return new;
end;
$$;

create trigger narration_clock_requires_independent_qc
before insert on public.narration_master_clock_versions
for each row execute function private.require_verified_narration_qc_for_clock();

create or replace function public.command_ensure_elevenlabs_narration_bundle_capability(
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
  then raise exception 'ElevenLabs bundle evidence is invalid' using errcode='22023'; end if;
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
  model_version:='2026-07-19-qc-bundle:'||voice_config.external_voice_id;
  select * into capability from private.provider_capabilities
    where provider_account_id=account.id and capability='gen_speech'
      and model_key='eleven_multilingual_v2'
      and private.provider_capabilities.model_version=model_version
      and endpoint_key='tts-with-timestamps'
      and schema_version='genie.elevenlabs-tts-timestamps.v1';
  if capability.id is null then
    insert into private.provider_capabilities(
      provider_account_id,capability,model_key,model_version,endpoint_key,
      schema_version,evidence_snapshot_id,canary_evidence_snapshot_id,currency,
      unit_name,unit_price_minor,maximum_request_minor,retention_class,
      verified_at,expires_at,status
    ) values(account.id,'gen_speech','eleven_multilingual_v2',model_version,
      'tts-with-timestamps','genie.elevenlabs-tts-timestamps.v1',schema_evidence.id,
      canary_evidence.id,'USD','request',88,88,'account_opt_out',
      greatest(p_retrieved_at,canary.checked_at),
      least(p_expires_at,schema_evidence.expires_at,canary.expires_at),'verified')
    returning * into capability;
  end if;
  if capability.status<>'verified' or capability.expires_at<=statement_timestamp()
    or capability.unit_price_minor<>88 or capability.maximum_request_minor<>88
    or capability.canary_evidence_snapshot_id<>canary_evidence.id
  then raise exception 'ElevenLabs narration bundle capability is stale' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'providerAccountId',account.id,
    'capabilityId',capability.id,'voiceVersionId',p_voice_version_id,
    'externalVoiceId',voice_config.external_voice_id,'modelId','eleven_multilingual_v2',
    'outputFormat','mp3_44100_128','unitPriceMinor',capability.unit_price_minor,
    'expiresAt',capability.expires_at);
end;
$$;

create or replace function public.command_ensure_openai_narration_qc_capabilities(
  p_workspace_id uuid,p_environment text,p_evidence_raw_sha256 text,
  p_evidence_canonical_hash text,p_retrieved_at timestamptz,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare account private.provider_accounts%rowtype;
  evidence private.provider_evidence_snapshots%rowtype;
  asr_capability private.provider_capabilities%rowtype;
  judge_capability private.provider_capabilities%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_evidence_raw_sha256!~'^[a-f0-9]{64}$'
    or p_evidence_canonical_hash!~'^[a-f0-9]{64}$'
    or p_expires_at<=p_retrieved_at or p_expires_at>p_retrieved_at+interval '90 days'
  then raise exception 'OpenAI narration QC evidence is invalid' using errcode='22023'; end if;
  insert into private.provider_accounts(
    workspace_id,environment,provider,account_key,credential_secret_ref,region,state
  ) values(p_workspace_id,p_environment,'openai','openai-narration-qc',
    'OPENAI_API_KEY','global','active')
  on conflict(workspace_id,environment,account_key) do update
    set state='active',aggregate_version=private.provider_accounts.aggregate_version+1
  returning * into account;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(account.id,'canary',
    encode(extensions.digest(convert_to('https://api.openai.com/v1/models|audio/transcriptions|chat/completions','UTF8'),'sha256'),'hex'),
    p_evidence_raw_sha256,p_evidence_canonical_hash,
    'provider-evidence/openai/narration-qc/canary-'||p_evidence_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at)
  on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into evidence from private.provider_evidence_snapshots
    where provider_account_id=account.id and evidence_kind='canary'
      and canonical_hash=p_evidence_canonical_hash;
  insert into private.provider_capabilities(
    provider_account_id,capability,model_key,model_version,endpoint_key,
    schema_version,evidence_snapshot_id,canary_evidence_snapshot_id,currency,
    unit_name,unit_price_minor,maximum_request_minor,retention_class,
    verified_at,expires_at,status
  ) values(account.id,'asr','gpt-4o-transcribe','2026-07-19-live-canary',
    'audio-transcriptions','genie.openai-hindi-asr.v1',evidence.id,evidence.id,
    'USD','request',3,3,'no_training',p_retrieved_at,p_expires_at,'verified')
  on conflict(provider_account_id,capability,model_key,model_version,endpoint_key,schema_version)
  do nothing;
  select * into asr_capability from private.provider_capabilities
    where provider_account_id=account.id and capability='asr'
      and model_key='gpt-4o-transcribe' and model_version='2026-07-19-live-canary'
      and endpoint_key='audio-transcriptions' and schema_version='genie.openai-hindi-asr.v1';
  insert into private.provider_capabilities(
    provider_account_id,capability,model_key,model_version,endpoint_key,
    schema_version,evidence_snapshot_id,canary_evidence_snapshot_id,currency,
    unit_name,unit_price_minor,maximum_request_minor,retention_class,
    verified_at,expires_at,status
  ) values(account.id,'audio_judge','gpt-audio-mini','2026-07-19-live-canary',
    'audio-chat-judge','genie.openai-audio-judge.v1',evidence.id,evidence.id,
    'USD','request',25,25,'no_training',p_retrieved_at,p_expires_at,'verified')
  on conflict(provider_account_id,capability,model_key,model_version,endpoint_key,schema_version)
  do nothing;
  select * into judge_capability from private.provider_capabilities
    where provider_account_id=account.id and capability='audio_judge'
      and model_key='gpt-audio-mini' and model_version='2026-07-19-live-canary'
      and endpoint_key='audio-chat-judge' and schema_version='genie.openai-audio-judge.v1';
  if asr_capability.id is null or judge_capability.id is null
    or asr_capability.status<>'verified' or judge_capability.status<>'verified'
    or asr_capability.expires_at<=statement_timestamp()
    or judge_capability.expires_at<=statement_timestamp()
    or asr_capability.unit_price_minor<>3 or judge_capability.unit_price_minor<>25
  then raise exception 'OpenAI narration QC capabilities are stale' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'providerAccountId',account.id,
    'asrCapabilityId',asr_capability.id,'asrModel','gpt-4o-transcribe',
    'audioJudgeCapabilityId',judge_capability.id,'audioJudgeModel','gpt-audio-mini',
    'totalMinor',28,'expiresAt',least(asr_capability.expires_at,judge_capability.expires_at));
end;
$$;

drop function public.command_prepare_narration_job(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb
);

create or replace function public.command_prepare_narration_job(
  p_preflight_run_id uuid,p_stage_attempt_id uuid,p_audio_identity_selection_id uuid,
  p_provider_capability_id uuid,p_asr_provider_capability_id uuid,
  p_audio_judge_provider_capability_id uuid,p_job_id uuid,p_target_asset_id uuid,
  p_capability_jti uuid,p_provider_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  selection public.preflight_audio_identity_selections%rowtype;
  script public.script_revisions%rowtype;
  intent private.world_build_spend_intents%rowtype;
  speech private.provider_capabilities%rowtype;
  asr_cap private.provider_capabilities%rowtype;
  judge_cap private.provider_capabilities%rowtype;
  voice_config private.voice_provider_configurations%rowtype;
  existing private.narration_generation_jobs%rowtype;
  quote_id uuid:=gen_random_uuid(); authorization_id uuid:=gen_random_uuid();
  reservation_id uuid:=gen_random_uuid(); speech_line_id uuid:=gen_random_uuid();
  asr_line_id uuid:=gen_random_uuid(); judge_line_id uuid:=gen_random_uuid();
  manifest_id uuid:=gen_random_uuid(); quote_hash text; rate_hash text;
  manifest_hash text; authority_expires_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into existing from private.narration_generation_jobs
    where preflight_run_id=p_preflight_run_id;
  if found then
    if existing.stage_attempt_id<>p_stage_attempt_id
      or existing.audio_identity_selection_id<>p_audio_identity_selection_id
      or existing.provider_capability_id<>p_provider_capability_id
      or existing.asr_provider_capability_id<>p_asr_provider_capability_id
      or existing.audio_judge_provider_capability_id<>p_audio_judge_provider_capability_id
    then raise exception 'narration preparation replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',existing.id,
      'providerRequestId',existing.provider_request_id,
      'capabilityGrantId',existing.capability_grant_id,
      'capabilityJti',existing.capability_jti,'inputManifestId',existing.input_manifest_id,
      'inputManifestHash',existing.input_manifest_hash,
      'quoteLineId',existing.micro_quote_line_id,
      'asrQuoteLineId',existing.asr_micro_quote_line_id,
      'audioJudgeQuoteLineId',existing.audio_judge_micro_quote_line_id,
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
  select * into speech from private.provider_capabilities
    where id=p_provider_capability_id and capability='gen_speech'
      and model_key='eleven_multilingual_v2'
      and schema_version='genie.elevenlabs-tts-timestamps.v1'
      and status='verified' and expires_at>statement_timestamp();
  select * into asr_cap from private.provider_capabilities
    where id=p_asr_provider_capability_id and capability='asr'
      and model_key='gpt-4o-transcribe' and schema_version='genie.openai-hindi-asr.v1'
      and status='verified' and expires_at>statement_timestamp();
  select * into judge_cap from private.provider_capabilities
    where id=p_audio_judge_provider_capability_id and capability='audio_judge'
      and model_key='gpt-audio-mini' and schema_version='genie.openai-audio-judge.v1'
      and status='verified' and expires_at>statement_timestamp();
  select * into voice_config from private.voice_provider_configurations
    where voice_version_id=selection.voice_version_id;
  authority_expires_at:=least(
    intent.expires_at,
    speech.expires_at,
    asr_cap.expires_at,
    judge_cap.expires_at
  );
  if run.id is null or run.kind<>'narration_clock' or run.state<>'running'
    or attempt.id is null or attempt.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch
    or selection.id is null or selection.configuration_candidate_id<>run.configuration_candidate_id
    or selection.state<>'verified' or script.id is null
    or intent.id is null or intent.workspace_id<>run.workspace_id
    or intent.episode_id<>run.episode_id or intent.script_revision_id<>run.script_revision_id
    or intent.hard_ceiling_minor<>500 or intent.narration_ceiling_minor<>116
    or speech.id is null or speech.unit_price_minor<>88 or speech.maximum_request_minor<>88
    or asr_cap.id is null or asr_cap.unit_price_minor<>3 or asr_cap.maximum_request_minor<>3
    or judge_cap.id is null or judge_cap.unit_price_minor<>25 or judge_cap.maximum_request_minor<>25
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
    'audioIdentitySelectionId',selection.id,'speechCapabilityId',speech.id,
    'asrCapabilityId',asr_cap.id,'audioJudgeCapabilityId',judge_cap.id,
    'providerPayload',p_provider_payload,'totalMinor',116)::text,'UTF8'),'sha256'),'hex');
  rate_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'speechCapabilityId',speech.id,'speechMinor',88,
    'asrCapabilityId',asr_cap.id,'asrMinor',3,
    'audioJudgeCapabilityId',judge_cap.id,'audioJudgeMinor',25,
    'expiresAt',authority_expires_at)::text,'UTF8'),'sha256'),'hex');
  manifest_hash:=encode(extensions.digest(convert_to(p_provider_payload::text,'UTF8'),'sha256'),'hex');
  insert into private.micro_quotes(id,workspace_id,episode_id,configuration_candidate_id,
    script_revision_id,preflight_kind,quote_number,quote_hash,rate_snapshot_hash,
    currency,total_minor,state,expires_at,confirmed_at)
  values(quote_id,run.workspace_id,run.episode_id,run.configuration_candidate_id,
    run.script_revision_id,'narration_clock',coalesce((select max(q.quote_number)+1
      from private.micro_quotes q where q.configuration_candidate_id=run.configuration_candidate_id
      and q.preflight_kind='narration_clock'),1),quote_hash,rate_hash,'USD',116,'confirmed',
    authority_expires_at,statement_timestamp());
  insert into private.micro_authorizations(id,workspace_id,micro_quote_id,configuration_candidate_id,
    script_revision_id,authorized_by,actor_authority_epoch,aal,quote_hash,
    hard_ceiling_minor,state,expires_at)
  values(authorization_id,run.workspace_id,quote_id,run.configuration_candidate_id,
    run.script_revision_id,intent.authorized_by,intent.actor_authority_epoch,'aal2',quote_hash,
    116,'active',authority_expires_at);
  insert into private.micro_reservations(id,workspace_id,micro_quote_id,micro_authorization_id,
    amount_minor,state,expires_at)
  values(
    reservation_id,
    run.workspace_id,
    quote_id,
    authorization_id,
    116,
    'held',
    authority_expires_at
  );
  insert into private.micro_quote_lines(id,micro_quote_id,line_number,slot_key,capability_id,
    operation,quantity,unit_price_minor,amount_minor,request_schema_hash)
  values
    (speech_line_id,quote_id,1,'narration.speech.primary',speech.id,'gen_speech',1,88,88,
      encode(extensions.digest(convert_to(speech.schema_version,'UTF8'),'sha256'),'hex')),
    (asr_line_id,quote_id,2,'narration.asr.primary',asr_cap.id,'asr',1,3,3,
      encode(extensions.digest(convert_to(asr_cap.schema_version,'UTF8'),'sha256'),'hex')),
    (judge_line_id,quote_id,3,'narration.audio-judge.primary',judge_cap.id,'audio_judge',1,25,25,
      encode(extensions.digest(convert_to(judge_cap.schema_version,'UTF8'),'sha256'),'hex'));
  insert into private.provider_input_manifests(id,workspace_id,operation,payload_schema_version,
    payload_json,content_hash)
  values(manifest_id,run.workspace_id,'gen_speech',speech.schema_version,
    p_provider_payload,manifest_hash);
  update public.preflight_runs set requires_micro_authority=true,micro_quote_id=quote_id,
    micro_authorization_id=authorization_id,micro_reservation_id=reservation_id,
    aggregate_version=aggregate_version+1 where id=run.id;
  insert into private.narration_generation_jobs(
    id,workspace_id,preflight_run_id,stage_attempt_id,spend_intent_id,
    audio_identity_selection_id,provider_capability_id,asr_provider_capability_id,
    audio_judge_provider_capability_id,target_asset_id,micro_quote_line_id,
    asr_micro_quote_line_id,audio_judge_micro_quote_line_id,input_manifest_id,
    input_manifest_hash,capability_jti
  ) values(p_job_id,run.workspace_id,run.id,attempt.id,intent.id,selection.id,
    speech.id,asr_cap.id,judge_cap.id,p_target_asset_id,speech_line_id,asr_line_id,
    judge_line_id,manifest_id,manifest_hash,p_capability_jti)
  returning * into existing;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',existing.id,
    'providerRequestId',null,'capabilityGrantId',null,'capabilityJti',existing.capability_jti,
    'inputManifestId',manifest_id,'inputManifestHash',manifest_hash,
    'quoteLineId',speech_line_id,'asrQuoteLineId',asr_line_id,
    'audioJudgeQuoteLineId',judge_line_id,'targetAssetId',p_target_asset_id,'totalMinor',116);
end;
$$;

create or replace function public.command_claim_narration_provider_job(
  p_job_id uuid,p_idempotency_key text,p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  capability private.provider_capabilities%rowtype;
  request private.provider_requests%rowtype; grant_id uuid; scope_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  if job.provider_request_id is not null then
    select * into request from private.provider_requests where id=job.provider_request_id;
  else
    select * into run from public.preflight_runs where id=job.preflight_run_id for update;
    select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id for update;
    select * into capability from private.provider_capabilities where id=job.provider_capability_id;
    if job.id is null or job.state<>'reserved' or run.state<>'running'
      or not run.requires_micro_authority or attempt.state<>'claimed'
      or attempt.authority_epoch<>run.authority_epoch
      or attempt.fencing_token<>(select highest_fencing_token from public.preflight_stage_runs
        where id=attempt.preflight_stage_run_id)
      or capability.id is null or capability.capability<>'gen_speech'
      or capability.status<>'verified' or capability.expires_at<=statement_timestamp()
      or not exists(select 1 from private.micro_quote_lines line
        where line.id=job.micro_quote_line_id and line.micro_quote_id=run.micro_quote_id
          and line.capability_id=capability.id and line.operation='gen_speech')
    then raise exception 'narration provider job authority is stale' using errcode='40001'; end if;
    insert into private.provider_requests(workspace_id,preflight_run_id,stage_attempt_id,
      provider_account_id,provider_capability_id,operation,request_schema_version,input_manifest_id,
      input_manifest_hash,idempotency_key,correlation_id,expected_cost_minor,maximum_cost_minor)
    values(job.workspace_id,run.id,attempt.id,capability.provider_account_id,capability.id,'gen_speech',
      capability.schema_version,job.input_manifest_id,job.input_manifest_hash,p_idempotency_key,
      p_correlation_id,88,88) returning * into request;
    insert into private.provider_request_quote_claims(workspace_id,provider_request_id,preflight_run_id,
      micro_quote_line_id,micro_authorization_id,micro_reservation_id,authority_epoch,fencing_token)
    values(job.workspace_id,request.id,run.id,job.micro_quote_line_id,run.micro_authorization_id,
      run.micro_reservation_id,run.authority_epoch,attempt.fencing_token);
    scope_hash:=encode(extensions.digest(convert_to(jsonb_build_object('jobId',job.id,
      'targetAssetId',job.target_asset_id,'inputManifestHash',job.input_manifest_hash)::text,'UTF8'),'sha256'),'hex');
    insert into private.worker_capability_grants(workspace_id,preflight_run_id,stage_attempt_id,
      provider_request_id,micro_quote_line_id,capability,authority_epoch,fencing_token,input_manifest_hash,
      token_jti_hash,allowed_rpc,allowed_object_scope_hash,expires_at)
    values(job.workspace_id,run.id,attempt.id,request.id,job.micro_quote_line_id,'gen_speech',
      run.authority_epoch,attempt.fencing_token,job.input_manifest_hash,
      encode(extensions.digest(convert_to(job.capability_jti::text,'UTF8'),'sha256'),'hex'),
      'provider.submit_exact_request',scope_hash,statement_timestamp()+interval '5 minutes')
    returning id into grant_id;
    update private.narration_generation_jobs set provider_request_id=request.id,
      capability_grant_id=grant_id,state='dispatching' where id=job.id returning * into job;
  end if;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id;
  return jsonb_build_object('ok',true,'jobId',job.id,
    'replayed',request.aggregate_version>1,'providerRequestId',request.id,
    'providerRequestState',request.state::text,'providerRequestVersion',request.aggregate_version,
    'capabilityGrantId',job.capability_grant_id,'capabilityJti',job.capability_jti,
    'workspaceId',job.workspace_id,'preflightRunId',job.preflight_run_id,
    'stageAttemptId',job.stage_attempt_id,'stageRunId',attempt.preflight_stage_run_id,
    'authorityEpoch',attempt.authority_epoch,'fencingToken',attempt.fencing_token,
    'inputManifestId',job.input_manifest_id,'inputManifestHash',job.input_manifest_hash,
    'quoteLineId',job.micro_quote_line_id,'targetAssetId',job.target_asset_id);
end;
$$;

create or replace function public.command_claim_narration_qc_step(
  p_job_id uuid,p_lease_token uuid,p_qc_run_id uuid,p_step text,
  p_audio_sha256 text,p_processing_text_sha256 text,
  p_narrator_gender public.narrator_gender,p_pronunciation_manifest_hash text,
  p_manifest_id uuid,p_manifest jsonb,p_manifest_hash text,
  p_idempotency_key text,p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  script public.script_revisions%rowtype; config public.episode_configuration_candidates%rowtype;
  qc private.narration_qc_runs%rowtype; capability private.provider_capabilities%rowtype;
  request private.provider_requests%rowtype; line private.micro_quote_lines%rowtype;
  request_id uuid; line_id uuid; capability_id uuid; operation_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_step not in ('asr','audio_judge') or p_audio_sha256!~'^[a-f0-9]{64}$'
    or p_processing_text_sha256!~'^[a-f0-9]{64}$'
    or p_pronunciation_manifest_hash!~'^[a-f0-9]{64}$'
    or p_manifest_hash!~'^[a-f0-9]{64}$'
    or p_manifest is null or jsonb_typeof(p_manifest)<>'object'
    or p_manifest_hash<>encode(extensions.digest(convert_to(p_manifest::text,'UTF8'),'sha256'),'hex')
    or char_length(p_idempotency_key) not between 8 and 200
  then raise exception 'narration QC claim envelope is invalid' using errcode='22023'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  select * into run from public.preflight_runs where id=job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id;
  select * into script from public.script_revisions where id=run.script_revision_id;
  select * into config from public.episode_configuration_candidates where id=run.configuration_candidate_id;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp()
    or job.promoted_asset_version_id is null
    or run.state<>'waiting_external' or run.kind<>'narration_clock'
    or attempt.state<>'waiting_external' or script.processing_utf8_sha256<>p_processing_text_sha256
    or config.narrator_gender<>p_narrator_gender
    or not exists(select 1 from public.asset_versions version
      where version.id=job.promoted_asset_version_id and version.workspace_id=job.workspace_id
        and version.content_sha256=p_audio_sha256 and version.media_mime='audio/mpeg')
  then raise exception 'narration QC authority is stale' using errcode='40001'; end if;
  select * into qc from private.narration_qc_runs where narration_job_id=job.id for update;
  if qc.id is null then
    if p_step<>'asr' then raise exception 'ASR must precede audio judgment' using errcode='40001'; end if;
    insert into private.narration_qc_runs(id,workspace_id,narration_job_id,
      narration_asset_version_id,audio_sha256,processing_text_sha256,narrator_gender,
      pronunciation_manifest_hash,state)
    values(p_qc_run_id,job.workspace_id,job.id,job.promoted_asset_version_id,
      p_audio_sha256,p_processing_text_sha256,p_narrator_gender,
      p_pronunciation_manifest_hash,'asr_reserved') returning * into qc;
  elsif qc.id<>p_qc_run_id or qc.audio_sha256<>p_audio_sha256
    or qc.processing_text_sha256<>p_processing_text_sha256
    or qc.narrator_gender<>p_narrator_gender
    or qc.pronunciation_manifest_hash<>p_pronunciation_manifest_hash
  then raise exception 'narration QC replay conflicts' using errcode='40001'; end if;
  if qc.state='verified' then
    return jsonb_build_object('ok',true,'replayed',true,'qcRunId',qc.id,
      'state',qc.state,'step',p_step,'providerRequestId',null,
      'providerRequestState',null,'providerRequestVersion',null,
      'asrTranscript',qc.asr_transcript,'finalAudioEvidence',qc.final_audio_evidence);
  end if;
  if qc.state='failed' then
    raise exception 'narration QC is terminal' using errcode='55000'; end if;
  if p_step='asr' then
    request_id:=qc.asr_provider_request_id;
    line_id:=job.asr_micro_quote_line_id;
    capability_id:=job.asr_provider_capability_id;
    operation_key:='asr';
    if qc.state not in ('asr_reserved','asr_submitted') then
      return jsonb_build_object('ok',true,'replayed',true,'qcRunId',qc.id,
        'state',qc.state,'step',p_step,'providerRequestId',request_id,
        'providerRequestState','succeeded','providerRequestVersion',3,
        'asrTranscript',qc.asr_transcript,'finalAudioEvidence',qc.final_audio_evidence);
    end if;
  else
    if qc.state<>'asr_verified' and qc.state not in ('judge_reserved','judge_submitted') then
      raise exception 'verified ASR is required before audio judgment' using errcode='40001'; end if;
    request_id:=qc.audio_judge_provider_request_id;
    line_id:=job.audio_judge_micro_quote_line_id;
    capability_id:=job.audio_judge_provider_capability_id;
    operation_key:='audio_judge';
  end if;
  if request_id is not null then
    select * into request from private.provider_requests where id=request_id;
    return jsonb_build_object('ok',true,'replayed',true,'qcRunId',qc.id,
      'state',qc.state,'step',p_step,'providerRequestId',request.id,
      'providerRequestState',request.state::text,
      'providerRequestVersion',request.aggregate_version,
      'asrTranscript',qc.asr_transcript,'finalAudioEvidence',qc.final_audio_evidence);
  end if;
  select * into capability from private.provider_capabilities
    where id=capability_id and private.provider_capabilities.capability=operation_key
      and status='verified' and expires_at>statement_timestamp();
  select * into line from private.micro_quote_lines where id=line_id
    and micro_quote_id=run.micro_quote_id and private.micro_quote_lines.capability_id=capability.id
    and private.micro_quote_lines.operation=operation_key;
  if capability.id is null or line.id is null
    or not exists(select 1 from private.micro_authorizations authz
      join private.micro_reservations reservation on reservation.micro_authorization_id=authz.id
      where authz.id=run.micro_authorization_id and reservation.id=run.micro_reservation_id
        and authz.state='active' and reservation.state in ('held','partially_settled')
        and authz.expires_at>statement_timestamp() and reservation.expires_at>statement_timestamp())
  then raise exception 'narration QC quote authority is stale' using errcode='40001'; end if;
  insert into private.provider_input_manifests(id,workspace_id,operation,payload_schema_version,
    payload_json,content_hash)
  values(p_manifest_id,job.workspace_id,operation_key,capability.schema_version,p_manifest,p_manifest_hash)
  on conflict(workspace_id,content_hash) do nothing;
  select id into p_manifest_id from private.provider_input_manifests
    where workspace_id=job.workspace_id and content_hash=p_manifest_hash
      and private.provider_input_manifests.operation=operation_key
      and payload_schema_version=capability.schema_version;
  if p_manifest_id is null then raise exception 'narration QC manifest conflicts' using errcode='40001'; end if;
  insert into private.provider_requests(workspace_id,preflight_run_id,stage_attempt_id,
    provider_account_id,provider_capability_id,operation,request_schema_version,
    input_manifest_id,input_manifest_hash,idempotency_key,correlation_id,
    expected_cost_minor,maximum_cost_minor)
  values(job.workspace_id,run.id,attempt.id,capability.provider_account_id,capability.id,
    operation_key,capability.schema_version,p_manifest_id,p_manifest_hash,p_idempotency_key,
    p_correlation_id,line.amount_minor,line.amount_minor) returning * into request;
  insert into private.provider_request_quote_claims(workspace_id,provider_request_id,
    preflight_run_id,micro_quote_line_id,micro_authorization_id,micro_reservation_id,
    authority_epoch,fencing_token)
  values(job.workspace_id,request.id,run.id,line.id,run.micro_authorization_id,
    run.micro_reservation_id,run.authority_epoch,attempt.fencing_token);
  if p_step='asr' then
    update private.narration_qc_runs set asr_provider_request_id=request.id,state='asr_reserved'
      where id=qc.id returning * into qc;
  else
    update private.narration_qc_runs set audio_judge_provider_request_id=request.id,state='judge_reserved'
      where id=qc.id returning * into qc;
  end if;
  return jsonb_build_object('ok',true,'replayed',false,'qcRunId',qc.id,
    'state',qc.state,'step',p_step,'providerRequestId',request.id,
    'providerRequestState',request.state::text,
    'providerRequestVersion',request.aggregate_version,
    'asrTranscript',qc.asr_transcript,'finalAudioEvidence',qc.final_audio_evidence);
end;
$$;

create or replace function public.command_submit_narration_qc_step(
  p_job_id uuid,p_lease_token uuid,p_step text,p_provider_request_id uuid,
  p_expected_version bigint
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  qc private.narration_qc_runs%rowtype; request private.provider_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  select * into qc from private.narration_qc_runs where narration_job_id=job.id for update;
  select * into request from private.provider_requests where id=p_provider_request_id for update;
  if p_step not in ('asr','audio_judge') or job.id is null or job.state<>'scanning'
    or job.ingest_lease_token<>p_lease_token or job.ingest_lease_expires_at<=statement_timestamp()
    or qc.id is null or request.aggregate_version<>p_expected_version or request.state<>'reserved'
    or (p_step='asr' and (qc.asr_provider_request_id<>request.id or request.operation<>'asr'))
    or (p_step='audio_judge' and (
      qc.audio_judge_provider_request_id<>request.id or request.operation<>'audio_judge'))
  then raise exception 'narration QC submission authority is stale' using errcode='40001'; end if;
  update private.provider_requests set state='submitted',submitted_at=statement_timestamp(),
    aggregate_version=aggregate_version+1 where id=request.id returning * into request;
  update private.narration_qc_runs set state=case when p_step='asr'
    then 'asr_submitted' else 'judge_submitted' end where id=qc.id returning * into qc;
  return jsonb_build_object('ok',true,'qcRunId',qc.id,'state',qc.state,
    'providerRequestId',request.id,'providerRequestState',request.state::text,
    'providerRequestVersion',request.aggregate_version);
end;
$$;

create or replace function public.command_record_narration_asr_result(
  p_job_id uuid,p_lease_token uuid,p_provider_request_id uuid,p_expected_version bigint,
  p_transcript text,p_transcript_sha256 text,p_normalized_expected_sha256 text,
  p_normalized_transcript_sha256 text,p_similarity numeric,p_edit_distance integer,
  p_length_ratio numeric,p_response_id_hash text,p_safe_response_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  qc private.narration_qc_runs%rowtype; request private.provider_requests%rowtype;
  passed boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if char_length(p_transcript) not between 1 and 20000
    or p_transcript_sha256<>encode(extensions.digest(convert_to(p_transcript,'UTF8'),'sha256'),'hex')
    or p_normalized_expected_sha256!~'^[a-f0-9]{64}$'
    or p_normalized_transcript_sha256!~'^[a-f0-9]{64}$'
    or p_similarity not between 0 and 1 or p_edit_distance not between 0 and 20000
    or p_length_ratio not between 0 and 10 or p_response_id_hash!~'^[a-f0-9]{64}$'
    or p_safe_response_hash!~'^[a-f0-9]{64}$'
  then raise exception 'narration ASR evidence is invalid' using errcode='22023'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  select * into qc from private.narration_qc_runs where narration_job_id=job.id for update;
  select * into request from private.provider_requests where id=p_provider_request_id for update;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp() or qc.state<>'asr_submitted'
    or qc.asr_provider_request_id<>request.id or request.operation<>'asr'
    or request.state<>'submitted' or request.aggregate_version<>p_expected_version
  then raise exception 'narration ASR completion authority is stale' using errcode='40001'; end if;
  passed:=p_similarity>=0.985 and p_length_ratio between 0.985 and 1.015
    and p_edit_distance<=18;
  update private.provider_requests set state='succeeded',safe_response_hash=p_safe_response_hash,
    billable_state='estimated',completed_at=statement_timestamp(),aggregate_version=aggregate_version+1
    where id=request.id;
  update private.narration_qc_runs set asr_transcript=p_transcript,
    asr_transcript_sha256=p_transcript_sha256,
    normalized_expected_sha256=p_normalized_expected_sha256,
    normalized_transcript_sha256=p_normalized_transcript_sha256,
    asr_similarity=p_similarity,asr_edit_distance=p_edit_distance,
    asr_length_ratio=p_length_ratio,asr_response_id_hash=p_response_id_hash,
    state=case when passed then 'asr_verified' else 'failed' end,
    safe_failure_class=case when passed then null else 'narration.asr_text_mismatch' end,
    completed_at=case when passed then null else statement_timestamp() end
    where id=qc.id returning * into qc;
  return jsonb_build_object('ok',true,'qcRunId',qc.id,'state',qc.state,
    'passed',passed,'transcriptHash',qc.asr_transcript_sha256);
end;
$$;

create or replace function public.command_record_narration_judge_result(
  p_job_id uuid,p_lease_token uuid,p_provider_request_id uuid,p_expected_version bigint,
  p_judge_evidence jsonb,p_judge_evidence_hash text,p_response_id_hash text,
  p_safe_response_hash text,p_final_audio_evidence jsonb,p_final_audio_evidence_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype;
  qc private.narration_qc_runs%rowtype; request private.provider_requests%rowtype;
  passed boolean; probe_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_judge_evidence is null or jsonb_typeof(p_judge_evidence)<>'object'
    or (p_judge_evidence-array['schemaVersion','intelligibilityPass','expressiveHindiPass',
      'requestedGenderPass','delhiAccentPass','glitchFreePass','pronunciationConcerns',
      'safeSummary']::text[])<>'{}'::jsonb
    or not(p_judge_evidence?&array['schemaVersion','intelligibilityPass','expressiveHindiPass',
      'requestedGenderPass','delhiAccentPass','glitchFreePass','pronunciationConcerns',
      'safeSummary'])
    or p_judge_evidence->>'schemaVersion'<>'genie.narration-audio-judge.v1'
    or jsonb_typeof(p_judge_evidence->'pronunciationConcerns')<>'array'
    or jsonb_array_length(p_judge_evidence->'pronunciationConcerns')>100
    or char_length(p_judge_evidence->>'safeSummary') not between 1 and 1000
    or p_judge_evidence_hash<>encode(extensions.digest(convert_to(p_judge_evidence::text,'UTF8'),'sha256'),'hex')
    or p_response_id_hash!~'^[a-f0-9]{64}$' or p_safe_response_hash!~'^[a-f0-9]{64}$'
    or p_final_audio_evidence is null or jsonb_typeof(p_final_audio_evidence)<>'object'
    or (p_final_audio_evidence-array['clippingDetected','truncationDetected','corruptFramesDetected',
      'unintendedSilenceDetected','audibleSeamsDetected','voiceIdentityPass','pronunciationPass',
      'expressiveHindiPass','requestedGenderPass','probeVersionId']::text[])<>'{}'::jsonb
    or not(p_final_audio_evidence?&array['clippingDetected','truncationDetected','corruptFramesDetected',
      'unintendedSilenceDetected','audibleSeamsDetected','voiceIdentityPass','pronunciationPass',
      'expressiveHindiPass','requestedGenderPass','probeVersionId'])
    or p_final_audio_evidence_hash<>encode(extensions.digest(convert_to(p_final_audio_evidence::text,'UTF8'),'sha256'),'hex')
  then raise exception 'narration audio-judge evidence is invalid' using errcode='22023'; end if;
  select * into job from private.narration_generation_jobs where id=p_job_id for update;
  select * into qc from private.narration_qc_runs where narration_job_id=job.id for update;
  select * into request from private.provider_requests where id=p_provider_request_id for update;
  probe_id:=(p_final_audio_evidence->>'probeVersionId')::uuid;
  passed:=(p_judge_evidence->>'intelligibilityPass')::boolean
    and (p_judge_evidence->>'expressiveHindiPass')::boolean
    and (p_judge_evidence->>'requestedGenderPass')::boolean
    and (p_judge_evidence->>'delhiAccentPass')::boolean
    and (p_judge_evidence->>'glitchFreePass')::boolean
    and jsonb_array_length(p_judge_evidence->'pronunciationConcerns')=0;
  if job.id is null or job.state<>'scanning' or job.ingest_lease_token<>p_lease_token
    or job.ingest_lease_expires_at<=statement_timestamp() or qc.state<>'judge_submitted'
    or qc.audio_judge_provider_request_id<>request.id or request.operation<>'audio_judge'
    or request.state<>'submitted' or request.aggregate_version<>p_expected_version
    or (p_final_audio_evidence->>'clippingDetected')::boolean
    or (p_final_audio_evidence->>'truncationDetected')::boolean
    or (p_final_audio_evidence->>'corruptFramesDetected')::boolean
    or (p_final_audio_evidence->>'unintendedSilenceDetected')::boolean
    or (p_final_audio_evidence->>'audibleSeamsDetected')::boolean
    or (p_final_audio_evidence->>'voiceIdentityPass')::boolean is not true
    or (p_final_audio_evidence->>'pronunciationPass')::boolean<>passed
    or (p_final_audio_evidence->>'expressiveHindiPass')::boolean<>passed
    or (p_final_audio_evidence->>'requestedGenderPass')::boolean<>passed
    or not exists(select 1 from public.media_probes probe
      where probe.id=probe_id and probe.asset_version_id=job.promoted_asset_version_id)
  then raise exception 'narration audio-judge completion authority is stale' using errcode='40001'; end if;
  update private.provider_requests set state='succeeded',safe_response_hash=p_safe_response_hash,
    billable_state='estimated',completed_at=statement_timestamp(),aggregate_version=aggregate_version+1
    where id=request.id;
  update private.narration_qc_runs set judge_evidence=p_judge_evidence,
    judge_evidence_hash=p_judge_evidence_hash,judge_response_id_hash=p_response_id_hash,
    final_audio_evidence=case when passed then p_final_audio_evidence else null end,
    final_audio_evidence_hash=case when passed then p_final_audio_evidence_hash else null end,
    state=case when passed then 'verified' else 'failed' end,
    safe_failure_class=case when passed then null else 'narration.audio_judge_rejected' end,
    completed_at=statement_timestamp() where id=qc.id returning * into qc;
  return jsonb_build_object('ok',true,'qcRunId',qc.id,'state',qc.state,
    'passed',passed,'finalAudioEvidence',qc.final_audio_evidence,
    'finalAudioEvidenceHash',qc.final_audio_evidence_hash);
end;
$$;

create or replace function public.command_record_narration_provider_output(
  p_provider_request_id uuid,p_quarantine_asset_version_id uuid,
  p_provider_response_hash text,p_source_audio_sha256 text,p_alignment jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype; request private.provider_requests%rowtype;
  computed_alignment_hash text; character_count integer; start_count integer; end_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs
    where provider_request_id=p_provider_request_id for update;
  select * into request from private.provider_requests where id=p_provider_request_id for update;
  if job.id is null or p_provider_response_hash!~'^[a-f0-9]{64}$'
    or p_source_audio_sha256!~'^[a-f0-9]{64}$' or p_alignment is null
    or jsonb_typeof(p_alignment)<>'object'
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
    or request.operation<>'gen_speech' or request.state not in ('submitted','accepted','polling','succeeded')
    or not exists(select 1 from private.quarantine_assets quarantine
      where quarantine.id=p_quarantine_asset_version_id and quarantine.workspace_id=job.workspace_id
        and quarantine.provider_request_id=p_provider_request_id
        and quarantine.source_sha256=p_source_audio_sha256
        and quarantine.declared_mime='audio/mpeg' and quarantine.state='quarantined')
  then raise exception 'narration provider output is stale' using errcode='40001'; end if;
  computed_alignment_hash:=encode(
    extensions.digest(convert_to(p_alignment::text,'UTF8'),'sha256'),
    'hex'
  );
  if job.state='quarantined' then
    if job.quarantine_asset_version_id<>p_quarantine_asset_version_id
      or job.provider_response_hash<>p_provider_response_hash
      or job.alignment_hash<>computed_alignment_hash
    then raise exception 'narration output replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'state',job.state);
  end if;
  if job.state<>'dispatching' then
    raise exception 'narration output arrived outside active authority' using errcode='40001'; end if;
  if request.state<>'succeeded' then
    -- Provider output is only quarantined here. The common secure-ingest
    -- promotion command is the sole authority that may mark media requests
    -- succeeded after immutable scan evidence is accepted.
    update private.provider_requests set safe_response_hash=p_provider_response_hash,
      billable_state='estimated',aggregate_version=aggregate_version+1
      where id=request.id;
  end if;
  update private.narration_generation_jobs set
    quarantine_asset_version_id=p_quarantine_asset_version_id,
    provider_response_hash=p_provider_response_hash,source_audio_sha256=p_source_audio_sha256,
    alignment=p_alignment,alignment_hash=computed_alignment_hash,state='quarantined'
  where id=job.id;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,'state','quarantined');
end;
$$;

revoke all on table private.narration_qc_runs from public,anon,authenticated;
revoke all on function private.guard_verified_narration_qc(),
  private.require_verified_narration_qc_for_clock() from public,anon,authenticated;
revoke all on function
  public.command_ensure_elevenlabs_narration_bundle_capability(uuid,text,uuid,text,text,timestamptz,timestamptz),
  public.command_ensure_openai_narration_qc_capabilities(uuid,text,text,text,timestamptz,timestamptz),
  public.command_prepare_narration_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),
  public.command_claim_narration_provider_job(uuid,text,uuid),
  public.command_claim_narration_qc_step(uuid,uuid,uuid,text,text,text,public.narrator_gender,text,uuid,jsonb,text,text,uuid),
  public.command_submit_narration_qc_step(uuid,uuid,text,uuid,bigint),
  public.command_record_narration_asr_result(uuid,uuid,uuid,bigint,text,text,text,text,numeric,integer,numeric,text,text),
  public.command_record_narration_judge_result(uuid,uuid,uuid,bigint,jsonb,text,text,text,jsonb,text)
from public,anon,authenticated;
grant execute on function
  public.command_ensure_elevenlabs_narration_bundle_capability(uuid,text,uuid,text,text,timestamptz,timestamptz),
  public.command_ensure_openai_narration_qc_capabilities(uuid,text,text,text,timestamptz,timestamptz),
  public.command_prepare_narration_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb),
  public.command_claim_narration_provider_job(uuid,text,uuid),
  public.command_claim_narration_qc_step(uuid,uuid,uuid,text,text,text,public.narrator_gender,text,uuid,jsonb,text,text,uuid),
  public.command_submit_narration_qc_step(uuid,uuid,text,uuid,bigint),
  public.command_record_narration_asr_result(uuid,uuid,uuid,bigint,text,text,text,text,numeric,integer,numeric,text,text),
  public.command_record_narration_judge_result(uuid,uuid,uuid,bigint,jsonb,text,text,text,jsonb,text)
to service_role;

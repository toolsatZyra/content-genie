-- Authenticated ElevenLabs voice receipts are immutable provider evidence.
-- Verification expires; narration dispatch must bind a current receipt rather
-- than trusting caller-authored availability metadata.

alter table public.voice_version_availability
  add column verification_expires_at timestamptz;

alter table public.voice_version_availability
  add constraint voice_verified_receipt_expiry_ck
  check (
    status <> 'verified'
    or (
      verified_at is not null
      and verification_expires_at is not null
      and verification_expires_at > verified_at
    )
  );

create table private.voice_authenticated_canaries (
  id uuid primary key default gen_random_uuid(),
  voice_version_id uuid not null references public.voice_versions(id) on delete restrict,
  provider text not null check (provider = 'elevenlabs'),
  external_voice_id text not null check (external_voice_id ~ '^[A-Za-z0-9]{20}$'),
  model_id text not null check (model_id = 'eleven_multilingual_v2'),
  output_format text not null check (output_format = 'mp3_44100_128'),
  phrase_sha256 text not null check (phrase_sha256 ~ '^[a-f0-9]{64}$'),
  provider_name_sha256 text not null check (provider_name_sha256 ~ '^[a-f0-9]{64}$'),
  audio_sha256 text not null check (audio_sha256 ~ '^[a-f0-9]{64}$'),
  request_id_sha256 text not null check (request_id_sha256 ~ '^[a-f0-9]{64}$'),
  byte_length bigint not null check (byte_length between 1000 and 25000000),
  checked_at timestamptz not null,
  expires_at timestamptz not null,
  command_id uuid not null unique,
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (voice_version_id, audio_sha256),
  check (expires_at > checked_at and expires_at <= checked_at + interval '90 days')
);

create trigger voice_authenticated_canaries_immutable
before update or delete on private.voice_authenticated_canaries
for each row execute function private.reject_mutation();

create or replace function public.command_record_authenticated_voice_canary(
  p_voice_version_id uuid,
  p_external_voice_id text,
  p_model_id text,
  p_output_format text,
  p_phrase_sha256 text,
  p_provider_name_sha256 text,
  p_audio_sha256 text,
  p_request_id_sha256 text,
  p_byte_length bigint,
  p_checked_at timestamptz,
  p_expires_at timestamptz,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  availability public.voice_version_availability%rowtype;
  configuration private.voice_provider_configurations%rowtype;
  canary private.voice_authenticated_canaries%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_model_id <> 'eleven_multilingual_v2'
    or p_output_format <> 'mp3_44100_128'
    or p_phrase_sha256 !~ '^[a-f0-9]{64}$'
    or p_provider_name_sha256 !~ '^[a-f0-9]{64}$'
    or p_audio_sha256 !~ '^[a-f0-9]{64}$'
    or p_request_id_sha256 !~ '^[a-f0-9]{64}$'
    or p_byte_length not between 1000 and 25000000
    or p_checked_at > statement_timestamp() + interval '5 minutes'
    or p_checked_at < statement_timestamp() - interval '24 hours'
    or p_expires_at <= p_checked_at
    or p_expires_at > p_checked_at + interval '90 days'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_request_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'authenticated voice canary envelope is invalid'
      using errcode = '22023';
  end if;
  select * into canary from private.voice_authenticated_canaries
  where idempotency_key = p_idempotency_key;
  if found then
    if canary.request_hash <> p_request_hash
      or canary.voice_version_id <> p_voice_version_id
    then
      raise exception 'voice canary replay conflicts' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'canaryId', canary.id,
      'voiceVersionId', canary.voice_version_id,
      'expiresAt', canary.expires_at
    );
  end if;
  select * into configuration from private.voice_provider_configurations
  where voice_version_id = p_voice_version_id;
  select * into availability from public.voice_version_availability
  where voice_version_id = p_voice_version_id for update;
  if configuration.voice_version_id is null
    or configuration.external_voice_id <> p_external_voice_id
    or availability.voice_version_id is null
    or availability.status = 'withdrawn'
  then
    raise exception 'voice canary identity is stale' using errcode = '40001';
  end if;
  insert into private.voice_authenticated_canaries(
    voice_version_id, provider, external_voice_id, model_id, output_format,
    phrase_sha256, provider_name_sha256, audio_sha256, request_id_sha256,
    byte_length, checked_at, expires_at, command_id, idempotency_key, request_hash
  ) values (
    p_voice_version_id, 'elevenlabs', p_external_voice_id, p_model_id,
    p_output_format, p_phrase_sha256, p_provider_name_sha256, p_audio_sha256,
    p_request_id_sha256, p_byte_length, p_checked_at, p_expires_at,
    p_command_id, p_idempotency_key, p_request_hash
  ) returning * into canary;
  update public.voice_version_availability
  set status = 'verified',
      verified_at = p_checked_at,
      verification_expires_at = p_expires_at,
      aggregate_version = aggregate_version + 1
  where voice_version_id = p_voice_version_id;
  return jsonb_build_object(
    'ok', true, 'replayed', false, 'canaryId', canary.id,
    'voiceVersionId', canary.voice_version_id,
    'expiresAt', canary.expires_at
  );
end;
$$;

create or replace function public.get_current_voice_provider_context(
  p_voice_version_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  configuration private.voice_provider_configurations%rowtype;
  availability public.voice_version_availability%rowtype;
  canary private.voice_authenticated_canaries%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into configuration from private.voice_provider_configurations
  where voice_version_id = p_voice_version_id;
  select * into availability from public.voice_version_availability
  where voice_version_id = p_voice_version_id;
  select * into canary from private.voice_authenticated_canaries
  where voice_version_id = p_voice_version_id
    and expires_at > statement_timestamp()
  order by checked_at desc limit 1;
  if configuration.voice_version_id is null
    or availability.status <> 'verified'
    or availability.verification_expires_at <= statement_timestamp()
    or canary.id is null
    or canary.expires_at <> availability.verification_expires_at
  then
    raise exception 'authenticated voice capability is stale'
      using errcode = '40001';
  end if;
  return jsonb_build_object(
    'voiceVersionId', p_voice_version_id,
    'externalVoiceId', configuration.external_voice_id,
    'provider', configuration.provider,
    'modelId', canary.model_id,
    'outputFormat', canary.output_format,
    'canaryId', canary.id,
    'expiresAt', canary.expires_at
  );
end;
$$;

revoke all on table private.voice_authenticated_canaries
  from public, anon, authenticated;
revoke all on function public.command_record_authenticated_voice_canary(
  uuid,text,text,text,text,text,text,text,bigint,timestamptz,timestamptz,
  uuid,text,text
), public.get_current_voice_provider_context(uuid)
  from public, anon, authenticated;
grant execute on function public.command_record_authenticated_voice_canary(
  uuid,text,text,text,text,text,text,text,bigint,timestamptz,timestamptz,
  uuid,text,text
), public.get_current_voice_provider_context(uuid)
  to service_role;

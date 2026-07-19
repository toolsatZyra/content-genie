-- Phase 2 / 0011 forward correction: a caller-authored object is not
-- provider authentication. Keep both launch voices pending until an authenticated
-- ElevenLabs receipt verifier is implemented.

alter table private.voice_version_availability_events
  drop constraint if exists voice_availability_events_no_unattested_verification;
alter table private.voice_version_availability_events
  add constraint voice_availability_events_no_unattested_verification
  check (new_status <> 'verified');

create or replace function public.command_set_voice_version_availability(
  p_voice_version_id uuid,
  p_expected_version bigint,
  p_status public.voice_version_availability_status,
  p_evidence jsonb,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_request_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid availability command envelope' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1
    or p_status is distinct from 'verified'
    or jsonb_typeof(p_evidence) is distinct from 'object'
    or pg_column_size(p_evidence) > 65536
    or not (
      (p_evidence - array[
        'kind','provider','result','checkedAt','artifactSha256'
      ]::text[]) = '{}'::jsonb
      and p_evidence ?& array[
        'kind','provider','result','checkedAt','artifactSha256'
      ]
      and jsonb_typeof(p_evidence -> 'kind') = 'string'
      and jsonb_typeof(p_evidence -> 'provider') = 'string'
      and jsonb_typeof(p_evidence -> 'result') = 'string'
      and jsonb_typeof(p_evidence -> 'checkedAt') = 'string'
      and jsonb_typeof(p_evidence -> 'artifactSha256') = 'string'
      and p_evidence ->> 'kind' = 'authenticated_canary'
      and p_evidence ->> 'provider' = 'elevenlabs'
      and p_evidence ->> 'result' = 'passed'
      and p_evidence ->> 'checkedAt' ~
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?Z$'
      and p_evidence ->> 'artifactSha256' ~ '^[a-f0-9]{64}$'
    ) is true
  then
    raise exception 'availability evidence is required' using errcode = '22023';
  end if;
  raise exception 'voice verification requires an authenticated provider receipt'
    using errcode = '55000';
end;
$$;

create or replace function public.command_withdraw_voice_version(
  p_voice_version_id uuid,
  p_expected_version bigint,
  p_evidence jsonb,
  p_command_id uuid,
  p_idempotency_key text,
  p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  availability public.voice_version_availability%rowtype;
  existing private.voice_version_availability_events%rowtype;
  prior_status public.voice_version_availability_status;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
    or p_request_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'invalid availability command envelope' using errcode = '22023';
  end if;
  if p_expected_version is null or p_expected_version < 1
    or jsonb_typeof(p_evidence) is distinct from 'object'
    or pg_column_size(p_evidence) > 65536
    or not (
      (p_evidence - array['kind','reason','actor']::text[]) = '{}'::jsonb
      and p_evidence ?& array['kind','reason','actor']
      and jsonb_typeof(p_evidence -> 'kind') = 'string'
      and jsonb_typeof(p_evidence -> 'reason') = 'string'
      and jsonb_typeof(p_evidence -> 'actor') = 'string'
      and p_evidence ->> 'kind' = 'administrative_withdrawal'
      and char_length(btrim(p_evidence ->> 'reason')) between 1 and 1000
      and char_length(btrim(p_evidence ->> 'actor')) between 1 and 200
    ) is true
  then
    raise exception 'withdrawal evidence is required' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'voice-withdrawal:' || p_idempotency_key,
      0
    )
  );
  select * into existing
  from private.voice_version_availability_events
  where idempotency_key = p_idempotency_key;
  if found then
    if existing.request_hash <> p_request_hash
      or existing.voice_version_id <> p_voice_version_id
      or existing.new_status <> 'withdrawn'
      or existing.aggregate_version - 1 is distinct from p_expected_version
    then
      raise exception 'idempotency key was already used with a different request'
        using errcode = '22023';
    end if;
    return jsonb_build_object(
      'ok', true,
      'voiceVersionId', existing.voice_version_id,
      'status', existing.new_status,
      'aggregateVersion', existing.aggregate_version
    );
  end if;

  select * into availability
  from public.voice_version_availability
  where voice_version_id = p_voice_version_id
  for update;
  if not found then
    raise exception 'voice version availability not found' using errcode = 'P0002';
  end if;
  if availability.aggregate_version is distinct from p_expected_version then
    raise exception 'stale voice availability version' using errcode = '40001';
  end if;
  if availability.status not in ('pending_authenticated_canary', 'verified') then
    raise exception 'invalid voice availability transition' using errcode = '55000';
  end if;
  prior_status := availability.status;

  update public.voice_version_availability
  set status = 'withdrawn',
      aggregate_version = aggregate_version + 1,
      withdrawn_at = statement_timestamp()
  where voice_version_id = p_voice_version_id
  returning * into availability;

  insert into private.voice_version_availability_events (
    command_id,
    voice_version_id,
    idempotency_key,
    request_hash,
    prior_status,
    new_status,
    aggregate_version,
    evidence,
    correlation_id
  )
  values (
    p_command_id,
    p_voice_version_id,
    p_idempotency_key,
    p_request_hash,
    prior_status,
    'withdrawn',
    availability.aggregate_version,
    p_evidence,
    p_correlation_id
  );
  return jsonb_build_object(
    'ok', true,
    'voiceVersionId', p_voice_version_id,
    'status', availability.status,
    'aggregateVersion', availability.aggregate_version
  );
end;
$$;

revoke all on function public.command_set_voice_version_availability(
  uuid,bigint,public.voice_version_availability_status,jsonb,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_set_voice_version_availability(
  uuid,bigint,public.voice_version_availability_status,jsonb,uuid,text,text,uuid
) to service_role;

revoke all on function public.command_withdraw_voice_version(
  uuid,bigint,jsonb,uuid,text,text,uuid
) from public, anon, authenticated;
grant execute on function public.command_withdraw_voice_version(
  uuid,bigint,jsonb,uuid,text,text,uuid
) to service_role;

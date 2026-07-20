-- Forward-only correction: PL/pgSQL treated the local `capability` record and
-- the capability column as ambiguous. Use unambiguous row/key names so the
-- authenticated narration bundle can be registered transactionally.

create or replace function public.command_ensure_elevenlabs_narration_bundle_capability(
  p_workspace_id uuid,p_environment text,p_voice_version_id uuid,
  p_schema_raw_sha256 text,p_schema_canonical_hash text,
  p_retrieved_at timestamptz,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare account_row private.provider_accounts%rowtype;
  schema_evidence_row private.provider_evidence_snapshots%rowtype;
  canary_evidence_row private.provider_evidence_snapshots%rowtype;
  capability_row private.provider_capabilities%rowtype;
  voice_config_row private.voice_provider_configurations%rowtype;
  canary_row private.voice_authenticated_canaries%rowtype;
  model_version_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_schema_raw_sha256 !~ '^[a-f0-9]{64}$'
    or p_schema_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at<=p_retrieved_at or p_expires_at>p_retrieved_at+interval '90 days'
    or p_retrieved_at>statement_timestamp()+interval '5 minutes'
  then raise exception 'ElevenLabs bundle evidence is invalid' using errcode='22023'; end if;
  select configuration.* into voice_config_row
    from private.voice_provider_configurations configuration
    where configuration.voice_version_id=p_voice_version_id;
  select canary.* into canary_row from private.voice_authenticated_canaries canary
    where canary.voice_version_id=p_voice_version_id
      and canary.expires_at>statement_timestamp()
    order by canary.checked_at desc limit 1;
  if voice_config_row.voice_version_id is null or voice_config_row.provider<>'elevenlabs'
    or canary_row.id is null
    or canary_row.external_voice_id<>voice_config_row.external_voice_id
    or canary_row.model_id<>'eleven_multilingual_v2'
    or canary_row.output_format<>'mp3_44100_128'
  then raise exception 'authenticated voice evidence is stale' using errcode='40001'; end if;
  insert into private.provider_accounts(
    workspace_id,environment,provider,account_key,credential_secret_ref,region,state
  ) values(p_workspace_id,p_environment,'elevenlabs','elevenlabs-narration',
    'ELEVENLABS_API_KEY','global','active')
  on conflict(workspace_id,environment,account_key) do update
    set state='active',aggregate_version=private.provider_accounts.aggregate_version+1
  returning * into account_row;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(account_row.id,'official_schema',
    encode(extensions.digest(convert_to('https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps','UTF8'),'sha256'),'hex'),
    p_schema_raw_sha256,p_schema_canonical_hash,
    'provider-evidence/elevenlabs/with-timestamps/schema-'||p_schema_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at)
  on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select snapshot.* into schema_evidence_row
    from private.provider_evidence_snapshots snapshot
    where snapshot.provider_account_id=account_row.id
      and snapshot.evidence_kind='official_schema'
      and snapshot.canonical_hash=p_schema_canonical_hash;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(account_row.id,'canary',
    encode(extensions.digest(convert_to('elevenlabs-voice-canary:'||p_voice_version_id::text,'UTF8'),'sha256'),'hex'),
    canary_row.audio_sha256,canary_row.audio_sha256,
    'provider-evidence/elevenlabs/voices/'||p_voice_version_id::text||'/canary-'||canary_row.audio_sha256||'.json',
    'verified',canary_row.checked_at,canary_row.expires_at)
  on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select snapshot.* into canary_evidence_row
    from private.provider_evidence_snapshots snapshot
    where snapshot.provider_account_id=account_row.id
      and snapshot.evidence_kind='canary'
      and snapshot.canonical_hash=canary_row.audio_sha256;
  model_version_key:='2026-07-19-qc-bundle:'||voice_config_row.external_voice_id;
  select registered.* into capability_row
    from private.provider_capabilities registered
    where registered.provider_account_id=account_row.id
      and registered.capability='gen_speech'
      and registered.model_key='eleven_multilingual_v2'
      and registered.model_version=model_version_key
      and registered.endpoint_key='tts-with-timestamps'
      and registered.schema_version='genie.elevenlabs-tts-timestamps.v1';
  if capability_row.id is null then
    insert into private.provider_capabilities(
      provider_account_id,capability,model_key,model_version,endpoint_key,
      schema_version,evidence_snapshot_id,canary_evidence_snapshot_id,currency,
      unit_name,unit_price_minor,maximum_request_minor,retention_class,
      verified_at,expires_at,status
    ) values(account_row.id,'gen_speech','eleven_multilingual_v2',model_version_key,
      'tts-with-timestamps','genie.elevenlabs-tts-timestamps.v1',schema_evidence_row.id,
      canary_evidence_row.id,'USD','request',88,88,'account_opt_out',
      greatest(p_retrieved_at,canary_row.checked_at),
      least(p_expires_at,schema_evidence_row.expires_at,canary_row.expires_at),'verified')
    returning * into capability_row;
  end if;
  if capability_row.status<>'verified'
    or capability_row.expires_at<=statement_timestamp()
    or capability_row.unit_price_minor<>88
    or capability_row.maximum_request_minor<>88
    or capability_row.canary_evidence_snapshot_id<>canary_evidence_row.id
  then raise exception 'ElevenLabs narration bundle capability is stale' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'providerAccountId',account_row.id,
    'capabilityId',capability_row.id,'voiceVersionId',p_voice_version_id,
    'externalVoiceId',voice_config_row.external_voice_id,
    'modelId','eleven_multilingual_v2','outputFormat','mp3_44100_128',
    'unitPriceMinor',capability_row.unit_price_minor,
    'expiresAt',capability_row.expires_at);
end;
$$;

revoke all on function
  public.command_ensure_elevenlabs_narration_bundle_capability(
    uuid,text,uuid,text,text,timestamptz,timestamptz
  )
from public,anon,authenticated;
grant execute on function
  public.command_ensure_elevenlabs_narration_bundle_capability(
    uuid,text,uuid,text,text,timestamptz,timestamptz
  )
to service_role;

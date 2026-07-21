-- Upgrade narration dispatch to ElevenLabs V3 while retaining the exact locked
-- script in the provider manifest. Only non-spoken delivery controls may be
-- inserted into the V3 delivery copy.

alter table private.voice_authenticated_canaries
  drop constraint if exists voice_authenticated_canaries_model_id_check;

alter table private.voice_authenticated_canaries
  add constraint voice_authenticated_canaries_model_id_check
  check (model_id in ('eleven_multilingual_v2', 'eleven_v3'));

do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef(
    'public.command_record_authenticated_voice_canary(uuid,text,text,text,text,text,text,text,bigint,timestamptz,timestamptz,uuid,text,text)'::regprocedure
  );
  if position('p_model_id <> ''eleven_multilingual_v2''' in definition) = 0 then
    raise exception 'voice canary function no longer matches the V2 baseline';
  end if;
  definition := replace(
    definition,
    'p_model_id <> ''eleven_multilingual_v2''',
    'p_model_id not in (''eleven_multilingual_v2'', ''eleven_v3'')'
  );
  execute definition;

  definition := pg_get_functiondef(
    'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)'::regprocedure
  );
  if position(
    '''source.extract'',''audio.pronunciation'',''story.plan'',''shot.plan'',''edd.plan'',''plan.evaluate'''
    in definition
  ) = 0 or position(
    'p_tool_name=''audio.pronunciation'' and run.kind=''narration_clock'''
    in definition
  ) = 0 then
    raise exception 'agent-call function no longer matches the narration baseline';
  end if;
  definition := replace(
    definition,
    '''source.extract'',''audio.pronunciation'',''story.plan'',''shot.plan'',''edd.plan'',''plan.evaluate''',
    '''source.extract'',''audio.pronunciation'',''audio.delivery'',''story.plan'',''shot.plan'',''edd.plan'',''plan.evaluate'''
  );
  definition := replace(
    definition,
    'p_tool_name=''audio.pronunciation'' and run.kind=''narration_clock''',
    'p_tool_name in (''audio.pronunciation'',''audio.delivery'') and run.kind=''narration_clock'''
  );
  execute definition;

  definition := pg_get_functiondef(
    'public.command_ensure_elevenlabs_narration_bundle_capability(uuid,text,uuid,text,text,timestamptz,timestamptz)'::regprocedure
  );
  if position('eleven_multilingual_v2' in definition) = 0
    or position('genie.elevenlabs-tts-timestamps.v1' in definition) = 0
    or position('2026-07-19-qc-bundle:' in definition) = 0
  then
    raise exception 'ElevenLabs capability function no longer matches the V2 baseline';
  end if;
  definition := replace(definition, 'eleven_multilingual_v2', 'eleven_v3');
  definition := replace(
    definition,
    'genie.elevenlabs-tts-timestamps.v1',
    'genie.elevenlabs-v3-tts-timestamps.v1'
  );
  definition := replace(
    definition,
    '2026-07-19-qc-bundle:',
    '2026-07-21-v3-qc-bundle:'
  );
  execute definition;

  definition := pg_get_functiondef(
    'public.command_prepare_narration_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  );
  if position('eleven_multilingual_v2' in definition) = 0
    or position('genie.elevenlabs-tts-timestamps.v1' in definition) = 0
  then
    raise exception 'narration preparation function no longer matches the V2 baseline';
  end if;
  definition := replace(definition, 'eleven_multilingual_v2', 'eleven_v3');
  definition := replace(
    definition,
    'genie.elevenlabs-tts-timestamps.v1',
    'genie.elevenlabs-v3-tts-timestamps.v1'
  );
  if position($old$
    or (p_provider_payload-array['modelId','outputFormat','targetAssetId','text','voiceId','voiceSettings']::text[])<>'{}'::jsonb
    or not(p_provider_payload?&array['modelId','outputFormat','targetAssetId','text','voiceId','voiceSettings'])
    or p_provider_payload->>'modelId'<>'eleven_v3'
    or p_provider_payload->>'outputFormat'<>'mp3_44100_128'
    or p_provider_payload->>'targetAssetId'<>p_target_asset_id::text
    or p_provider_payload->>'text'<>script.processing_text
    or p_provider_payload->>'voiceId'<>voice_config.external_voice_id
$old$ in definition) = 0 then
    raise exception 'narration provider-payload guard no longer matches the baseline';
  end if;
  definition := replace(
    definition,
    $old$
    or (p_provider_payload-array['modelId','outputFormat','targetAssetId','text','voiceId','voiceSettings']::text[])<>'{}'::jsonb
    or not(p_provider_payload?&array['modelId','outputFormat','targetAssetId','text','voiceId','voiceSettings'])
    or p_provider_payload->>'modelId'<>'eleven_v3'
    or p_provider_payload->>'outputFormat'<>'mp3_44100_128'
    or p_provider_payload->>'targetAssetId'<>p_target_asset_id::text
    or p_provider_payload->>'text'<>script.processing_text
    or p_provider_payload->>'voiceId'<>voice_config.external_voice_id
$old$,
    $new$
    or (p_provider_payload-array['deliveryMap','deliveryTextSha256','modelId','outputFormat',
      'sourceText','sourceTextSha256','targetAssetId','text','voiceId','voiceSettings']::text[])<>'{}'::jsonb
    or not(p_provider_payload?&array['deliveryMap','deliveryTextSha256','modelId','outputFormat',
      'sourceText','sourceTextSha256','targetAssetId','text','voiceId','voiceSettings'])
    or p_provider_payload->>'modelId'<>'eleven_v3'
    or p_provider_payload->>'outputFormat'<>'mp3_44100_128'
    or p_provider_payload->>'targetAssetId'<>p_target_asset_id::text
    or p_provider_payload->>'sourceText'<>script.processing_text
    or p_provider_payload->>'sourceTextSha256'<>encode(
      extensions.digest(convert_to(script.processing_text,'UTF8'),'sha256'),'hex'
    )
    or char_length(p_provider_payload->>'text') not between 1 and 5000
    or p_provider_payload->>'deliveryTextSha256'<>encode(
      extensions.digest(convert_to(p_provider_payload->>'text','UTF8'),'sha256'),'hex'
    )
    or jsonb_typeof(p_provider_payload->'deliveryMap')<>'array'
    or jsonb_array_length(p_provider_payload->'deliveryMap')<>char_length(p_provider_payload->>'text')
    or (select count(*)
        from jsonb_array_elements(p_provider_payload->'deliveryMap') elements(item)
        where jsonb_typeof(item)<>'null')<>char_length(script.processing_text)
    or exists(
      select 1 from (
        select item, row_number() over(order by ordinality)-1 as expected_index
        from jsonb_array_elements(p_provider_payload->'deliveryMap')
          with ordinality mapped(item, ordinality)
        where jsonb_typeof(item)<>'null'
      ) ordered_map
      where case
        when jsonb_typeof(item)='number'
          then (item#>>'{}')::integer<>expected_index
        else true
      end
    )
    or p_provider_payload->>'voiceId'<>voice_config.external_voice_id
$new$
  );
  execute definition;
end;
$migration$;

create or replace function public.get_existing_narration_delivery(
  p_preflight_run_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  job private.narration_generation_jobs%rowtype;
  manifest private.provider_input_manifests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  select * into job
  from private.narration_generation_jobs
  where preflight_run_id = p_preflight_run_id;
  if job.id is null then
    return null;
  end if;
  select * into manifest
  from private.provider_input_manifests
  where id = job.input_manifest_id
    and workspace_id = job.workspace_id
    and operation = 'gen_speech';
  if manifest.id is null
    or manifest.content_hash <> encode(
      extensions.digest(convert_to(manifest.payload_json::text, 'UTF8'), 'sha256'),
      'hex'
    )
  then
    raise exception 'existing narration delivery is not trustworthy'
      using errcode = '40001';
  end if;
  return manifest.payload_json;
end;
$$;

revoke all on function public.get_existing_narration_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.get_existing_narration_delivery(uuid)
  to service_role;

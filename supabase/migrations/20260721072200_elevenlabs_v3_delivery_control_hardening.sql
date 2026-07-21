-- The delivery map must prove both sides of the invariant: every locked source
-- scalar survives unchanged (except English CAPS emphasis), and every inserted
-- scalar belongs to the narrow V3 control grammar. This prevents a privileged
-- caller from smuggling additional spoken words through a null map entry.

do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef(
    'public.command_prepare_narration_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure
  );
  if position(
    '    or p_provider_payload->>''voiceId''<>voice_config.external_voice_id'
    in definition
  ) = 0 then
    raise exception 'narration delivery guard no longer matches the V3 baseline';
  end if;
  definition := replace(
    definition,
    '    or p_provider_payload->>''voiceId''<>voice_config.external_voice_id',
    $guard$    or exists(
      select 1
      from jsonb_array_elements(p_provider_payload->'deliveryMap')
        with ordinality mapped(item, ordinality)
      where case
        when jsonb_typeof(item)='number' then
          substr(p_provider_payload->>'text', ordinality::integer, 1)
            <> substr(p_provider_payload->>'sourceText', (item#>>'{}')::integer + 1, 1)
          and not(
            substr(p_provider_payload->>'sourceText', (item#>>'{}')::integer + 1, 1)
              ~ '^[A-Za-z]$'
            and substr(p_provider_payload->>'text', ordinality::integer, 1)
              = upper(substr(
                  p_provider_payload->>'sourceText',
                  (item#>>'{}')::integer + 1,
                  1
                ))
          )
        else false
      end
    )
    or coalesce((
      select string_agg(
        substr(p_provider_payload->>'text', ordinality::integer, 1),
        '' order by ordinality
      )
      from jsonb_array_elements(p_provider_payload->'deliveryMap')
        with ordinality mapped(item, ordinality)
      where jsonb_typeof(item)='null'
    ), '') !~ '^(?:(?:\[(?:curious|excited|exhales|sighs|whispers)\] )|,|\.{3}|!)*$'
    or p_provider_payload->>'voiceId'<>voice_config.external_voice_id$guard$
  );
  execute definition;
end;
$migration$;

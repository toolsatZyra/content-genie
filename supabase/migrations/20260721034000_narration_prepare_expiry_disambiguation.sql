-- Repair the deployed narration preparation function without changing its
-- signature or authority contract. The original local variable `expires_at`
-- collided with table columns of the same name inside PL/pgSQL queries.

do $migration$
declare
  function_signature regprocedure :=
    'public.command_prepare_narration_job(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure;
  original_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(function_signature)
    into original_definition;

  if position('manifest_hash text; authority_expires_at timestamptz;' in original_definition) > 0 then
    return;
  end if;

  if position('manifest_hash text; expires_at timestamptz;' in original_definition) = 0 then
    raise exception 'narration preparation function has an unexpected expiry declaration'
      using errcode = '55000';
  end if;

  corrected_definition := replace(
    original_definition,
    'manifest_hash text; expires_at timestamptz;',
    'manifest_hash text; authority_expires_at timestamptz;'
  );
  corrected_definition := replace(
    corrected_definition,
    'expires_at:=least(intent.expires_at,speech.expires_at,asr_cap.expires_at,judge_cap.expires_at);',
    'authority_expires_at:=least(intent.expires_at,speech.expires_at,asr_cap.expires_at,judge_cap.expires_at);'
  );
  corrected_definition := replace(
    corrected_definition,
    '''expiresAt'',expires_at)',
    '''expiresAt'',authority_expires_at)'
  );
  corrected_definition := replace(
    corrected_definition,
    'expires_at,statement_timestamp());',
    'authority_expires_at,statement_timestamp());'
  );
  corrected_definition := replace(
    corrected_definition,
    '116,''active'',expires_at);',
    '116,''active'',authority_expires_at);'
  );
  corrected_definition := replace(
    corrected_definition,
    '116,''held'',expires_at);',
    '116,''held'',authority_expires_at);'
  );

  if corrected_definition = original_definition
    or position('authority_expires_at' in corrected_definition) = 0
    or position('manifest_hash text; expires_at timestamptz;' in corrected_definition) > 0
  then
    raise exception 'narration preparation expiry repair did not converge'
      using errcode = '55000';
  end if;

  execute corrected_definition;
end
$migration$;

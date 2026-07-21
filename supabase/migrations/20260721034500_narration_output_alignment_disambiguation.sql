-- Repair the deployed narration output recorder. Its local `alignment_hash`
-- variable collided with the narration job column of the same name.

do $migration$
declare
  function_signature regprocedure :=
    'public.command_record_narration_provider_output(uuid,uuid,text,text,jsonb)'::regprocedure;
  original_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef(function_signature)
    into original_definition;

  if position('computed_alignment_hash text;' in original_definition) > 0 then
    return;
  end if;

  if position('  alignment_hash text;' in original_definition) = 0 then
    raise exception 'narration output function has an unexpected alignment declaration'
      using errcode = '55000';
  end if;

  corrected_definition := replace(
    original_definition,
    '  alignment_hash text;',
    '  computed_alignment_hash text;'
  );
  corrected_definition := replace(
    corrected_definition,
    'alignment_hash:=encode(',
    'computed_alignment_hash:=encode('
  );
  corrected_definition := replace(
    corrected_definition,
    'job.alignment_hash<>alignment_hash',
    'job.alignment_hash<>computed_alignment_hash'
  );
  corrected_definition := replace(
    corrected_definition,
    'alignment_hash=alignment_hash,state=',
    'alignment_hash=computed_alignment_hash,state='
  );

  if corrected_definition = original_definition
    or position('computed_alignment_hash' in corrected_definition) = 0
    or position('  alignment_hash text;' in corrected_definition) > 0
  then
    raise exception 'narration output alignment repair did not converge'
      using errcode = '55000';
  end if;

  execute corrected_definition;
end
$migration$;

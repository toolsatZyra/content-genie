-- Permit the prequalified Anthropic structured-output adapter to replace an
-- OpenAI call that was terminally rejected for insufficient project quota.
-- Preserve the existing tool scope and every stage/fencing authority check.

do $migration$
declare
  definition text;
begin
  definition := pg_get_functiondef(
    'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)'::regprocedure
  );
  if position(
    'p_model_version not in (''gpt-5.6-sol'',''gpt-5.6-terra'')'
    in definition
  ) = 0 or position(
    'p_maximum_result_bytes,0,''openai'',p_model_version,p_prompt_hash,''authorized'''
    in definition
  ) = 0 then
    raise exception 'agent-call function no longer matches the provider baseline';
  end if;
  definition := replace(
    definition,
    'p_model_version not in (''gpt-5.6-sol'',''gpt-5.6-terra'')',
    'p_model_version not in (''gpt-5.6-sol'',''gpt-5.6-terra'',''claude-sonnet-4-6'')'
  );
  definition := replace(
    definition,
    'p_maximum_result_bytes,0,''openai'',p_model_version,p_prompt_hash,''authorized''',
    'p_maximum_result_bytes,0,case when p_model_version=''claude-sonnet-4-6'' then ''anthropic'' else ''openai'' end,p_model_version,p_prompt_hash,''authorized'''
  );
  execute definition;
end;
$migration$;

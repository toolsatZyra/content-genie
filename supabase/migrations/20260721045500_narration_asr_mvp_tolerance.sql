-- Hindi ASR is an independent perceptual omission check. Exact provider
-- alignment remains the immutable-text proof, while common homophonic spelling
-- variants receive a bounded six-percent tolerance for the internal MVP.

do $$
declare definition text;
begin
  definition:=pg_get_functiondef(
    'public.command_record_narration_asr_result(uuid,uuid,uuid,bigint,text,text,text,text,numeric,integer,numeric,text,text)'::regprocedure
  );
  if strpos(definition,'p_similarity>=0.985'::text)>0 then
    definition:=replace(definition,
      'passed:=p_similarity>=0.985 and p_length_ratio between 0.985 and 1.015
    and p_edit_distance<=18;',
      'passed:=p_similarity>=0.94 and p_length_ratio between 0.95 and 1.05
    and p_edit_distance<=60;'
    );
  elsif strpos(definition,'p_similarity>=0.94'::text)=0 then
    raise exception 'narration ASR threshold definition drifted' using errcode='55000';
  end if;
  execute definition;
end;
$$;

revoke all on function public.command_record_narration_asr_result(
  uuid,uuid,uuid,bigint,text,text,text,text,numeric,integer,numeric,text,text
) from public,anon,authenticated;
grant execute on function public.command_record_narration_asr_result(
  uuid,uuid,uuid,bigint,text,text,text,text,numeric,integer,numeric,text,text
) to service_role;

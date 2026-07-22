-- The explicit cultural-confirmation correction replaced the review command
-- from its earlier definition. Reapply the later owner-MVP authority context
-- so audit triggers receive the exact profile, epoch, AAL and provenance.

do $$
declare
  definition text;
  needle text := 'perform private.assert_aal2();';
  replacement text := E'perform private.assert_workspace_action_authority(\n    p_workspace_id,case when p_decision = ''approve''\n      then ''mvp_final_review'' else ''mvp_review'' end\n  );';
begin
  definition := pg_get_functiondef(
    'public.command_review_mvp_master(uuid,uuid,bigint,text,boolean,boolean,text)'::regprocedure
  );
  if length(definition) - length(replace(definition,needle,''))
    <> length(needle)
  then
    raise exception 'expected one strict AAL2 call in the corrected MVP review command'
      using errcode = '23514';
  end if;
  definition := replace(definition,needle,replacement);
  execute definition;
end;
$$;

comment on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) is
  'Records an owner-MVP review with profile-bound authority; approval requires an existing qualified cultural decision plus explicit cultural and final confirmations.';

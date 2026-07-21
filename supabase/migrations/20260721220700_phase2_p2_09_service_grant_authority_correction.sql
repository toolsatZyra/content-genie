-- The public command's EXECUTE ACL is the service authority boundary. Remove
-- the deprecated JWT auth.role() inspection without rewriting applied history.
-- Fail closed if the immediately preceding definition is not the one audited.

do $migration$
declare
  function_signature constant regprocedure :=
    'public.command_record_p2_09_cultural_claim_bundle(uuid,uuid,text,jsonb,jsonb,text,text,text)'::regprocedure;
  function_definition text;
  deprecated_guard constant text := E'  if auth.role() is distinct from ''service_role'' then\n    raise exception ''service authority required'' using errcode=''42501'';\n  end if;\n';
begin
  function_definition:=pg_get_functiondef(function_signature);
  if position(deprecated_guard in function_definition)=0 then
    raise exception 'P2-09 service command definition does not match the audited predecessor'
      using errcode='40001';
  end if;
  function_definition:=replace(function_definition,deprecated_guard,'');
  if position('auth.role()' in function_definition)>0 then
    raise exception 'deprecated auth.role inspection remains in the P2-09 service command'
      using errcode='40001';
  end if;
  execute function_definition;
end;
$migration$;

revoke all on function public.command_record_p2_09_cultural_claim_bundle(
  uuid,uuid,text,jsonb,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.command_record_p2_09_cultural_claim_bundle(
  uuid,uuid,text,jsonb,jsonb,text,text,text
) to service_role;

revoke all on function private.p2_09_expected_claim_categories(),
  private.p2_09_cultural_contract_hash(),
  private.assert_p2_09_claim_categories(uuid,uuid,jsonb),
  private.p2_09_cultural_bundle_is_approvable(uuid,uuid),
  private.enforce_p2_09_source_review_approval()
from public,anon,authenticated,service_role;

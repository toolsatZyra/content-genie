-- The developer-only MVP uses password-authenticated workspace roles for authority.
-- Keep the legacy function name so existing command contracts remain stable while
-- removing the TOTP step-up requirement from every caller.
create or replace function private.assert_aal2()
returns void
language plpgsql
stable
set search_path=''
as $$
begin
  if auth.role() is distinct from 'authenticated'
    or auth.uid() is null
    or private.current_aal() not in ('aal1','aal2')
  then
    raise exception 'authenticated session required' using errcode='42501';
  end if;
end;
$$;

comment on function private.assert_aal2() is
  'Legacy command-contract guard. Developer MVP accepts an authenticated aal1 or aal2 session; workspace role and active-session checks remain authoritative.';

-- Three command paths used inline AAL2 predicates instead of the shared guard.
-- Rewrite only those exact predicates, preserving each signed function body and
-- its existing membership, role, idempotency, budget and audit checks.
do $$
declare
  function_signature regprocedure;
  definition text;
begin
  foreach function_signature in array array[
    'public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure,
    'public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure,
    'public.prepare_first_episode_world_lock(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(function_signature);
    if position('private.current_aal()<>''aal2''' in definition)=0 then
      raise exception 'Expected legacy AAL2 predicate is missing from %',function_signature;
    end if;
    definition:=replace(
      definition,
      'private.current_aal()<>''aal2''',
      'private.current_aal() not in (''aal1'',''aal2'')'
    );
    definition:=replace(
      definition,
      'AAL2 authenticated authority required',
      'authenticated workspace authority required'
    );
    definition:=replace(
      definition,
      'AAL2 active membership required',
      'active authenticated membership required'
    );
    execute definition;
  end loop;
end;
$$;

-- The endpoint allowlist replacement must retain the previously shipped,
-- owner-evidence-bound ceiling extension for exact legacy storyboard runs.
-- This forward repair is also safe on a fresh database where the preceding
-- migration already contains the final definition.

do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef(
    'public.command_reserve_mvp_media_dispatch(uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint)'::regprocedure
  );
  if strpos(
    definition,
    'mvp_legacy_storyboard_owner_authorization_is_current'
  ) > 0 then
    return;
  end if;
  revised := regexp_replace(
    definition,
    'if\s+aggregate_maximum\s*\+\s*p_maximum_cost_microusd\s*>\s*run_hard_ceiling\s+then',
    $replacement$if aggregate_maximum + p_maximum_cost_microusd >
      run_hard_ceiling + coalesce((
        select authority.authorized_additional_maximum_microusd
        from private.mvp_storyboard_quote_compatibility_authorities authority
        where authority.workspace_id = p_workspace_id
          and authority.production_run_id = p_production_run_id
          and private.mvp_legacy_storyboard_owner_authorization_is_current(
            authority.workspace_id, authority.production_run_id, authority.id
          )
      ), 0)
    then$replacement$,
    'i'
  );
  if revised = definition then
    raise exception 'media dispatch compatibility ceiling repair target was not found'
      using errcode = '23514';
  end if;
  execute revised;
end;
$migration$;

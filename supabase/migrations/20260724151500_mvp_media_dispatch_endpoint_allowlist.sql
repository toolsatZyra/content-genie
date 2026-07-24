-- FAL endpoint identifiers are not all rooted under `fal-ai/`: Seedance uses
-- the documented `bytedance/` namespace. Bind spend-bearing MVP dispatches to
-- the exact provider endpoints compiled by the production worker.

create or replace function public.command_reserve_mvp_media_dispatch(
  p_workspace_id uuid,
  p_production_run_id uuid,
  p_episode_id uuid,
  p_attempt_number integer,
  p_shot_number integer,
  p_dispatch_key text,
  p_media_kind text,
  p_endpoint text,
  p_input_manifest_sha256 text,
  p_expected_cost_microusd bigint,
  p_maximum_cost_microusd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_row private.mvp_media_dispatches%rowtype;
  aggregate_maximum numeric;
  run_hard_ceiling bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_workspace_id is null or p_production_run_id is null
    or p_episode_id is null or p_attempt_number is null
    or p_attempt_number not between 1 and 20 or p_shot_number is null
    or p_shot_number not between 1 and 200
    or p_input_manifest_sha256 is null
    or p_input_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_dispatch_key is null
    or p_dispatch_key !~ '^(storyboard|clip):[0-9]{1,3}:(single|start|end|motion)$'
    or not (
      (p_media_kind = 'storyboard' and p_dispatch_key in (
        'storyboard:' || p_shot_number::text || ':single',
        'storyboard:' || p_shot_number::text || ':start',
        'storyboard:' || p_shot_number::text || ':end'
      ))
      or
      (p_media_kind = 'clip'
        and p_dispatch_key = 'clip:' || p_shot_number::text || ':motion')
    )
    or p_media_kind is null
    or p_media_kind not in ('storyboard','clip')
    or p_endpoint is null
    or p_endpoint not in (
      'fal-ai/nano-banana-2',
      'fal-ai/nano-banana-2/edit',
      'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
      'fal-ai/kling-video/v3/pro/image-to-video',
      'bytedance/seedance-2.0/image-to-video'
    )
    or p_expected_cost_microusd is null
    or p_expected_cost_microusd not between 0 and 50000000
    or p_maximum_cost_microusd is null
    or p_maximum_cost_microusd not between p_expected_cost_microusd and 50000000
  then
    raise exception 'media dispatch reservation is invalid' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'mvp-media-dispatch:' || p_production_run_id::text,
    0
  ));

  select * into dispatch_row
  from private.mvp_media_dispatches
  where production_run_id = p_production_run_id
    and attempt_number = p_attempt_number
    and dispatch_key = p_dispatch_key
  for update;
  if found then
    if dispatch_row.workspace_id <> p_workspace_id
      or dispatch_row.episode_id <> p_episode_id
      or dispatch_row.shot_number <> p_shot_number
      or dispatch_row.media_kind <> p_media_kind
      or dispatch_row.endpoint <> p_endpoint
      or dispatch_row.input_manifest_sha256 <> p_input_manifest_sha256
      or dispatch_row.expected_cost_microusd <> p_expected_cost_microusd
      or dispatch_row.maximum_cost_microusd <> p_maximum_cost_microusd
    then
      raise exception 'media dispatch reservation conflicts with immutable intent'
        using errcode = '40001';
    end if;
    if dispatch_row.state = 'dispatching'
      and dispatch_row.lease_expires_at <= statement_timestamp()
    then
      update private.mvp_media_dispatches
      set state = 'outcome_unknown', version = version + 1,
          claim_token = null, lease_expires_at = null,
          completed_at = statement_timestamp(),
          last_error_code = 'PROVIDER_OUTCOME_UNKNOWN',
          last_error_summary =
            'The provider dispatch lease expired after the network boundary; automatic resubmission is blocked.'
      where id = dispatch_row.id
      returning * into dispatch_row;
    end if;
    return to_jsonb(dispatch_row) || jsonb_build_object('replayed', true);
  end if;

  select run.hard_ceiling_microusd into run_hard_ceiling
  from public.production_runs run
  where run.id = p_production_run_id
    and run.workspace_id = p_workspace_id
    and run.episode_id = p_episode_id;
  if not found or run_hard_ceiling is null or run_hard_ceiling < 0 then
    raise exception 'media dispatch production authority is unavailable'
      using errcode = '23514';
  end if;

  select coalesce(sum(dispatch.maximum_cost_microusd), 0)
  into aggregate_maximum
  from private.mvp_media_dispatches dispatch
  where dispatch.production_run_id = p_production_run_id
    and dispatch.state in (
      'reserved','dispatching','submitted','succeeded','outcome_unknown'
    );
  if aggregate_maximum + p_maximum_cost_microusd > run_hard_ceiling +
      coalesce((
        select authority.authorized_additional_maximum_microusd
        from private.mvp_storyboard_quote_compatibility_authorities authority
        where authority.workspace_id = p_workspace_id
          and authority.production_run_id = p_production_run_id
          and private.mvp_legacy_storyboard_owner_authorization_is_current(
            authority.workspace_id, authority.production_run_id, authority.id
          )
      ), 0)
  then
    raise exception 'media dispatch aggregate maximum exceeds production run authority'
      using errcode = '23514';
  end if;

  insert into private.mvp_media_dispatches(
    workspace_id,production_run_id,episode_id,attempt_number,shot_number,
    dispatch_key,media_kind,endpoint,input_manifest_sha256,
    expected_cost_microusd,maximum_cost_microusd,state
  ) values(
    p_workspace_id,p_production_run_id,p_episode_id,p_attempt_number,
    p_shot_number,p_dispatch_key,p_media_kind,p_endpoint,
    p_input_manifest_sha256,p_expected_cost_microusd,p_maximum_cost_microusd,
    'reserved'
  ) returning * into dispatch_row;
  return to_jsonb(dispatch_row) || jsonb_build_object('replayed', false);
end;
$$;

comment on function public.command_reserve_mvp_media_dispatch(
  uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint
) is
  'Reserves an exact, cost-bound MVP media dispatch for the production compiler allowlist, including FAL Seedance under its bytedance namespace.';

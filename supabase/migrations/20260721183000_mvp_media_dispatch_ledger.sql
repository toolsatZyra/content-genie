-- Persist an immutable spend intent before every storyboard/video provider
-- submission. A crash after the network boundary leaves an outcome_unknown
-- row that cannot be dispatched again automatically.

create unique index mvp_production_jobs_media_dispatch_link_uq
on public.mvp_production_jobs(workspace_id, production_run_id, episode_id);

create table private.mvp_media_dispatches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  production_run_id uuid not null,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 20),
  shot_number integer not null check (shot_number between 1 and 200),
  dispatch_key text not null check (
    dispatch_key ~ '^(storyboard|clip):[0-9]{1,3}:(single|start|end|motion)$'
  ),
  media_kind text not null check (media_kind in ('storyboard','clip')),
  endpoint text not null check (
    endpoint ~ '^fal-ai/[A-Za-z0-9._/-]{3,180}$'
    and strpos(endpoint, '..') = 0 and strpos(endpoint, '//') = 0
    and right(endpoint, 1) <> '/'
  ),
  input_manifest_sha256 text not null check (
    input_manifest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  expected_cost_microusd bigint not null check (
    expected_cost_microusd between 0 and 50000000
  ),
  maximum_cost_microusd bigint not null check (
    maximum_cost_microusd between expected_cost_microusd and 50000000
  ),
  state text not null check (state in (
    'reserved','dispatching','submitted','succeeded','failed','outcome_unknown'
  )),
  version bigint not null default 1 check (version > 0),
  fencing_token bigint not null default 0 check (fencing_token >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  external_request_id text,
  status_url text,
  response_url text,
  output_content_sha256 text check (
    output_content_sha256 is null or output_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  last_error_summary text check (
    last_error_summary is null or char_length(last_error_summary) between 1 and 500
  ),
  created_at timestamptz not null default statement_timestamp(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  unique (production_run_id, attempt_number, dispatch_key),
  unique (external_request_id),
  unique (workspace_id, id),
  unique (id, workspace_id, production_run_id, attempt_number, shot_number),
  foreign key (workspace_id, production_run_id, episode_id)
    references public.mvp_production_jobs(
      workspace_id, production_run_id, episode_id
    ) on delete restrict,
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  check (
    (state = 'dispatching'
      and claim_token is not null and lease_expires_at is not null
      and external_request_id is null and status_url is null and response_url is null)
    or
    (state <> 'dispatching'
      and claim_token is null and lease_expires_at is null)
  ),
  check (
    (media_kind = 'storyboard' and dispatch_key in (
      'storyboard:' || shot_number::text || ':single',
      'storyboard:' || shot_number::text || ':start',
      'storyboard:' || shot_number::text || ':end'
    ))
    or
    (media_kind = 'clip'
      and dispatch_key = 'clip:' || shot_number::text || ':motion')
  ),
  check (
    (state in ('submitted','succeeded')
      and external_request_id is not null
      and status_url is not null and response_url is not null
      and dispatched_at is not null)
    or
    (state not in ('submitted','succeeded')
      and external_request_id is null
      and status_url is null and response_url is null
      and dispatched_at is null)
  ),
  check (
    state <> 'succeeded'
    or (output_content_sha256 is not null and completed_at is not null
      and last_error_code is null and last_error_summary is null)
  ),
  check (
    state not in ('failed','outcome_unknown')
    or (completed_at is not null
      and last_error_code is not null and last_error_summary is not null)
  ),
  check (
    state not in ('reserved','dispatching','submitted')
    or (completed_at is null and output_content_sha256 is null
      and last_error_code is null and last_error_summary is null)
  ),
  check (
    external_request_id is null
    or external_request_id ~ '^[A-Za-z0-9_-]{6,200}$'
  ),
  check (
    status_url is null
    or (char_length(status_url) between 12 and 2048
      and status_url ~ '^https://queue[.]fal[.]run/'
      and strpos(status_url, '#') = 0)
  ),
  check (
    response_url is null
    or (char_length(response_url) between 12 and 2048
      and response_url ~ '^https://queue[.]fal[.]run/'
      and strpos(response_url, '#') = 0)
  ),
  check (
    external_request_id is null
    or (
      strpos(status_url, '/requests/' || external_request_id) > 0
      and strpos(response_url, '/requests/' || external_request_id) > 0
    )
  ),
  check (
    (dispatched_at is null or dispatched_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
  )
);

alter table private.mvp_media_dispatches enable row level security;
alter table private.mvp_media_dispatches force row level security;
revoke all on private.mvp_media_dispatches
from public, anon, authenticated, service_role;
grant select on private.mvp_media_dispatches to service_role;

create index mvp_media_dispatches_reconcile_idx
on private.mvp_media_dispatches(state, lease_expires_at, created_at);

create or replace view public.mvp_media_dispatch_worker
with (security_invoker = true)
as select * from private.mvp_media_dispatches;
revoke all on public.mvp_media_dispatch_worker
from public, anon, authenticated, service_role;
grant select on public.mvp_media_dispatch_worker to service_role;

alter table private.mvp_storyboard_frames
  add column provider_dispatch_id uuid;
alter table private.mvp_storyboard_frames
  add column provider_dispatch_required boolean not null default false;
alter table private.mvp_storyboard_frames
  alter column provider_dispatch_required set default true;
alter table private.mvp_production_clips
  add column provider_dispatch_id uuid;
alter table private.mvp_production_clips
  add column provider_dispatch_required boolean not null default false;
alter table private.mvp_production_clips
  alter column provider_dispatch_required set default true;
alter table private.mvp_storyboard_frames
  add constraint mvp_storyboard_frames_provider_dispatch_required_check
  check (not provider_dispatch_required or provider_dispatch_id is not null);
alter table private.mvp_production_clips
  add constraint mvp_production_clips_provider_dispatch_required_check
  check (not provider_dispatch_required or provider_dispatch_id is not null);
alter table private.mvp_storyboard_frames
  add constraint mvp_storyboard_frames_provider_dispatch_match_fk
  foreign key (
    provider_dispatch_id, workspace_id, production_run_id,
    attempt_number, shot_number
  ) references private.mvp_media_dispatches(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict;
alter table private.mvp_production_clips
  add constraint mvp_production_clips_provider_dispatch_match_fk
  foreign key (
    provider_dispatch_id, workspace_id, production_run_id,
    attempt_number, shot_number
  ) references private.mvp_media_dispatches(
    id, workspace_id, production_run_id, attempt_number, shot_number
  ) on delete restrict;
create unique index mvp_storyboard_frame_provider_dispatch_uq
on private.mvp_storyboard_frames(provider_dispatch_id)
where provider_dispatch_id is not null;
create unique index mvp_production_clip_provider_dispatch_uq
on private.mvp_production_clips(provider_dispatch_id)
where provider_dispatch_id is not null;

create or replace function private.enforce_mvp_media_dispatch_asset_binding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_row private.mvp_media_dispatches%rowtype;
  expected_key text;
  expected_kind text;
  asset_endpoint text;
begin
  if new.provider_dispatch_id is null then
    if new.provider_dispatch_required then
      raise exception 'provider dispatch evidence is required'
        using errcode = '23514';
    end if;
    return new;
  end if;

  select * into dispatch_row
  from private.mvp_media_dispatches
  where id = new.provider_dispatch_id;
  if not found then
    raise exception 'provider dispatch evidence is unavailable'
      using errcode = '23503';
  end if;

  if tg_table_name = 'mvp_storyboard_frames' then
    expected_kind := 'storyboard';
    expected_key := 'storyboard:' || new.shot_number::text || ':' || new.frame_role;
    asset_endpoint := new.endpoint;
  elsif tg_table_name = 'mvp_production_clips' then
    expected_kind := 'clip';
    expected_key := 'clip:' || new.shot_number::text || ':motion';
    asset_endpoint := new.model_key;
  else
    raise exception 'provider dispatch binding target is invalid'
      using errcode = '23514';
  end if;

  if dispatch_row.workspace_id <> new.workspace_id
    or dispatch_row.production_run_id <> new.production_run_id
    or dispatch_row.attempt_number <> new.attempt_number
    or dispatch_row.shot_number <> new.shot_number
    or dispatch_row.media_kind <> expected_kind
    or dispatch_row.dispatch_key <> expected_key
    or dispatch_row.endpoint <> asset_endpoint
    or dispatch_row.external_request_id is distinct from new.external_request_id
  then
    raise exception 'provider dispatch does not match the exact media asset'
      using errcode = '23514';
  end if;

  if new.state = 'submitted'
    and dispatch_row.state not in ('submitted','succeeded')
  then
    raise exception 'provider dispatch submission evidence is unavailable'
      using errcode = '23514';
  end if;
  if new.state = 'complete' and (
    dispatch_row.state <> 'succeeded'
    or dispatch_row.output_content_sha256 is distinct from new.content_sha256
  ) then
    raise exception 'provider dispatch output does not match the completed asset'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mvp_storyboard_frames_enforce_provider_dispatch
before insert or update of
  provider_dispatch_id,provider_dispatch_required,workspace_id,
  production_run_id,attempt_number,shot_number,frame_role,endpoint,state,
  external_request_id,content_sha256
on private.mvp_storyboard_frames
for each row execute function private.enforce_mvp_media_dispatch_asset_binding();

create trigger mvp_production_clips_enforce_provider_dispatch
before insert or update of
  provider_dispatch_id,provider_dispatch_required,workspace_id,
  production_run_id,attempt_number,shot_number,model_key,state,
  external_request_id,content_sha256
on private.mvp_production_clips
for each row execute function private.enforce_mvp_media_dispatch_asset_binding();

create or replace view public.mvp_storyboard_frame_worker
with (security_invoker = true)
as
select
  id,workspace_id,episode_id,production_run_id,plan_bundle_id,attempt_number,
  shot_number,composition_mode,endpoint,model_key,prompt,system_prompt,
  binding_manifest,state,external_request_id,status_url,response_url,object_name,
  content_sha256,byte_length,media_mime,width,height,last_error_code,
  last_error_summary,created_at,completed_at,frame_role,
  provider_dispatch_id,provider_dispatch_required
from private.mvp_storyboard_frames;
revoke all on public.mvp_storyboard_frame_worker
from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_storyboard_frame_worker
to service_role;

create or replace view public.mvp_production_clip_worker
with (security_invoker = true)
as select * from private.mvp_production_clips;
revoke all on public.mvp_production_clip_worker
from public, anon, authenticated;
grant select, insert, update, delete on public.mvp_production_clip_worker
to service_role;

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
    or p_endpoint !~ '^fal-ai/[A-Za-z0-9._/-]{3,180}$'
    or strpos(p_endpoint, '..') > 0 or strpos(p_endpoint, '//') > 0
    or right(p_endpoint, 1) = '/'
    or p_expected_cost_microusd is null
    or p_expected_cost_microusd not between 0 and 50000000
    or p_maximum_cost_microusd is null
    or p_maximum_cost_microusd not between p_expected_cost_microusd and 50000000
  then
    raise exception 'media dispatch reservation is invalid' using errcode = '22023';
  end if;

  -- Serialize every new liability decision for the run. This both converts a
  -- concurrent duplicate into an idempotent replay and prevents two distinct
  -- shots from independently consuming the same remaining authority.
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
  if aggregate_maximum + p_maximum_cost_microusd > run_hard_ceiling then
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

create or replace function public.command_claim_mvp_media_dispatch(
  p_dispatch_id uuid,
  p_expected_version bigint,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dispatch_row private.mvp_media_dispatches%rowtype;
  next_token uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_expected_version is null
    or p_expected_version < 1 or p_lease_seconds is null
    or p_lease_seconds not between 60 and 900
  then
    raise exception 'media dispatch lease is invalid' using errcode = '22023';
  end if;
  update private.mvp_media_dispatches
  set state = 'dispatching', version = version + 1,
      fencing_token = fencing_token + 1, claim_token = next_token,
      lease_expires_at = statement_timestamp()
        + make_interval(secs => p_lease_seconds),
      last_error_code = null, last_error_summary = null
  where id = p_dispatch_id and state = 'reserved'
    and version = p_expected_version
  returning * into dispatch_row;
  if not found then
    raise exception 'media dispatch claim is stale' using errcode = '40001';
  end if;
  return to_jsonb(dispatch_row);
end;
$$;

create or replace function public.command_record_mvp_media_dispatch_submission(
  p_dispatch_id uuid,
  p_expected_version bigint,
  p_claim_token uuid,
  p_fencing_token bigint,
  p_external_request_id text,
  p_status_url text,
  p_response_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare dispatch_row private.mvp_media_dispatches%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_expected_version is null
    or p_expected_version < 1 or p_claim_token is null
    or p_fencing_token is null or p_fencing_token < 1
    or p_external_request_id is null
    or p_external_request_id !~ '^[A-Za-z0-9_-]{6,200}$'
    or p_status_url is null or p_response_url is null
    or char_length(p_status_url) not between 12 and 2048
    or char_length(p_response_url) not between 12 and 2048
    or p_status_url !~ '^https://queue[.]fal[.]run/'
    or p_response_url !~ '^https://queue[.]fal[.]run/'
    or strpos(p_status_url, '/requests/' || p_external_request_id) = 0
    or strpos(p_response_url, '/requests/' || p_external_request_id) = 0
    or strpos(p_status_url, '#') > 0 or strpos(p_response_url, '#') > 0
  then
    raise exception 'media dispatch submission receipt is invalid'
      using errcode = '22023';
  end if;
  select * into dispatch_row from private.mvp_media_dispatches
  where id = p_dispatch_id for update;
  if dispatch_row.state in ('submitted','succeeded') then
    if dispatch_row.external_request_id = p_external_request_id
      and dispatch_row.status_url = p_status_url
      and dispatch_row.response_url = p_response_url
    then return to_jsonb(dispatch_row); end if;
    raise exception 'media dispatch receipt conflicts with committed submission'
      using errcode = '40001';
  end if;
  update private.mvp_media_dispatches
  set state = 'submitted', version = version + 1,
      claim_token = null, lease_expires_at = null,
      external_request_id = p_external_request_id,
      status_url = p_status_url, response_url = p_response_url,
      dispatched_at = statement_timestamp()
  where id = p_dispatch_id and state = 'dispatching'
    and version = p_expected_version and claim_token = p_claim_token
    and fencing_token = p_fencing_token
    and lease_expires_at > statement_timestamp()
  returning * into dispatch_row;
  if not found then
    raise exception 'media dispatch submission fence is stale'
      using errcode = '40001';
  end if;
  return to_jsonb(dispatch_row);
end;
$$;

create or replace function public.command_fail_mvp_media_dispatch(
  p_dispatch_id uuid,
  p_expected_version bigint,
  p_claim_token uuid,
  p_fencing_token bigint,
  p_outcome_unknown boolean,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare dispatch_row private.mvp_media_dispatches%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_expected_version is null
    or p_expected_version < 1 or p_claim_token is null
    or p_fencing_token is null or p_fencing_token < 1
    or p_outcome_unknown is null or p_error_code is null
    or p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    or p_error_summary is null
    or char_length(btrim(p_error_summary)) not between 1 and 500
  then
    raise exception 'media dispatch failure evidence is invalid'
      using errcode = '22023';
  end if;
  update private.mvp_media_dispatches
  set state = case when p_outcome_unknown then 'outcome_unknown' else 'failed' end,
      version = version + 1, claim_token = null, lease_expires_at = null,
      completed_at = statement_timestamp(),
      last_error_code = p_error_code,
      last_error_summary = left(btrim(p_error_summary), 500)
  where id = p_dispatch_id and state = 'dispatching'
    and version = p_expected_version and claim_token = p_claim_token
    and fencing_token = p_fencing_token
    and lease_expires_at > statement_timestamp()
  returning * into dispatch_row;
  if not found then
    raise exception 'media dispatch failure fence is stale'
      using errcode = '40001';
  end if;
  return to_jsonb(dispatch_row);
end;
$$;

create or replace function public.command_complete_mvp_media_dispatch_output(
  p_dispatch_id uuid,
  p_external_request_id text,
  p_output_content_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare dispatch_row private.mvp_media_dispatches%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_dispatch_id is null or p_external_request_id is null
    or p_external_request_id !~ '^[A-Za-z0-9_-]{6,200}$'
    or p_output_content_sha256 is null
    or p_output_content_sha256 !~ '^[a-f0-9]{64}$'
  then
    raise exception 'media dispatch output evidence is invalid'
      using errcode = '22023';
  end if;
  update private.mvp_media_dispatches
  set state = 'succeeded', version = version + 1,
      output_content_sha256 = p_output_content_sha256,
      completed_at = statement_timestamp(),
      last_error_code = null, last_error_summary = null
  where id = p_dispatch_id and state = 'submitted'
    and external_request_id = p_external_request_id
  returning * into dispatch_row;
  if not found then
    select * into dispatch_row from private.mvp_media_dispatches
    where id = p_dispatch_id and state = 'succeeded'
      and external_request_id = p_external_request_id
      and output_content_sha256 = p_output_content_sha256;
  end if;
  if not found then
    raise exception 'media dispatch output completion is stale'
      using errcode = '40001';
  end if;
  return to_jsonb(dispatch_row);
end;
$$;

revoke all on function public.command_reserve_mvp_media_dispatch(
  uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint
) from public, anon, authenticated;
revoke all on function public.command_claim_mvp_media_dispatch(uuid,bigint,integer)
from public, anon, authenticated;
revoke all on function public.command_record_mvp_media_dispatch_submission(
  uuid,bigint,uuid,bigint,text,text,text
) from public, anon, authenticated;
revoke all on function public.command_fail_mvp_media_dispatch(
  uuid,bigint,uuid,bigint,boolean,text,text
) from public, anon, authenticated;
revoke all on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text
) from public, anon, authenticated;
grant execute on function public.command_reserve_mvp_media_dispatch(
  uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint
) to service_role;
grant execute on function public.command_claim_mvp_media_dispatch(uuid,bigint,integer)
to service_role;
grant execute on function public.command_record_mvp_media_dispatch_submission(
  uuid,bigint,uuid,bigint,text,text,text
) to service_role;
grant execute on function public.command_fail_mvp_media_dispatch(
  uuid,bigint,uuid,bigint,boolean,text,text
) to service_role;
grant execute on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text
) to service_role;

revoke all on function private.enforce_mvp_media_dispatch_asset_binding()
from public, anon, authenticated;

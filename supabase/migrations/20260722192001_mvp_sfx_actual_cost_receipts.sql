-- Convert ElevenLabs' provider-returned character-cost credits through the
-- immutable SFX quote rate. Reused or deliberate-silence cues incur no new
-- provider charge; newly generated cues must retain exact monetary evidence.

alter table private.mvp_production_sfx
  add column actual_cost_required boolean not null default false;
alter table private.mvp_production_sfx
  add column provider_usage_unit_price_microusd bigint;
alter table private.mvp_production_sfx
  add column provider_actual_cost_microusd bigint;
alter table private.mvp_production_sfx
  add column provider_rate_card_version_id uuid
    references private.production_rate_card_versions(id) on delete restrict;
alter table private.mvp_production_sfx
  add column provider_billing_evidence_sha256 text;

alter table private.mvp_production_sfx
  alter column actual_cost_required set default true;
alter table private.mvp_production_sfx
  add constraint mvp_production_sfx_actual_cost_check check(
    (provider_actual_cost_microusd is null
      and provider_usage_unit_price_microusd is null
      and provider_rate_card_version_id is null
      and provider_billing_evidence_sha256 is null)
    or (provider_usage_count is not null
      and provider_usage_unit_price_microusd is not null
      and provider_usage_unit_price_microusd>=0
      and provider_actual_cost_microusd=
        provider_usage_count*provider_usage_unit_price_microusd
      and provider_rate_card_version_id is not null
      and provider_billing_evidence_sha256~'^[a-f0-9]{64}$')
  );
alter table private.mvp_production_sfx
  add constraint mvp_production_sfx_actual_cost_required_check check(
    not actual_cost_required or provider_state<>'succeeded'
    or provider_actual_cost_microusd is not null
  );

create or replace view public.mvp_production_sfx_worker
with (security_invoker = true)
as
select
  id,workspace_id,episode_id,production_run_id,plan_bundle_id,attempt_number,
  shot_number,source_sfx_id,shot_start_ms,shot_end_ms,cue_kind,cue_text,cue_sha256,
  prompt_text,prompt_sha256,provider_payload,payload_sha256,model_contract,
  model_contract_sha256,model_id,output_format,requested_duration_ms,
  start_offset_ms,trim_duration_ms,gain_db,fade_in_ms,fade_out_ms,state,
  version,provider_state,lease_token,lease_expires_at,claimed_at,
  provider_completed_at,provider_response_sha256,provider_usage_count,
  object_name,content_sha256,byte_length,media_mime,generated_duration_ms,
  qc_state,qc_evidence,qc_evidence_sha256,failure_stage,last_error_code,
  last_error_summary,created_at,updated_at,completed_at,actual_cost_required,
  provider_usage_unit_price_microusd,provider_actual_cost_microusd,
  provider_rate_card_version_id,provider_billing_evidence_sha256
from private.mvp_production_sfx;
revoke all on public.mvp_production_sfx_worker
from public,anon,authenticated,service_role;
grant select on public.mvp_production_sfx_worker to service_role;

create or replace function public.command_complete_mvp_sfx(
  p_sfx_id uuid,
  p_lease_token uuid,
  p_expected_version bigint,
  p_provider_response_sha256 text,
  p_provider_usage_count integer,
  p_object_name text,
  p_content_sha256 text,
  p_byte_length bigint,
  p_generated_duration_ms integer,
  p_qc_evidence jsonb,
  p_qc_evidence_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sfx_row private.mvp_production_sfx%rowtype;
  rate_row private.production_rate_card_versions%rowtype;
  qc_hash text;
  billing_hash text;
  complete_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_sfx_id is null or p_lease_token is null or p_expected_version is null
    or p_provider_response_sha256 is null
    or p_provider_response_sha256 !~ '^[a-f0-9]{64}$'
    or p_content_sha256 is null
    or p_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_provider_usage_count is null
    or p_provider_usage_count not between 1 and 9999999
    or p_object_name is null
    or p_byte_length is null or p_byte_length not between 64 and 4194304
    or p_generated_duration_ms is null
    or p_generated_duration_ms not between 500 and 5100
    or p_qc_evidence is null or jsonb_typeof(p_qc_evidence) <> 'object'
    or p_qc_evidence->>'schemaVersion' <> 'genie.mvp-sfx-qc.v1'
    or p_qc_evidence->>'passed' <> 'true'
  then
    raise exception 'MVP SFX completion evidence is invalid'
      using errcode = '22023';
  end if;
  qc_hash := encode(extensions.digest(
    convert_to(p_qc_evidence::text, 'UTF8'), 'sha256'
  ), 'hex');
  if p_qc_evidence_sha256 is distinct from qc_hash then
    raise exception 'MVP SFX QC hash is invalid' using errcode = '22023';
  end if;

  select rate.* into rate_row
  from private.mvp_production_sfx sfx
  join public.production_runs run
    on run.workspace_id=sfx.workspace_id and run.id=sfx.production_run_id
  join public.production_quote_lines line
    on line.workspace_id=run.workspace_id
    and line.production_quote_id=run.production_quote_id
    and line.line_key='sfx_ambience' and line.line_kind='sfx_ambience'
  join private.production_rate_card_versions rate
    on rate.id=line.rate_card_version_id
    and rate.rate_key='sfx_ambience' and rate.unit_name='credit'
  where sfx.id=p_sfx_id;
  if rate_row.id is null then
    raise exception 'MVP SFX billing rate is unavailable' using errcode='23514';
  end if;
  billing_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'providerResponseSha256',p_provider_response_sha256,
    'providerUsageCount',p_provider_usage_count,
    'rateCardVersionId',rate_row.id,
    'unitPriceMicrousd',rate_row.unit_price_microusd,
    'sourceHeader','character-cost')::text,'UTF8'),'sha256'),'hex');

  update private.mvp_production_sfx
  set state = 'complete', provider_state = 'succeeded', version = version + 1,
      lease_token = null, lease_expires_at = null,
      provider_completed_at = statement_timestamp(),
      provider_response_sha256 = p_provider_response_sha256,
      provider_usage_count = p_provider_usage_count,
      provider_usage_unit_price_microusd=rate_row.unit_price_microusd,
      provider_actual_cost_microusd=
        p_provider_usage_count*rate_row.unit_price_microusd,
      provider_rate_card_version_id=rate_row.id,
      provider_billing_evidence_sha256=billing_hash,
      object_name = p_object_name, content_sha256 = p_content_sha256,
      byte_length = p_byte_length, media_mime = 'audio/mpeg',
      generated_duration_ms = p_generated_duration_ms,
      qc_state = 'passed', qc_evidence = p_qc_evidence,
      qc_evidence_sha256 = p_qc_evidence_sha256,
      completed_at = statement_timestamp()
  where id = p_sfx_id and state = 'claimed'
    and version = p_expected_version and lease_token = p_lease_token
    and lease_expires_at > statement_timestamp()
    and trim_duration_ms <= p_generated_duration_ms
  returning * into sfx_row;
  if not found then
    raise exception 'MVP SFX completion lease is stale'
      using errcode = '40001';
  end if;

  select count(*) filter(where state = 'complete')::integer
  into complete_count
  from private.mvp_production_sfx
  where production_run_id = sfx_row.production_run_id
    and attempt_number = sfx_row.attempt_number;

  update public.mvp_production_jobs
  set completed_sfx = complete_count,
      state = case when complete_count = total_sfx
        then 'rendering' else state end,
      version = version + 1
  where production_run_id = sfx_row.production_run_id
    and attempt_number = sfx_row.attempt_number
    and state = 'sound_designing';

  return to_jsonb(sfx_row);
end;
$$;

create or replace function public.get_mvp_episode_actual_costs(
  p_workspace_id uuid
)
returns table(
  episode_id uuid,
  production_run_id uuid,
  currency char(3),
  fal_actual_cost_microusd bigint,
  sfx_actual_cost_microusd bigint,
  total_actual_cost_microusd bigint,
  cost_evidence_complete boolean
)
language plpgsql stable security definer set search_path=''
as $$
declare actor_id uuid:=auth.uid();
begin
  if actor_id is null
    or not private.is_active_member(p_workspace_id,actor_id)
  then raise exception 'active membership required' using errcode='42501'; end if;
  return query
  select run.episode_id,run.id,'USD'::char(3),
    coalesce(fal.actual_cost,0)::bigint,
    coalesce(sfx.actual_cost,0)::bigint,
    (coalesce(fal.actual_cost,0)+coalesce(sfx.actual_cost,0))::bigint,
    coalesce(fal.complete,false) and coalesce(sfx.complete,true)
  from public.production_runs run
  left join lateral(
    select sum(dispatch.actual_cost_microusd)::bigint actual_cost,
      count(*)>0 and not exists(
        select 1 from private.mvp_media_dispatches pending
        where pending.production_run_id=run.id and pending.actual_cost_required
          and (pending.state<>'succeeded' or pending.billing_state<>'reconciled')
      ) complete
    from private.mvp_media_dispatches dispatch
    where dispatch.production_run_id=run.id
      and dispatch.state='succeeded' and dispatch.billing_state='reconciled'
  ) fal on true
  left join lateral(
    select sum(cue.provider_actual_cost_microusd)::bigint actual_cost,
      not exists(
        select 1 from private.mvp_production_sfx pending_sfx
        where pending_sfx.production_run_id=run.id
          and pending_sfx.cue_kind='generated_effect'
          and pending_sfx.provider_state not in ('reused','succeeded')
      ) complete
    from private.mvp_production_sfx cue
    where cue.production_run_id=run.id
      and cue.provider_state='succeeded'
  ) sfx on true
  where run.workspace_id=p_workspace_id
  order by run.created_at desc,run.id;
end;
$$;

revoke all on function public.get_mvp_episode_actual_costs(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_mvp_episode_actual_costs(uuid)
to authenticated;

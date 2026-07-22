-- Bind every completed FAL request to the provider's request-level billing event.
-- The queue response's billable-unit header remains useful usage evidence, but
-- it is not sufficient monetary evidence when account discounts can apply.

alter table private.mvp_media_dispatches
  drop constraint mvp_media_dispatches_cost_evidence_state_check,
  drop constraint mvp_media_dispatches_cost_evidence_required_check;

alter table private.mvp_media_dispatches
  add column provider_billing_event_endpoint_id text,
  add column provider_billing_event_output_units numeric,
  add column provider_billing_event_unit_price_usd numeric,
  add column provider_billing_event_percent_discount numeric,
  add column provider_billing_event_cost_nano_usd bigint,
  add column provider_billing_event_timestamp timestamptz,
  add column provider_billing_event_evidence_sha256 text;

alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_cost_evidence_state_check check(
    (cost_evidence_state='provider_billing_event_recorded'
      and provider_reported_billable_units is not null
      and provider_reported_billable_units>0
      and estimated_unit_price_microusd is not null
      and estimated_unit_price_microusd>=0
      and estimated_cost_microusd=
        ceil(provider_reported_billable_units*estimated_unit_price_microusd)
      and provider_usage_evidence_sha256~'^[a-f0-9]{64}$'
      and provider_billing_event_endpoint_id is not null
      and char_length(provider_billing_event_endpoint_id) between 3 and 200
      and provider_billing_event_output_units=provider_reported_billable_units
      and provider_billing_event_unit_price_usd is not null
      and provider_billing_event_unit_price_usd>=0
      and (provider_billing_event_percent_discount is null
        or provider_billing_event_percent_discount between 0 and 100)
      and provider_billing_event_cost_nano_usd is not null
      and provider_billing_event_cost_nano_usd>=0
      and provider_billing_event_timestamp is not null
      and provider_billing_event_evidence_sha256~'^[a-f0-9]{64}$')
    or (cost_evidence_state='estimated_from_provider_reported_units'
      and provider_reported_billable_units is not null
      and estimated_unit_price_microusd is not null
      and estimated_unit_price_microusd>=0
      and estimated_cost_microusd=
        ceil(provider_reported_billable_units*estimated_unit_price_microusd)
      and provider_usage_evidence_sha256~'^[a-f0-9]{64}$'
      and provider_billing_event_endpoint_id is null
      and provider_billing_event_output_units is null
      and provider_billing_event_unit_price_usd is null
      and provider_billing_event_percent_discount is null
      and provider_billing_event_cost_nano_usd is null
      and provider_billing_event_timestamp is null
      and provider_billing_event_evidence_sha256 is null)
    or (cost_evidence_state='unreconciled'
      and provider_reported_billable_units is null
      and estimated_unit_price_microusd is null
      and estimated_cost_microusd is null
      and provider_usage_evidence_sha256 is null
      and provider_billing_event_endpoint_id is null
      and provider_billing_event_output_units is null
      and provider_billing_event_unit_price_usd is null
      and provider_billing_event_percent_discount is null
      and provider_billing_event_cost_nano_usd is null
      and provider_billing_event_timestamp is null
      and provider_billing_event_evidence_sha256 is null)
    or (cost_evidence_state in ('pending','legacy_unavailable')
      and provider_reported_billable_units is null
      and estimated_unit_price_microusd is null
      and estimated_cost_microusd is null
      and provider_usage_evidence_sha256 is null
      and provider_billing_event_endpoint_id is null
      and provider_billing_event_output_units is null
      and provider_billing_event_unit_price_usd is null
      and provider_billing_event_percent_discount is null
      and provider_billing_event_cost_nano_usd is null
      and provider_billing_event_timestamp is null
      and provider_billing_event_evidence_sha256 is null)
  ),
  add constraint mvp_media_dispatches_cost_evidence_required_check check(
    not cost_evidence_required or state<>'succeeded'
    or cost_evidence_state in (
      'provider_billing_event_recorded',
      'estimated_from_provider_reported_units'
    )
  );

comment on column private.mvp_media_dispatches.provider_billing_event_cost_nano_usd
  is 'Request-level cost reported by the FAL billing-events API in nano-USD; distinct from the locked-rate estimate.';
comment on column private.mvp_media_dispatches.provider_billing_event_evidence_sha256
  is 'SHA-256 of the canonical request-level FAL billing-event receipt.';

revoke all on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text,numeric,text
) from public,anon,authenticated,service_role;
drop function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text,numeric,text
);

create function public.command_complete_mvp_media_dispatch_output(
  p_dispatch_id uuid,
  p_external_request_id text,
  p_output_content_sha256 text,
  p_provider_reported_billable_units numeric,
  p_provider_usage_evidence_sha256 text,
  p_billing_event_endpoint_id text,
  p_billing_event_output_units numeric,
  p_billing_event_unit_price_usd numeric,
  p_billing_event_percent_discount numeric,
  p_billing_event_cost_nano_usd bigint,
  p_billing_event_timestamp timestamptz,
  p_billing_event_evidence_sha256 text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  dispatch_row private.mvp_media_dispatches%rowtype;
  rate_row private.production_rate_card_versions%rowtype;
  estimated_cost bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501'; end if;
  if p_dispatch_id is null or p_external_request_id is null
    or p_external_request_id!~'^[A-Za-z0-9_-]{6,200}$'
    or p_output_content_sha256 is null
    or p_output_content_sha256!~'^[a-f0-9]{64}$'
    or p_provider_reported_billable_units is null
    or p_provider_reported_billable_units<=0
    or p_provider_reported_billable_units>10000
    or scale(p_provider_reported_billable_units)>4
    or p_provider_usage_evidence_sha256 is null
    or p_provider_usage_evidence_sha256!~'^[a-f0-9]{64}$'
    or p_billing_event_endpoint_id is null
    or char_length(p_billing_event_endpoint_id) not between 3 and 200
    or p_billing_event_endpoint_id!~'^[A-Za-z0-9][A-Za-z0-9._/-]+$'
    or p_billing_event_output_units is null
    or p_billing_event_output_units<>p_provider_reported_billable_units
    or p_billing_event_output_units<=0
    or p_billing_event_output_units>10000
    or scale(p_billing_event_output_units)>4
    or p_billing_event_unit_price_usd is null
    or p_billing_event_unit_price_usd<0
    or p_billing_event_unit_price_usd>10000
    or scale(p_billing_event_unit_price_usd)>9
    or (p_billing_event_percent_discount is not null
      and (p_billing_event_percent_discount<0
        or p_billing_event_percent_discount>100
        or scale(p_billing_event_percent_discount)>6))
    or p_billing_event_cost_nano_usd is null
    or p_billing_event_cost_nano_usd<0
    or p_billing_event_timestamp is null
    or p_billing_event_timestamp>statement_timestamp()+interval '5 minutes'
    or p_billing_event_evidence_sha256 is null
    or p_billing_event_evidence_sha256!~'^[a-f0-9]{64}$'
  then raise exception 'media dispatch billing-event evidence is invalid'
    using errcode='22023'; end if;
  select * into dispatch_row from private.mvp_media_dispatches
  where id=p_dispatch_id for update;
  if dispatch_row.id is null
    or dispatch_row.external_request_id is distinct from p_external_request_id
    or dispatch_row.endpoint is distinct from p_billing_event_endpoint_id
  then raise exception 'media dispatch output completion is stale'
    using errcode='40001'; end if;
  select * into rate_row from private.production_rate_card_versions
  where id=dispatch_row.rate_card_version_id;
  if rate_row.id is null then
    raise exception 'media dispatch estimate rate is unavailable'
      using errcode='23514'; end if;
  estimated_cost:=ceil(
    p_provider_reported_billable_units*rate_row.unit_price_microusd
  );
  if dispatch_row.state='succeeded' then
    if dispatch_row.output_content_sha256=p_output_content_sha256
      and dispatch_row.provider_reported_billable_units=
        p_provider_reported_billable_units
      and dispatch_row.estimated_unit_price_microusd=
        rate_row.unit_price_microusd
      and dispatch_row.estimated_cost_microusd=estimated_cost
      and dispatch_row.provider_usage_evidence_sha256=
        p_provider_usage_evidence_sha256
      and dispatch_row.cost_evidence_state=
        'provider_billing_event_recorded'
      and dispatch_row.provider_billing_event_endpoint_id=
        p_billing_event_endpoint_id
      and dispatch_row.provider_billing_event_output_units=
        p_billing_event_output_units
      and dispatch_row.provider_billing_event_unit_price_usd=
        p_billing_event_unit_price_usd
      and dispatch_row.provider_billing_event_percent_discount
        is not distinct from p_billing_event_percent_discount
      and dispatch_row.provider_billing_event_cost_nano_usd=
        p_billing_event_cost_nano_usd
      and dispatch_row.provider_billing_event_timestamp=
        p_billing_event_timestamp
      and dispatch_row.provider_billing_event_evidence_sha256=
        p_billing_event_evidence_sha256
    then return to_jsonb(dispatch_row); end if;
    if dispatch_row.output_content_sha256=p_output_content_sha256
      and dispatch_row.cost_evidence_state=
        'estimated_from_provider_reported_units'
      and dispatch_row.provider_reported_billable_units=
        p_provider_reported_billable_units
      and dispatch_row.estimated_unit_price_microusd=
        rate_row.unit_price_microusd
      and dispatch_row.estimated_cost_microusd=estimated_cost
      and dispatch_row.provider_usage_evidence_sha256=
        p_provider_usage_evidence_sha256
    then
      update private.mvp_media_dispatches set
        cost_evidence_state='provider_billing_event_recorded',
        provider_billing_event_endpoint_id=p_billing_event_endpoint_id,
        provider_billing_event_output_units=p_billing_event_output_units,
        provider_billing_event_unit_price_usd=p_billing_event_unit_price_usd,
        provider_billing_event_percent_discount=p_billing_event_percent_discount,
        provider_billing_event_cost_nano_usd=p_billing_event_cost_nano_usd,
        provider_billing_event_timestamp=p_billing_event_timestamp,
        provider_billing_event_evidence_sha256=p_billing_event_evidence_sha256,
        billing_error_code=null,billing_error_summary=null,version=version+1
      where id=dispatch_row.id returning * into dispatch_row;
      return to_jsonb(dispatch_row);
    end if;
    raise exception 'media dispatch cost evidence conflicts with completion'
      using errcode='40001';
  end if;
  if dispatch_row.state<>'submitted' then
    raise exception 'media dispatch output completion is stale'
      using errcode='40001'; end if;
  update private.mvp_media_dispatches set
    state='succeeded',version=version+1,
    output_content_sha256=p_output_content_sha256,
    cost_evidence_state='provider_billing_event_recorded',
    provider_reported_billable_units=p_provider_reported_billable_units,
    estimated_unit_price_microusd=rate_row.unit_price_microusd,
    estimated_cost_microusd=estimated_cost,
    provider_usage_evidence_sha256=p_provider_usage_evidence_sha256,
    provider_billing_event_endpoint_id=p_billing_event_endpoint_id,
    provider_billing_event_output_units=p_billing_event_output_units,
    provider_billing_event_unit_price_usd=p_billing_event_unit_price_usd,
    provider_billing_event_percent_discount=p_billing_event_percent_discount,
    provider_billing_event_cost_nano_usd=p_billing_event_cost_nano_usd,
    provider_billing_event_timestamp=p_billing_event_timestamp,
    provider_billing_event_evidence_sha256=p_billing_event_evidence_sha256,
    billing_error_code=null,billing_error_summary=null,
    completed_at=statement_timestamp(),last_error_code=null,last_error_summary=null
  where id=dispatch_row.id returning * into dispatch_row;
  return to_jsonb(dispatch_row);
end;
$$;

revoke all on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text,numeric,text,text,numeric,numeric,numeric,bigint,timestamptz,text
) from public,anon,authenticated,service_role;
grant execute on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text,numeric,text,text,numeric,numeric,numeric,bigint,timestamptz,text
) to service_role;

revoke all on function public.get_mvp_episode_costs(uuid)
from public,anon,authenticated,service_role;
drop function public.get_mvp_episode_costs(uuid);

create function public.get_mvp_episode_costs(p_workspace_id uuid)
returns table(
  episode_id uuid,
  production_run_id uuid,
  currency char(3),
  fal_cost_basis text,
  fal_locked_rate_estimate_microusd bigint,
  fal_provider_billing_cost_nano_usd bigint,
  sfx_provider_cost_microusd bigint,
  repair_director_cost_microusd bigint,
  uncosted_repair_director_calls integer,
  cost_evidence_status text,
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
    case
      when not coalesce(fal.complete,true) then 'incomplete'
      when coalesce(fal.event_count,0)>0 then 'provider_billing_events'
      else 'no_fal_spend'
    end,
    coalesce(fal.locked_rate_estimate,0)::bigint,
    coalesce(fal.provider_billing_cost,0)::bigint,
    coalesce(sfx.provider_cost,0)::bigint,
    case when coalesce(repair.call_count,0)=0 then 0::bigint else null end,
    coalesce(repair.call_count,0)::integer,
    case
      when coalesce(repair.call_count,0)>0
        then 'incomplete_uncosted_repair_director'
      when not coalesce(fal.complete,true) or not coalesce(sfx.complete,true)
        then 'incomplete_provider_cost_evidence'
      when coalesce(fal.event_count,0)>0 or coalesce(sfx.costed_count,0)>0
        then 'provider_cost_evidence_recorded'
      else 'no_provider_spend'
    end,
    coalesce(fal.complete,true) and coalesce(sfx.complete,true)
      and coalesce(repair.call_count,0)=0
  from public.production_runs run
  left join lateral(
    select
      sum(dispatch.estimated_cost_microusd) filter(
        where dispatch.state='succeeded'
          and dispatch.cost_evidence_state=
            'provider_billing_event_recorded'
      )::bigint locked_rate_estimate,
      sum(dispatch.provider_billing_event_cost_nano_usd) filter(
        where dispatch.state='succeeded'
          and dispatch.cost_evidence_state=
            'provider_billing_event_recorded'
      )::bigint provider_billing_cost,
      count(*) filter(
        where dispatch.state='succeeded'
          and dispatch.cost_evidence_state=
            'provider_billing_event_recorded'
      )::integer event_count,
      not exists(
        select 1 from private.mvp_media_dispatches pending
        where pending.production_run_id=run.id
          and pending.cost_evidence_required
          and (pending.state<>'succeeded'
            or pending.cost_evidence_state<>
              'provider_billing_event_recorded')
      ) complete
    from private.mvp_media_dispatches dispatch
    where dispatch.production_run_id=run.id
  ) fal on true
  left join lateral(
    select sum(cue.provider_actual_cost_microusd)::bigint provider_cost,
      count(*) filter(where cue.provider_state='succeeded')::integer costed_count,
      not exists(
        select 1 from private.mvp_production_sfx pending_sfx
        where pending_sfx.production_run_id=run.id
          and pending_sfx.cue_kind='generated_effect'
          and pending_sfx.provider_state not in ('reused','succeeded')
      ) complete
    from private.mvp_production_sfx cue
    where cue.production_run_id=run.id and cue.provider_state='succeeded'
  ) sfx on true
  left join lateral(
    select count(*)::integer call_count
    from public.mvp_repair_feedback_grounding_versions evidence
    where evidence.production_run_id=run.id
  ) repair on true
  where run.workspace_id=p_workspace_id
  order by run.created_at desc,run.id;
end;
$$;

revoke all on function public.get_mvp_episode_costs(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_mvp_episode_costs(uuid)
to authenticated;

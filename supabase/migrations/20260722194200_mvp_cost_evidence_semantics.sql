-- FAL reports charged usage units in X-Fal-Billable-Units. Multiplying those
-- units by Genie's locked quote rate is a reproducible estimate, not proof of
-- the provider's final monetary charge. Rename the ledger accordingly and keep
-- repair-director spend visibly incomplete until its OpenAI usage is costed.

alter table private.mvp_media_dispatches
  drop constraint mvp_media_dispatches_actual_cost_check,
  drop constraint mvp_media_dispatches_billing_evidence_check,
  drop constraint mvp_media_dispatches_billing_state_check,
  drop constraint mvp_media_dispatches_actual_cost_required_check;

drop view public.mvp_media_dispatch_worker;

alter table private.mvp_media_dispatches
  rename column billing_state to cost_evidence_state;
alter table private.mvp_media_dispatches
  rename column actual_cost_required to cost_evidence_required;
alter table private.mvp_media_dispatches
  rename column actual_billable_units to provider_reported_billable_units;
alter table private.mvp_media_dispatches
  rename column actual_unit_price_microusd to estimated_unit_price_microusd;
alter table private.mvp_media_dispatches
  rename column actual_cost_microusd to estimated_cost_microusd;
alter table private.mvp_media_dispatches
  rename column billing_evidence_sha256 to provider_usage_evidence_sha256;

update private.mvp_media_dispatches
set cost_evidence_state='estimated_from_provider_reported_units'
where cost_evidence_state='reconciled';

alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_estimated_cost_check check(
    estimated_cost_microusd is null or estimated_cost_microusd>=0
  ),
  add constraint mvp_media_dispatches_provider_usage_evidence_check check(
    provider_usage_evidence_sha256 is null
    or provider_usage_evidence_sha256~'^[a-f0-9]{64}$'
  ),
  add constraint mvp_media_dispatches_cost_evidence_state_check check(
    (cost_evidence_state='estimated_from_provider_reported_units'
      and rate_card_version_id is not null
      and provider_reported_billable_units is not null
      and provider_reported_billable_units>0
      and estimated_unit_price_microusd is not null
      and estimated_unit_price_microusd>=0
      and estimated_cost_microusd=
        ceil(provider_reported_billable_units*estimated_unit_price_microusd)
      and provider_usage_evidence_sha256 is not null
      and billing_error_code is null and billing_error_summary is null)
    or (cost_evidence_state='unreconciled'
      and provider_reported_billable_units is null
      and estimated_unit_price_microusd is null
      and estimated_cost_microusd is null
      and provider_usage_evidence_sha256 is null
      and billing_error_code='PROVIDER_BILLING_UNRECONCILED'
      and char_length(billing_error_summary) between 1 and 500)
    or (cost_evidence_state in ('pending','legacy_unavailable')
      and provider_reported_billable_units is null
      and estimated_unit_price_microusd is null
      and estimated_cost_microusd is null
      and provider_usage_evidence_sha256 is null
      and billing_error_code is null and billing_error_summary is null)
  ),
  add constraint mvp_media_dispatches_cost_evidence_required_check check(
    not cost_evidence_required or state<>'succeeded'
    or cost_evidence_state='estimated_from_provider_reported_units'
  );

comment on column private.mvp_media_dispatches.provider_reported_billable_units
is 'Usage units the FAL response reports as charged via X-Fal-Billable-Units.';
comment on column private.mvp_media_dispatches.estimated_unit_price_microusd
is 'Genie quote rate used for estimation; not a provider monetary-charge receipt.';
comment on column private.mvp_media_dispatches.estimated_cost_microusd
is 'Estimated cost from provider-reported units multiplied by the locked Genie quote rate.';
comment on column private.mvp_media_dispatches.provider_usage_evidence_sha256
is 'Hash binding the provider-reported billable-unit header to the exact result URL.';

create view public.mvp_media_dispatch_worker
with (security_invoker = true)
as select * from private.mvp_media_dispatches;
revoke all on public.mvp_media_dispatch_worker
from public,anon,authenticated,service_role;
grant select on public.mvp_media_dispatch_worker to service_role;

create or replace function private.reconcile_legacy_mvp_media_dispatch_rates()
returns integer language plpgsql security definer set search_path=''
as $$
declare changed integer:=0; step_count integer;
begin
  update private.mvp_media_dispatches dispatch set
    rate_card_version_id=priced.rate_card_version_id,
    cost_evidence_required=true
  from (
    select candidate.id,line.rate_card_version_id
    from private.mvp_media_dispatches candidate
    join public.production_runs run on run.id=candidate.production_run_id
    join public.production_quote_lines line
      on line.production_quote_id=run.production_quote_id
    join public.preflight_provider_request_slots slot
      on slot.id=line.provider_request_slot_id
    where candidate.rate_card_version_id is null
      and candidate.state<>'succeeded' and candidate.media_kind='clip'
      and slot.shot_number=candidate.shot_number and slot.slot_kind='primary'
      and line.expected_amount_microusd=candidate.expected_cost_microusd
      and line.high_amount_microusd=candidate.maximum_cost_microusd
  ) priced where dispatch.id=priced.id;
  get diagnostics step_count=row_count; changed:=changed+step_count;

  update private.mvp_media_dispatches dispatch set
    rate_card_version_id=priced.rate_card_version_id,
    cost_evidence_required=true
  from (
    select candidate.id,line.rate_card_version_id
    from private.mvp_media_dispatches candidate
    join public.production_runs run on run.id=candidate.production_run_id
    join public.production_quote_lines line
      on line.production_quote_id=run.production_quote_id
      and line.line_key='storyboard_generation'
    join private.production_rate_card_versions rate
      on rate.id=line.rate_card_version_id
    where candidate.rate_card_version_id is null
      and candidate.state<>'succeeded' and candidate.media_kind='storyboard'
      and candidate.expected_cost_microusd=ceil(1.525*rate.unit_price_microusd)
      and candidate.maximum_cost_microusd=ceil(1.525*rate.unit_price_microusd)
  ) priced where dispatch.id=priced.id;
  get diagnostics step_count=row_count; changed:=changed+step_count;

  update private.mvp_media_dispatches dispatch set
    rate_card_version_id=authority.storyboard_rate_card_version_id,
    cost_evidence_required=true
  from private.mvp_storyboard_quote_compatibility_authorities authority
  where dispatch.rate_card_version_id is null and dispatch.state<>'succeeded'
    and dispatch.media_kind='storyboard'
    and authority.workspace_id=dispatch.workspace_id
    and authority.production_run_id=dispatch.production_run_id
    and dispatch.expected_cost_microusd=
      authority.per_frame_expected_cost_microusd
    and dispatch.maximum_cost_microusd=
      authority.per_frame_expected_cost_microusd;
  get diagnostics step_count=row_count; changed:=changed+step_count;

  if exists(select 1 from private.mvp_media_dispatches
    where state='submitted' and rate_card_version_id is null)
  then raise exception 'submitted legacy media dispatch rate remains unavailable'
    using errcode='23514'; end if;
  return changed;
end;
$$;

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
  p_provider_usage_evidence_sha256 text
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
  then raise exception 'media dispatch output evidence is invalid'
    using errcode='22023'; end if;
  select * into dispatch_row from private.mvp_media_dispatches
  where id=p_dispatch_id for update;
  if dispatch_row.id is null
    or dispatch_row.external_request_id is distinct from p_external_request_id
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
      and dispatch_row.cost_evidence_state=
        'estimated_from_provider_reported_units'
      and dispatch_row.provider_reported_billable_units=
        p_provider_reported_billable_units
      and dispatch_row.estimated_unit_price_microusd=
        rate_row.unit_price_microusd
      and dispatch_row.estimated_cost_microusd=estimated_cost
      and dispatch_row.provider_usage_evidence_sha256=
        p_provider_usage_evidence_sha256
    then return to_jsonb(dispatch_row); end if;
    raise exception 'media dispatch cost evidence conflicts with completion'
      using errcode='40001';
  end if;
  if dispatch_row.state<>'submitted' then
    raise exception 'media dispatch output completion is stale'
      using errcode='40001'; end if;
  update private.mvp_media_dispatches set
    state='succeeded',version=version+1,
    output_content_sha256=p_output_content_sha256,
    cost_evidence_state='estimated_from_provider_reported_units',
    provider_reported_billable_units=p_provider_reported_billable_units,
    estimated_unit_price_microusd=rate_row.unit_price_microusd,
    estimated_cost_microusd=estimated_cost,
    provider_usage_evidence_sha256=p_provider_usage_evidence_sha256,
    billing_error_code=null,billing_error_summary=null,
    completed_at=statement_timestamp(),last_error_code=null,last_error_summary=null
  where id=dispatch_row.id returning * into dispatch_row;
  return to_jsonb(dispatch_row);
end;
$$;

create or replace function public.command_record_mvp_media_billing_unreconciled(
  p_dispatch_id uuid,p_external_request_id text,p_error_summary text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare dispatch_row private.mvp_media_dispatches%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501'; end if;
  if p_dispatch_id is null or p_external_request_id is null
    or p_external_request_id!~'^[A-Za-z0-9_-]{6,200}$'
    or p_error_summary is null or char_length(p_error_summary) not between 1 and 500
  then raise exception 'media dispatch billing failure is invalid'
    using errcode='22023'; end if;
  update private.mvp_media_dispatches set
    cost_evidence_state='unreconciled',
    billing_error_code='PROVIDER_BILLING_UNRECONCILED',
    billing_error_summary=p_error_summary,version=version+1
  where id=p_dispatch_id and state='submitted'
    and external_request_id=p_external_request_id
    and cost_evidence_state='pending'
  returning * into dispatch_row;
  if not found then
    select * into dispatch_row from private.mvp_media_dispatches
    where id=p_dispatch_id and state='submitted'
      and external_request_id=p_external_request_id
      and cost_evidence_state='unreconciled'
      and billing_error_code='PROVIDER_BILLING_UNRECONCILED'
      and billing_error_summary=p_error_summary;
  end if;
  if not found then raise exception 'media dispatch billing failure is stale'
    using errcode='40001'; end if;
  return to_jsonb(dispatch_row);
end;
$$;

grant execute on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text,numeric,text
) to service_role;

revoke all on function public.get_mvp_episode_actual_costs(uuid)
from public,anon,authenticated,service_role;
drop function public.get_mvp_episode_actual_costs(uuid);

create function public.get_mvp_episode_costs(p_workspace_id uuid)
returns table(
  episode_id uuid,
  production_run_id uuid,
  currency char(3),
  fal_cost_basis text,
  fal_estimated_cost_microusd bigint,
  sfx_estimated_cost_microusd bigint,
  repair_director_cost_microusd bigint,
  known_estimated_cost_microusd bigint,
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
      when not coalesce(fal.complete,true) then 'unreconciled'
      when coalesce(fal.costed_count,0)>0
        then 'estimated_from_provider_reported_units'
      else 'no_fal_spend'
    end,
    coalesce(fal.estimated_cost,0)::bigint,
    coalesce(sfx.estimated_cost,0)::bigint,
    case when coalesce(repair.call_count,0)=0 then 0::bigint else null end,
    (coalesce(fal.estimated_cost,0)+coalesce(sfx.estimated_cost,0))::bigint,
    coalesce(repair.call_count,0)::integer,
    case
      when coalesce(repair.call_count,0)>0
        then 'incomplete_uncosted_repair_director'
      when not coalesce(fal.complete,true) or not coalesce(sfx.complete,true)
        then 'unreconciled'
      when coalesce(fal.costed_count,0)>0 or coalesce(sfx.costed_count,0)>0
        then 'estimated'
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
            'estimated_from_provider_reported_units'
      )::bigint estimated_cost,
      count(*) filter(
        where dispatch.state='succeeded'
          and dispatch.cost_evidence_state=
            'estimated_from_provider_reported_units'
      )::integer costed_count,
      not exists(
        select 1 from private.mvp_media_dispatches pending
        where pending.production_run_id=run.id
          and pending.cost_evidence_required
          and (pending.state<>'succeeded'
            or pending.cost_evidence_state<>
              'estimated_from_provider_reported_units')
      ) complete
    from private.mvp_media_dispatches dispatch
    where dispatch.production_run_id=run.id
  ) fal on true
  left join lateral(
    select sum(cue.provider_actual_cost_microusd)::bigint estimated_cost,
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

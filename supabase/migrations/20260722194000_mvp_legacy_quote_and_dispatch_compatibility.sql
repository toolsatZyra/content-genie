-- Preserve immutable legacy quotes while giving already-authorized runs a
-- separately auditable storyboard-cost authority. Reconcile provider requests
-- that crossed the FAL boundary before rate binding was introduced.

create table private.mvp_storyboard_quote_compatibility_authorities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  production_run_id uuid not null,
  production_quote_id uuid not null,
  plan_bundle_id uuid not null,
  quote_hash text not null check(quote_hash~'^[a-f0-9]{64}$'),
  source_edd_content_sha256 text not null check(
    source_edd_content_sha256~'^[a-f0-9]{64}$'
  ),
  storyboard_rate_card_version_id uuid not null
    references private.production_rate_card_versions(id) on delete restrict,
  storyboard_billing_quantum_count numeric(12,4) not null check(
    storyboard_billing_quantum_count between 1.525 and 610
  ),
  per_frame_expected_cost_microusd bigint not null check(
    per_frame_expected_cost_microusd>=0
  ),
  authorized_attempt_count integer not null check(authorized_attempt_count=20),
  authorized_additional_maximum_microusd bigint not null check(
    authorized_additional_maximum_microusd>=per_frame_expected_cost_microusd
  ),
  authority_reason text not null check(
    authority_reason='legacy_quote_without_storyboard_line'
  ),
  authority_manifest_sha256 text not null unique check(
    authority_manifest_sha256~'^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,production_run_id),
  unique(workspace_id,production_quote_id),
  foreign key(workspace_id,production_run_id)
    references public.production_runs(workspace_id,id) on delete restrict,
  foreign key(workspace_id,production_quote_id)
    references public.production_quotes(workspace_id,id) on delete restrict,
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict
);

create trigger mvp_storyboard_quote_compatibility_authorities_immutable
before update or delete
on private.mvp_storyboard_quote_compatibility_authorities
for each row execute function private.reject_mutation();

revoke all on private.mvp_storyboard_quote_compatibility_authorities
from public,anon,authenticated,service_role;

do $migration$
declare
  legacy record;
  evidence private.provider_evidence_snapshots%rowtype;
  rate_row private.production_rate_card_versions%rowtype;
  required_units numeric;
  next_version integer;
  computed_rate_hash text;
  per_frame_cost bigint;
  compatibility_maximum bigint;
  manifest_hash text;
begin
  for legacy in
    select run.workspace_id,run.id production_run_id,
      quote.id production_quote_id,quote.plan_bundle_id,quote.quote_hash,
      component.payload edd_payload,component.content_hash edd_hash,
      source_rate.pricing_evidence_snapshot_id
    from public.production_runs run
    join public.production_quotes quote
      on quote.workspace_id=run.workspace_id and quote.id=run.production_quote_id
    join public.preflight_plan_bundles bundle
      on bundle.workspace_id=quote.workspace_id and bundle.id=quote.plan_bundle_id
    join public.preflight_plan_component_versions component
      on component.workspace_id=bundle.workspace_id
      and component.id=bundle.edd_version_id
      and component.component_kind='edd'
    join lateral (
      select rate.pricing_evidence_snapshot_id
      from public.production_quote_lines line
      join private.production_rate_card_versions rate
        on rate.id=line.rate_card_version_id
      where line.production_quote_id=quote.id
      order by line.line_number
      limit 1
    ) source_rate on true
    where not exists (
      select 1 from public.production_quote_lines line
      where line.production_quote_id=quote.id
        and line.line_key='storyboard_generation'
    )
  loop
    select * into evidence from private.provider_evidence_snapshots
    where id=legacy.pricing_evidence_snapshot_id;
    select coalesce(sum(case
      when coalesce(shot->>'storyboardCompositionMode','single_frame')=
        'two_state_start_end' then 3.05::numeric
      else 1.525::numeric end),0)
    into required_units
    from jsonb_array_elements(legacy.edd_payload->'shots') shot;
    if evidence.id is null or required_units not between 1.525 and 610 then
      raise exception 'legacy storyboard compatibility evidence is unavailable'
        using errcode='23514';
    end if;
    computed_rate_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
      'rateKey','storyboard_generation','lineKind','provider_storyboard',
      'capabilityVersionId',null,'unitName','billing_quantum',
      'unitPriceMicrousd',80000,'minimumQuantity',0,
      'maximumLineMicrousd',50000000,
      'pricingEvidenceSnapshotId',evidence.id,
      'verifiedAt',evidence.retrieved_at,'expiresAt',evidence.expires_at
    )::text,'UTF8'),'sha256'),'hex');
    select * into rate_row from private.production_rate_card_versions
    where rate_key='storyboard_generation' and rate_hash=computed_rate_hash;
    if rate_row.id is null then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('production-rate:storyboard_generation',0)
      );
      select * into rate_row from private.production_rate_card_versions
      where rate_key='storyboard_generation' and rate_hash=computed_rate_hash;
      if rate_row.id is null then
        select coalesce(max(version_number),0)+1 into next_version
        from private.production_rate_card_versions
        where rate_key='storyboard_generation';
        insert into private.production_rate_card_versions(
          id,rate_key,version_number,line_kind,capability_version_id,currency,
          unit_name,unit_price_microusd,minimum_quantity,maximum_line_microusd,
          mandatory_addon,pricing_evidence_snapshot_id,rate_hash,verified_at,
          expires_at,state
        ) values(
          gen_random_uuid(),'storyboard_generation',next_version,
          'provider_storyboard',null,'USD','billing_quantum',80000,0,50000000,
          true,evidence.id,computed_rate_hash,evidence.retrieved_at,
          evidence.expires_at,'verified'
        ) returning * into rate_row;
      end if;
    end if;
    per_frame_cost:=ceil(1.525*rate_row.unit_price_microusd);
    compatibility_maximum:=ceil(
      required_units*rate_row.unit_price_microusd*20
    );
    manifest_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
      'authorityReason','legacy_quote_without_storyboard_line',
      'authorizedAdditionalMaximumMicrousd',compatibility_maximum,
      'authorizedAttemptCount',20,
      'perFrameExpectedCostMicrousd',per_frame_cost,
      'planBundleId',legacy.plan_bundle_id,
      'productionQuoteId',legacy.production_quote_id,
      'productionRunId',legacy.production_run_id,
      'quoteHash',legacy.quote_hash,
      'sourceEddContentSha256',legacy.edd_hash,
      'storyboardBillingQuantumCount',required_units,
      'storyboardRateCardVersionId',rate_row.id,
      'workspaceId',legacy.workspace_id
    )::text,'UTF8'),'sha256'),'hex');
    insert into private.mvp_storyboard_quote_compatibility_authorities(
      workspace_id,production_run_id,production_quote_id,plan_bundle_id,
      quote_hash,source_edd_content_sha256,storyboard_rate_card_version_id,
      storyboard_billing_quantum_count,per_frame_expected_cost_microusd,
      authorized_attempt_count,authorized_additional_maximum_microusd,
      authority_reason,authority_manifest_sha256
    ) values(
      legacy.workspace_id,legacy.production_run_id,legacy.production_quote_id,
      legacy.plan_bundle_id,legacy.quote_hash,legacy.edd_hash,rate_row.id,
      required_units,per_frame_cost,20,compatibility_maximum,
      'legacy_quote_without_storyboard_line',manifest_hash
    );
  end loop;
end;
$migration$;

create function public.get_mvp_storyboard_cost_authority(
  p_workspace_id uuid,p_production_run_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  run_row public.production_runs%rowtype;
  quote_row public.production_quotes%rowtype;
  line_row public.production_quote_lines%rowtype;
  rate_row private.production_rate_card_versions%rowtype;
  compatibility private.mvp_storyboard_quote_compatibility_authorities%rowtype;
  per_frame_cost bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501'; end if;
  select * into run_row from public.production_runs
  where workspace_id=p_workspace_id and id=p_production_run_id;
  select * into quote_row from public.production_quotes
  where workspace_id=p_workspace_id and id=run_row.production_quote_id;
  select * into line_row from public.production_quote_lines
  where workspace_id=p_workspace_id
    and production_quote_id=quote_row.id
    and line_key='storyboard_generation'
    and line_kind='provider_storyboard';
  if line_row.id is not null then
    select * into rate_row from private.production_rate_card_versions
    where id=line_row.rate_card_version_id;
    per_frame_cost:=ceil(1.525*rate_row.unit_price_microusd);
    if rate_row.id is null or line_row.expected_amount_microusd<per_frame_cost
      or line_row.high_amount_microusd<per_frame_cost
    then raise exception 'immutable storyboard quote authority is invalid'
      using errcode='23514'; end if;
    return jsonb_build_object(
      'expectedCostMicrousd',per_frame_cost,
      'maximumCostMicrousd',per_frame_cost,
      'rateCardVersionId',rate_row.id,
      'source','immutable_quote'
    );
  end if;
  select * into compatibility
  from private.mvp_storyboard_quote_compatibility_authorities authority
  where authority.workspace_id=p_workspace_id
    and authority.production_run_id=p_production_run_id
    and authority.production_quote_id=quote_row.id
    and authority.quote_hash=quote_row.quote_hash;
  if run_row.id is null or quote_row.id is null or compatibility.id is null then
    raise exception 'storyboard cost authority is unavailable'
      using errcode='23514'; end if;
  return jsonb_build_object(
    'expectedCostMicrousd',compatibility.per_frame_expected_cost_microusd,
    'maximumCostMicrousd',compatibility.per_frame_expected_cost_microusd,
    'rateCardVersionId',compatibility.storyboard_rate_card_version_id,
    'source','legacy_quote_compatibility'
  );
end;
$$;

revoke all on function public.get_mvp_storyboard_cost_authority(uuid,uuid)
from public,anon,authenticated;
grant execute on function public.get_mvp_storyboard_cost_authority(uuid,uuid)
to service_role;

create or replace function private.bind_mvp_media_dispatch_rate()
returns trigger language plpgsql security definer set search_path=''
as $$
declare priced record;
begin
  if new.media_kind='clip' then
    select line.rate_card_version_id,line.expected_amount_microusd,
      line.high_amount_microusd into priced
    from public.production_runs run
    join public.production_quote_lines line
      on line.production_quote_id=run.production_quote_id
    join public.preflight_provider_request_slots slot
      on slot.id=line.provider_request_slot_id
    where run.workspace_id=new.workspace_id and run.id=new.production_run_id
      and slot.shot_number=new.shot_number and slot.slot_kind='primary';
    if priced.rate_card_version_id is null
      or priced.expected_amount_microusd<>new.expected_cost_microusd
      or priced.high_amount_microusd<>new.maximum_cost_microusd
    then raise exception 'media dispatch clip rate authority is unavailable'
      using errcode='23514'; end if;
  else
    select line.rate_card_version_id,
      ceil(1.525*rate.unit_price_microusd)::bigint per_frame_cost into priced
    from public.production_runs run
    join public.production_quote_lines line
      on line.production_quote_id=run.production_quote_id
      and line.line_key='storyboard_generation'
    join private.production_rate_card_versions rate
      on rate.id=line.rate_card_version_id
    where run.workspace_id=new.workspace_id and run.id=new.production_run_id;
    if priced.rate_card_version_id is null then
      select authority.storyboard_rate_card_version_id rate_card_version_id,
        authority.per_frame_expected_cost_microusd per_frame_cost into priced
      from private.mvp_storyboard_quote_compatibility_authorities authority
      where authority.workspace_id=new.workspace_id
        and authority.production_run_id=new.production_run_id;
    end if;
    if priced.rate_card_version_id is null
      or new.expected_cost_microusd<>priced.per_frame_cost
      or new.maximum_cost_microusd<>priced.per_frame_cost
    then raise exception 'media dispatch storyboard rate authority is unavailable'
      using errcode='23514'; end if;
  end if;
  new.rate_card_version_id:=priced.rate_card_version_id;
  return new;
end;
$$;

do $migration$
declare
  definition text;
  revised text;
begin
  definition:=pg_get_functiondef(
    'public.command_reserve_mvp_media_dispatch(uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint)'::regprocedure
  );
  revised:=replace(definition,
$old$  if aggregate_maximum + p_maximum_cost_microusd > run_hard_ceiling then
$old$,
$new$  if aggregate_maximum + p_maximum_cost_microusd > run_hard_ceiling +
      coalesce((select authority.authorized_additional_maximum_microusd
        from private.mvp_storyboard_quote_compatibility_authorities authority
        where authority.workspace_id=p_workspace_id
          and authority.production_run_id=p_production_run_id),0)
  then
$new$);
  if revised=definition then
    raise exception 'media dispatch compatibility ceiling patch target was not found'
      using errcode='23514';
  end if;
  execute revised;
end;
$migration$;

create function private.enforce_mvp_legacy_storyboard_compatibility_budget()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  authority private.mvp_storyboard_quote_compatibility_authorities%rowtype;
  run_ceiling bigint;
  storyboard_maximum numeric;
  quoted_media_maximum numeric;
begin
  select * into authority
  from private.mvp_storyboard_quote_compatibility_authorities
  where workspace_id=new.workspace_id and production_run_id=new.production_run_id;
  if authority.id is null then return new; end if;
  select hard_ceiling_microusd into run_ceiling from public.production_runs
  where workspace_id=new.workspace_id and id=new.production_run_id;
  select coalesce(sum(maximum_cost_microusd),0) into storyboard_maximum
  from private.mvp_media_dispatches
  where production_run_id=new.production_run_id and media_kind='storyboard'
    and state in ('reserved','dispatching','submitted','succeeded','outcome_unknown');
  select coalesce(sum(maximum_cost_microusd),0) into quoted_media_maximum
  from private.mvp_media_dispatches
  where production_run_id=new.production_run_id and media_kind<>'storyboard'
    and state in ('reserved','dispatching','submitted','succeeded','outcome_unknown');
  if (new.media_kind='storyboard'
      and storyboard_maximum+new.maximum_cost_microusd>
        authority.authorized_additional_maximum_microusd)
    or (new.media_kind<>'storyboard'
      and quoted_media_maximum+new.maximum_cost_microusd>run_ceiling)
  then raise exception 'legacy media dispatch exceeds its separated authority'
    using errcode='23514'; end if;
  return new;
end;
$$;

create trigger mvp_media_dispatches_legacy_compatibility_budget
before insert on private.mvp_media_dispatches
for each row execute function private.enforce_mvp_legacy_storyboard_compatibility_budget();

create function private.reconcile_legacy_mvp_media_dispatch_rates()
returns integer language plpgsql security definer set search_path=''
as $$
declare changed integer:=0; step_count integer;
begin
  update private.mvp_media_dispatches dispatch set
    rate_card_version_id=priced.rate_card_version_id,
    actual_cost_required=true
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
    actual_cost_required=true
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
    actual_cost_required=true
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

create function public.command_reconcile_legacy_mvp_media_dispatch_rates()
returns integer language plpgsql security definer set search_path=''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501'; end if;
  return private.reconcile_legacy_mvp_media_dispatch_rates();
end;
$$;

select private.reconcile_legacy_mvp_media_dispatch_rates();

revoke all on function
  private.bind_mvp_media_dispatch_rate(),
  private.enforce_mvp_legacy_storyboard_compatibility_budget(),
  private.reconcile_legacy_mvp_media_dispatch_rates(),
  public.command_reconcile_legacy_mvp_media_dispatch_rates()
from public,anon,authenticated;
grant execute on function
  public.command_reconcile_legacy_mvp_media_dispatch_rates()
to service_role;

comment on table private.mvp_storyboard_quote_compatibility_authorities is
  'Immutable separate storyboard spend authority for already-locked runs whose historical quote predates storyboard line pricing; the original quote is never changed.';

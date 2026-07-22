-- Bind the storyboard image workload into the immutable quote and preserve
-- provider-reported billing units as reproducible monetary evidence. A
-- missing billing header is an explicit unreconciled state, never zero cost.

alter table private.production_rate_card_versions
  drop constraint if exists production_rate_card_versions_line_kind_check;
alter table private.production_rate_card_versions
  add constraint production_rate_card_versions_line_kind_check check(line_kind in (
    'provider_clip','provider_storyboard','upscale','narration_master_reuse',
    'score_music','sfx_ambience','qc_judges','render_export','repair_allowance'
  ));
alter table private.production_rate_card_versions
  drop constraint if exists production_rate_card_versions_unit_name_check;
alter table private.production_rate_card_versions
  add constraint production_rate_card_versions_unit_name_check check(unit_name in (
    'billing_quantum','credit','episode','minute','judge_call','render_minute'
  ));
alter table private.production_rate_card_versions
  drop constraint if exists production_rate_card_versions_check;
alter table private.production_rate_card_versions
  add constraint production_rate_card_versions_check check(
    (line_kind='provider_clip' and capability_version_id is not null
      and not mandatory_addon)
    or (line_kind<>'provider_clip' and capability_version_id is null
      and mandatory_addon)
  );

alter table public.production_quote_lines
  drop constraint if exists production_quote_lines_line_kind_check;
alter table public.production_quote_lines
  add constraint production_quote_lines_line_kind_check check(line_kind in (
    'provider_clip','provider_storyboard','upscale','narration_master_reuse',
    'score_music','sfx_ambience','qc_judges','render_export','repair_allowance'
  ));

create or replace function public.command_ensure_production_allowance_rates(
  p_workspace_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  evidence private.provider_evidence_snapshots%rowtype;
  definition record;
  existing private.production_rate_card_versions%rowtype;
  rate_id uuid;
  next_version integer;
  computed_hash text;
  result_value jsonb:='[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select snapshot.* into evidence
    from private.provider_evidence_snapshots snapshot
    join private.provider_accounts account on account.id=snapshot.provider_account_id
    where account.workspace_id=p_workspace_id and account.state='active'
      and snapshot.evidence_kind='pricing'
      and snapshot.verification_state='verified'
      and snapshot.expires_at>statement_timestamp()
    order by snapshot.expires_at desc,snapshot.retrieved_at desc limit 1;
  if evidence.id is null then
    raise exception 'authenticated pricing evidence is unavailable' using errcode='40001';
  end if;
  for definition in select * from (values
    ('upscale','upscale','minute',1200000::bigint,0::numeric,5000000::bigint),
    ('narration_master_reuse','narration_master_reuse','episode',0::bigint,1::numeric,0::bigint),
    ('score_music','score_music','episode',1250000::bigint,1::numeric,2500000::bigint),
    ('sfx_ambience','sfx_ambience','credit',100::bigint,0::numeric,1000000::bigint),
    ('storyboard_generation','provider_storyboard','billing_quantum',80000::bigint,0::numeric,50000000::bigint),
    ('qc_judges','qc_judges','judge_call',250000::bigint,4::numeric,3000000::bigint),
    ('render_export','render_export','render_minute',500000::bigint,1::numeric,1500000::bigint),
    ('repair_allowance','repair_allowance','episode',500000::bigint,1::numeric,1000000::bigint)
  ) as rates(rate_key,line_kind,unit_name,unit_price_microusd,minimum_quantity,maximum_line_microusd)
  loop
    computed_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
      'rateKey',definition.rate_key,'lineKind',definition.line_kind,
      'capabilityVersionId',null,'unitName',definition.unit_name,
      'unitPriceMicrousd',definition.unit_price_microusd,
      'minimumQuantity',definition.minimum_quantity,
      'maximumLineMicrousd',definition.maximum_line_microusd,
      'pricingEvidenceSnapshotId',evidence.id,'verifiedAt',evidence.retrieved_at,
      'expiresAt',evidence.expires_at)::text,'UTF8'),'sha256'),'hex');
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('production-rate:'||definition.rate_key,0));
    select * into existing from private.production_rate_card_versions
      where rate_key=definition.rate_key and rate_hash=computed_hash;
    if existing.id is null then
      select coalesce(max(version_number),0)+1 into next_version
        from private.production_rate_card_versions where rate_key=definition.rate_key;
      rate_id:=gen_random_uuid();
      insert into private.production_rate_card_versions(
        id,rate_key,version_number,line_kind,capability_version_id,currency,
        unit_name,unit_price_microusd,minimum_quantity,maximum_line_microusd,
        mandatory_addon,pricing_evidence_snapshot_id,rate_hash,verified_at,
        expires_at,state
      ) values(rate_id,definition.rate_key,next_version,definition.line_kind,null,
        'USD',definition.unit_name,definition.unit_price_microusd,
        definition.minimum_quantity,definition.maximum_line_microusd,true,
        evidence.id,computed_hash,evidence.retrieved_at,evidence.expires_at,'verified');
    else rate_id:=existing.id; end if;
    result_value:=result_value||jsonb_build_array(jsonb_build_object(
      'rateCardId',rate_id,'rateKey',definition.rate_key,
      'lineKind',definition.line_kind,'unitName',definition.unit_name,
      'unitPriceMicrousd',definition.unit_price_microusd,
      'minimumQuantity',definition.minimum_quantity,
      'maximumLineMicrousd',definition.maximum_line_microusd,
      'rateHash',computed_hash,'expiresAt',evidence.expires_at
    ));
  end loop;
  return result_value;
end;
$$;

create or replace function public.get_production_quote_input(
  p_workspace_id uuid,p_configuration_candidate_id uuid,
  p_allowance_rate_card_ids uuid[]
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  bundle public.preflight_plan_bundles%rowtype;
  consensus private.preflight_plan_qc_consensus%rowtype;
  clock public.narration_master_clock_versions%rowtype;
  quote public.production_quotes%rowtype;
  edd_payload jsonb;
  storyboard_billing_quantum_count numeric;
  slot_value jsonb;
  allowance_value jsonb;
  expiry_value timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into bundle from public.preflight_plan_bundles
    where workspace_id=p_workspace_id
      and configuration_candidate_id=p_configuration_candidate_id
      and state='qc_passed' order by plan_iteration desc limit 1;
  select * into consensus from private.preflight_plan_qc_consensus
    where workspace_id=p_workspace_id and plan_bundle_id=bundle.id
      and verdict='pass';
  select * into clock from public.narration_master_clock_versions
    where workspace_id=p_workspace_id and id=bundle.master_clock_version_id
      and state='verified';
  select component.payload into edd_payload
    from public.preflight_plan_component_versions component
    where component.workspace_id=p_workspace_id
      and component.id=bundle.edd_version_id
      and component.component_kind='edd';
  if jsonb_typeof(edd_payload->'shots')='array' then
    select coalesce(sum(case
      when coalesce(shot->>'storyboardCompositionMode','single_frame')
        = 'two_state_start_end' then 3.05::numeric
      else 1.525::numeric end),0)
    into storyboard_billing_quantum_count
    from jsonb_array_elements(edd_payload->'shots') shot;
  end if;
  select * into quote from public.production_quotes
    where workspace_id=p_workspace_id and configuration_candidate_id=p_configuration_candidate_id
      and plan_bundle_id=bundle.id and expires_at>statement_timestamp()
      and exists(select 1 from public.production_quote_lines line
        where line.production_quote_id=production_quotes.id
          and line.line_key='storyboard_generation'
          and line.line_kind='provider_storyboard')
    order by quote_number desc limit 1;
  select jsonb_agg(jsonb_build_object(
    'slotId',slot.id,'slotKey',slot.slot_key,'slotKind',slot.slot_kind,
    'billingQuantumCount',slot.billing_quantum_count,
    'retainedDurationMs',slot.retained_duration_ms,
    'outputHeight',slot.output_height,'capabilityVersionId',slot.capability_version_id,
    'rateCardId',rate.id,'rateHash',rate.rate_hash,
    'unitPriceMicrousd',rate.unit_price_microusd,'expiresAt',rate.expires_at
  ) order by slot.shot_number,slot.slot_kind,slot.slot_key),min(rate.expires_at)
  into slot_value,expiry_value
  from public.preflight_provider_request_slots slot
  join lateral(select card.* from private.production_rate_card_versions card
    where card.capability_version_id=slot.capability_version_id
      and card.line_kind='provider_clip' and card.state='verified'
      and card.expires_at>statement_timestamp()
    order by card.verified_at desc,card.version_number desc limit 1) rate on true
  where slot.workspace_id=p_workspace_id and slot.plan_bundle_id=bundle.id;
  select jsonb_agg(jsonb_build_object(
    'rateCardId',rate.id,'rateKey',rate.rate_key,'lineKind',rate.line_kind,
    'unitName',rate.unit_name,'unitPriceMicrousd',rate.unit_price_microusd,
    'minimumQuantity',rate.minimum_quantity,
    'maximumLineMicrousd',rate.maximum_line_microusd,
    'rateHash',rate.rate_hash,'expiresAt',rate.expires_at
  ) order by rate.rate_key),least(expiry_value,min(rate.expires_at))
  into allowance_value,expiry_value
  from private.production_rate_card_versions rate
  where rate.id=any(p_allowance_rate_card_ids) and rate.state='verified'
    and rate.mandatory_addon and rate.expires_at>statement_timestamp();
  if bundle.id is null or consensus.id is null or clock.id is null
    or storyboard_billing_quantum_count is null
    or storyboard_billing_quantum_count not between 1.525 and 610
    or jsonb_array_length(coalesce(slot_value,'[]'::jsonb))<1
    or jsonb_array_length(coalesce(slot_value,'[]'::jsonb))<>
      (select count(*) from public.preflight_provider_request_slots slot
        where slot.plan_bundle_id=bundle.id)
    or jsonb_array_length(coalesce(allowance_value,'[]'::jsonb))<>8
    or (select count(distinct value->>'rateKey')
      from jsonb_array_elements(allowance_value))<>8
    or expiry_value<=statement_timestamp()
  then raise exception 'production quote input is incomplete or stale' using errcode='40001'; end if;
  return jsonb_build_object(
    'workspaceId',p_workspace_id,
    'configurationCandidateId',p_configuration_candidate_id,
    'planBundleId',bundle.id,'planHash',bundle.plan_hash,
    'planQcConsensusId',consensus.id,'masterDurationMs',clock.duration_ms,
    'rateExpiresAt',expiry_value,'slots',slot_value,'allowanceRates',allowance_value,
    'storyboardBillingQuantumCount',storyboard_billing_quantum_count,
    'existingQuote',case when quote.id is null then null else jsonb_build_object(
      'quoteId',quote.id,'quoteHash',quote.quote_hash,
      'hardCeilingMicrousd',quote.hard_ceiling_microusd,
      'expiresAt',quote.expires_at) end
  );
end;
$$;

create or replace function private.enforce_storyboard_quote_coverage()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  edd_payload jsonb;
  required_units numeric;
  priced record;
begin
  select component.payload into edd_payload
  from public.preflight_plan_bundles bundle
  join public.preflight_plan_component_versions component
    on component.workspace_id=bundle.workspace_id and component.id=bundle.edd_version_id
  where bundle.workspace_id=new.workspace_id and bundle.id=new.plan_bundle_id;
  if jsonb_typeof(edd_payload->'shots')='array' then
    select coalesce(sum(case
      when coalesce(shot->>'storyboardCompositionMode','single_frame')
        = 'two_state_start_end' then 3.05::numeric
      else 1.525::numeric end),0)
    into required_units from jsonb_array_elements(edd_payload->'shots') shot;
  end if;
  select line.*,rate.unit_price_microusd into priced
  from public.production_quote_lines line
  join private.production_rate_card_versions rate
    on rate.id=line.rate_card_version_id
  where line.workspace_id=new.workspace_id
    and line.production_quote_id=new.id
    and line.line_key='storyboard_generation'
    and line.line_kind='provider_storyboard';
  if required_units is null or required_units not between 1.525 and 610
    or priced.id is null
    or priced.low_quantity<>required_units
    or priced.expected_quantity<>required_units
    or priced.high_quantity<>required_units
    or priced.low_amount_microusd<>ceil(required_units*priced.unit_price_microusd)
    or priced.expected_amount_microusd<>ceil(required_units*priced.unit_price_microusd)
    or priced.high_amount_microusd<>ceil(required_units*priced.unit_price_microusd)
  then
    raise exception 'production quote omits exact storyboard generation cost'
      using errcode='23514';
  end if;
  return null;
end;
$$;

create constraint trigger production_quotes_require_storyboard_cost
after insert on public.production_quotes
deferrable initially deferred
for each row execute function private.enforce_storyboard_quote_coverage();

alter table private.mvp_media_dispatches
  add column rate_card_version_id uuid
    references private.production_rate_card_versions(id) on delete restrict;
alter table private.mvp_media_dispatches
  add column billing_state text not null default 'pending';
alter table private.mvp_media_dispatches
  add column actual_cost_required boolean not null default false;
alter table private.mvp_media_dispatches
  add column actual_billable_units numeric(12,4);
alter table private.mvp_media_dispatches
  add column actual_unit_price_microusd bigint;
alter table private.mvp_media_dispatches
  add column actual_cost_microusd bigint;
alter table private.mvp_media_dispatches
  add column billing_evidence_sha256 text;
alter table private.mvp_media_dispatches
  add column billing_error_code text;
alter table private.mvp_media_dispatches
  add column billing_error_summary text;

update private.mvp_media_dispatches
set billing_state='legacy_unavailable'
where state='succeeded';
alter table private.mvp_media_dispatches
  alter column actual_cost_required set default true;
alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_actual_cost_check check(
    actual_cost_microusd is null or actual_cost_microusd>=0
  );
alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_billing_evidence_check check(
    billing_evidence_sha256 is null
    or billing_evidence_sha256~'^[a-f0-9]{64}$'
  );
alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_billing_error_code_check check(
    billing_error_code is null or billing_error_code='PROVIDER_BILLING_UNRECONCILED'
  );
alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_billing_state_check check(
    (billing_state='reconciled'
      and rate_card_version_id is not null
      and actual_billable_units is not null and actual_billable_units>0
      and actual_unit_price_microusd is not null and actual_unit_price_microusd>=0
      and actual_cost_microusd=ceil(actual_billable_units*actual_unit_price_microusd)
      and billing_evidence_sha256 is not null
      and billing_error_code is null and billing_error_summary is null)
    or (billing_state='unreconciled'
      and actual_billable_units is null and actual_unit_price_microusd is null
      and actual_cost_microusd is null and billing_evidence_sha256 is null
      and billing_error_code='PROVIDER_BILLING_UNRECONCILED'
      and char_length(billing_error_summary) between 1 and 500)
    or (billing_state in ('pending','legacy_unavailable')
      and actual_billable_units is null and actual_unit_price_microusd is null
      and actual_cost_microusd is null and billing_evidence_sha256 is null
      and billing_error_code is null and billing_error_summary is null)
  );
alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_actual_cost_required_check check(
    not actual_cost_required or state<>'succeeded' or billing_state='reconciled'
  );

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
    select line.rate_card_version_id,rate.unit_price_microusd into priced
    from public.production_runs run
    join public.production_quote_lines line
      on line.production_quote_id=run.production_quote_id
      and line.line_key='storyboard_generation'
    join private.production_rate_card_versions rate
      on rate.id=line.rate_card_version_id
    where run.workspace_id=new.workspace_id and run.id=new.production_run_id;
    if priced.rate_card_version_id is null
      or new.expected_cost_microusd<>ceil(1.525*priced.unit_price_microusd)
      or new.maximum_cost_microusd<>ceil(1.525*priced.unit_price_microusd)
    then raise exception 'media dispatch storyboard rate authority is unavailable'
      using errcode='23514'; end if;
  end if;
  new.rate_card_version_id:=priced.rate_card_version_id;
  return new;
end;
$$;

create trigger mvp_media_dispatches_bind_rate
before insert on private.mvp_media_dispatches
for each row execute function private.bind_mvp_media_dispatch_rate();

create or replace view public.mvp_media_dispatch_worker
with (security_invoker = true)
as select * from private.mvp_media_dispatches;
revoke all on public.mvp_media_dispatch_worker
from public, anon, authenticated, service_role;
grant select on public.mvp_media_dispatch_worker to service_role;

revoke all on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text
) from public,anon,authenticated,service_role;
drop function public.command_complete_mvp_media_dispatch_output(uuid,text,text);

create function public.command_complete_mvp_media_dispatch_output(
  p_dispatch_id uuid,
  p_external_request_id text,
  p_output_content_sha256 text,
  p_actual_billable_units numeric,
  p_billing_evidence_sha256 text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  dispatch_row private.mvp_media_dispatches%rowtype;
  rate_row private.production_rate_card_versions%rowtype;
  actual_cost bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode='42501'; end if;
  if p_dispatch_id is null or p_external_request_id is null
    or p_external_request_id!~'^[A-Za-z0-9_-]{6,200}$'
    or p_output_content_sha256 is null
    or p_output_content_sha256!~'^[a-f0-9]{64}$'
    or p_actual_billable_units is null
    or p_actual_billable_units<=0 or p_actual_billable_units>10000
    or scale(p_actual_billable_units)>4
    or p_billing_evidence_sha256 is null
    or p_billing_evidence_sha256!~'^[a-f0-9]{64}$'
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
    raise exception 'media dispatch billing rate is unavailable'
      using errcode='23514'; end if;
  actual_cost:=ceil(p_actual_billable_units*rate_row.unit_price_microusd);
  if dispatch_row.state='succeeded' then
    if dispatch_row.output_content_sha256=p_output_content_sha256
      and dispatch_row.billing_state='reconciled'
      and dispatch_row.actual_billable_units=p_actual_billable_units
      and dispatch_row.actual_unit_price_microusd=rate_row.unit_price_microusd
      and dispatch_row.actual_cost_microusd=actual_cost
      and dispatch_row.billing_evidence_sha256=p_billing_evidence_sha256
    then return to_jsonb(dispatch_row); end if;
    raise exception 'media dispatch billing evidence conflicts with completion'
      using errcode='40001';
  end if;
  if dispatch_row.state<>'submitted' then
    raise exception 'media dispatch output completion is stale'
      using errcode='40001'; end if;
  update private.mvp_media_dispatches set
    state='succeeded',version=version+1,
    output_content_sha256=p_output_content_sha256,
    billing_state='reconciled',actual_billable_units=p_actual_billable_units,
    actual_unit_price_microusd=rate_row.unit_price_microusd,
    actual_cost_microusd=actual_cost,
    billing_evidence_sha256=p_billing_evidence_sha256,
    billing_error_code=null,billing_error_summary=null,
    completed_at=statement_timestamp(),last_error_code=null,last_error_summary=null
  where id=dispatch_row.id returning * into dispatch_row;
  return to_jsonb(dispatch_row);
end;
$$;

create function public.command_record_mvp_media_billing_unreconciled(
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
    billing_state='unreconciled',billing_error_code='PROVIDER_BILLING_UNRECONCILED',
    billing_error_summary=p_error_summary,version=version+1
  where id=p_dispatch_id and state='submitted'
    and external_request_id=p_external_request_id
    and billing_state='pending'
  returning * into dispatch_row;
  if not found then
    select * into dispatch_row from private.mvp_media_dispatches
    where id=p_dispatch_id and state='submitted'
      and external_request_id=p_external_request_id
      and billing_state='unreconciled'
      and billing_error_code='PROVIDER_BILLING_UNRECONCILED'
      and billing_error_summary=p_error_summary;
  end if;
  if not found then raise exception 'media dispatch billing failure is stale'
    using errcode='40001'; end if;
  return to_jsonb(dispatch_row);
end;
$$;

revoke all on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text,numeric,text
),public.command_record_mvp_media_billing_unreconciled(uuid,text,text)
from public,anon,authenticated;
grant execute on function public.command_complete_mvp_media_dispatch_output(
  uuid,text,text,numeric,text
),public.command_record_mvp_media_billing_unreconciled(uuid,text,text)
to service_role;

revoke all on function private.enforce_storyboard_quote_coverage(),
  private.bind_mvp_media_dispatch_rate()
from public,anon,authenticated;

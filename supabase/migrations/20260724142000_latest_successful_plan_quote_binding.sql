-- A configuration can have several Preflight runs, and each run restarts its
-- bounded plan iteration at one. Quote preparation must follow the same
-- newest-plan ordering used by World Lock instead of comparing iteration
-- numbers across different runs.

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
      and state='qc_passed'
    order by created_at desc,id desc limit 1;
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


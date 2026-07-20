-- Quote compilation reads only the passed immutable plan, exact request slots,
-- authenticated production rates, and a conservative versioned allowance
-- schedule. This creates no spend authority; confirmation and reservation
-- remain separated until the atomic World Lock command.

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
    ('sfx_ambience','sfx_ambience','episode',500000::bigint,1::numeric,1000000::bigint),
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
  select * into quote from public.production_quotes
    where workspace_id=p_workspace_id and configuration_candidate_id=p_configuration_candidate_id
      and plan_bundle_id=bundle.id and expires_at>statement_timestamp()
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
    or jsonb_array_length(coalesce(slot_value,'[]'::jsonb))<1
    or jsonb_array_length(coalesce(slot_value,'[]'::jsonb))<>
      (select count(*) from public.preflight_provider_request_slots slot
        where slot.plan_bundle_id=bundle.id)
    or jsonb_array_length(coalesce(allowance_value,'[]'::jsonb))<>7
    or (select count(distinct value->>'rateKey')
      from jsonb_array_elements(allowance_value))<>7
    or expiry_value<=statement_timestamp()
  then raise exception 'production quote input is incomplete or stale' using errcode='40001'; end if;
  return jsonb_build_object(
    'workspaceId',p_workspace_id,
    'configurationCandidateId',p_configuration_candidate_id,
    'planBundleId',bundle.id,'planHash',bundle.plan_hash,
    'planQcConsensusId',consensus.id,'masterDurationMs',clock.duration_ms,
    'rateExpiresAt',expiry_value,'slots',slot_value,'allowanceRates',allowance_value,
    'existingQuote',case when quote.id is null then null else jsonb_build_object(
      'quoteId',quote.id,'quoteHash',quote.quote_hash,
      'hardCeilingMicrousd',quote.hard_ceiling_microusd,
      'expiresAt',quote.expires_at) end
  );
end;
$$;

create or replace function public.prepare_production_quote(
  p_workspace_id uuid,p_configuration_candidate_id uuid,p_plan_bundle_id uuid,
  p_hard_ceiling_microusd bigint,p_expires_at timestamptz,p_lines jsonb
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare
  bundle public.preflight_plan_bundles%rowtype;
  computed_rate_snapshot_hash text;
  computed_quote_hash text;
  rate_expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into bundle from public.preflight_plan_bundles
    where id=p_plan_bundle_id and workspace_id=p_workspace_id
      and configuration_candidate_id=p_configuration_candidate_id
      and state='qc_passed';
  if bundle.id is null or p_lines is null or jsonb_typeof(p_lines)<>'array'
    or jsonb_array_length(p_lines) not between 8 and 3000
    or p_hard_ceiling_microusd not between 0 and 50000000
    or p_expires_at<=statement_timestamp()
  then raise exception 'production quote preparation is invalid' using errcode='40001'; end if;
  select encode(extensions.digest(convert_to(
    string_agg(card.id::text||':'||card.rate_hash,'|' order by card.id),
    'UTF8'),'sha256'),'hex'),min(card.expires_at)
  into computed_rate_snapshot_hash,rate_expiry
  from (select distinct (value->>'rateCardId')::uuid id
    from jsonb_array_elements(p_lines)) requested
  join private.production_rate_card_versions card on card.id=requested.id
  join private.provider_evidence_snapshots evidence
    on evidence.id=card.pricing_evidence_snapshot_id
  where card.state='verified' and card.expires_at>statement_timestamp()
    and evidence.verification_state='verified' and evidence.expires_at>=p_expires_at;
  computed_quote_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'planHash',bundle.plan_hash,'rateSnapshotHash',computed_rate_snapshot_hash,
    'hardCeilingMicrousd',p_hard_ceiling_microusd,'expiresAt',p_expires_at,
    'lines',p_lines)::text,'UTF8'),'sha256'),'hex');
  if computed_rate_snapshot_hash is null or p_expires_at>rate_expiry
  then raise exception 'production quote rate evidence is stale' using errcode='40001'; end if;
  return jsonb_build_object('rateSnapshotHash',computed_rate_snapshot_hash,
    'quoteHash',computed_quote_hash,'rateExpiresAt',rate_expiry);
end;
$$;

revoke all on function public.command_ensure_production_allowance_rates(uuid),
  public.get_production_quote_input(uuid,uuid,uuid[]),
  public.prepare_production_quote(uuid,uuid,uuid,bigint,timestamptz,jsonb)
from public,anon,authenticated;
grant execute on function public.command_ensure_production_allowance_rates(uuid),
  public.get_production_quote_input(uuid,uuid,uuid[]),
  public.prepare_production_quote(uuid,uuid,uuid,bigint,timestamptz,jsonb)
to service_role;

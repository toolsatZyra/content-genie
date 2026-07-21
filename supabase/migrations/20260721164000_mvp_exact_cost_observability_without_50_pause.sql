-- The owner-operated developer MVP keeps exact quotes, reservations, and
-- append-only settlement evidence, but does not pause at an arbitrary USD 50
-- threshold. These are monetary-integrity constraints, not a new spending cap.

alter table public.production_quotes
  drop constraint if exists production_quotes_hard_ceiling_microusd_check;
alter table public.production_quotes
  add constraint production_quotes_hard_ceiling_microusd_check
  check (hard_ceiling_microusd >= high_total_microusd);

alter table public.production_quote_confirmations
  drop constraint if exists production_quote_confirmations_hard_ceiling_microusd_check;
alter table public.production_quote_confirmations
  add constraint production_quote_confirmations_hard_ceiling_microusd_check
  check (hard_ceiling_microusd >= 0);

alter table private.production_budget_authorizations
  drop constraint if exists production_budget_authorizations_authorized_high_microusd_check;
alter table private.production_budget_authorizations
  add constraint production_budget_authorizations_authorized_high_microusd_check
  check (authorized_high_microusd >= 0);
alter table private.production_budget_authorizations
  drop constraint if exists production_budget_authorizations_hard_ceiling_microusd_check;
alter table private.production_budget_authorizations
  add constraint production_budget_authorizations_hard_ceiling_microusd_check
  check (hard_ceiling_microusd >= authorized_high_microusd);

alter table private.production_budget_reservations
  drop constraint if exists production_budget_reservations_reserved_microusd_check;
alter table private.production_budget_reservations
  add constraint production_budget_reservations_reserved_microusd_check
  check (reserved_microusd >= 0);

alter table public.production_runs
  drop constraint if exists production_runs_authorized_high_microusd_check;
alter table public.production_runs
  add constraint production_runs_authorized_high_microusd_check
  check (authorized_high_microusd >= 0);
alter table public.production_runs
  drop constraint if exists production_runs_hard_ceiling_microusd_check;
alter table public.production_runs
  add constraint production_runs_hard_ceiling_microusd_check
  check (hard_ceiling_microusd >= authorized_high_microusd);

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
    or p_hard_ceiling_microusd<0
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

create or replace function public.command_record_production_quote(
  p_quote_id uuid,p_workspace_id uuid,p_configuration_candidate_id uuid,
  p_plan_bundle_id uuid,p_plan_qc_consensus_id uuid,p_quote_hash text,
  p_rate_snapshot_hash text,p_hard_ceiling_microusd bigint,p_expires_at timestamptz,
  p_lines jsonb
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  bundle public.preflight_plan_bundles%rowtype;
  consensus private.preflight_plan_qc_consensus%rowtype;
  quote_number_value integer;
  line jsonb;
  line_number_value integer:=0;
  rate private.production_rate_card_versions%rowtype;
  slot public.preflight_provider_request_slots%rowtype;
  low_quantity_value numeric;
  expected_quantity_value numeric;
  high_quantity_value numeric;
  low_amount_value bigint;
  expected_amount_value bigint;
  high_amount_value bigint;
  low_total_value bigint:=0;
  expected_total_value bigint:=0;
  high_total_value bigint:=0;
  computed_rate_snapshot_hash text;
  computed_quote_hash text;
  rate_expiry timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into bundle from public.preflight_plan_bundles
    where id=p_plan_bundle_id and workspace_id=p_workspace_id
      and configuration_candidate_id=p_configuration_candidate_id;
  select * into consensus from private.preflight_plan_qc_consensus
    where id=p_plan_qc_consensus_id and workspace_id=p_workspace_id
      and plan_bundle_id=p_plan_bundle_id;
  if bundle.id is null or consensus.id is null or consensus.verdict<>'pass'
    or p_lines is null or jsonb_typeof(p_lines)<>'array'
    or jsonb_array_length(p_lines) not between 8 and 3000
    or p_hard_ceiling_microusd<0
    or p_expires_at<=statement_timestamp()
    or (select count(distinct value->>'lineKey') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines)
  then raise exception 'production quote envelope is invalid' using errcode='40001'; end if;

  select encode(extensions.digest(convert_to(string_agg(card.id::text||':'||card.rate_hash,'|' order by card.id),'UTF8'),'sha256'),'hex'),
    min(card.expires_at)
  into computed_rate_snapshot_hash,rate_expiry
  from (select distinct (value->>'rateCardId')::uuid id from jsonb_array_elements(p_lines)) requested
  join private.production_rate_card_versions card on card.id=requested.id
  join private.provider_evidence_snapshots evidence on evidence.id=card.pricing_evidence_snapshot_id
  where card.state='verified' and card.expires_at>statement_timestamp()
    and evidence.verification_state='verified' and evidence.expires_at>=p_expires_at;
  computed_quote_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'planHash',bundle.plan_hash,'rateSnapshotHash',computed_rate_snapshot_hash,
    'hardCeilingMicrousd',p_hard_ceiling_microusd,'expiresAt',p_expires_at,
    'lines',p_lines)::text,'UTF8'),'sha256'),'hex');
  if computed_rate_snapshot_hash is null or computed_rate_snapshot_hash is distinct from p_rate_snapshot_hash
    or computed_quote_hash is distinct from p_quote_hash or p_expires_at>rate_expiry
  then raise exception 'production quote rate evidence is stale or ambiguous' using errcode='40001'; end if;

  select coalesce(sum((value->>'lowAmountMicrousd')::bigint),0),
    coalesce(sum((value->>'expectedAmountMicrousd')::bigint),0),
    coalesce(sum((value->>'highAmountMicrousd')::bigint),0)
  into low_total_value,expected_total_value,high_total_value
  from jsonb_array_elements(p_lines);
  if low_total_value<0 or expected_total_value<low_total_value
    or high_total_value<expected_total_value or high_total_value>p_hard_ceiling_microusd
  then raise exception 'production quote totals exceed the approved ceiling' using errcode='40001'; end if;

  select coalesce(max(quote_number),0)+1 into quote_number_value
    from public.production_quotes where configuration_candidate_id=p_configuration_candidate_id;
  insert into public.production_quotes(
    id,workspace_id,configuration_candidate_id,plan_bundle_id,plan_qc_consensus_id,
    quote_number,quote_hash,rate_snapshot_hash,currency,low_total_microusd,
    expected_total_microusd,high_total_microusd,hard_ceiling_microusd,
    target_40usd_breached,expires_at
  ) values(p_quote_id,p_workspace_id,p_configuration_candidate_id,p_plan_bundle_id,
    p_plan_qc_consensus_id,quote_number_value,p_quote_hash,p_rate_snapshot_hash,'USD',
    low_total_value,expected_total_value,high_total_value,p_hard_ceiling_microusd,
    expected_total_value>40000000,p_expires_at);

  for line in select value from jsonb_array_elements(p_lines) loop
    line_number_value:=line_number_value+1;
    if jsonb_typeof(line)<>'object'
      or (line-array['lineId','lineKey','lineKind','slotId','rateCardId','lowQuantity','expectedQuantity','highQuantity','lowAmountMicrousd','expectedAmountMicrousd','highAmountMicrousd','evidenceHash']::text[])<>'{}'::jsonb
      or not(line?&array['lineId','lineKey','lineKind','slotId','rateCardId','lowQuantity','expectedQuantity','highQuantity','lowAmountMicrousd','expectedAmountMicrousd','highAmountMicrousd','evidenceHash'])
    then raise exception 'production quote line is not exact' using errcode='22023'; end if;
    select * into rate from private.production_rate_card_versions
      where id=(line->>'rateCardId')::uuid and state='verified' and expires_at>=p_expires_at;
    select * into slot from public.preflight_provider_request_slots
      where id=nullif(line->>'slotId','')::uuid and workspace_id=p_workspace_id
        and plan_bundle_id=p_plan_bundle_id;
    low_quantity_value:=(line->>'lowQuantity')::numeric;
    expected_quantity_value:=(line->>'expectedQuantity')::numeric;
    high_quantity_value:=(line->>'highQuantity')::numeric;
    low_amount_value:=(line->>'lowAmountMicrousd')::bigint;
    expected_amount_value:=(line->>'expectedAmountMicrousd')::bigint;
    high_amount_value:=(line->>'highAmountMicrousd')::bigint;
    if rate.id is null or rate.line_kind<>line->>'lineKind'
      or low_quantity_value<0 or expected_quantity_value<low_quantity_value
      or high_quantity_value<expected_quantity_value or high_quantity_value<rate.minimum_quantity
      or low_amount_value<>ceil(low_quantity_value*rate.unit_price_microusd)
      or expected_amount_value<>ceil(expected_quantity_value*rate.unit_price_microusd)
      or high_amount_value<>ceil(high_quantity_value*rate.unit_price_microusd)
      or high_amount_value>rate.maximum_line_microusd
      or line->>'evidenceHash' is distinct from encode(extensions.digest(convert_to(
        rate.rate_hash||':'||low_quantity_value::text||':'||expected_quantity_value::text||':'||high_quantity_value::text,
        'UTF8'),'sha256'),'hex')
      or (rate.line_kind='provider_clip' and (
        slot.id is null or rate.capability_version_id<>slot.capability_version_id
        or high_quantity_value<>slot.billing_quantum_count
        or low_quantity_value<>case when slot.slot_kind='primary' then slot.billing_quantum_count else 0 end
        or expected_quantity_value<>case slot.slot_kind
          when 'primary' then slot.billing_quantum_count when 'candidate' then slot.billing_quantum_count
          when 'retry' then slot.billing_quantum_count*0.35 else slot.billing_quantum_count*0.15 end))
      or (rate.line_kind<>'provider_clip' and (slot.id is not null or line->>'lineKey'<>rate.rate_key))
    then raise exception 'production quote line math or binding is invalid' using errcode='40001'; end if;
    insert into public.production_quote_lines(
      id,workspace_id,production_quote_id,line_number,line_key,line_kind,
      provider_request_slot_id,rate_card_version_id,low_quantity,expected_quantity,
      high_quantity,low_amount_microusd,expected_amount_microusd,
      high_amount_microusd,evidence_hash
    ) values((line->>'lineId')::uuid,p_workspace_id,p_quote_id,line_number_value,
      line->>'lineKey',line->>'lineKind',slot.id,rate.id,low_quantity_value,
      expected_quantity_value,high_quantity_value,low_amount_value,
      expected_amount_value,high_amount_value,line->>'evidenceHash');
  end loop;

  if exists(select 1 from public.preflight_provider_request_slots planned
      where planned.plan_bundle_id=p_plan_bundle_id and not exists(
        select 1 from public.production_quote_lines priced
        where priced.production_quote_id=p_quote_id and priced.provider_request_slot_id=planned.id))
    or (select count(*) from public.production_quote_lines where production_quote_id=p_quote_id and line_kind='provider_clip')<>
       (select count(*) from public.preflight_provider_request_slots where plan_bundle_id=p_plan_bundle_id)
    or exists(select 1 from unnest(array['upscale','narration_master_reuse','score_music','sfx_ambience','qc_judges','render_export','repair_allowance']) required(rate_key)
      where not exists(select 1 from public.production_quote_lines line
        where line.production_quote_id=p_quote_id and line.line_key=required.rate_key))
    or high_total_value>p_hard_ceiling_microusd
  then raise exception 'production quote omits the full high envelope or exceeds its ceiling' using errcode='40001'; end if;

  return p_quote_id;
end;
$$;

create or replace function public.command_start_mvp_production(
  p_workspace_id uuid,
  p_production_run_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.production_runs%rowtype;
  plan_id uuid;
  narration_id uuid;
  job_row public.mvp_production_jobs%rowtype;
begin
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  select * into run_row from public.production_runs
  where workspace_id = p_workspace_id and id = p_production_run_id;
  if not found then
    raise exception 'production authority unavailable' using errcode = '42501';
  end if;
  select quote.plan_bundle_id, clock.narration_asset_version_id
  into plan_id, narration_id
  from public.production_quotes quote
  join public.preflight_plan_bundles bundle
    on bundle.workspace_id = quote.workspace_id and bundle.id = quote.plan_bundle_id
  join public.narration_master_clock_versions clock
    on clock.workspace_id = bundle.workspace_id and clock.id = bundle.master_clock_version_id
  where quote.workspace_id = p_workspace_id and quote.id = run_row.production_quote_id
    and bundle.state = 'qc_passed' and clock.state = 'verified';
  if plan_id is null or narration_id is null then
    raise exception 'locked production inputs unavailable' using errcode = '23514';
  end if;
  insert into public.mvp_production_jobs(
    production_run_id, workspace_id, episode_id, plan_bundle_id,
    narration_asset_version_id, state
  ) values(
    run_row.id, p_workspace_id, run_row.episode_id, plan_id, narration_id, 'queued'
  ) on conflict(production_run_id) do nothing;
  select * into job_row from public.mvp_production_jobs
  where production_run_id = run_row.id;
  update public.production_run_statuses
  set state = case when state = 'authorized' then 'queued' else state end,
      version = case when state = 'authorized' then version + 1 else version end,
      changed_at = case when state = 'authorized' then statement_timestamp() else changed_at end
  where production_run_id = run_row.id;
  return jsonb_build_object(
    'productionRunId', job_row.production_run_id,
    'state', job_row.state,
    'version', job_row.version
  );
end;
$$;

revoke all on function public.prepare_production_quote(uuid,uuid,uuid,bigint,timestamptz,jsonb)
  from public,anon,authenticated;
revoke all on function public.command_record_production_quote(uuid,uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb)
  from public,anon,authenticated;
grant execute on function public.prepare_production_quote(uuid,uuid,uuid,bigint,timestamptz,jsonb)
  to service_role;
grant execute on function public.command_record_production_quote(uuid,uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb)
  to service_role;

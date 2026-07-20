-- Exact, user-confirmed production quote. This migration deliberately creates
-- no production authorization or reservation: those exist only inside the
-- atomic World Lock command.

create table private.production_rate_card_versions (
  id uuid primary key,
  rate_key text not null check(rate_key~'^[a-z][a-z0-9_.:-]{2,140}$'),
  version_number integer not null check(version_number>0),
  line_kind text not null check(line_kind in (
    'provider_clip','upscale','narration_master_reuse','score_music',
    'sfx_ambience','qc_judges','render_export','repair_allowance'
  )),
  capability_version_id uuid references private.production_provider_capability_versions(id) on delete restrict,
  currency char(3) not null check(currency='USD'),
  unit_name text not null check(unit_name in ('billing_quantum','episode','minute','judge_call','render_minute')),
  unit_price_microusd bigint not null check(unit_price_microusd>=0),
  minimum_quantity numeric(12,4) not null check(minimum_quantity>=0),
  maximum_line_microusd bigint not null check(maximum_line_microusd between 0 and 50000000),
  mandatory_addon boolean not null,
  pricing_evidence_snapshot_id uuid not null references private.provider_evidence_snapshots(id) on delete restrict,
  rate_hash text not null check(rate_hash~'^[a-f0-9]{64}$'),
  verified_at timestamptz not null,
  expires_at timestamptz not null,
  state text not null check(state in ('verified','disabled','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  unique(rate_key,version_number),
  unique(rate_key,rate_hash),
  check(expires_at>verified_at),
  check((line_kind='provider_clip' and capability_version_id is not null and not mandatory_addon)
    or (line_kind<>'provider_clip' and capability_version_id is null and mandatory_addon))
);

create table public.production_quotes (
  id uuid primary key,
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  plan_bundle_id uuid not null,
  plan_qc_consensus_id uuid not null,
  quote_number integer not null check(quote_number>0),
  quote_hash text not null check(quote_hash~'^[a-f0-9]{64}$'),
  rate_snapshot_hash text not null check(rate_snapshot_hash~'^[a-f0-9]{64}$'),
  currency char(3) not null check(currency='USD'),
  low_total_microusd bigint not null check(low_total_microusd>=0),
  expected_total_microusd bigint not null check(expected_total_microusd>=low_total_microusd),
  high_total_microusd bigint not null check(high_total_microusd>=expected_total_microusd),
  hard_ceiling_microusd bigint not null check(hard_ceiling_microusd between high_total_microusd and 50000000),
  target_40usd_breached boolean not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(configuration_candidate_id,quote_number),
  unique(configuration_candidate_id,quote_hash),
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,plan_bundle_id)
    references public.preflight_plan_bundles(workspace_id,id) on delete restrict,
  foreign key(workspace_id,plan_qc_consensus_id)
    references private.preflight_plan_qc_consensus(workspace_id,id) on delete restrict,
  check(expires_at>created_at),
  check(target_40usd_breached=(expected_total_microusd>40000000))
);

create table public.production_quote_lines (
  id uuid primary key,
  workspace_id uuid not null,
  production_quote_id uuid not null,
  line_number integer not null check(line_number>0),
  line_key text not null check(line_key~'^[a-z][a-z0-9_.:-]{2,180}$'),
  line_kind text not null check(line_kind in (
    'provider_clip','upscale','narration_master_reuse','score_music',
    'sfx_ambience','qc_judges','render_export','repair_allowance'
  )),
  provider_request_slot_id uuid,
  rate_card_version_id uuid not null references private.production_rate_card_versions(id) on delete restrict,
  low_quantity numeric(12,4) not null check(low_quantity>=0),
  expected_quantity numeric(12,4) not null check(expected_quantity>=low_quantity),
  high_quantity numeric(12,4) not null check(high_quantity>=expected_quantity),
  low_amount_microusd bigint not null check(low_amount_microusd>=0),
  expected_amount_microusd bigint not null check(expected_amount_microusd>=low_amount_microusd),
  high_amount_microusd bigint not null check(high_amount_microusd>=expected_amount_microusd),
  evidence_hash text not null check(evidence_hash~'^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(production_quote_id,line_number),
  unique(production_quote_id,line_key),
  unique(production_quote_id,provider_request_slot_id),
  foreign key(workspace_id,production_quote_id)
    references public.production_quotes(workspace_id,id) on delete restrict,
  foreign key(workspace_id,provider_request_slot_id)
    references public.preflight_provider_request_slots(workspace_id,id) on delete restrict,
  check((line_kind='provider_clip' and provider_request_slot_id is not null)
    or (line_kind<>'provider_clip' and provider_request_slot_id is null))
);

create table public.production_quote_confirmations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  production_quote_id uuid not null,
  quote_hash text not null check(quote_hash~'^[a-f0-9]{64}$'),
  hard_ceiling_microusd bigint not null check(hard_ceiling_microusd between 0 and 50000000),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check(actor_aal='aal2'),
  command_id uuid not null unique,
  confirmed_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(production_quote_id),
  foreign key(workspace_id,production_quote_id)
    references public.production_quotes(workspace_id,id) on delete restrict
);

create trigger production_rate_cards_immutable before update or delete on private.production_rate_card_versions
for each row execute function private.reject_mutation();
create trigger production_quotes_immutable before update or delete on public.production_quotes
for each row execute function private.reject_mutation();
create trigger production_quote_lines_immutable before update or delete on public.production_quote_lines
for each row execute function private.reject_mutation();
create trigger production_quote_confirmations_immutable before update or delete on public.production_quote_confirmations
for each row execute function private.reject_mutation();

create or replace function public.command_record_production_rate_card(
  p_rate_card_id uuid,p_rate_key text,p_line_kind text,p_capability_version_id uuid,
  p_unit_name text,p_unit_price_microusd bigint,p_minimum_quantity numeric,
  p_maximum_line_microusd bigint,p_pricing_evidence_snapshot_id uuid,
  p_rate_hash text,p_verified_at timestamptz,p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare capability private.production_provider_capability_versions%rowtype;
  evidence private.provider_evidence_snapshots%rowtype; next_version integer;
  mandatory boolean; computed_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into capability from private.production_provider_capability_versions
    where id=p_capability_version_id;
  select * into evidence from private.provider_evidence_snapshots
    where id=p_pricing_evidence_snapshot_id;
  mandatory:=p_line_kind<>'provider_clip';
  computed_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'rateKey',p_rate_key,'lineKind',p_line_kind,'capabilityVersionId',p_capability_version_id,
    'unitName',p_unit_name,'unitPriceMicrousd',p_unit_price_microusd,
    'minimumQuantity',p_minimum_quantity,'maximumLineMicrousd',p_maximum_line_microusd,
    'pricingEvidenceSnapshotId',p_pricing_evidence_snapshot_id,'verifiedAt',p_verified_at,
    'expiresAt',p_expires_at)::text,'UTF8'),'sha256'),'hex');
  if evidence.id is null or evidence.evidence_kind<>'pricing'
    or evidence.verification_state<>'verified' or evidence.retrieved_at>p_verified_at
    or evidence.expires_at<p_expires_at or p_expires_at<=p_verified_at
    or p_rate_hash is distinct from computed_hash
    or (p_line_kind='provider_clip' and (
      capability.id is null or capability.state<>'verified'
      or capability.expires_at<p_expires_at
      or capability.provider_account_id<>evidence.provider_account_id))
    or (p_line_kind<>'provider_clip' and p_capability_version_id is not null)
  then raise exception 'production rate card evidence is invalid' using errcode='40001'; end if;
  select coalesce(max(version_number),0)+1 into next_version
    from private.production_rate_card_versions where rate_key=p_rate_key;
  insert into private.production_rate_card_versions(
    id,rate_key,version_number,line_kind,capability_version_id,currency,unit_name,
    unit_price_microusd,minimum_quantity,maximum_line_microusd,mandatory_addon,
    pricing_evidence_snapshot_id,rate_hash,verified_at,expires_at,state
  ) values(p_rate_card_id,p_rate_key,next_version,p_line_kind,p_capability_version_id,
    'USD',p_unit_name,p_unit_price_microusd,p_minimum_quantity,p_maximum_line_microusd,
    mandatory,p_pricing_evidence_snapshot_id,p_rate_hash,p_verified_at,p_expires_at,'verified');
  return p_rate_card_id;
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
    or p_hard_ceiling_microusd not between 0 and 50000000
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

create or replace function public.command_confirm_production_quote(
  p_workspace_id uuid,p_quote_id uuid,p_quote_hash text,
  p_hard_ceiling_microusd bigint,p_command_id uuid
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare actor_id uuid:=auth.uid(); confirmation_id uuid; quote public.production_quotes%rowtype;
begin
  if auth.role() is distinct from 'authenticated' or actor_id is null
    or private.current_aal()<>'aal2'
  then raise exception 'AAL2 authenticated authority required' using errcode='42501'; end if;
  select * into quote from public.production_quotes
    where id=p_quote_id and workspace_id=p_workspace_id;
  select confirmation.id into confirmation_id from public.production_quote_confirmations confirmation
    where confirmation.command_id=p_command_id;
  if confirmation_id is not null then
    if exists(select 1 from public.production_quote_confirmations confirmation
      where confirmation.id=confirmation_id and confirmation.workspace_id=p_workspace_id
        and confirmation.production_quote_id=p_quote_id and confirmation.quote_hash=p_quote_hash
        and confirmation.hard_ceiling_microusd=p_hard_ceiling_microusd
        and confirmation.confirmed_by=actor_id)
    then return confirmation_id; end if;
    raise exception 'quote confirmation command conflicts' using errcode='40001';
  end if;
  if quote.id is null or not private.is_active_member(p_workspace_id,actor_id)
    or quote.expires_at<=statement_timestamp()
    or p_quote_hash is distinct from quote.quote_hash
    or p_hard_ceiling_microusd is distinct from quote.hard_ceiling_microusd
  then raise exception 'quote confirmation is stale or mismatched' using errcode='40001'; end if;
  insert into public.production_quote_confirmations(
    workspace_id,production_quote_id,quote_hash,hard_ceiling_microusd,
    confirmed_by,actor_aal,command_id
  ) values(p_workspace_id,quote.id,quote.quote_hash,quote.hard_ceiling_microusd,
    actor_id,'aal2',p_command_id) returning id into confirmation_id;
  return confirmation_id;
end;
$$;

create index rate_card_capability_idx on private.production_rate_card_versions(capability_version_id) where capability_version_id is not null;
create index rate_card_evidence_idx on private.production_rate_card_versions(pricing_evidence_snapshot_id);
create index production_quote_config_idx on public.production_quotes(configuration_candidate_id,quote_number desc);
create index production_quote_plan_idx on public.production_quotes(plan_bundle_id);
create index production_quote_consensus_idx on public.production_quotes(plan_qc_consensus_id);
create index production_quote_line_quote_idx on public.production_quote_lines(production_quote_id,line_number);
create index production_quote_line_rate_idx on public.production_quote_lines(rate_card_version_id);
create index production_quote_confirmation_quote_idx on public.production_quote_confirmations(production_quote_id);
create index production_quote_confirmation_actor_idx on public.production_quote_confirmations(confirmed_by);

do $$ declare table_name text; begin
  foreach table_name in array array['production_quotes','production_quote_lines','production_quote_confirmations'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id,(select auth.uid())))',
      table_name||'_member_select',table_name);
  end loop;
end $$;

revoke all on table public.production_quotes,public.production_quote_lines,
  public.production_quote_confirmations from public,anon,authenticated;
grant select on table public.production_quotes,public.production_quote_lines,
  public.production_quote_confirmations to authenticated;
revoke all on function
  public.command_record_production_rate_card(uuid,text,text,uuid,text,bigint,numeric,bigint,uuid,text,timestamptz,timestamptz),
  public.command_record_production_quote(uuid,uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb),
  public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)
from public,anon,authenticated;
grant execute on function public.command_record_production_quote(uuid,uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb)
to service_role;
grant execute on function public.command_record_production_rate_card(uuid,text,text,uuid,text,bigint,numeric,bigint,uuid,text,timestamptz,timestamptz)
to service_role;
grant execute on function public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)
to authenticated;

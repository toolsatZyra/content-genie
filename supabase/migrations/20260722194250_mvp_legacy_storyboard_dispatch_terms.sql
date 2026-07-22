-- The worker immediately preceding exact provider billing reserved 120000
-- microusd per storyboard frame. Preserve that immutable replay identity for
-- old quotes while the bound 80000-microusd rate still settles 1.525 reported
-- billing quanta at the exact 122000-microusd actual cost.

create table private.mvp_storyboard_quote_compatibility_dispatch_terms (
  id uuid primary key default gen_random_uuid(),
  compatibility_authority_id uuid not null unique
    references private.mvp_storyboard_quote_compatibility_authorities(id)
    on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  production_run_id uuid not null,
  expected_cost_microusd bigint not null check(expected_cost_microusd=120000),
  maximum_cost_microusd bigint not null check(maximum_cost_microusd=120000),
  legacy_contract_git_commit text not null check(
    legacy_contract_git_commit='35ff40f15af820514913fbf19c4ec0a9e7699845'
  ),
  compatibility_reason text not null check(
    compatibility_reason='legacy_storyboard_worker_reservation_replay'
  ),
  terms_manifest_sha256 text not null unique check(
    terms_manifest_sha256~'^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,production_run_id),
  foreign key(workspace_id,production_run_id)
    references public.production_runs(workspace_id,id) on delete restrict
);

insert into private.mvp_storyboard_quote_compatibility_dispatch_terms(
  compatibility_authority_id,workspace_id,production_run_id,
  expected_cost_microusd,maximum_cost_microusd,legacy_contract_git_commit,
  compatibility_reason,terms_manifest_sha256
)
select authority.id,authority.workspace_id,authority.production_run_id,
  120000,120000,'35ff40f15af820514913fbf19c4ec0a9e7699845',
  'legacy_storyboard_worker_reservation_replay',
  encode(extensions.digest(convert_to(jsonb_build_object(
    'compatibilityAuthorityId',authority.id,
    'compatibilityReason','legacy_storyboard_worker_reservation_replay',
    'expectedCostMicrousd',120000,
    'legacyContractGitCommit','35ff40f15af820514913fbf19c4ec0a9e7699845',
    'maximumCostMicrousd',120000,
    'productionRunId',authority.production_run_id,
    'workspaceId',authority.workspace_id
  )::text,'UTF8'),'sha256'),'hex')
from private.mvp_storyboard_quote_compatibility_authorities authority;

create trigger mvp_storyboard_quote_compatibility_dispatch_terms_immutable
before update or delete
on private.mvp_storyboard_quote_compatibility_dispatch_terms
for each row execute function private.reject_mutation();

revoke all on private.mvp_storyboard_quote_compatibility_dispatch_terms
from public,anon,authenticated,service_role;

create or replace function public.get_mvp_storyboard_cost_authority(
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
  terms private.mvp_storyboard_quote_compatibility_dispatch_terms%rowtype;
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
  select * into terms
  from private.mvp_storyboard_quote_compatibility_dispatch_terms dispatch_terms
  where dispatch_terms.compatibility_authority_id=compatibility.id;
  if run_row.id is null or quote_row.id is null or compatibility.id is null
    or terms.id is null
  then raise exception 'storyboard cost authority is unavailable'
    using errcode='23514'; end if;
  return jsonb_build_object(
    'expectedCostMicrousd',terms.expected_cost_microusd,
    'maximumCostMicrousd',terms.maximum_cost_microusd,
    'rateCardVersionId',compatibility.storyboard_rate_card_version_id,
    'source','legacy_quote_compatibility'
  );
end;
$$;

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
      ceil(1.525*rate.unit_price_microusd)::bigint expected_cost,
      ceil(1.525*rate.unit_price_microusd)::bigint maximum_cost into priced
    from public.production_runs run
    join public.production_quote_lines line
      on line.production_quote_id=run.production_quote_id
      and line.line_key='storyboard_generation'
    join private.production_rate_card_versions rate
      on rate.id=line.rate_card_version_id
    where run.workspace_id=new.workspace_id and run.id=new.production_run_id;
    if priced.rate_card_version_id is null then
      select authority.storyboard_rate_card_version_id rate_card_version_id,
        terms.expected_cost_microusd expected_cost,
        terms.maximum_cost_microusd maximum_cost into priced
      from private.mvp_storyboard_quote_compatibility_authorities authority
      join private.mvp_storyboard_quote_compatibility_dispatch_terms terms
        on terms.compatibility_authority_id=authority.id
      where authority.workspace_id=new.workspace_id
        and authority.production_run_id=new.production_run_id;
    end if;
    if priced.rate_card_version_id is null
      or new.expected_cost_microusd<>priced.expected_cost
      or new.maximum_cost_microusd<>priced.maximum_cost
    then raise exception 'media dispatch storyboard rate authority is unavailable'
      using errcode='23514'; end if;
  end if;
  new.rate_card_version_id:=priced.rate_card_version_id;
  return new;
end;
$$;

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
  join private.mvp_storyboard_quote_compatibility_dispatch_terms terms
    on terms.compatibility_authority_id=authority.id
  where dispatch.rate_card_version_id is null and dispatch.state<>'succeeded'
    and dispatch.media_kind='storyboard'
    and authority.workspace_id=dispatch.workspace_id
    and authority.production_run_id=dispatch.production_run_id
    and dispatch.expected_cost_microusd=terms.expected_cost_microusd
    and dispatch.maximum_cost_microusd=terms.maximum_cost_microusd;
  get diagnostics step_count=row_count; changed:=changed+step_count;

  if exists(select 1 from private.mvp_media_dispatches
    where state='submitted' and rate_card_version_id is null)
  then raise exception 'submitted legacy media dispatch rate remains unavailable'
    using errcode='23514'; end if;
  return changed;
end;
$$;

select private.reconcile_legacy_mvp_media_dispatch_rates();

revoke all on function
  private.bind_mvp_media_dispatch_rate(),
  private.reconcile_legacy_mvp_media_dispatch_rates()
from public,anon,authenticated;

comment on table private.mvp_storyboard_quote_compatibility_dispatch_terms is
  'Immutable replay terms for the 120000-microusd legacy storyboard reservation; actual provider billing remains rate-derived and may settle at 122000 microusd.';

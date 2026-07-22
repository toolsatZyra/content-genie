-- Forward-only: a legacy compatibility calculation is not itself spend authority. Bind it
-- to the exact owner's durable quote confirmation and autonomous-production
-- start receipt before any new storyboard request may consume the sidecar.

create table private.mvp_storyboard_quote_compatibility_owner_authorizations (
  id uuid primary key default gen_random_uuid(),
  compatibility_authority_id uuid not null unique
    references private.mvp_storyboard_quote_compatibility_authorities(id)
    on delete restrict,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  production_run_id uuid not null,
  production_quote_id uuid not null,
  production_quote_confirmation_id uuid not null unique
    references public.production_quote_confirmations(id) on delete restrict,
  mvp_start_authority_receipt_id bigint not null unique
    references private.workspace_authority_receipts(id) on delete restrict,
  authority_profile_id uuid not null
    references private.workspace_authority_profiles(id) on delete restrict,
  authority_profile_epoch bigint not null check(authority_profile_epoch>0),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check(actor_aal in ('aal1','aal2')),
  authority_provenance text not null check(authority_provenance in (
    'verified_aal2','verified_single_owner_developer'
  )),
  authorized_attempt_count integer not null check(authorized_attempt_count=20),
  authorized_additional_maximum_microusd bigint not null check(
    authorized_additional_maximum_microusd>=0
  ),
  authorization_basis text not null check(
    authorization_basis=
      'confirmed_quote_and_explicit_owner_mvp_autonomous_start'
  ),
  evidence_manifest_sha256 text not null unique check(
    evidence_manifest_sha256~'^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,production_run_id),
  unique(workspace_id,production_quote_id),
  foreign key(workspace_id,production_run_id)
    references public.production_runs(workspace_id,id) on delete restrict,
  foreign key(workspace_id,production_quote_id)
    references public.production_quotes(workspace_id,id) on delete restrict
);

create trigger mvp_storyboard_compat_owner_authorizations_immutable
before update or delete
on private.mvp_storyboard_quote_compatibility_owner_authorizations
for each row execute function private.reject_mutation();

revoke all on private.mvp_storyboard_quote_compatibility_owner_authorizations
from public,anon,authenticated,service_role;

create function private.reconcile_mvp_legacy_storyboard_owner_authorities()
returns integer language plpgsql security definer set search_path=''
as $$
declare changed integer;
begin
  insert into private.mvp_storyboard_quote_compatibility_owner_authorizations(
    compatibility_authority_id,workspace_id,production_run_id,
    production_quote_id,production_quote_confirmation_id,
    mvp_start_authority_receipt_id,authority_profile_id,
    authority_profile_epoch,owner_user_id,actor_aal,authority_provenance,
    authorized_attempt_count,authorized_additional_maximum_microusd,
    authorization_basis,evidence_manifest_sha256
  )
  select
    compatibility.id,compatibility.workspace_id,compatibility.production_run_id,
    compatibility.production_quote_id,confirmation.id,start_receipt.id,
    profile.id,profile.profile_epoch,profile.owner_user_id,
    start_receipt.actor_aal,start_receipt.authority_provenance,
    compatibility.authorized_attempt_count,
    compatibility.authorized_additional_maximum_microusd,
    'confirmed_quote_and_explicit_owner_mvp_autonomous_start',
    encode(extensions.digest(convert_to(jsonb_build_object(
      'authorizationBasis',
        'confirmed_quote_and_explicit_owner_mvp_autonomous_start',
      'authorizedAdditionalMaximumMicrousd',
        compatibility.authorized_additional_maximum_microusd,
      'authorizedAttemptCount',compatibility.authorized_attempt_count,
      'authorityProfileEpoch',profile.profile_epoch,
      'authorityProfileId',profile.id,
      'compatibilityAuthorityId',compatibility.id,
      'compatibilityManifestSha256',compatibility.authority_manifest_sha256,
      'mvpStartActorAal',start_receipt.actor_aal,
      'mvpStartAuthorityProvenance',start_receipt.authority_provenance,
      'mvpStartAuthorityReceiptId',start_receipt.id,
      'ownerUserId',profile.owner_user_id,
      'productionQuoteConfirmationId',confirmation.id,
      'productionQuoteConfirmedActorAal',confirmation.actor_aal,
      'productionQuoteId',compatibility.production_quote_id,
      'productionRunId',compatibility.production_run_id,
      'quoteHash',confirmation.quote_hash,
      'workspaceId',compatibility.workspace_id
    )::text,'UTF8'),'sha256'),'hex')
  from private.mvp_storyboard_quote_compatibility_authorities compatibility
  join public.production_runs run
    on run.workspace_id=compatibility.workspace_id
    and run.id=compatibility.production_run_id
    and run.production_quote_id=compatibility.production_quote_id
  join private.workspace_authority_profiles profile
    on profile.workspace_id=run.workspace_id
    and profile.id=run.authority_profile_id
    and profile.profile_epoch=run.authority_profile_epoch
    and profile.profile_kind='single_owner_developer'
    and profile.owner_user_id=run.created_by
  join public.production_quote_confirmations confirmation
    on confirmation.workspace_id=run.workspace_id
    and confirmation.production_quote_id=run.production_quote_id
    and confirmation.quote_hash=compatibility.quote_hash
    and confirmation.hard_ceiling_microusd=run.hard_ceiling_microusd
    and confirmation.confirmed_by=profile.owner_user_id
    and confirmation.authority_profile_id=profile.id
    and confirmation.authority_profile_epoch=profile.profile_epoch
    and confirmation.authority_provenance in (
      'verified_aal2','verified_single_owner_developer'
    )
  join public.mvp_production_jobs job
    on job.workspace_id=run.workspace_id
    and job.production_run_id=run.id
    and job.authority_profile_id=profile.id
    and job.authority_profile_epoch=profile.profile_epoch
    and job.authority_provenance in (
      'verified_aal2','verified_single_owner_developer'
    )
  join lateral (
    select receipt.*
    from private.workspace_authority_receipts receipt
    where receipt.workspace_id=run.workspace_id
      and receipt.authority_profile_id=profile.id
      and receipt.authority_profile_epoch=profile.profile_epoch
      and receipt.action_key='mvp_start'
      and receipt.actor_user_id=profile.owner_user_id
      and receipt.authority_provenance in (
        'verified_aal2','verified_single_owner_developer'
      )
      and receipt.created_at=job.created_at
    order by receipt.id
    limit 1
  ) start_receipt on true
  where run.authority_provenance in (
      'verified_aal2','verified_single_owner_developer'
    )
    and private.workspace_has_exact_single_owner(
      run.workspace_id,profile.owner_user_id
    )
    and not exists (
      select 1
      from private.mvp_storyboard_quote_compatibility_owner_authorizations prior
      where prior.compatibility_authority_id=compatibility.id
    )
  on conflict do nothing;
  get diagnostics changed=row_count;
  return changed;
end;
$$;

create function private.mvp_legacy_storyboard_owner_authorization_is_current(
  p_workspace_id uuid,p_production_run_id uuid,p_compatibility_authority_id uuid
)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1
    from private.mvp_storyboard_quote_compatibility_owner_authorizations approval
    join private.mvp_storyboard_quote_compatibility_authorities authority
      on authority.id=approval.compatibility_authority_id
      and authority.workspace_id=approval.workspace_id
      and authority.production_run_id=approval.production_run_id
      and authority.production_quote_id=approval.production_quote_id
      and authority.authorized_attempt_count=approval.authorized_attempt_count
      and authority.authorized_additional_maximum_microusd=
        approval.authorized_additional_maximum_microusd
    join public.production_runs run
      on run.workspace_id=approval.workspace_id
      and run.id=approval.production_run_id
      and run.production_quote_id=approval.production_quote_id
      and run.created_by=approval.owner_user_id
      and run.authority_profile_id=approval.authority_profile_id
      and run.authority_profile_epoch=approval.authority_profile_epoch
      and run.authority_provenance in (
        'verified_aal2','verified_single_owner_developer'
      )
    join private.workspace_authority_profiles profile
      on profile.workspace_id=approval.workspace_id
      and profile.id=approval.authority_profile_id
      and profile.profile_epoch=approval.authority_profile_epoch
      and profile.profile_kind='single_owner_developer'
      and profile.owner_user_id=approval.owner_user_id
    where approval.workspace_id=p_workspace_id
      and approval.production_run_id=p_production_run_id
      and approval.compatibility_authority_id=p_compatibility_authority_id
      and private.workspace_has_exact_single_owner(
        approval.workspace_id,approval.owner_user_id
      )
  )
$$;

select private.reconcile_mvp_legacy_storyboard_owner_authorities();

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
    and authority.quote_hash=quote_row.quote_hash
    and private.mvp_legacy_storyboard_owner_authorization_is_current(
      authority.workspace_id,authority.production_run_id,authority.id
    );
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
        and authority.production_run_id=new.production_run_id
        and private.mvp_legacy_storyboard_owner_authorization_is_current(
          authority.workspace_id,authority.production_run_id,authority.id
        );
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

do $migration$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef(
    'public.command_reserve_mvp_media_dispatch(uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint)'::regprocedure
  );
  revised:=replace(definition,
$old$      coalesce((select authority.authorized_additional_maximum_microusd
        from private.mvp_storyboard_quote_compatibility_authorities authority
        where authority.workspace_id=p_workspace_id
          and authority.production_run_id=p_production_run_id),0)
$old$,
$new$      coalesce((select authority.authorized_additional_maximum_microusd
        from private.mvp_storyboard_quote_compatibility_authorities authority
        where authority.workspace_id=p_workspace_id
          and authority.production_run_id=p_production_run_id
          and private.mvp_legacy_storyboard_owner_authorization_is_current(
            authority.workspace_id,authority.production_run_id,authority.id
          )),0)
$new$);
  if revised=definition then
    raise exception 'legacy storyboard owner authority ceiling patch target was not found'
      using errcode='23514';
  end if;
  execute revised;
end;
$migration$;

create or replace function private.enforce_mvp_legacy_storyboard_compatibility_budget()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  authority private.mvp_storyboard_quote_compatibility_authorities%rowtype;
  run_ceiling bigint;
  storyboard_maximum numeric;
  quoted_media_maximum numeric;
begin
  select * into authority
  from private.mvp_storyboard_quote_compatibility_authorities candidate
  where candidate.workspace_id=new.workspace_id
    and candidate.production_run_id=new.production_run_id
    and private.mvp_legacy_storyboard_owner_authorization_is_current(
      candidate.workspace_id,candidate.production_run_id,candidate.id
    );
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

revoke all on function
  private.reconcile_mvp_legacy_storyboard_owner_authorities(),
  private.mvp_legacy_storyboard_owner_authorization_is_current(uuid,uuid,uuid)
from public,anon,authenticated,service_role;

comment on table
  private.mvp_storyboard_quote_compatibility_owner_authorizations is
  'Immutable evidence binding a legacy storyboard compatibility envelope to the exact single owner, confirmed quote, authority profile epoch, and explicit autonomous MVP start receipt.';

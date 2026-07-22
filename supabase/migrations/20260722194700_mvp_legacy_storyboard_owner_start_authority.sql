-- Bind a legacy storyboard compatibility envelope to the exact authenticated
-- owner during Start. The receipt, job, and authorization are committed in one
-- transaction, before the queued job becomes visible to a service worker.

create or replace function private.assert_workspace_action_authority(
  p_workspace_id uuid,
  p_action_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actual_aal text := private.current_aal();
  profile_row private.workspace_authority_profiles%rowtype;
  provenance text;
  receipt_id bigint;
begin
  if p_action_key is null or p_action_key not in (
    'micro_quote_authorize','world_spend_authorize','source_review',
    'production_quote_confirm','world_lock_prepare','world_lock_commit',
    'mvp_start','mvp_retry','mvp_review','mvp_cultural_review',
    'mvp_final_review'
  ) then
    raise exception 'workspace action is not owner-MVP allowlisted'
      using errcode = '42501';
  end if;
  if coalesce(auth.jwt()->>'role','') <> 'authenticated'
    or actor_id is null or actual_aal not in ('aal1','aal2')
    or not private.is_active_member(p_workspace_id,actor_id)
  then
    raise exception 'authenticated active workspace membership required'
      using errcode = '42501';
  end if;

  perform private.lock_workspace_authority(p_workspace_id);
  select * into profile_row
  from private.workspace_authority_profiles profile
  where profile.workspace_id = p_workspace_id
  for update;
  if not found then
    raise exception 'workspace authority profile is unavailable'
      using errcode = '42501';
  end if;
  if actual_aal = 'aal2' then
    provenance := 'verified_aal2';
  elsif profile_row.profile_kind = 'single_owner_developer'
    and profile_row.owner_user_id = actor_id
    and private.workspace_has_exact_single_owner(p_workspace_id,actor_id)
  then
    provenance := 'verified_single_owner_developer';
  else
    raise exception 'AAL2 required for this workspace authority profile'
      using errcode = '42501';
  end if;

  perform set_config('genie.authority.workspace_id',p_workspace_id::text,true);
  perform set_config('genie.authority.action_key',p_action_key,true);
  perform set_config('genie.authority.profile_id',profile_row.id::text,true);
  perform set_config(
    'genie.authority.profile_epoch',profile_row.profile_epoch::text,true
  );
  perform set_config('genie.authority.actor_aal',actual_aal,true);
  perform set_config('genie.authority.provenance',provenance,true);

  insert into private.workspace_authority_receipts(
    workspace_id,authority_profile_id,authority_profile_epoch,action_key,
    actor_user_id,actor_aal,authority_provenance
  ) values (
    p_workspace_id,profile_row.id,profile_row.profile_epoch,p_action_key,
    actor_id,actual_aal,provenance
  ) returning id into receipt_id;

  return jsonb_build_object(
    'workspaceId',p_workspace_id,'actionKey',p_action_key,
    'actorUserId',actor_id,'actorAal',actual_aal,
    'authorityProfileId',profile_row.id,
    'authorityProfileEpoch',profile_row.profile_epoch,
    'authorityProvenance',provenance,
    'authorityReceiptId',receipt_id
  );
end;
$$;

create function private.authorize_mvp_legacy_storyboard_owner_start(
  p_workspace_id uuid,p_production_run_id uuid,p_actor_user_id uuid,
  p_mvp_start_authority_receipt_id bigint
)
returns uuid language plpgsql volatile security definer set search_path=''
as $$
declare authorization_id uuid;
begin
  if p_workspace_id is null or p_production_run_id is null
    or p_actor_user_id is null or p_mvp_start_authority_receipt_id is null
  then raise exception 'exact MVP start authority is required'
    using errcode='22023'; end if;

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
    and profile.owner_user_id=p_actor_user_id
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
  join private.workspace_authority_receipts start_receipt
    on start_receipt.id=p_mvp_start_authority_receipt_id
    and start_receipt.workspace_id=run.workspace_id
    and start_receipt.authority_profile_id=profile.id
    and start_receipt.authority_profile_epoch=profile.profile_epoch
    and start_receipt.action_key='mvp_start'
    and start_receipt.actor_user_id=profile.owner_user_id
    and start_receipt.authority_provenance in (
      'verified_aal2','verified_single_owner_developer'
    )
  where compatibility.workspace_id=p_workspace_id
    and compatibility.production_run_id=p_production_run_id
    and run.authority_provenance in (
      'verified_aal2','verified_single_owner_developer'
    )
    and private.workspace_has_exact_single_owner(
      run.workspace_id,profile.owner_user_id
    )
  on conflict(compatibility_authority_id) do nothing
  returning id into authorization_id;

  if authorization_id is null then
    select approval.id into authorization_id
    from private.mvp_storyboard_quote_compatibility_owner_authorizations approval
    where approval.workspace_id=p_workspace_id
      and approval.production_run_id=p_production_run_id
      and approval.owner_user_id=p_actor_user_id
      and private.mvp_legacy_storyboard_owner_authorization_is_current(
        approval.workspace_id,approval.production_run_id,
        approval.compatibility_authority_id
      );
  end if;
  if authorization_id is null and exists (
    select 1
    from private.mvp_storyboard_quote_compatibility_authorities compatibility
    where compatibility.workspace_id=p_workspace_id
      and compatibility.production_run_id=p_production_run_id
  ) then
    raise exception 'exact owner authority is required for legacy storyboard spend'
      using errcode='42501';
  end if;
  return authorization_id;
end;
$$;

do $migration$
declare definition text; revised text;
begin
  definition:=pg_get_functiondef(
    'public.command_start_mvp_production(uuid,uuid)'::regprocedure
  );
  revised:=replace(definition,
$old$  job_row public.mvp_production_jobs%rowtype;
begin
  perform private.assert_workspace_action_authority(p_workspace_id,'mvp_start');
$old$,
$new$  job_row public.mvp_production_jobs%rowtype;
  start_authority jsonb;
begin
  start_authority:=private.assert_workspace_action_authority(
    p_workspace_id,'mvp_start'
  );
$new$);
  if revised=definition then
    raise exception 'MVP start authority receipt capture patch target was not found'
      using errcode='23514';
  end if;
  definition:=revised;
  revised:=replace(definition,
$old$  select * into job_row from public.mvp_production_jobs
  where production_run_id = run_row.id;
$old$,
$new$  select * into job_row from public.mvp_production_jobs
  where production_run_id = run_row.id;
  perform private.authorize_mvp_legacy_storyboard_owner_start(
    p_workspace_id,run_row.id,actor_id,
    (start_authority->>'authorityReceiptId')::bigint
  );
$new$);
  if revised=definition then
    raise exception 'MVP start atomic legacy authority patch target was not found'
      using errcode='23514';
  end if;
  execute revised;
end;
$migration$;

revoke all on function
  private.assert_workspace_action_authority(uuid,text),
  private.authorize_mvp_legacy_storyboard_owner_start(uuid,uuid,uuid,bigint)
from public,anon,authenticated,service_role;

comment on function public.command_start_mvp_production(uuid,uuid) is
  'Starts production and atomically binds any legacy storyboard compatibility envelope to the exact current owner action receipt before the job is visible.';

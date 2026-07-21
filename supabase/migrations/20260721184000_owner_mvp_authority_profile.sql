-- Forward-only owner-MVP authority profile.
-- AAL1 is never a workspace-wide setting: it is valid only for the stored
-- single owner, for the narrow action allowlist below, while the exact-one
-- active-admin membership invariant and profile epoch still match.

create table private.workspace_authority_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique
    references public.workspaces(id) on delete restrict,
  profile_kind text not null check (
    profile_kind in ('single_owner_developer','managed_team')
  ),
  owner_user_id uuid references auth.users(id) on delete restrict,
  profile_epoch bigint not null default 1 check (profile_epoch > 0),
  activated_at timestamptz not null default statement_timestamp(),
  transitioned_at timestamptz,
  transition_reason text check (
    transition_reason is null
    or char_length(transition_reason) between 1 and 1000
  ),
  updated_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  check (
    (profile_kind = 'single_owner_developer'
      and owner_user_id is not null
      and transitioned_at is null
      and transition_reason is null)
    or
    (profile_kind = 'managed_team' and owner_user_id is null)
  )
);

create table private.workspace_authority_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  authority_profile_id uuid not null
    references private.workspace_authority_profiles(id) on delete restrict,
  event_kind text not null check (event_kind in ('bootstrap','transition')),
  prior_profile_kind text check (
    prior_profile_kind is null
    or prior_profile_kind in ('single_owner_developer','managed_team')
  ),
  new_profile_kind text not null check (
    new_profile_kind in ('single_owner_developer','managed_team')
  ),
  prior_profile_epoch bigint check (
    prior_profile_epoch is null or prior_profile_epoch > 0
  ),
  new_profile_epoch bigint not null check (new_profile_epoch > 0),
  prior_owner_user_id uuid references auth.users(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_aal text check (actor_aal is null or actor_aal in ('aal1','aal2')),
  reason text not null check (char_length(reason) between 1 and 1000),
  created_at timestamptz not null default statement_timestamp(),
  check (
    (event_kind = 'bootstrap'
      and prior_profile_kind is null and prior_profile_epoch is null)
    or
    (event_kind = 'transition'
      and prior_profile_kind = 'single_owner_developer'
      and new_profile_kind = 'managed_team'
      and new_profile_epoch = prior_profile_epoch + 1)
  )
);

create table private.workspace_authority_receipts (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  authority_profile_id uuid not null
    references private.workspace_authority_profiles(id) on delete restrict,
  authority_profile_epoch bigint not null check (authority_profile_epoch > 0),
  action_key text not null check (
    action_key in (
      'micro_quote_authorize','world_spend_authorize','source_review',
      'production_quote_confirm','world_lock_prepare','world_lock_commit',
      'mvp_start','mvp_retry','mvp_review','mvp_cultural_review',
      'mvp_final_review'
    )
  ),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check (actor_aal in ('aal1','aal2')),
  authority_provenance text not null check (
    authority_provenance in ('verified_aal2','verified_single_owner_developer')
  ),
  created_at timestamptz not null default statement_timestamp()
);

alter table private.workspace_authority_profiles enable row level security;
alter table private.workspace_authority_profiles force row level security;
alter table private.workspace_authority_events enable row level security;
alter table private.workspace_authority_events force row level security;
alter table private.workspace_authority_receipts enable row level security;
alter table private.workspace_authority_receipts force row level security;

revoke all on private.workspace_authority_profiles,
  private.workspace_authority_events,
  private.workspace_authority_receipts
from public,anon,authenticated,service_role;

-- Bootstrap the live workspace population exactly once. A workspace qualifies
-- only when its entire active membership is one admin row.
insert into private.workspace_authority_profiles(
  workspace_id,profile_kind,owner_user_id
)
select
  workspace.id,
  case when member.active_count = 1 and member.admin_count = 1
    then 'single_owner_developer' else 'managed_team' end,
  case when member.active_count = 1 and member.admin_count = 1
    then member.only_admin_user_id else null end
from public.workspaces workspace
cross join lateral (
  select
    count(*) filter (where membership.status = 'active')::integer
      as active_count,
    count(*) filter (
      where membership.status = 'active' and membership.role = 'admin'
    )::integer as admin_count,
    (array_agg(membership.user_id) filter (
      where membership.status = 'active' and membership.role = 'admin'
    ))[1] as only_admin_user_id
  from public.memberships membership
  where membership.workspace_id = workspace.id
) member;

insert into private.workspace_authority_events(
  workspace_id,authority_profile_id,event_kind,new_profile_kind,
  new_profile_epoch,reason
)
select workspace_id,id,'bootstrap',profile_kind,profile_epoch,
  '20260721184000 exact active-membership bootstrap'
from private.workspace_authority_profiles;

create or replace function private.workspace_has_exact_single_owner(
  p_workspace_id uuid,
  p_owner_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_workspace_id is not null
    and p_owner_user_id is not null
    and count(*) filter (where membership.status = 'active') = 1
    and count(*) filter (
      where membership.status = 'active'
        and membership.role = 'admin'
        and membership.user_id = p_owner_user_id
    ) = 1
  from public.memberships membership
  where membership.workspace_id = p_workspace_id
$$;

create or replace function private.guard_workspace_authority_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.profile_kind = 'managed_team' then
    if new.profile_kind <> 'managed_team'
      or new.owner_user_id is not null
      or new.profile_epoch <> old.profile_epoch
    then
      raise exception 'managed workspace authority cannot downgrade'
        using errcode = '23514';
    end if;
  elsif new.profile_kind <> 'managed_team'
    or new.owner_user_id is not null
    or new.profile_epoch <> old.profile_epoch + 1
    or new.transitioned_at is null
    or new.transition_reason is null
  then
    raise exception 'single-owner authority transition is invalid'
      using errcode = '23514';
  end if;
  if new.id <> old.id or new.workspace_id <> old.workspace_id
    or new.activated_at <> old.activated_at
  then
    raise exception 'workspace authority profile identity is immutable'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger workspace_authority_profiles_guard_update
before update on private.workspace_authority_profiles
for each row execute function private.guard_workspace_authority_profile_update();

create trigger workspace_authority_profiles_no_delete
before delete on private.workspace_authority_profiles
for each row execute function private.reject_mutation();
create trigger workspace_authority_events_immutable
before update or delete on private.workspace_authority_events
for each row execute function private.reject_mutation();
create trigger workspace_authority_receipts_immutable
before update or delete on private.workspace_authority_receipts
for each row execute function private.reject_mutation();

create or replace function private.reconcile_workspace_authority(
  p_workspace_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_row private.workspace_authority_profiles%rowtype;
  active_count integer;
  admin_count integer;
  only_admin_user_id uuid;
  prior_owner_user_id uuid;
  event_actor uuid := auth.uid();
  event_aal text;
begin
  if p_workspace_id is null then return; end if;
  perform private.lock_workspace_authority(p_workspace_id);

  select * into profile_row
  from private.workspace_authority_profiles profile
  where profile.workspace_id = p_workspace_id
  for update;

  select
    count(*) filter (where membership.status = 'active')::integer,
    count(*) filter (
      where membership.status = 'active' and membership.role = 'admin'
    )::integer,
    (array_agg(membership.user_id) filter (
      where membership.status = 'active' and membership.role = 'admin'
    ))[1]
  into active_count,admin_count,only_admin_user_id
  from public.memberships membership
  where membership.workspace_id = p_workspace_id;

  if not found or profile_row.id is null then
    insert into private.workspace_authority_profiles(
      workspace_id,profile_kind,owner_user_id
    ) values (
      p_workspace_id,
      case when active_count = 1 and admin_count = 1
        then 'single_owner_developer' else 'managed_team' end,
      case when active_count = 1 and admin_count = 1
        then only_admin_user_id else null end
    ) returning * into profile_row;
    insert into private.workspace_authority_events(
      workspace_id,authority_profile_id,event_kind,new_profile_kind,
      new_profile_epoch,actor_user_id,actor_aal,reason
    ) values (
      p_workspace_id,profile_row.id,'bootstrap',profile_row.profile_kind,
      profile_row.profile_epoch,event_actor,
      case when event_actor is null then null else private.current_aal() end,
      left(coalesce(nullif(btrim(p_reason),''),'membership bootstrap'),1000)
    );
    return;
  end if;

  if profile_row.profile_kind = 'single_owner_developer'
    and not (
      active_count = 1 and admin_count = 1
      and only_admin_user_id = profile_row.owner_user_id
    )
  then
    prior_owner_user_id := profile_row.owner_user_id;
    event_aal := case when event_actor is null then null
      else private.current_aal() end;
    update private.workspace_authority_profiles
    set profile_kind = 'managed_team',owner_user_id = null,
        profile_epoch = profile_epoch + 1,
        transitioned_at = statement_timestamp(),
        transition_reason = left(
          coalesce(nullif(btrim(p_reason),''),'exact single-owner invariant ceased'),
          1000
        ),
        updated_at = statement_timestamp()
    where id = profile_row.id
    returning * into profile_row;

    insert into private.workspace_authority_events(
      workspace_id,authority_profile_id,event_kind,prior_profile_kind,
      new_profile_kind,prior_profile_epoch,new_profile_epoch,
      prior_owner_user_id,actor_user_id,actor_aal,reason
    ) values (
      p_workspace_id,profile_row.id,'transition','single_owner_developer',
      'managed_team',profile_row.profile_epoch - 1,profile_row.profile_epoch,
      prior_owner_user_id,event_actor,event_aal,
      coalesce(profile_row.transition_reason,'exact single-owner invariant ceased')
    );

    -- Pause local orchestration authority. Provider dispatches that have
    -- already reached submitted remain untouched and can still be reconciled.
    update public.production_run_statuses
    set state = 'paused',version = version + 1,
        reason = 'Workspace authority changed; owner-MVP authority is stale.',
        changed_at = statement_timestamp()
    where workspace_id = p_workspace_id
      and state in ('authorized','queued','running','waiting_external','waiting_decision');
  end if;
end;
$$;

create or replace function private.reconcile_workspace_authority_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.reconcile_workspace_authority(
      old.workspace_id,'membership deleted'
    );
    return old;
  end if;
  if tg_op = 'UPDATE' and old.workspace_id <> new.workspace_id then
    perform private.reconcile_workspace_authority(
      old.workspace_id,'membership moved from workspace'
    );
  end if;
  perform private.reconcile_workspace_authority(
    new.workspace_id,
    case tg_op when 'INSERT' then 'membership inserted'
      else 'membership role or status changed' end
  );
  return new;
end;
$$;

create trigger memberships_reconcile_workspace_authority
after insert or update of workspace_id,role,status or delete
on public.memberships
for each row execute function private.reconcile_workspace_authority_membership();

-- Restore the shared contract to its literal meaning. Team administration,
-- broker authority, reviewer appointment, and every non-allowlisted caller
-- remain strict AAL2.
create or replace function private.assert_aal2()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'authenticated'
    or auth.uid() is null
    or private.current_aal() <> 'aal2'
  then
    raise exception 'AAL2 authenticated authority required'
      using errcode = '42501';
  end if;
end;
$$;

comment on function private.assert_aal2() is
  'Strict shared AAL2 guard. Narrow owner-MVP AAL1 exceptions use private.assert_workspace_action_authority instead.';

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
  );

  return jsonb_build_object(
    'workspaceId',p_workspace_id,'actionKey',p_action_key,
    'actorUserId',actor_id,'actorAal',actual_aal,
    'authorityProfileId',profile_row.id,
    'authorityProfileEpoch',profile_row.profile_epoch,
    'authorityProvenance',provenance
  );
end;
$$;

create or replace function private.workspace_action_is_authorized(
  p_workspace_id uuid,
  p_action_key text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.assert_workspace_action_authority(
    p_workspace_id,p_action_key
  );
  return true;
end;
$$;

create or replace function private.assert_workspace_profile_epoch(
  p_workspace_id uuid,
  p_authority_profile_id uuid,
  p_authority_profile_epoch bigint,
  p_authority_provenance text,
  p_boundary text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_row private.workspace_authority_profiles%rowtype;
begin
  select * into profile_row
  from private.workspace_authority_profiles profile
  where profile.workspace_id = p_workspace_id;
  if profile_row.id is null
    or p_authority_provenance = 'legacy_unverified'
    or p_authority_profile_id is distinct from profile_row.id
    or p_authority_profile_epoch is distinct from profile_row.profile_epoch
    or (
      profile_row.profile_kind = 'single_owner_developer'
      and not private.workspace_has_exact_single_owner(
        p_workspace_id,profile_row.owner_user_id
      )
    )
  then
    raise exception '% authority profile epoch is stale',
      coalesce(nullif(btrim(p_boundary),''),'workspace')
      using errcode = '40001';
  end if;
end;
$$;

create or replace function private.workspace_allows_owner_mvp_spend(
  p_workspace_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.workspace_authority_profiles profile
    where profile.workspace_id = p_workspace_id
      and profile.profile_kind = 'single_owner_developer'
      and private.workspace_has_exact_single_owner(
        p_workspace_id,profile.owner_user_id
      )
  )
$$;

create or replace function private.assert_workspace_spend_envelope(
  p_workspace_id uuid,
  p_high_microusd bigint,
  p_hard_ceiling_microusd bigint
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_workspace_id is null or p_high_microusd is null
    or p_hard_ceiling_microusd is null or p_high_microusd < 0
    or p_hard_ceiling_microusd < p_high_microusd
  then
    raise exception 'production spend envelope is invalid'
      using errcode = '22023';
  end if;
  if not private.workspace_allows_owner_mvp_spend(p_workspace_id)
    and (p_high_microusd > 50000000
      or p_hard_ceiling_microusd > 50000000)
  then
    raise exception 'managed workspace production ceiling exceeds 50000000 microusd'
      using errcode = '23514';
  end if;
end;
$$;

-- Existing rows created under the global AAL1 override cannot be attributed
-- honestly. Keep them unchanged and mark them legacy_unverified; triggers below
-- stamp all authenticated new authority rows with actual JWT AAL + exact profile.
do $$
declare
  target text;
  target_schema text;
  target_table text;
begin
  foreach target in array array[
    'private.micro_authorizations',
    'private.world_build_spend_intents',
    'public.source_review_decisions',
    'public.production_quote_confirmations',
    'public.series_release_decisions',
    'private.production_budget_authorizations',
    'private.production_budget_reservations',
    'public.production_runs',
    'public.mvp_production_jobs',
    'public.mvp_master_reviews',
    'public.mvp_master_cultural_decisions',
    'public.mvp_master_final_decisions',
    'private.mvp_media_dispatches'
  ] loop
    target_schema := split_part(target,'.',1);
    target_table := split_part(target,'.',2);
    execute format(
      'alter table %I.%I add column authority_profile_id uuid references private.workspace_authority_profiles(id) on delete restrict',
      target_schema,target_table
    );
    execute format(
      'alter table %I.%I add column authority_profile_epoch bigint check (authority_profile_epoch is null or authority_profile_epoch > 0)',
      target_schema,target_table
    );
    execute format(
      'alter table %I.%I add column authority_provenance text not null default ''legacy_unverified'' check (authority_provenance in (''legacy_unverified'',''verified_aal2'',''verified_single_owner_developer''))',
      target_schema,target_table
    );
    execute format(
      'alter table %I.%I add constraint %I check ((authority_provenance = ''legacy_unverified'' and authority_profile_id is null and authority_profile_epoch is null) or (authority_provenance <> ''legacy_unverified'' and authority_profile_id is not null and authority_profile_epoch > 0))',
      target_schema,target_table,target_table || '_authority_provenance_shape_check'
    );
  end loop;
end;
$$;

alter table private.micro_authorizations
  drop constraint if exists micro_authorizations_aal_check;
alter table private.micro_authorizations
  add constraint micro_authorizations_aal_check check (aal in ('aal1','aal2'));
alter table private.world_build_spend_intents
  drop constraint if exists world_build_spend_intents_aal_check;
alter table private.world_build_spend_intents
  add constraint world_build_spend_intents_aal_check check (aal in ('aal1','aal2'));

do $$
declare target text; target_schema text; target_table text;
begin
  foreach target in array array[
    'public.source_review_decisions','public.production_quote_confirmations',
    'public.series_release_decisions','private.production_budget_authorizations',
    'public.mvp_master_reviews','public.mvp_master_cultural_decisions',
    'public.mvp_master_final_decisions'
  ] loop
    target_schema := split_part(target,'.',1);
    target_table := split_part(target,'.',2);
    execute format(
      'alter table %I.%I drop constraint if exists %I',
      target_schema,target_table,target_table || '_actor_aal_check'
    );
    execute format(
      'alter table %I.%I add constraint %I check (actor_aal in (''aal1'',''aal2''))',
      target_schema,target_table,target_table || '_actor_aal_check'
    );
  end loop;
end;
$$;

alter table private.mvp_media_dispatches
  drop constraint if exists mvp_media_dispatches_expected_cost_microusd_check;
alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_expected_cost_microusd_check
  check (expected_cost_microusd >= 0);
alter table private.mvp_media_dispatches
  drop constraint if exists mvp_media_dispatches_maximum_cost_microusd_check;
alter table private.mvp_media_dispatches
  add constraint mvp_media_dispatches_maximum_cost_microusd_check
  check (maximum_cost_microusd >= expected_cost_microusd);

create or replace function private.stamp_workspace_authority_actor_aal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_workspace uuid;
  context_profile uuid;
  context_epoch bigint;
  context_aal text;
  context_provenance text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'authenticated' then
    new.authority_profile_id := null;
    new.authority_profile_epoch := null;
    new.authority_provenance := 'legacy_unverified';
    return new;
  end if;
  context_workspace := nullif(
    current_setting('genie.authority.workspace_id',true),''
  )::uuid;
  context_profile := nullif(
    current_setting('genie.authority.profile_id',true),''
  )::uuid;
  context_epoch := nullif(
    current_setting('genie.authority.profile_epoch',true),''
  )::bigint;
  context_aal := nullif(
    current_setting('genie.authority.actor_aal',true),''
  );
  context_provenance := nullif(
    current_setting('genie.authority.provenance',true),''
  );
  if context_workspace is distinct from new.workspace_id
    or not (
      current_setting('genie.authority.action_key',true)
        = any(string_to_array(tg_argv[0],','))
    )
    or context_aal is distinct from private.current_aal()
  then
    raise exception 'workspace authority provenance context is unavailable'
      using errcode = '42501';
  end if;
  perform private.assert_workspace_profile_epoch(
    new.workspace_id,context_profile,context_epoch,context_provenance,
    tg_argv[0]
  );
  new.actor_aal := context_aal;
  new.authority_profile_id := context_profile;
  new.authority_profile_epoch := context_epoch;
  new.authority_provenance := context_provenance;
  return new;
end;
$$;

create or replace function private.stamp_workspace_authority_aal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare stamped jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'authenticated' then
    new.authority_profile_id := null;
    new.authority_profile_epoch := null;
    new.authority_provenance := 'legacy_unverified';
    return new;
  end if;
  stamped := jsonb_build_object(
    'workspaceId',current_setting('genie.authority.workspace_id',true),
    'profileId',current_setting('genie.authority.profile_id',true),
    'profileEpoch',current_setting('genie.authority.profile_epoch',true),
    'actorAal',current_setting('genie.authority.actor_aal',true),
    'provenance',current_setting('genie.authority.provenance',true),
    'actionKey',current_setting('genie.authority.action_key',true)
  );
  if nullif(stamped->>'workspaceId','')::uuid is distinct from new.workspace_id
    or not (
      stamped->>'actionKey' = any(string_to_array(tg_argv[0],','))
    )
    or stamped->>'actorAal' is distinct from private.current_aal()
  then
    raise exception 'workspace authority provenance context is unavailable'
      using errcode = '42501';
  end if;
  perform private.assert_workspace_profile_epoch(
    new.workspace_id,nullif(stamped->>'profileId','')::uuid,
    nullif(stamped->>'profileEpoch','')::bigint,stamped->>'provenance',
    tg_argv[0]
  );
  new.aal := stamped->>'actorAal';
  new.authority_profile_id := nullif(stamped->>'profileId','')::uuid;
  new.authority_profile_epoch := nullif(stamped->>'profileEpoch','')::bigint;
  new.authority_provenance := stamped->>'provenance';
  return new;
end;
$$;

create or replace function private.stamp_workspace_authority_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  context_workspace uuid;
  context_profile uuid;
  context_epoch bigint;
  context_provenance text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'authenticated' then
    new.authority_profile_id := null;
    new.authority_profile_epoch := null;
    new.authority_provenance := 'legacy_unverified';
    return new;
  end if;
  context_workspace := nullif(current_setting(
    'genie.authority.workspace_id',true
  ),'')::uuid;
  context_profile := nullif(current_setting(
    'genie.authority.profile_id',true
  ),'')::uuid;
  context_epoch := nullif(current_setting(
    'genie.authority.profile_epoch',true
  ),'')::bigint;
  context_provenance := nullif(current_setting(
    'genie.authority.provenance',true
  ),'');
  if context_workspace is distinct from new.workspace_id
    or not (
      current_setting('genie.authority.action_key',true)
        = any(string_to_array(tg_argv[0],','))
    )
  then
    raise exception 'workspace authority provenance context is unavailable'
      using errcode = '42501';
  end if;
  perform private.assert_workspace_profile_epoch(
    new.workspace_id,context_profile,context_epoch,context_provenance,
    tg_argv[0]
  );
  new.authority_profile_id := context_profile;
  new.authority_profile_epoch := context_epoch;
  new.authority_provenance := context_provenance;
  return new;
end;
$$;

create or replace function private.enforce_workspace_spend_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare row_json jsonb := to_jsonb(new); high_value bigint; ceiling_value bigint;
begin
  high_value := (row_json->>tg_argv[0])::bigint;
  ceiling_value := (row_json->>tg_argv[1])::bigint;
  perform private.assert_workspace_spend_envelope(
    new.workspace_id,high_value,ceiling_value
  );
  return new;
end;
$$;

create trigger micro_authorizations_stamp_workspace_authority
before insert on private.micro_authorizations
for each row execute function private.stamp_workspace_authority_aal(
  'micro_quote_authorize'
);
create trigger world_build_spend_intents_stamp_workspace_authority
before insert on private.world_build_spend_intents
for each row execute function private.stamp_workspace_authority_aal(
  'world_spend_authorize'
);
create trigger source_review_decisions_stamp_workspace_authority
before insert on public.source_review_decisions
for each row execute function private.stamp_workspace_authority_actor_aal(
  'source_review'
);
create trigger production_quote_confirmations_stamp_workspace_authority
before insert on public.production_quote_confirmations
for each row execute function private.stamp_workspace_authority_actor_aal(
  'production_quote_confirm'
);
create trigger series_release_decisions_stamp_workspace_authority
before insert on public.series_release_decisions
for each row execute function private.stamp_workspace_authority_actor_aal(
  'world_lock_commit'
);
create trigger production_budget_authorizations_stamp_workspace_authority
before insert on private.production_budget_authorizations
for each row execute function private.stamp_workspace_authority_actor_aal(
  'world_lock_commit'
);
create trigger production_budget_reservations_stamp_workspace_authority
before insert on private.production_budget_reservations
for each row execute function private.stamp_workspace_authority_profile(
  'world_lock_commit'
);
create trigger production_runs_stamp_workspace_authority
before insert on public.production_runs
for each row execute function private.stamp_workspace_authority_profile(
  'world_lock_commit'
);
create trigger mvp_master_reviews_stamp_workspace_authority
before insert on public.mvp_master_reviews
for each row execute function private.stamp_workspace_authority_actor_aal(
  'mvp_review,mvp_final_review'
);
create trigger mvp_master_cultural_decisions_stamp_workspace_authority
before insert on public.mvp_master_cultural_decisions
for each row execute function private.stamp_workspace_authority_actor_aal(
  'mvp_cultural_review'
);
create trigger mvp_master_final_decisions_stamp_workspace_authority
before insert on public.mvp_master_final_decisions
for each row execute function private.stamp_workspace_authority_actor_aal(
  'mvp_final_review'
);

create trigger production_quotes_enforce_workspace_spend
before insert on public.production_quotes
for each row execute function private.enforce_workspace_spend_insert(
  'high_total_microusd','hard_ceiling_microusd'
);
create trigger production_quote_confirmations_enforce_workspace_spend
before insert on public.production_quote_confirmations
for each row execute function private.enforce_workspace_spend_insert(
  'hard_ceiling_microusd','hard_ceiling_microusd'
);
create trigger production_budget_authorizations_enforce_workspace_spend
before insert on private.production_budget_authorizations
for each row execute function private.enforce_workspace_spend_insert(
  'authorized_high_microusd','hard_ceiling_microusd'
);
create trigger production_budget_reservations_enforce_workspace_spend
before insert on private.production_budget_reservations
for each row execute function private.enforce_workspace_spend_insert(
  'reserved_microusd','reserved_microusd'
);
create trigger production_runs_enforce_workspace_spend
before insert on public.production_runs
for each row execute function private.enforce_workspace_spend_insert(
  'authorized_high_microusd','hard_ceiling_microusd'
);
create trigger mvp_media_dispatches_enforce_workspace_spend
before insert on private.mvp_media_dispatches
for each row execute function private.enforce_workspace_spend_insert(
  'expected_cost_microusd','maximum_cost_microusd'
);

create or replace function private.stamp_mvp_job_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare run_row public.production_runs%rowtype;
begin
  if coalesce(auth.jwt()->>'role','') <> 'authenticated' then
    new.authority_profile_id := null;
    new.authority_profile_epoch := null;
    new.authority_provenance := 'legacy_unverified';
    return new;
  end if;
  select * into run_row from public.production_runs run
  where run.id = new.production_run_id and run.workspace_id = new.workspace_id;
  perform private.assert_workspace_profile_epoch(
    new.workspace_id,run_row.authority_profile_id,
    run_row.authority_profile_epoch,run_row.authority_provenance,'mvp start'
  );
  new.authority_profile_id := run_row.authority_profile_id;
  new.authority_profile_epoch := run_row.authority_profile_epoch;
  new.authority_provenance := run_row.authority_provenance;
  return new;
end;
$$;

create or replace function private.stamp_mvp_media_dispatch_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare job_row public.mvp_production_jobs%rowtype;
begin
  select * into job_row from public.mvp_production_jobs job
  where job.production_run_id = new.production_run_id
    and job.workspace_id = new.workspace_id;
  perform private.assert_workspace_profile_epoch(
    new.workspace_id,job_row.authority_profile_id,
    job_row.authority_profile_epoch,job_row.authority_provenance,
    'media dispatch reserve'
  );
  new.authority_profile_id := job_row.authority_profile_id;
  new.authority_profile_epoch := job_row.authority_profile_epoch;
  new.authority_provenance := job_row.authority_provenance;
  return new;
end;
$$;

create or replace function private.guard_mvp_claim_authority_epoch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'mvp_production_jobs'
    and new.worker_claim_token is not null
    and new.worker_claim_token is distinct from old.worker_claim_token
  then
    perform private.assert_workspace_profile_epoch(
      new.workspace_id,new.authority_profile_id,new.authority_profile_epoch,
      new.authority_provenance,'mvp job claim'
    );
  elsif tg_table_name = 'mvp_media_dispatches'
    and new.state = 'dispatching' and old.state <> 'dispatching'
  then
    perform private.assert_workspace_profile_epoch(
      new.workspace_id,new.authority_profile_id,new.authority_profile_epoch,
      new.authority_provenance,'media dispatch claim'
    );
  end if;
  return new;
end;
$$;

create trigger mvp_production_jobs_stamp_workspace_authority
before insert on public.mvp_production_jobs
for each row execute function private.stamp_mvp_job_authority();
create trigger mvp_media_dispatches_stamp_workspace_authority
before insert on private.mvp_media_dispatches
for each row execute function private.stamp_mvp_media_dispatch_authority();
create trigger mvp_production_jobs_guard_claim_authority_epoch
before update of worker_claim_token on public.mvp_production_jobs
for each row execute function private.guard_mvp_claim_authority_epoch();
create trigger mvp_media_dispatches_guard_claim_authority_epoch
before update of state on private.mvp_media_dispatches
for each row execute function private.guard_mvp_claim_authority_epoch();

-- Replace only the exact current authority calls/predicates. Drift fails the
-- migration rather than silently broadening or omitting an action boundary.
do $$
declare
  item record;
  definition text;
  needle text := 'perform private.assert_aal2();';
begin
  for item in select * from (values
    ('public.command_authorize_micro_quote(uuid,uuid,bigint,text,bigint,uuid,text,text,uuid)'::regprocedure,'micro_quote_authorize'),
    ('public.command_submit_source_review(uuid,uuid,uuid,bigint,text,text,text,uuid,text,text,uuid)'::regprocedure,'source_review'),
    ('public.command_retry_mvp_production(uuid,uuid,bigint)'::regprocedure,'mvp_retry'),
    ('public.command_record_mvp_master_cultural_decision(uuid,uuid,bigint,text,text)'::regprocedure,'mvp_cultural_review')
  ) value(function_signature,action_key)
  loop
    definition := pg_get_functiondef(item.function_signature);
    if length(definition) - length(replace(definition,needle,''))
      <> length(needle)
    then
      raise exception 'Expected one strict AAL2 call in %',item.function_signature;
    end if;
    definition := replace(definition,needle,format(
      'perform private.assert_workspace_action_authority(p_workspace_id,%L);',
      item.action_key
    ));
    execute definition;
  end loop;
end;
$$;

do $$
declare definition text; needle text := 'perform private.assert_aal2();';
begin
  definition := pg_get_functiondef(
    'public.command_review_mvp_master(uuid,uuid,bigint,text,boolean,boolean,text)'::regprocedure
  );
  if length(definition) - length(replace(definition,needle,''))
    <> length(needle)
  then
    raise exception 'Expected one strict AAL2 call in MVP master review';
  end if;
  definition := replace(definition,needle,
    E'perform private.assert_workspace_action_authority(\n    p_workspace_id,case when p_decision = ''approve''\n      then ''mvp_final_review'' else ''mvp_review'' end\n  );'
  );
  execute definition;
end;
$$;

do $$
declare item record; definition text; needle text;
begin
  for item in select * from (values
    ('public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure,'production_quote_confirm'),
    ('public.prepare_first_episode_world_lock(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint)'::regprocedure,'world_lock_prepare'),
    ('public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure,'world_lock_commit')
  ) value(function_signature,action_key)
  loop
    definition := pg_get_functiondef(item.function_signature);
    needle := 'private.current_aal() not in (''aal1'',''aal2'')';
    if position(needle in definition) = 0 then
      raise exception 'Expected developer-MVP AAL predicate in %',
        item.function_signature;
    end if;
    definition := replace(definition,needle,format(
      'not private.workspace_action_is_authorized(p_workspace_id,%L)',
      item.action_key
    ));
    execute definition;
  end loop;
end;
$$;

do $$
declare definition text; needle text;
begin
  definition := pg_get_functiondef(
    'public.command_authorize_world_build_intent(uuid,uuid,uuid,bigint,bigint,uuid,text,text)'::regprocedure
  );
  needle := 'perform private.assert_active_session(p_workspace_id);';
  if position(needle in definition) = 0 then
    raise exception 'World-spend active-session boundary drifted';
  end if;
  definition := replace(definition,needle,needle || E'\n  ' ||
    'perform private.assert_workspace_action_authority(p_workspace_id,''world_spend_authorize'');');
  execute definition;
end;
$$;

do $$
declare definition text; needle text;
begin
  definition := pg_get_functiondef(
    'public.command_start_mvp_production(uuid,uuid)'::regprocedure
  );
  needle := E'begin\n  if actor_id is null or not private.is_active_member';
  if position(needle in definition) = 0 then
    raise exception 'MVP start membership boundary drifted';
  end if;
  definition := replace(definition,needle,
    E'begin\n  perform private.assert_workspace_action_authority(p_workspace_id,''mvp_start'');\n  if actor_id is null or not private.is_active_member');
  needle := E'  if not found then\n    raise exception ''production authority unavailable'' using errcode = ''42501'';\n  end if;';
  if position(needle in definition) = 0 then
    raise exception 'MVP start production-authority boundary drifted';
  end if;
  definition := replace(definition,needle,needle || E'\n  perform private.assert_workspace_profile_epoch(\n    p_workspace_id,run_row.authority_profile_id,\n    run_row.authority_profile_epoch,run_row.authority_provenance,''mvp start''\n  );\n  perform private.assert_workspace_spend_envelope(\n    p_workspace_id,run_row.authorized_high_microusd,\n    run_row.hard_ceiling_microusd\n  );');
  execute definition;
end;
$$;

-- Service-side quote preparation/recording still obeys the profile cap.
do $$
declare item regprocedure; definition text; needle text := E'begin\n';
begin
  foreach item in array array[
    'public.prepare_production_quote(uuid,uuid,uuid,bigint,timestamptz,jsonb)'::regprocedure,
    'public.command_record_production_quote(uuid,uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb)'::regprocedure
  ] loop
    definition := pg_get_functiondef(item);
    if position(needle in definition) = 0 then
      raise exception 'Production quote function body drifted: %',item;
    end if;
    definition := regexp_replace(
      definition,'begin\n',
      E'begin\n  perform private.assert_workspace_spend_envelope(\n    p_workspace_id,p_hard_ceiling_microusd,p_hard_ceiling_microusd\n  );\n',
      ''
    );
    execute definition;
  end loop;
end;
$$;

-- Preparation reads the bound quote/confirmation but writes nothing, so add
-- an explicit envelope check after both rows are loaded.
do $$
declare definition text; needle text;
begin
  definition := pg_get_functiondef(
    'public.prepare_first_episode_world_lock(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint)'::regprocedure
  );
  needle := E'  if config.id is null or series_row.aggregate_version';
  if position(needle in definition) = 0 then
    raise exception 'World Lock preparation quote boundary drifted';
  end if;
  definition := replace(definition,needle,
    E'  perform private.assert_workspace_spend_envelope(\n    p_workspace_id,quote.high_total_microusd,\n    confirmation.hard_ceiling_microusd\n  );\n' || needle);
  execute definition;
end;
$$;

revoke all on function private.workspace_has_exact_single_owner(uuid,uuid),
  private.lock_workspace_authority(uuid),
  private.guard_workspace_authority_profile_update(),
  private.reconcile_workspace_authority(uuid,text),
  private.reconcile_workspace_authority_membership(),
  private.assert_workspace_action_authority(uuid,text),
  private.workspace_action_is_authorized(uuid,text),
  private.assert_workspace_profile_epoch(uuid,uuid,bigint,text,text),
  private.workspace_allows_owner_mvp_spend(uuid),
  private.assert_workspace_spend_envelope(uuid,bigint,bigint),
  private.stamp_workspace_authority_actor_aal(),
  private.stamp_workspace_authority_aal(),
  private.stamp_workspace_authority_profile(),
  private.enforce_workspace_spend_insert(),
  private.stamp_mvp_job_authority(),
  private.stamp_mvp_media_dispatch_authority(),
  private.guard_mvp_claim_authority_epoch()
from public,anon,authenticated;

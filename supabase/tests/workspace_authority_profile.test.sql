-- Isolated contract for 20260721184000_owner_mvp_authority_profile.sql.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth,storage,private,audit,pg_catalog;

select plan(34);

select has_table(
  'private','workspace_authority_profiles',
  'workspace authority profiles are durable private state'
);
select has_table(
  'private','workspace_authority_events',
  'workspace authority transitions have an append-only event ledger'
);
select has_table(
  'private','workspace_authority_receipts',
  'every permitted owner-MVP guard records exact authority provenance'
);
select has_column(
  'public','production_quote_confirmations','authority_profile_id',
  'production quote confirmations bind the exact authority profile'
);
select has_column(
  'public','mvp_production_jobs','authority_profile_epoch',
  'MVP jobs persist the authority profile epoch'
);
select has_column(
  'private','mvp_media_dispatches','authority_profile_epoch',
  'media dispatches persist the authority profile epoch'
);
select has_trigger(
  'public','memberships','memberships_reconcile_workspace_authority',
  'membership changes reconcile the one-way authority profile'
);
select has_trigger(
  'public','mvp_production_jobs',
  'mvp_production_jobs_guard_claim_authority_epoch',
  'MVP job claims recheck the stored profile epoch'
);
select has_trigger(
  'private','mvp_media_dispatches',
  'mvp_media_dispatches_guard_claim_authority_epoch',
  'media-dispatch claims recheck the stored profile epoch'
);

select ok(
  not exists (
    select 1
    from private.workspace_authority_profiles profile
    left join lateral (
      select
        count(*) filter (where membership.status = 'active')::integer
          as active_count,
        count(*) filter (
          where membership.status = 'active' and membership.role = 'admin'
        )::integer as admin_count
      from public.memberships membership
      where membership.workspace_id = profile.workspace_id
    ) member on true
    where (member.active_count = 1 and member.admin_count = 1)
      is distinct from (profile.profile_kind = 'single_owner_developer')
  ),
  'bootstrap classifies exactly-one-active-admin workspaces and all others exactly'
);

insert into auth.users(
  id,email,email_confirmed_at,created_at,updated_at,aud,role
) values
  ('d1200000-0000-4000-8000-000000000001','owner-a@zyra.test',
    statement_timestamp(),statement_timestamp(),statement_timestamp(),
    'authenticated','authenticated'),
  ('d1200000-0000-4000-8000-000000000002','owner-b@zyra.test',
    statement_timestamp(),statement_timestamp(),statement_timestamp(),
    'authenticated','authenticated'),
  ('d1200000-0000-4000-8000-000000000003','member-a@zyra.test',
    statement_timestamp(),statement_timestamp(),statement_timestamp(),
    'authenticated','authenticated');

insert into public.organizations(id,name,slug) values
  ('d1000000-0000-4000-8000-000000000001',
    'Authority profile fixture','authority-profile-fixture');
insert into public.workspaces(id,organization_id,name,slug) values
  ('d1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Owner A workspace','owner-a-workspace'),
  ('d1100000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'Owner B workspace','owner-b-workspace');
insert into public.memberships(
  workspace_id,user_id,role,status,authority_epoch,activated_at
) values
  ('d1100000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001','admin','active',1,
    statement_timestamp()),
  ('d1100000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000002','admin','active',1,
    statement_timestamp());
insert into private.membership_session_authorizations(
  workspace_id,user_id,authority_epoch,session_id
) values
  ('d1100000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001',1,
    'd1210000-0000-4000-8000-000000000001'),
  ('d1100000-0000-4000-8000-000000000002',
    'd1200000-0000-4000-8000-000000000002',1,
    'd1210000-0000-4000-8000-000000000002');

select is(
  (
    select count(*)::integer
    from private.workspace_authority_profiles
    where workspace_id in (
      'd1100000-0000-4000-8000-000000000001',
      'd1100000-0000-4000-8000-000000000002'
    ) and profile_kind = 'single_owner_developer'
  ),
  2,
  'a newly observed exact single-admin membership bootstraps single-owner authority'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"d1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"d1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub','d1200000-0000-4000-8000-000000000001',true
);
select set_config('request.jwt.claim.role','authenticated',true);
grant usage on schema private to authenticated;
grant execute on function private.assert_workspace_action_authority(uuid,text),
  private.assert_aal2(),private.current_aal()
to authenticated;
set local role authenticated;
select lives_ok(
  $$select private.assert_workspace_action_authority(
    'd1100000-0000-4000-8000-000000000001','mvp_start'
  )$$,
  'the exact stored single owner may use the narrow MVP action at AAL1'
);
reset role;
select is(
  (
    select actor_aal from private.workspace_authority_receipts
    where workspace_id = 'd1100000-0000-4000-8000-000000000001'
    order by id desc limit 1
  ),
  'aal1',
  'owner-MVP receipt records the actual JWT AAL'
);
select is(
  (
    select authority_provenance
    from private.workspace_authority_receipts
    where workspace_id = 'd1100000-0000-4000-8000-000000000001'
    order by id desc limit 1
  ),
  'verified_single_owner_developer',
  'owner-MVP receipt identifies the exact single-owner provenance'
);
select ok(
  exists (
    select 1
    from private.workspace_authority_receipts receipt
    join private.workspace_authority_profiles profile
      on profile.id = receipt.authority_profile_id
     and profile.profile_epoch = receipt.authority_profile_epoch
    where receipt.workspace_id = 'd1100000-0000-4000-8000-000000000001'
      and profile.workspace_id = receipt.workspace_id
  ),
  'owner-MVP receipt stores the exact current profile id and epoch'
);
set local role authenticated;
select throws_ok(
  $$select private.assert_aal2()$$,
  '42501','AAL2 authenticated authority required',
  'the shared AAL2 guard is strict again'
);
select throws_ok(
  $$select private.assert_workspace_action_authority(
    'd1100000-0000-4000-8000-000000000001','create_invitation'
  )$$,
  '42501','workspace action is not owner-MVP allowlisted',
  'owner AAL1 cannot escape into general team administration'
);
reset role;

create temp table saved_authority_profile(
  workspace_id uuid primary key,
  authority_profile_id uuid not null,
  authority_profile_epoch bigint not null,
  authority_provenance text not null
) on commit drop;
insert into saved_authority_profile
select workspace_id,id,profile_epoch,'verified_single_owner_developer'
from private.workspace_authority_profiles
where workspace_id = 'd1100000-0000-4000-8000-000000000001';

insert into public.memberships(
  workspace_id,user_id,role,status,authority_epoch,activated_at
) values (
  'd1100000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000003','member','active',1,
  statement_timestamp()
);

select is(
  (
    select profile_kind from private.workspace_authority_profiles
    where workspace_id = 'd1100000-0000-4000-8000-000000000001'
  ),
  'managed_team',
  'a second active member transitions the workspace to managed-team authority'
);
select is(
  (
    select profile_epoch from private.workspace_authority_profiles
    where workspace_id = 'd1100000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'the single-owner to managed-team transition increments the profile epoch'
);
select ok(
  exists (
    select 1 from private.workspace_authority_events
    where workspace_id = 'd1100000-0000-4000-8000-000000000001'
      and event_kind = 'transition'
      and prior_profile_kind = 'single_owner_developer'
      and new_profile_kind = 'managed_team'
      and prior_profile_epoch = 1 and new_profile_epoch = 2
  ),
  'the one-way transition appends its exact immutable epoch event'
);
set local role authenticated;
select throws_ok(
  $$select private.assert_workspace_action_authority(
    'd1100000-0000-4000-8000-000000000001','mvp_start'
  )$$,
  '42501','AAL2 required for this workspace authority profile',
  'ordinary managed-workspace AAL1 authority is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"d1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"d1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub','d1200000-0000-4000-8000-000000000001',true
);
select set_config('request.jwt.claim.role','authenticated',true);
select lives_ok(
  $$select private.assert_workspace_action_authority(
    'd1100000-0000-4000-8000-000000000001','mvp_start'
  )$$,
  'managed-workspace permitted actions remain available at AAL2'
);
reset role;

update public.memberships
set status = 'deactivated',deactivated_at = statement_timestamp(),
    authority_epoch = authority_epoch + 1
where workspace_id = 'd1100000-0000-4000-8000-000000000001'
  and user_id = 'd1200000-0000-4000-8000-000000000003';
select is(
  (
    select profile_kind from private.workspace_authority_profiles
    where workspace_id = 'd1100000-0000-4000-8000-000000000001'
  ),
  'managed_team',
  'managed-team authority never auto-downgrades after membership contracts'
);

select lives_ok(
  $$select private.assert_workspace_spend_envelope(
    'd1100000-0000-4000-8000-000000000001',50000000,50000000
  )$$,
  'managed workspaces accept the exact 50000000 microusd boundary'
);
select throws_ok(
  $$select private.assert_workspace_spend_envelope(
    'd1100000-0000-4000-8000-000000000001',50000001,50000001
  )$$,
  '23514','managed workspace production ceiling exceeds 50000000 microusd',
  'managed workspaces reject 50000001 microusd'
);
select lives_ok(
  $$select private.assert_workspace_spend_envelope(
    'd1100000-0000-4000-8000-000000000002',50000001,70000000
  )$$,
  'an exact single-owner developer workspace may exceed USD 50'
);
select throws_ok(
  $$select private.assert_workspace_spend_envelope(
    'd1100000-0000-4000-8000-000000000002',70000001,70000000
  )$$,
  '22023','production spend envelope is invalid',
  'owner-MVP spend still enforces exact high less-than-or-equal-to ceiling math'
);

select throws_ok(
  format(
    'select private.assert_workspace_profile_epoch(%L,%L,%s,%L,%L)',
    workspace_id,authority_profile_id,authority_profile_epoch,
    authority_provenance,'mvp start'
  ),
  '40001','mvp start authority profile epoch is stale',
  'MVP start rejects a stale owner profile epoch'
)
from saved_authority_profile;
select throws_ok(
  format(
    'select private.assert_workspace_profile_epoch(%L,%L,%s,%L,%L)',
    workspace_id,authority_profile_id,authority_profile_epoch,
    authority_provenance,'mvp job claim'
  ),
  '40001','mvp job claim authority profile epoch is stale',
  'MVP job claim rejects a stale owner profile epoch'
)
from saved_authority_profile;
select throws_ok(
  format(
    'select private.assert_workspace_profile_epoch(%L,%L,%s,%L,%L)',
    workspace_id,authority_profile_id,authority_profile_epoch,
    authority_provenance,'media dispatch claim'
  ),
  '40001','media dispatch claim authority profile epoch is stale',
  'media-dispatch claim rejects a stale owner profile epoch'
)
from saved_authority_profile;

select ok(
  pg_get_functiondef(
    'public.command_start_mvp_production(uuid,uuid)'::regprocedure
  ) like '%assert_workspace_profile_epoch%'
  and pg_get_functiondef(
    'public.command_start_mvp_production(uuid,uuid)'::regprocedure
  ) like '%assert_workspace_spend_envelope%',
  'MVP start invokes both the epoch and spend boundaries'
);
select ok(
  pg_get_functiondef(
    'public.prepare_production_quote(uuid,uuid,uuid,bigint,timestamptz,jsonb)'::regprocedure
  ) like '%assert_workspace_spend_envelope%'
  and pg_get_functiondef(
    'public.command_record_production_quote(uuid,uuid,uuid,uuid,uuid,text,text,bigint,timestamptz,jsonb)'::regprocedure
  ) like '%assert_workspace_spend_envelope%'
  and pg_get_functiondef(
    'public.prepare_first_episode_world_lock(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint)'::regprocedure
  ) like '%assert_workspace_spend_envelope%',
  'prepare, record, and World Lock preparation enforce the managed USD 50 boundary'
);
select ok(
  pg_get_functiondef('private.assert_broker_admin(uuid)'::regprocedure)
    like '%private.assert_aal2()%'
  and pg_get_functiondef(
    'public.command_create_invitation(uuid,text,text,public.membership_role,timestamptz,uuid,text,text,uuid)'::regprocedure
  ) like '%private.assert_aal2()%'
  and pg_get_functiondef(
    'public.command_appoint_cultural_reviewer(uuid,uuid,text[],text[],text[],text[],text,text,timestamptz,timestamptz,uuid,text,text,uuid)'::regprocedure
  ) like '%private.assert_aal2()%',
  'broker and general team administration remain on the strict shared AAL2 guard'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'production_runs'
      and column_name = 'authority_provenance'
      and column_default like '%legacy_unverified%'
  ),
  'ambiguous preexisting authority rows are tagged legacy_unverified without guessing'
);

select * from finish();
rollback;

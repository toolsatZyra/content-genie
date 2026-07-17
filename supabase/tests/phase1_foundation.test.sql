begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, storage, private, audit, pg_catalog;

select plan(50);

insert into public.organizations (id, name, slug)
values ('10000000-0000-0000-0000-000000000001', 'Zyra', 'zyra');

insert into public.workspaces (id, organization_id, name, slug)
values
  (
    '10000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000001',
    'Genie One',
    'genie-one'
  ),
  (
    '10000000-0000-0000-0000-000000000102',
    '10000000-0000-0000-0000-000000000001',
    'Genie Two',
    'genie-two'
  );

insert into auth.users (
  id, email, email_confirmed_at, created_at, updated_at, aud, role
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'member.one@zyra.test',
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp(),
    'authenticated',
    'authenticated'
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'member.two@zyra.test',
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp(),
    'authenticated',
    'authenticated'
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'admin@zyra.test',
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp(),
    'authenticated',
    'authenticated'
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'invitee@zyra.test',
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp(),
    'authenticated',
    'authenticated'
  );

insert into public.profiles (user_id, display_name)
values
  ('20000000-0000-0000-0000-000000000001', 'Member One'),
  ('20000000-0000-0000-0000-000000000002', 'Member Two'),
  ('20000000-0000-0000-0000-000000000003', 'Admin');

insert into public.memberships (
  workspace_id, user_id, role, status, activated_at
)
values
  (
    '10000000-0000-0000-0000-000000000101',
    '20000000-0000-0000-0000-000000000001',
    'member',
    'active',
    statement_timestamp()
  ),
  (
    '10000000-0000-0000-0000-000000000102',
    '20000000-0000-0000-0000-000000000002',
    'member',
    'active',
    statement_timestamp()
  ),
  (
    '10000000-0000-0000-0000-000000000101',
    '20000000-0000-0000-0000-000000000003',
    'admin',
    'active',
    statement_timestamp()
  );

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ),
  0::bigint,
  'every exposed table has RLS enabled'
);

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not exists (
        select 1 from pg_policy p where p.polrelid = c.oid
      )
  ),
  0::bigint,
  'every exposed table has an explicit policy'
);

select ok(
  not has_table_privilege('anon', 'public.series', 'select'),
  'anon has no Series table grant'
);
select ok(
  has_table_privilege('authenticated', 'public.series', 'select'),
  'authenticated receives an explicit Series select grant'
);
select ok(
  not has_table_privilege('authenticated', 'private.command_receipts', 'select'),
  'authenticated cannot read command receipts'
);
select ok(
  not has_table_privilege('authenticated', 'audit.events', 'select'),
  'authenticated cannot read audit records'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.command_create_series(uuid,text,text,text,uuid,uuid,text,text,uuid)',
    'execute'
  ),
  'authenticated can execute the bounded create-Series command'
);
select ok(
  has_function_privilege(
    'authenticated',
    'private.is_active_member(uuid,uuid)',
    'execute'
  ),
  'authenticated can evaluate the RLS membership helper'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000001","email":"member.one@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

select is((select count(*) from public.series), 0::bigint, 'member starts with no Series');

select lives_ok(
  $command$
    select public.command_create_series(
      '10000000-0000-0000-0000-000000000101',
      'Shiva Stories',
      'Devotional stories of Shiva',
      'shiva-stories',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000001',
      'series-create-0001',
      repeat('a', 64),
      '50000000-0000-0000-0000-000000000001'
    )
  $command$,
  'active member creates a Series through the command boundary'
);
select is((select count(*) from public.series), 1::bigint, 'one Series was created');
select lives_ok(
  $command$
    select public.command_create_series(
      '10000000-0000-0000-0000-000000000101',
      'Shiva Stories',
      'Devotional stories of Shiva',
      'shiva-stories',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000099',
      'series-create-0001',
      repeat('a', 64),
      '50000000-0000-0000-0000-000000000001'
    )
  $command$,
  'same idempotency key and request returns the prior result'
);
select is((select count(*) from public.series), 1::bigint, 'idempotent replay made no duplicate');
select throws_ok(
  $command$
    select public.command_create_series(
      '10000000-0000-0000-0000-000000000101',
      'Changed',
      '',
      'changed',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000098',
      'series-create-0001',
      repeat('b', 64),
      '50000000-0000-0000-0000-000000000001'
    )
  $command$,
  '22023',
  'idempotency key was already used with a different request',
  'changed payload cannot reuse an idempotency key'
);
select throws_ok(
  $command$
    insert into public.series (
      workspace_id, slug, title, owner_user_id, created_by
    ) values (
      '10000000-0000-0000-0000-000000000101',
      'direct-write',
      'Direct write',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001'
    )
  $command$,
  '42501',
  null,
  'direct Series insert is denied'
);

select lives_ok(
  $command$
    select public.command_create_episode(
      '10000000-0000-0000-0000-000000000101',
      (select id from public.series where slug = 'shiva-stories'),
      'The River in His Hair',
      '',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000002',
      'episode-create-0001',
      repeat('c', 64),
      '50000000-0000-0000-0000-000000000002'
    )
  $command$,
  'first Episode command succeeds'
);
select lives_ok(
  $command$
    select public.command_create_episode(
      '10000000-0000-0000-0000-000000000101',
      (select id from public.series where slug = 'shiva-stories'),
      'The Silent Mountain',
      '',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000003',
      'episode-create-0002',
      repeat('d', 64),
      '50000000-0000-0000-0000-000000000003'
    )
  $command$,
  'second Episode command succeeds'
);
select is(
  (select array_agg(episode_number order by episode_number) from public.episodes),
  array[1,2],
  'Episode numbers are monotonic and unique'
);
select is(
  (select count(*) from public.work_items where kind = 'episode.world_setup'),
  2::bigint,
  'each Episode creates one deduplicated world-setup item'
);

select lives_ok(
  $command$
    select public.command_claim_work_item(
      '10000000-0000-0000-0000-000000000101',
      (select id from public.work_items order by created_at limit 1),
      300,
      '40000000-0000-0000-0000-000000000004',
      'work-claim-0001',
      repeat('e', 64),
      '50000000-0000-0000-0000-000000000004'
    )
  $command$,
  'eligible member claims an assigned work item'
);
select is(
  (select count(*) from public.work_leases where lease_state = 'active'),
  1::bigint,
  'one active work lease exists'
);
select is(
  (select max(fencing_token) from public.work_leases),
  1::bigint,
  'the initial lease receives fence one'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000003","email":"admin@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000003',
  true
);
set local role authenticated;

select throws_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'invitee@zyra.test',
      repeat('f', 64),
      'member',
      statement_timestamp() + interval '1 hour',
      '40000000-0000-0000-0000-000000000005',
      'invite-create-0001',
      repeat('1', 64),
      '50000000-0000-0000-0000-000000000005'
    )
  $command$,
  '42501',
  'aal2 required',
  'AAL1 cannot create an invitation'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","session_id":"30000000-0000-0000-0000-000000000003","email":"admin@zyra.test"}',
  true
);
set local role authenticated;
select lives_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'invitee@zyra.test',
      repeat('f', 64),
      'member',
      statement_timestamp() + interval '1 hour',
      '40000000-0000-0000-0000-000000000006',
      'invite-create-0002',
      repeat('2', 64),
      '50000000-0000-0000-0000-000000000006'
    )
  $command$,
  'AAL2 admin creates a bounded invitation'
);
select is(
  (select count(*) from public.invitations where consumed_at is null),
  1::bigint,
  'one live invitation exists'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000004","email":"invitee@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000004',
  true
);
set local role authenticated;
select lives_ok(
  $command$
    select public.command_accept_invitation(
      repeat('f', 64),
      '40000000-0000-0000-0000-000000000007',
      'invite-accept-0001',
      repeat('3', 64),
      '50000000-0000-0000-0000-000000000007'
    )
  $command$,
  'verified matching invitee accepts once'
);
select is(
  (
    select status::text from public.memberships
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '20000000-0000-0000-0000-000000000004'
  ),
  'active',
  'invitation acceptance creates active membership'
);
select throws_ok(
  $command$
    select public.command_accept_invitation(
      repeat('f', 64),
      '40000000-0000-0000-0000-000000000008',
      'invite-accept-0002',
      repeat('4', 64),
      '50000000-0000-0000-0000-000000000008'
    )
  $command$,
  '42501',
  null,
  'consumed invitation cannot be replayed'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","session_id":"30000000-0000-0000-0000-000000000003","email":"admin@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000003',
  true
);
set local role authenticated;
select lives_ok(
  $command$
    select public.command_offboard_member(
      '10000000-0000-0000-0000-000000000101',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000003',
      1,
      'team member left Zyra',
      '40000000-0000-0000-0000-000000000009',
      'member-offboard-0001',
      repeat('5', 64),
      '50000000-0000-0000-0000-000000000009'
    )
  $command$,
  'AAL2 admin offboards with an explicit replacement'
);
select is(
  (
    select status::text from public.memberships
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '20000000-0000-0000-0000-000000000001'
  ),
  'deactivated',
  'offboarded membership is inactive'
);
select is(
  (select count(*) from public.series where owner_user_id = '20000000-0000-0000-0000-000000000003'),
  1::bigint,
  'Series ownership transfers'
);
select is(
  (select count(*) from public.episodes where owner_user_id = '20000000-0000-0000-0000-000000000003'),
  2::bigint,
  'Episode ownership transfers'
);
select is(
  (select count(*) from public.work_leases where lease_state = 'revoked'),
  1::bigint,
  'active lease is revoked'
);
select is(
  (
    select count(*) from public.work_items
    where assigned_user_id = '20000000-0000-0000-0000-000000000003'
  ),
  2::bigint,
  'open work transfers to the replacement'
);
select ok((select count(*) from audit.events) >= 7, 'security and business actions are audited');

reset role;
select throws_ok(
  $command$
    update audit.events set outcome = 'failed'
  $command$,
  '55000',
  'immutable record cannot be updated or deleted',
  'audit events are immutable even to a database owner'
);
select is(
  private.storage_workspace_id(
    '10000000-0000-0000-0000-000000000101/assets/frame.webp'
  ),
  '10000000-0000-0000-0000-000000000101'::uuid,
  'safe Storage path yields its workspace'
);
select is(
  private.storage_workspace_id(
    '10000000-0000-0000-0000-000000000101/%2e%2e/secret'
  ),
  null,
  'encoded Storage traversal is rejected'
);
select is(
  private.storage_workspace_id(
    '10000000-0000-0000-0000-000000000101/../secret'
  ),
  null,
  'dot-segment Storage traversal is rejected'
);
select is(
  private.storage_workspace_id(
    E'10000000-0000-0000-0000-000000000101\\secret'
  ),
  null,
  'backslash Storage traversal is rejected'
);
select is(
  private.storage_workspace_id('orphan-file.webp'),
  null,
  'Storage object without a workspace folder is rejected'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000001","email":"member.one@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;
select is((select count(*) from public.series), 0::bigint, 'revoked member sees no Series');
select throws_ok(
  $command$
    select public.command_create_series(
      '10000000-0000-0000-0000-000000000101',
      'Forbidden',
      '',
      'forbidden',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000010',
      'series-create-0002',
      repeat('6', 64),
      '50000000-0000-0000-0000-000000000010'
    )
  $command$,
  '42501',
  'active workspace session required',
  'revoked member cannot use an open tab command'
);

reset role;
select throws_ok(
  $command$
    update public.domain_events set event_type = 'tampered.v1'
  $command$,
  '55000',
  'immutable record cannot be updated or deleted',
  'domain event history is immutable'
);
select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'episodes'
  ),
  'Episode projection is explicitly published to Realtime'
);
select is(
  (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'workspace_private_member_%'
  ),
  4::bigint,
  'workspace-private has four explicit object policies'
);
select is(
  (
    select count(*) from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and qual like '%workspace-exports%'
  ),
  0::bigint,
  'workspace-exports has no authenticated direct-read policy'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000004","email":"invitee@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000004',
  true
);
set local role authenticated;
select is(
  (select count(*) from public.notifications),
  0::bigint,
  'a member cannot read another recipient notification'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000003","role":"authenticated","aal":"aal2","session_id":"30000000-0000-0000-0000-000000000003","email":"admin@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000003',
  true
);
set local role authenticated;
select is((select count(*) from public.series), 1::bigint, 'workspace admin reads its Series');

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000002","email":"member.two@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000002',
  true
);
set local role authenticated;
select is((select count(*) from public.series), 0::bigint, 'other workspace cannot enumerate Series');

reset role;
select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, storage, private, audit, pg_catalog;

select plan(104);

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
  ),
  (
    '20000000-0000-0000-0000-000000000005',
    'reactivate@zyra.test',
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
  ('20000000-0000-0000-0000-000000000003', 'Admin'),
  ('20000000-0000-0000-0000-000000000005', 'Reactivated Member');

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
  ),
  (
    '10000000-0000-0000-0000-000000000101',
    '20000000-0000-0000-0000-000000000005',
    'member',
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
select ok(
  has_function_privilege(
    'authenticated',
    'public.authorize_storage_sign(text,text)',
    'execute'
  ),
  'authenticated can request a bounded server-side Storage authorization decision'
);
select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'execute')
  ),
  0::bigint,
  'anon cannot execute any public application function'
);
select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname in (
        'authorize_storage_sign',
        'command_accept_invitation',
        'command_archive_series',
        'command_claim_work_item',
        'command_create_episode',
        'command_create_invitation',
        'command_create_series',
        'command_offboard_member'
      )
  ),
  8::bigint,
  'Phase 1 exposes only seven reviewed commands and the Storage authorizer'
);
select ok(
  (
    select p.provolatile = 'v'
      and pg_get_functiondef(p.oid) like '%lock_workspace_authority%'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'assert_active_session'
  ),
  'every workspace command takes the volatile workspace authority lock'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_client_diagnostic(text,timestamptz,text,text,text,text,uuid)',
    'execute'
  ),
  'authenticated cannot invoke the service diagnostic sink'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.record_client_diagnostic(text,timestamptz,text,text,text,text,uuid)',
    'execute'
  ),
  'service role can invoke the bounded diagnostic sink'
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

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated","aal":"aal1","email":"member.one@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;
select is(
  (select count(*) from public.series),
  0::bigint,
  'an authenticated JWT without a session id fails closed'
);

reset role;
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
    select public.command_archive_series(
      '10000000-0000-0000-0000-000000000101',
      (select id from public.series where slug = 'shiva-stories'),
      1,
      '40000000-0000-0000-0000-000000000014',
      'series-archive-0001',
      repeat('6', 64),
      '50000000-0000-0000-0000-000000000014'
    )
  $command$,
  'the owner archives a Series through its compare-and-swap command'
);
select is(
  (select state::text from public.series where slug = 'shiva-stories'),
  'archived',
  'the Series is archived reversibly'
);
select is(
  (select aggregate_version from public.series where slug = 'shiva-stories'),
  2::bigint,
  'the successful archive advances the Series aggregate version'
);
select throws_ok(
  $command$
    select public.command_archive_series(
      '10000000-0000-0000-0000-000000000101',
      (select id from public.series where slug = 'shiva-stories'),
      1,
      '40000000-0000-0000-0000-000000000015',
      'series-archive-stale-0001',
      repeat('7', 64),
      '50000000-0000-0000-0000-000000000015'
    )
  $command$,
  '40001',
  'Series conflict or authorization failure',
  'a stale Series archive version loses deterministically'
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
update public.work_leases
set acquired_at = statement_timestamp() - interval '2 minutes',
    heartbeat_at = statement_timestamp() - interval '2 minutes',
    expires_at = statement_timestamp() - interval '1 second'
where fencing_token = 1;
select is(
  private.reconcile_expired_work_leases(100),
  1,
  'the lease reconciler reopens exactly one item after expiry'
);
select is(
  (
    select w.state::text
    from public.work_items w
    join public.work_leases l on l.work_item_id = w.id
    where l.fencing_token = 1
  ),
  'open',
  'expired work becomes claimable again'
);
set local role authenticated;
select lives_ok(
  $command$
    select public.command_claim_work_item(
      '10000000-0000-0000-0000-000000000101',
      (select work_item_id from public.work_leases where fencing_token = 1),
      300,
      '40000000-0000-0000-0000-000000000016',
      'work-claim-takeover-0001',
      repeat('8', 64),
      '50000000-0000-0000-0000-000000000016'
    )
  $command$,
  'eligible member takes over work after the prior lease expires'
);
select is(
  (select max(fencing_token) from public.work_leases where lease_state = 'active'),
  2::bigint,
  'the takeover receives the higher active fencing token'
);
select is(
  (select count(*) from public.work_leases where lease_state = 'active'),
  1::bigint,
  'only the highest-fenced lease remains active'
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
  'AAL2 authenticated authority required',
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
select lives_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'invitee@zyra.test',
      repeat('f', 64),
      'member',
      statement_timestamp() + interval '1 hour',
      '40000000-0000-0000-0000-000000000096',
      'invite-create-0002',
      repeat('2', 64),
      '50000000-0000-0000-0000-000000000096'
    )
  $command$,
  'lost invitation-create response can be retried with the same key'
);
select is(
  (select count(*) from public.invitations where consumed_at is null),
  1::bigint,
  'invitation-create replay creates no second token record'
);
select throws_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'member.one@zyra.test',
      repeat('d', 64),
      'member',
      statement_timestamp() + interval '1 hour',
      '40000000-0000-0000-0000-000000000095',
      'invite-create-active',
      repeat('9', 64),
      '50000000-0000-0000-0000-000000000095'
    )
  $command$,
  '23505',
  'invitation target is already an active member',
  'an already-active member cannot retain a future reactivation token'
);
select throws_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'new-admin@zyra.test',
      repeat('c', 64),
      'admin',
      statement_timestamp() + interval '1 hour',
      '40000000-0000-0000-0000-000000000094',
      'invite-create-admin',
      repeat('8', 64),
      '50000000-0000-0000-0000-000000000094'
    )
  $command$,
  '42501',
  'invitations cannot grant admin',
  'an invitation cannot escalate a user to admin'
);
select throws_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'expired@zyra.test',
      repeat('b', 64),
      'member',
      statement_timestamp() - interval '1 second',
      '40000000-0000-0000-0000-000000000093',
      'invite-create-expired',
      repeat('7', 64),
      '50000000-0000-0000-0000-000000000093'
    )
  $command$,
  '22023',
  'invitation expiry must be within 24 hours',
  'an expired invitation cannot be created'
);
select lives_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'member.two@zyra.test',
      repeat('e', 64),
      'reviewer',
      statement_timestamp() + interval '1 hour',
      '40000000-0000-0000-0000-000000000092',
      'invite-create-mismatch',
      repeat('6', 64),
      '50000000-0000-0000-0000-000000000092'
    )
  $command$,
  'a separate invitation is created for email-mismatch proof'
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
select throws_ok(
  $command$
    select public.command_accept_invitation(
      repeat('e', 64),
      '40000000-0000-0000-0000-000000000091',
      'invite-accept-mismatch',
      repeat('5', 64),
      '50000000-0000-0000-0000-000000000091'
    )
  $command$,
  '42501',
  'invitation is invalid, expired, replayed, or email-mismatched',
  'a verified user cannot accept an invitation for another exact email'
);
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
select lives_ok(
  $command$
    select public.command_accept_invitation(
      repeat('f', 64),
      '40000000-0000-0000-0000-000000000090',
      'invite-accept-0001',
      repeat('3', 64),
      '50000000-0000-0000-0000-000000000090'
    )
  $command$,
  'lost invitation-accept response can be retried with the same key'
);
select is(
  (
    select count(*) from public.memberships
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '20000000-0000-0000-0000-000000000004'
  ),
  1::bigint,
  'invitation-accept replay creates no duplicate membership'
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
insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  'workspace-private',
  '10000000-0000-0000-0000-000000000101/source/storage-policy/v1/probe.txt',
  '20000000-0000-0000-0000-000000000001',
  '{}'::jsonb
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
select set_config('storage.operation', 'storage.object.upload_update', true);
set local role authenticated;
select lives_ok(
  $storage$
    do $block$
    declare
      affected integer;
    begin
      update storage.objects
      set metadata = '{"forged":true}'::jsonb
      where bucket_id = 'workspace-private'
        and name =
          '10000000-0000-0000-0000-000000000101/source/storage-policy/v1/probe.txt';
      get diagnostics affected = row_count;
      if affected <> 0 then
        raise exception 'non-owner changed % Storage rows', affected;
      end if;
    end
    $block$
  $storage$,
  'a same-workspace non-owner cannot overwrite another member Storage object'
);
select set_config('storage.operation', 'storage.object.get_authenticated', true);
select is(
  (
    select count(*) from storage.objects
    where bucket_id = 'workspace-private'
      and name =
        '10000000-0000-0000-0000-000000000101/source/storage-policy/v1/probe.txt'
  ),
  1::bigint,
  'a same-workspace member can read shared authenticated media'
);
select set_config('storage.operation', 'storage.object.sign', true);
select is(
  (
    select count(*) from storage.objects
    where bucket_id = 'workspace-private'
      and name =
        '10000000-0000-0000-0000-000000000101/source/storage-policy/v1/probe.txt'
  ),
  0::bigint,
  'an authenticated member cannot directly authorize a signed URL'
);
select set_config('storage.operation', 'storage.object.upload_signed', true);
select throws_ok(
  $storage$
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'workspace-private',
      '10000000-0000-0000-0000-000000000101/source/storage-policy/v1/signed.txt',
      '20000000-0000-0000-0000-000000000004',
      '{}'::jsonb
    )
  $storage$,
  '42501',
  null,
  'an authenticated member cannot mint a long-lived signed upload path'
);

reset role;
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
select set_config('storage.operation', 'storage.object.upload_update', true);
set local role authenticated;
select lives_ok(
  $storage$
    do $block$
    declare
      affected integer;
    begin
      update storage.objects
      set metadata = '{"ownerUpdate":true}'::jsonb
      where bucket_id = 'workspace-private'
        and name =
          '10000000-0000-0000-0000-000000000101/source/storage-policy/v1/probe.txt';
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'owner changed % Storage rows', affected;
      end if;
    end
    $block$
  $storage$,
  'a Storage object owner retains the narrowly operation-scoped update path'
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
      '20000000-0000-0000-0000-000000000005',
      '20000000-0000-0000-0000-000000000003',
      1,
      'session reactivation proof',
      '40000000-0000-0000-0000-000000000120',
      'member-offboard-reactivation',
      repeat('1', 64),
      '50000000-0000-0000-0000-000000000120'
    )
  $command$,
  'admin offboards the session-reactivation proof member'
);
select lives_ok(
  $command$
    select public.command_create_invitation(
      '10000000-0000-0000-0000-000000000101',
      'reactivate@zyra.test',
      repeat('6', 64),
      'member',
      statement_timestamp() + interval '1 hour',
      '40000000-0000-0000-0000-000000000121',
      'invite-create-reactivation',
      repeat('2', 64),
      '50000000-0000-0000-0000-000000000121'
    )
  $command$,
  'admin creates a fresh invitation for the offboarded member'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000105","email":"reactivate@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000005',
  true
);
set local role authenticated;
select lives_ok(
  $command$
    select public.command_accept_invitation(
      repeat('6', 64),
      '40000000-0000-0000-0000-000000000122',
      'invite-accept-reactivation',
      repeat('3', 64),
      '50000000-0000-0000-0000-000000000122'
    )
  $command$,
  'the offboarded member accepts the new invitation in a fresh session'
);
select is(
  (select count(*) from public.series),
  1::bigint,
  'the newly authorized session sees workspace data after reactivation'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated","aal":"aal1","session_id":"30000000-0000-0000-0000-000000000005","email":"reactivate@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-0000-0000-000000000005',
  true
);
set local role authenticated;
select is(
  (select count(*) from public.series),
  0::bigint,
  'the pre-offboarding session remains denied after membership reactivation'
);
select throws_ok(
  $command$
    select public.command_create_series(
      '10000000-0000-0000-0000-000000000101',
      'Forbidden old session',
      '',
      'forbidden-old-session',
      '20000000-0000-0000-0000-000000000005',
      '40000000-0000-0000-0000-000000000123',
      'series-create-old-session',
      repeat('4', 64),
      '50000000-0000-0000-0000-000000000123'
    )
  $command$,
  '42501',
  'active workspace session required',
  'the pre-offboarding session cannot execute commands after reactivation'
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

select throws_ok(
  $command$
    select public.command_offboard_member(
      '10000000-0000-0000-0000-000000000101',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      1,
      'invalid self-replacement',
      '40000000-0000-0000-0000-000000000089',
      'member-offboard-invalid',
      repeat('4', 64),
      '50000000-0000-0000-0000-000000000089'
    )
  $command$,
  '23514',
  'deactivated member retains active ownership or work',
  'offboarding cannot transfer work back to the deactivated member'
);
select is(
  (
    select status::text from public.memberships
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '20000000-0000-0000-0000-000000000001'
  ),
  'active',
  'rejected self-replacement rolls back the entire offboarding transaction'
);

-- Simulate an invitation that predates this corrective migration so the
-- offboarding path proves it revokes legacy dangling tokens too.
reset role;
alter table public.invitations disable trigger invitations_reject_active_member;
insert into public.invitations (
  workspace_id, invited_email, token_hash, maximum_role, issued_by, expires_at
) values
  (
    '10000000-0000-0000-0000-000000000101',
    'member.one@zyra.test',
    repeat('9', 64),
    'member',
    '20000000-0000-0000-0000-000000000003',
    statement_timestamp() + interval '1 hour'
  ),
  (
    '10000000-0000-0000-0000-000000000101',
    'issued-by-legacy@example.test',
    repeat('8', 64),
    'member',
    '20000000-0000-0000-0000-000000000001',
    statement_timestamp() + interval '1 hour'
  );
alter table public.invitations enable trigger invitations_reject_active_member;
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
select is(
  (
    select count(*) from (
      select s.id
      from public.series s
      where s.workspace_id = '10000000-0000-0000-0000-000000000101'
        and s.owner_user_id = '20000000-0000-0000-0000-000000000001'
      union all
      select e.id
      from public.episodes e
      where e.workspace_id = '10000000-0000-0000-0000-000000000101'
        and e.owner_user_id = '20000000-0000-0000-0000-000000000001'
      union all
      select w.id
      from public.work_items w
      where w.workspace_id = '10000000-0000-0000-0000-000000000101'
        and w.assigned_user_id = '20000000-0000-0000-0000-000000000001'
        and w.state in ('open', 'claimed')
      union all
      select l.id
      from public.work_leases l
      where l.workspace_id = '10000000-0000-0000-0000-000000000101'
        and l.holder_user_id = '20000000-0000-0000-0000-000000000001'
        and l.lease_state = 'active'
    ) assignments
  ),
  0::bigint,
  'no active object or work assignment remains attached to an inactive member'
);
select is(
  (
    select revoke_reason from public.invitations
    where token_hash = repeat('9', 64)
  ),
  'member offboarded',
  'offboarding revokes every legacy live invitation for the member email'
);
select is(
  (
    select revoke_reason from public.invitations
    where token_hash = repeat('8', 64)
  ),
  'member offboarded',
  'offboarding revokes every live invitation issued by the departed member'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.invitations'::regclass
      and tgname = 'invitations_require_active_issuer_before_consumption'
      and not tgisinternal
  ),
  'invitation consumption is guarded by an active-issuer trigger'
);
reset role;
select ok((select count(*) from audit.events) >= 7, 'security and business actions are audited');

select throws_ok(
  $command$
    update audit.events set outcome = 'failed'
  $command$,
  '55000',
  'immutable record cannot be updated or deleted',
  'audit events are immutable even to a database owner'
);
select ok(
  not has_table_privilege('authenticated', 'audit.events', 'update'),
  'application users cannot update audit events'
);
select ok(
  not has_table_privilege('authenticated', 'audit.events', 'delete'),
  'application users cannot delete audit events'
);
select ok(
  not has_table_privilege('authenticated', 'audit.events', 'truncate'),
  'application users cannot truncate audit events'
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
      'Shiva Stories',
      'Devotional stories of Shiva',
      'shiva-stories',
      '20000000-0000-0000-0000-000000000001',
      '40000000-0000-0000-0000-000000000088',
      'series-create-0001',
      repeat('a', 64),
      '50000000-0000-0000-0000-000000000088'
    )
  $command$,
  '42501',
  'active workspace session required',
  'an exact pre-offboarding receipt replay is authorized again and denied'
);
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
select throws_ok(
  $command$
    select public.command_accept_invitation(
      repeat('9', 64),
      '40000000-0000-0000-0000-000000000087',
      'invite-accept-dangling',
      repeat('0', 64),
      '50000000-0000-0000-0000-000000000087'
    )
  $command$,
  '42501',
  'invitation is invalid, expired, replayed, or email-mismatched',
  'a retained pre-offboarding invitation cannot reactivate the member'
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
select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'domain_events'
  ),
  'Domain-event reconciliation is explicitly published to Realtime'
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
-- Simulate a legacy or administrative record whose issuer was deactivated
-- after creation; consumption must still fail atomically.
update public.invitations
set issued_by = '20000000-0000-0000-0000-000000000001'
where token_hash = repeat('e', 64);
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
select throws_ok(
  $command$
    select public.command_accept_invitation(
      repeat('e', 64),
      '40000000-0000-0000-0000-000000000086',
      'invite-accept-inactive-issuer',
      repeat('2', 64),
      '50000000-0000-0000-0000-000000000086'
    )
  $command$,
  '42501',
  'invitation is invalid, expired, replayed, or email-mismatched',
  'an invitation from an inactive issuer cannot be accepted'
);
select is(
  (
    select count(*) from public.memberships
    where workspace_id = '10000000-0000-0000-0000-000000000101'
      and user_id = '20000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'rejected inactive-issuer acceptance creates no membership'
);
select is((select count(*) from public.series), 0::bigint, 'other workspace cannot enumerate Series');

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000003","role":"service_role"}',
  true
);
set local role service_role;
select lives_ok(
  $diagnostic$
    do $block$
    begin
      perform public.record_client_diagnostic(
        'app.client_error',
        statement_timestamp(),
        'test',
        'diagnostic-dedupe-proof',
        'bounded safe diagnostic',
        repeat('a', 64),
        '20000000-0000-0000-0000-000000000003'
      );
      perform public.record_client_diagnostic(
        'app.client_error',
        statement_timestamp(),
        'test',
        'diagnostic-dedupe-proof',
        'bounded safe diagnostic',
        repeat('a', 64),
        '20000000-0000-0000-0000-000000000003'
      );
    end
    $block$
  $diagnostic$,
  'the service diagnostic boundary safely deduplicates a retry'
);
reset role;
select is(
  (
    select count(*) from private.diagnostic_events
    where dedupe_hash = repeat('a', 64)
  ),
  1::bigint,
  'diagnostic deduplication stores exactly one immutable row'
);
set local role service_role;
select lives_ok(
  $diagnostic$
    do $block$
    declare
      item integer;
    begin
      for item in 1..19 loop
        perform public.record_client_diagnostic(
          'app.client_error',
          statement_timestamp(),
          'test',
          'diagnostic-rate-' || item::text,
          'bounded safe diagnostic',
          md5(item::text) || md5('genie-' || item::text),
          '20000000-0000-0000-0000-000000000003'
        );
      end loop;
    end
    $block$
  $diagnostic$,
  'the database accepts the bounded per-user diagnostic allowance'
);
select throws_ok(
  $diagnostic$
    select public.record_client_diagnostic(
      'app.client_error',
      statement_timestamp(),
      'test',
      'diagnostic-rate-overflow',
      'bounded safe diagnostic',
      repeat('b', 64),
      '20000000-0000-0000-0000-000000000003'
    )
  $diagnostic$,
  '54000',
  'diagnostic rate limit reached',
  'the database rejects distributed diagnostic bursts beyond the allowance'
);
reset role;
select * from finish();
rollback;

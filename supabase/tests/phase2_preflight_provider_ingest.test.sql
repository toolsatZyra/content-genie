begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, storage, private, audit, pg_catalog;
select plan(100);

create temp table fixture_values (
  key text primary key,
  value text not null
) on commit drop;
grant select, insert, update, delete on fixture_values to authenticated, service_role;
grant usage on schema private to service_role;
grant select on all tables in schema private to service_role;

insert into public.organizations (id, name, slug)
values ('a1000000-0000-4000-8000-000000000001', 'Genie Phase Two', 'genie-phase-two');

insert into public.workspaces (id, organization_id, name, slug)
values
  (
    'a1100000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'Genie Preview One',
    'genie-preview-one'
  ),
  (
    'a1100000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001',
    'Genie Preview Two',
    'genie-preview-two'
  );

insert into auth.users (
  id, email, email_confirmed_at, created_at, updated_at, aud, role
)
values
  (
    'a1200000-0000-4000-8000-000000000001',
    'phase2.admin.one@zyra.test',
    statement_timestamp(), statement_timestamp(), statement_timestamp(),
    'authenticated', 'authenticated'
  ),
  (
    'a1200000-0000-4000-8000-000000000002',
    'phase2.admin.two@zyra.test',
    statement_timestamp(), statement_timestamp(), statement_timestamp(),
    'authenticated', 'authenticated'
  );

insert into public.profiles (user_id, display_name)
values
  ('a1200000-0000-4000-8000-000000000001', 'Phase Two Admin One'),
  ('a1200000-0000-4000-8000-000000000002', 'Phase Two Admin Two');

insert into public.memberships (
  workspace_id, user_id, role, status, authority_epoch, activated_at
)
values
  (
    'a1100000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001',
    'admin', 'active', 1, statement_timestamp()
  ),
  (
    'a1100000-0000-4000-8000-000000000002',
    'a1200000-0000-4000-8000-000000000002',
    'admin', 'active', 1, statement_timestamp()
  );

insert into public.series (
  id, workspace_id, slug, title, owner_user_id, created_by
)
values
  (
    'a1300000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'phase-two-provider-one', 'Phase Two Provider One',
    'a1200000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001'
  ),
  (
    'a1300000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'phase-two-provider-two', 'Phase Two Provider Two',
    'a1200000-0000-4000-8000-000000000002',
    'a1200000-0000-4000-8000-000000000002'
  );

insert into public.episodes (
  id, workspace_id, series_id, episode_number, title, owner_user_id, created_by
)
values
  (
    'a1400000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1300000-0000-4000-8000-000000000001',
    1, 'The Exact Preflight',
    'a1200000-0000-4000-8000-000000000001',
    'a1200000-0000-4000-8000-000000000001'
  ),
  (
    'a1400000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'a1300000-0000-4000-8000-000000000002',
    1, 'Cross Workspace Rejection',
    'a1200000-0000-4000-8000-000000000002',
    'a1200000-0000-4000-8000-000000000002'
  );

insert into private.aggregate_versions (
  workspace_id, aggregate_type, aggregate_id, current_version
)
values
  (
    'a1100000-0000-4000-8000-000000000001',
    'episode', 'a1400000-0000-4000-8000-000000000001', 1
  ),
  (
    'a1100000-0000-4000-8000-000000000002',
    'episode', 'a1400000-0000-4000-8000-000000000002', 1
  );

set local session_replication_role = replica;
insert into public.script_revisions (
  id, workspace_id, episode_id, revision_number, source_kind, raw_text,
  raw_utf8, raw_utf8_sha256, processing_text, processing_utf8_sha256,
  processing_profile, coordinate_map, runtime_evidence,
  raw_utf16_code_units, raw_scalar_count, raw_grapheme_count,
  processing_utf16_code_units, processing_scalar_count,
  processing_grapheme_count, estimated_duration_seconds,
  duration_out_of_band, duration_acknowledged, created_by
)
values
  (
    'a1500000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    1, 'browser_text', 'other', convert_to('other', 'UTF8'),
    encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
    'other', encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
    'genie-script-processing.v1',
    '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
    '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
    5, 5, 5, 5, 5, 5, 60, false, false,
    'a1200000-0000-4000-8000-000000000001'
  ),
  (
    'a1500000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'a1400000-0000-4000-8000-000000000002',
    1, 'browser_text', 'other', convert_to('other', 'UTF8'),
    encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
    'other', encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
    'genie-script-processing.v1',
    '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
    '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
    5, 5, 5, 5, 5, 5, 60, false, false,
    'a1200000-0000-4000-8000-000000000002'
  );
set local session_replication_role = origin;

insert into public.script_lock_events (
  id, workspace_id, episode_id, script_revision_id, raw_utf8_sha256,
  actor_user_id, actor_authority_epoch, duration_acknowledged,
  command_id, correlation_id
)
values
  (
    'a1510000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000001',
    encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
    'a1200000-0000-4000-8000-000000000001', 1, false,
    'a1520000-0000-4000-8000-000000000001',
    'a1530000-0000-4000-8000-000000000001'
  ),
  (
    'a1510000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'a1400000-0000-4000-8000-000000000002',
    'a1500000-0000-4000-8000-000000000002',
    encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
    'a1200000-0000-4000-8000-000000000002', 1, false,
    'a1520000-0000-4000-8000-000000000002',
    'a1530000-0000-4000-8000-000000000002'
  );

insert into public.episode_configuration_candidates (
  id, workspace_id, episode_id, candidate_number, script_revision_id,
  narrator_gender, voice_version_id, look_version_id,
  voice_confirmed_by, voice_confirmed_at, look_confirmed_by,
  look_confirmed_at, state, selected_by
)
values
  (
    'a1600000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001', 1,
    'a1500000-0000-4000-8000-000000000001', 'male',
    'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
    (select id from public.look_versions where look_key = 'glowing-divine-realism'),
    'a1200000-0000-4000-8000-000000000001', statement_timestamp(),
    'a1200000-0000-4000-8000-000000000001', statement_timestamp(),
    'world_design', 'a1200000-0000-4000-8000-000000000001'
  ),
  (
    'a1600000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'a1400000-0000-4000-8000-000000000002', 1,
    'a1500000-0000-4000-8000-000000000002', 'male',
    'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
    (select id from public.look_versions where look_key = 'glowing-divine-realism'),
    'a1200000-0000-4000-8000-000000000002', statement_timestamp(),
    'a1200000-0000-4000-8000-000000000002', statement_timestamp(),
    'world_design', 'a1200000-0000-4000-8000-000000000002'
  );

insert into private.provider_accounts (
  id, workspace_id, environment, provider, account_key,
  credential_secret_ref, region, state
)
values
  (
    'a1700000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'test', 'fal', 'fal.test.one', 'FAL_KEY', 'global', 'active'
  ),
  (
    'a1700000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000002',
    'test', 'fal', 'fal.test.two', 'FAL_KEY', 'global', 'active'
  );

insert into private.provider_evidence_snapshots (
  id, provider_account_id, evidence_kind, source_url_hash,
  raw_object_sha256, canonical_hash, storage_object_name,
  verification_state, retrieved_at, expires_at
)
values
  (
    'a1710000-0000-4000-8000-000000000001',
    'a1700000-0000-4000-8000-000000000001', 'official_schema',
    repeat('1', 64), repeat('2', 64), repeat('3', 64),
    'evidence/provider/fal/test/one.json', 'verified',
    statement_timestamp(), statement_timestamp() + interval '1 day'
  ),
  (
    'a1710000-0000-4000-8000-000000000002',
    'a1700000-0000-4000-8000-000000000002', 'official_schema',
    repeat('4', 64), repeat('5', 64), repeat('6', 64),
    'evidence/provider/fal/test/two.json', 'verified',
    statement_timestamp(), statement_timestamp() + interval '1 day'
  ),
  (
    'a1710000-0000-4000-8000-000000000003',
    'a1700000-0000-4000-8000-000000000001', 'canary',
    repeat('7', 64), repeat('8', 64), repeat('9', 64),
    'evidence/provider/fal/test/one-canary.json', 'verified',
    statement_timestamp(), statement_timestamp() + interval '1 day'
  ),
  (
    'a1710000-0000-4000-8000-000000000004',
    'a1700000-0000-4000-8000-000000000002', 'canary',
    repeat('a', 64), repeat('b', 64), repeat('c', 64),
    'evidence/provider/fal/test/two-canary.json', 'verified',
    statement_timestamp(), statement_timestamp() + interval '1 day'
  );

insert into private.provider_capabilities (
  id, provider_account_id, capability, model_key, model_version,
  endpoint_key, schema_version, evidence_snapshot_id, canary_evidence_snapshot_id, currency,
  unit_name, unit_price_minor, maximum_request_minor, retention_class,
  verified_at, expires_at, status
)
values
  (
    'a1720000-0000-4000-8000-000000000001',
    'a1700000-0000-4000-8000-000000000001', 'gen_image',
    'fal-ai/nano-banana-pro', '2026-07-01', 'fal.image',
    'fal.image.v1', 'a1710000-0000-4000-8000-000000000001', 'a1710000-0000-4000-8000-000000000003',
    'USD', 'image', 40, 500, 'no_training', statement_timestamp(),
    statement_timestamp() + interval '1 day', 'verified'
  ),
  (
    'a1720000-0000-4000-8000-000000000002',
    'a1700000-0000-4000-8000-000000000002', 'gen_image',
    'fal-ai/nano-banana-pro', '2026-07-01', 'fal.image',
    'fal.image.v1', 'a1710000-0000-4000-8000-000000000002', 'a1710000-0000-4000-8000-000000000004',
    'USD', 'image', 40, 500, 'no_training', statement_timestamp(),
    statement_timestamp() + interval '1 day', 'verified'
  );

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claim.role', 'service_role', true);

insert into fixture_values(key,value)
select 'fal_world_edit_capability_id', result->>'capabilityId'
from (
  select public.command_ensure_fal_world_edit_capability(
    'a1100000-0000-4000-8000-000000000001',
    'test',
    repeat('d',64),
    repeat('e',64),
    repeat('f',64),
    repeat('0',64),
    statement_timestamp(),
    statement_timestamp()+interval '1 day'
  ) result
) registered;

do $test$
declare
  capability private.provider_capabilities%rowtype;
  replayed jsonb;
begin
  select * into capability
  from private.provider_capabilities
  where id=(
    select value::uuid from fixture_values
    where key='fal_world_edit_capability_id'
  );
  if capability.id is null
    or capability.capability<>'edit_image'
    or capability.canary_evidence_snapshot_id is null
    or not exists(
      select 1
      from private.provider_evidence_snapshots canary
      where canary.id=capability.canary_evidence_snapshot_id
        and canary.evidence_kind='canary'
        and canary.verification_state='verified'
    )
  then
    raise exception 'fal edit capability is not bound to verified canary evidence';
  end if;
  replayed:=public.command_ensure_fal_world_edit_capability(
    'a1100000-0000-4000-8000-000000000001',
    'test',
    repeat('d',64),
    repeat('e',64),
    repeat('f',64),
    repeat('0',64),
    capability.verified_at,
    capability.expires_at
  );
  if replayed->>'capabilityId'<>capability.id::text then
    raise exception 'fal edit capability replay drifted';
  end if;
end;
$test$;

select ok(
  not has_function_privilege(
    'authenticated',
    'public.command_record_remote_fetch(uuid,uuid,uuid,text,text,text,uuid,text,text,jsonb,integer,bigint,integer,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_record_remote_fetch(uuid,uuid,uuid,text,text,text,uuid,text,text,jsonb,integer,bigint,integer,text,text,text)',
    'execute'
  ),
  'remote fetch evidence has only the environment-bound service command'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.command_record_provider_output_remote_fetch(uuid,uuid,text,text,uuid,text,text,text,jsonb,integer,bigint,integer,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_record_provider_output_remote_fetch(uuid,uuid,text,text,uuid,text,text,text,jsonb,integer,bigint,integer,text)',
    'execute'
  ),
  'only the service worker can bind a remote fetch to its leased provider candidate'
);

select throws_ok(
  $sql$
    select public.command_create_micro_quote(
      'a1100000-0000-4000-8000-000000000001',
      'a1400000-0000-4000-8000-000000000001',
      'a1600000-0000-4000-8000-000000000001',
      'a1500000-0000-4000-8000-000000000001',
      'secure_ingest', repeat('a', 64), repeat('b', 64),
      jsonb_build_array(jsonb_build_object(
        'slotKey', 'anchor.image.underquoted',
        'capabilityId', 'a1720000-0000-4000-8000-000000000001',
        'operation', 'gen_image', 'quantity', 2,
        'unitPriceMinor', 40, 'amountMinor', 40,
        'requestSchemaHash', repeat('c', 64)
      )), statement_timestamp() + interval '1 hour'
    )
  $sql$,
  '40001',
  'micro quote line is not exact verified authority',
  'underquoted provider cost cannot become authority'
);

select throws_ok(
  $sql$
    select public.command_create_micro_quote(
      'a1100000-0000-4000-8000-000000000001',
      'a1400000-0000-4000-8000-000000000001',
      'a1600000-0000-4000-8000-000000000001',
      'a1500000-0000-4000-8000-000000000001',
      'secure_ingest', repeat('d', 64), repeat('e', 64),
      jsonb_build_array(jsonb_build_object(
        'slotKey', 'anchor.image.cross_workspace',
        'capabilityId', 'a1720000-0000-4000-8000-000000000002',
        'operation', 'gen_image', 'quantity', 1,
        'unitPriceMinor', 40, 'amountMinor', 40,
        'requestSchemaHash', repeat('f', 64)
      )), statement_timestamp() + interval '1 hour'
    )
  $sql$,
  '40001',
  'micro quote line is not exact verified authority',
  'another workspace provider capability cannot be quoted'
);

select throws_ok(
  $sql$
    select public.command_create_micro_quote(
      'a1100000-0000-4000-8000-000000000001',
      'a1400000-0000-4000-8000-000000000001',
      'a1600000-0000-4000-8000-000000000001',
      'a1500000-0000-4000-8000-000000000001',
      'secure_ingest', repeat('0', 64), repeat('1', 64),
      jsonb_build_array(jsonb_build_object(
        'slotKey', 'production.video.forbidden',
        'capabilityId', 'a1720000-0000-4000-8000-000000000001',
        'operation', 'gen_video', 'quantity', 1,
        'unitPriceMinor', 40, 'amountMinor', 40,
        'requestSchemaHash', repeat('2', 64)
      )), statement_timestamp() + interval '1 hour'
    )
  $sql$,
  '22023', 'micro quote line is invalid',
  'micro authority cannot quote or claim a production video slot'
);

select throws_ok(
  $sql$
    select public.command_create_micro_quote(
      'a1100000-0000-4000-8000-000000000001',
      'a1400000-0000-4000-8000-000000000001',
      'a1600000-0000-4000-8000-000000000001',
      'a1500000-0000-4000-8000-000000000001',
      'secure_ingest', repeat('3', 64), repeat('4', 64),
      jsonb_build_array(jsonb_build_object(
        'slotKey', 'production.render.forbidden',
        'capabilityId', 'a1720000-0000-4000-8000-000000000001',
        'operation', 'render', 'quantity', 1,
        'unitPriceMinor', 40, 'amountMinor', 40,
        'requestSchemaHash', repeat('5', 64)
      )), statement_timestamp() + interval '1 hour'
    )
  $sql$,
  '22023', 'micro quote line is invalid',
  'micro authority cannot quote or claim a render slot'
);

select throws_ok(
  $sql$
    select public.command_create_micro_quote(
      'a1100000-0000-4000-8000-000000000001',
      'a1400000-0000-4000-8000-000000000001',
      'a1600000-0000-4000-8000-000000000001',
      'a1500000-0000-4000-8000-000000000001',
      'secure_ingest', repeat('6', 64), repeat('7', 64),
      jsonb_build_array(jsonb_build_object(
        'slotKey', 'production.export.forbidden',
        'capabilityId', 'a1720000-0000-4000-8000-000000000001',
        'operation', 'export', 'quantity', 1,
        'unitPriceMinor', 40, 'amountMinor', 40,
        'requestSchemaHash', repeat('8', 64)
      )), statement_timestamp() + interval '1 hour'
    )
  $sql$,
  '22023', 'micro quote line is invalid',
  'micro authority cannot quote or claim an export slot'
);

select throws_ok(
  $sql$
    select public.command_create_micro_quote(
      'a1100000-0000-4000-8000-000000000001',
      'a1400000-0000-4000-8000-000000000001',
      'a1600000-0000-4000-8000-000000000001',
      'a1500000-0000-4000-8000-000000000001',
      'secure_ingest', repeat('9', 64), repeat('a', 64),
      jsonb_build_array(jsonb_build_object(
        'slotKey', 'production.approval.forbidden',
        'capabilityId', 'a1720000-0000-4000-8000-000000000001',
        'operation', 'approve', 'quantity', 1,
        'unitPriceMinor', 40, 'amountMinor', 40,
        'requestSchemaHash', repeat('b', 64)
      )), statement_timestamp() + interval '1 hour'
    )
  $sql$,
  '22023', 'micro quote line is invalid',
  'micro authority cannot quote or claim an approval slot'
);

select is(
  jsonb_build_object(
    'quotes', (select count(*) from private.micro_quotes),
    'quoteLines', (select count(*) from private.micro_quote_lines),
    'requests', (select count(*) from private.provider_requests),
    'costEvents', (select count(*) from private.provider_cost_events),
    'settledMinor', (select coalesce(sum(settled_minor), 0) from private.micro_reservations)
  ),
  '{"costEvents":0,"quoteLines":0,"quotes":0,"requests":0,"settledMinor":0}'::jsonb,
  'forbidden production operations create no quote, request, or spend authority'
);

insert into fixture_values (key, value)
select 'quote_id', public.command_create_micro_quote(
  'a1100000-0000-4000-8000-000000000001',
  'a1400000-0000-4000-8000-000000000001',
  'a1600000-0000-4000-8000-000000000001',
  'a1500000-0000-4000-8000-000000000001',
  'secure_ingest', repeat('1', 64), repeat('2', 64),
  jsonb_build_array(jsonb_build_object(
    'slotKey', 'anchor.image.primary',
    'capabilityId', 'a1720000-0000-4000-8000-000000000001',
    'operation', 'gen_image', 'quantity', 1,
    'unitPriceMinor', 40, 'amountMinor', 40,
    'requestSchemaHash', repeat('3', 64)
  )), statement_timestamp() + interval '1 hour'
)::text;

insert into fixture_values (key, value)
select 'aal1_quote_id', public.command_create_micro_quote(
  'a1100000-0000-4000-8000-000000000001',
  'a1400000-0000-4000-8000-000000000001',
  'a1600000-0000-4000-8000-000000000001',
  'a1500000-0000-4000-8000-000000000001',
  'secure_ingest', repeat('6', 64), repeat('7', 64),
  jsonb_build_array(jsonb_build_object(
    'slotKey', 'anchor.image.aal1_probe',
    'capabilityId', 'a1720000-0000-4000-8000-000000000001',
    'operation', 'gen_image', 'quantity', 1,
    'unitPriceMinor', 40, 'amountMinor', 40,
    'requestSchemaHash', repeat('8', 64)
  )), statement_timestamp() + interval '1 hour'
)::text;

select is(
  (select total_minor from private.micro_quotes where id = (
    select value::uuid from fixture_values where key = 'quote_id'
  )),
  40::bigint,
  'the verified quote reserves its exact minor-unit cost'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"a1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  format(
    'select public.command_authorize_micro_quote(%L,%L,1,%L,40,%L,%L,%L,%L)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'aal1_quote_id'), repeat('6', 64),
    'a1800000-0000-4000-8000-000000000001', 'micro-authorize-aal1',
    repeat('4', 64), 'a1810000-0000-4000-8000-000000000001'
  ),
  'the exact single-owner developer may authorize a bounded micro-spend at the actual AAL1 session'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into fixture_values (key, value)
select 'authorization_response', public.command_authorize_micro_quote(
  'a1100000-0000-4000-8000-000000000001',
  (select value::uuid from fixture_values where key = 'quote_id'),
  1, repeat('1', 64), 40,
  'a1800000-0000-4000-8000-000000000002', 'micro-authorize-aal2',
  repeat('5', 64), 'a1810000-0000-4000-8000-000000000002'
)::text;

reset role;
select is(
  (select state::text from private.micro_quotes where id = (
    select value::uuid from fixture_values where key = 'quote_id'
  )),
  'confirmed',
  'AAL2 turns the exact quote into one confirmed authority'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

insert into fixture_values (key, value)
select 'preflight_run_id', (
  public.command_create_preflight_run(
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    'a1600000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000001', 'secure_ingest', true,
    (select value::uuid from fixture_values where key = 'quote_id'),
    ((select value::jsonb from fixture_values where key = 'authorization_response')
      ->> 'microAuthorizationId')::uuid,
    ((select value::jsonb from fixture_values where key = 'authorization_response')
      ->> 'microReservationId')::uuid,
    'a1820000-0000-4000-8000-000000000001',
    'preflight-create-secure-001', repeat('6', 64)
  ) ->> 'preflightRunId'
);

select throws_ok(
  format(
    'select public.command_create_preflight_run(%L,%L,%L,%L,%L,true,%L,%L,%L,%L,%L,%L)',
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    'a1600000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000001', 'secure_ingest',
    (select value from fixture_values where key = 'quote_id'),
    ((select value::jsonb from fixture_values where key = 'authorization_response')
      ->> 'microAuthorizationId'),
    ((select value::jsonb from fixture_values where key = 'authorization_response')
      ->> 'microReservationId'),
    'a1820000-0000-4000-8000-000000000002',
    'preflight-create-secure-002', repeat('7', 64)
  ),
  '23505', null,
  'one configuration and kind cannot have two active preflight authorities'
);

select lives_ok(
  format(
    'select public.command_transition_preflight_run(%L,1,%L,null)',
    (select value from fixture_values where key = 'preflight_run_id'), 'enqueue'
  ),
  'the preflight enters its dedicated durable queue'
);
select lives_ok(
  format(
    'select public.command_transition_preflight_run(%L,2,%L,%L)',
    (select value from fixture_values where key = 'preflight_run_id'),
    'started', 'trigger-run-secure-001'
  ),
  'the queued preflight starts only with a Trigger identity'
);

insert into fixture_values (key, value)
select 'stage_run_id', id::text from public.preflight_stage_runs
where preflight_run_id = (
  select value::uuid from fixture_values where key = 'preflight_run_id'
);

insert into fixture_values (key, value)
values ('input_manifest_id', 'a1900000-0000-4000-8000-000000000001');

select lives_ok(
  format(
    'select public.command_register_provider_input_manifest(%L,%L,%L,%L,%L::jsonb,%L)',
    (select value from fixture_values where key = 'input_manifest_id'),
    'a1100000-0000-4000-8000-000000000001', 'gen_image', 'fal.image.v1',
    '{"imageSize":"portrait_9_16","numImages":1,"outputFormat":"png","prompt":"Shiva under moonlight","targetAssetId":"a1910000-0000-4000-8000-000000000001"}',
    repeat('8', 64)
  ),
  'the provider input manifest is stored server-side by exact hash'
);

select lives_ok(
  format(
    'select public.command_make_preflight_stage_ready(%L,1,%L,%L)',
    (select value from fixture_values where key = 'stage_run_id'),
    (select value from fixture_values where key = 'input_manifest_id'),
    repeat('8', 64)
  ),
  'the root stage becomes ready with an exact input manifest'
);

insert into fixture_values (key, value)
select 'claim_response', public.command_claim_preflight_stage(
  (select value::uuid from fixture_values where key = 'stage_run_id'),
  2, 1, 'trigger.worker.secure.001', 120
)::text;

select is(
  ((select value::jsonb from fixture_values where key = 'claim_response')
    ->> 'fencingToken')::bigint,
  1::bigint,
  'the first attempt receives the first monotonically increasing fence'
);

select throws_ok(
  format(
    'select public.command_start_preflight_attempt(%L,2,1,%L,%L,%L)',
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'), repeat('8', 64),
    'task-secure-001', 'task-run-secure-001'
  ),
  '40001', 'stale preflight attempt start',
  'a stale fencing token cannot start the claimed attempt'
);

select lives_ok(
  format(
    'select public.command_start_preflight_attempt(%L,1,1,%L,%L,%L)',
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'), repeat('8', 64),
    'task-secure-001', 'task-run-secure-001'
  ),
  'the exact claimed attempt starts'
);

insert into fixture_values (key, value)
values ('cross_kind_input_manifest_id', 'a1900000-0000-4000-8000-000000000002');

select public.command_register_provider_input_manifest(
  (select value::uuid from fixture_values where key = 'cross_kind_input_manifest_id'),
  'a1100000-0000-4000-8000-000000000001',
  'gen_image', 'fal.image.v1',
  '{"imageSize":"portrait_9_16","numImages":1,"outputFormat":"png","prompt":"Cross-kind fixture","targetAssetId":"a1910000-0000-4000-8000-000000000002"}'::jsonb,
  repeat('5', 64)
);

insert into fixture_values (key, value)
select 'cross_kind_run_id', (
  public.command_create_preflight_run(
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    'a1600000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000001', 'world_anchor', false,
    null, null, null, 'a1820000-0000-4000-8000-000000000004',
    'preflight-create-cross-kind-001', repeat('9', 64)
  ) ->> 'preflightRunId'
);

select public.command_transition_preflight_run(
  (select value::uuid from fixture_values where key = 'cross_kind_run_id'),
  1, 'enqueue', null
);
select public.command_transition_preflight_run(
  (select value::uuid from fixture_values where key = 'cross_kind_run_id'),
  2, 'started', 'trigger-run-cross-kind-001'
);

insert into fixture_values (key, value)
select 'cross_kind_stage_id', id::text
from public.preflight_stage_runs
where preflight_run_id = (
  select value::uuid from fixture_values where key = 'cross_kind_run_id'
);

select public.command_make_preflight_stage_ready(
  (select value::uuid from fixture_values where key = 'cross_kind_stage_id'),
  1,
  (select value::uuid from fixture_values where key = 'cross_kind_input_manifest_id'),
  repeat('5', 64)
);

insert into fixture_values (key, value)
select 'cross_kind_claim', public.command_claim_preflight_stage(
  (select value::uuid from fixture_values where key = 'cross_kind_stage_id'),
  2, 1, 'trigger.worker.cross.kind.001', 120
)::text;

select public.command_start_preflight_attempt(
  ((select value::jsonb from fixture_values where key = 'cross_kind_claim')
    ->> 'stageAttemptId')::uuid,
  1, 1, repeat('5', 64), 'task-cross-kind-001', 'task-run-cross-kind-001'
);

select throws_ok(
  format(
    'select public.command_claim_micro_provider_slot(%L,%L,%L,%L,%L,%L,%L,%L,null)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'preflight_run_id'),
    ((select value::jsonb from fixture_values where key = 'cross_kind_claim')
      ->> 'stageAttemptId'),
    (select id from private.micro_quote_lines where micro_quote_id = (
      select value::uuid from fixture_values where key = 'quote_id'
    )),
    (select value from fixture_values where key = 'input_manifest_id'),
    repeat('8', 64), 'cross-stage-provider-request-001',
    'a1940000-0000-4000-8000-000000000002'
  ),
  '23503', null,
  'a stage attempt from another preflight run cannot create a provider request'
);

select throws_ok(
  format(
    'select public.command_claim_micro_provider_slot(%L,%L,%L,%L,%L,%L,%L,%L,null)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'cross_kind_run_id'),
    ((select value::jsonb from fixture_values where key = 'cross_kind_claim')
      ->> 'stageAttemptId'),
    (select id from private.micro_quote_lines where micro_quote_id = (
      select value::uuid from fixture_values where key = 'quote_id'
    )),
    (select value from fixture_values where key = 'cross_kind_input_manifest_id'),
    repeat('5', 64), 'cross-kind-provider-request-001',
    'a1940000-0000-4000-8000-000000000003'
  ),
  '40001', 'provider slot authority is stale',
  'a world-anchor preflight cannot consume a secure-ingest micro slot'
);

select throws_ok(
  format(
    'select public.command_claim_micro_provider_slot(%L,%L,%L,%L,%L,%L,%L,%L,null)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'preflight_run_id'),
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'),
    (select id from private.micro_quote_lines where micro_quote_id = (
      select value::uuid from fixture_values where key = 'aal1_quote_id'
    )),
    (select value from fixture_values where key = 'input_manifest_id'),
    repeat('8', 64), 'cross-slot-provider-request-001',
    'a1940000-0000-4000-8000-000000000004'
  ),
  '40001', 'provider slot authority is stale',
  'a quote line from another authority cannot be cross-linked into the run'
);

select throws_ok(
  format(
    'select public.command_claim_micro_provider_slot(%L,%L,%L,%L,%L,%L,%L,%L,null)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'preflight_run_id'),
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'),
    (select id from private.micro_quote_lines where micro_quote_id = (
      select value::uuid from fixture_values where key = 'quote_id'
    )),
    (select value from fixture_values where key = 'cross_kind_input_manifest_id'),
    repeat('5', 64), 'cross-manifest-provider-request-001',
    'a1940000-0000-4000-8000-000000000005'
  ),
  '40001', 'provider slot authority is stale',
  'a manifest from another preflight run cannot be cross-linked into the stage'
);

select is(
  jsonb_build_object(
    'requests', (select count(*) from private.provider_requests),
    'claims', (select count(*) from private.provider_request_quote_claims),
    'costEvents', (select count(*) from private.provider_cost_events),
    'settledMinor', (select coalesce(sum(settled_minor), 0) from private.micro_reservations)
  ),
  '{"claims":0,"costEvents":0,"requests":0,"settledMinor":0}'::jsonb,
  'cross-kind, stage, slot, and manifest attempts create no request or spend'
);

select lives_ok(
  format(
    'select public.command_transition_preflight_run(%L,3,%L,null)',
    (select value from fixture_values where key = 'cross_kind_run_id'), 'fail'
  ),
  'the cross-kind fixture terminalizes without leaving active authority'
);

select ok(
  public.command_heartbeat_preflight_attempt(
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId')::uuid,
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'leaseId')::uuid,
    1, 120
  ) > statement_timestamp(),
  'the current lease can heartbeat within its absolute cap'
);

select throws_ok(
  format(
    'select public.command_record_agent_tool_call(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,1,1,1000,%L,%L,%L)',
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    'a1600000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000001',
    'a1920000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'preflight_run_id'),
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'), 'http.fetch', repeat('9', 64), repeat('a', 64),
    repeat('b', 64), 'gpt', 'test', repeat('c', 64)
  ),
  '22023', 'restricted tool envelope is invalid',
  'the agent cannot acquire arbitrary HTTP authority'
);

insert into fixture_values (key, value)
select 'tool_call_id', public.command_record_agent_tool_call(
  'a1100000-0000-4000-8000-000000000001',
  'a1400000-0000-4000-8000-000000000001',
  'a1600000-0000-4000-8000-000000000001',
  'a1500000-0000-4000-8000-000000000001',
  'a1920000-0000-4000-8000-000000000001',
  (select value::uuid from fixture_values where key = 'preflight_run_id'),
  ((select value::jsonb from fixture_values where key = 'claim_response')
    ->> 'stageAttemptId')::uuid,
  'source.extract', repeat('9', 64), repeat('a', 64), repeat('b', 64),
  2, 1, 1000, 'gpt', 'test', repeat('c', 64)
)::text;

select ok(
  public.command_complete_agent_tool_call(
    (select value::uuid from fixture_values where key = 'tool_call_id'),
    repeat('a', 64), repeat('d', 64), '{"items":1}'
  ),
  'a restricted read-only tool records its bounded result'
);
select ok(
  public.command_complete_agent_tool_call(
    (select value::uuid from fixture_values where key = 'tool_call_id'),
    repeat('a', 64), repeat('d', 64), '{"items":1}'
  ),
  'an identical completion replay is idempotent'
);
select is(
  (select count(*) from private.agent_tool_calls
    where authorization_call_id = (
      select value::uuid from fixture_values where key = 'tool_call_id'
    )),
  1::bigint,
  'one authorization produces exactly one immutable result row'
);
select throws_ok(
  format(
    'select public.command_complete_agent_tool_call(%L,%L,%L,%L::jsonb)',
    (select value from fixture_values where key = 'tool_call_id'),
    repeat('a', 64), repeat('e', 64), '{"items":2}'
  ),
  '40001', 'restricted tool completion conflicts with prior result',
  'a replay cannot replace the first restricted-tool result'
);

select lives_ok(
  format(
    'select public.command_record_agent_injection_finding(%L,%L,%L,%L,%L,%L,%L)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'preflight_run_id'),
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'), 'provider_output', repeat('f', 64),
    'PROMPT_INJECTION', 'quarantined'
  ),
  'injection evidence stores only hashes and a bounded disposition'
);

insert into fixture_values (key, value)
select 'allowlist_v1', public.command_activate_remote_fetch_allowlist(
  'test', 'provider_output', repeat('1', 64), '["cdn.fal.media"]'
)::text;

insert into fixture_values (key, value)
select 'allowlist_v2', public.command_activate_remote_fetch_allowlist(
  'test', 'provider_output', repeat('2', 64),
  '["cdn.fal.media","assets.fal.media"]'
)::text;

select is(
  (select state from private.remote_fetch_allowlist_versions
    where id = (select value::uuid from fixture_values where key = 'allowlist_v1')),
  'withdrawn',
  'allowlist rotation withdraws the prior immutable version'
);
select is(
  (select version_number from private.remote_fetch_allowlist_versions
    where id = (select value::uuid from fixture_values where key = 'allowlist_v2')),
  (select version_number + 1 from private.remote_fetch_allowlist_versions
    where id = (select value::uuid from fixture_values where key = 'allowlist_v1')),
  'allowlist rotation activates one monotonically versioned successor'
);

select throws_ok(
  format(
    'select public.command_record_remote_fetch(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,0,1048576,10000,%L,%L,null)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'preflight_run_id'),
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'),
    'preview', 'provider_output', 'cdn.fal.media',
    (select value from fixture_values where key = 'allowlist_v2'),
    repeat('3', 64), repeat('2', 64),
    jsonb_build_array(repeat('4', 64))::text,
    'fetched', repeat('5', 64)
  ),
  '42501', 'remote fetch host is not allowlisted',
  'a test allowlist cannot authorize a preview-environment fetch'
);

insert into fixture_values(key,value)
select 'provider_remote_fetch_id',public.command_record_remote_fetch(
  'a1100000-0000-4000-8000-000000000001',
  (select value::uuid from fixture_values where key='preflight_run_id'),
  ((select value::jsonb from fixture_values where key='claim_response')
    ->>'stageAttemptId')::uuid,
  'test','provider_output','cdn.fal.media',
  (select value::uuid from fixture_values where key='allowlist_v2'),
  repeat('3',64),repeat('2',64),jsonb_build_array(repeat('4',64)),
  0,1048576,10000,'fetched',repeat('5',64),null
)::text;

insert into fixture_values(key,value)
select 'research_allowlist',public.command_activate_remote_fetch_allowlist(
  'test','research_reference',repeat('6',64),'["upload.wikimedia.org"]'
)::text;

set local session_replication_role=replica;
update public.preflight_stage_attempts
set state='claimed'
where id=(
  ((select value::jsonb from fixture_values where key='claim_response')
    ->>'stageAttemptId')::uuid
);
set local session_replication_role=origin;

select lives_ok(
  format(
    'select public.command_record_remote_fetch(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,0,26214400,60000,%L,%L,null)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key='preflight_run_id'),
    ((select value::jsonb from fixture_values where key='claim_response')
      ->>'stageAttemptId'),
    'test','research_reference','upload.wikimedia.org',
    (select value from fixture_values where key='research_allowlist'),
    repeat('7',64),repeat('6',64),
    jsonb_build_array(repeat('8',64))::text,
    'fetched',repeat('9',64)
  ),
  'a highest-fencing claimed World attempt may record licensed research fetch evidence'
);

set local session_replication_role=replica;
update public.preflight_stage_attempts
set state='running'
where id=(
  ((select value::jsonb from fixture_values where key='claim_response')
    ->>'stageAttemptId')::uuid
);
set local session_replication_role=origin;

insert into fixture_values (key, value)
select 'provider_request_id', public.command_claim_micro_provider_slot(
  'a1100000-0000-4000-8000-000000000001',
  (select value::uuid from fixture_values where key = 'preflight_run_id'),
  ((select value::jsonb from fixture_values where key = 'claim_response')
    ->> 'stageAttemptId')::uuid,
  (select id from private.micro_quote_lines where micro_quote_id = (
    select value::uuid from fixture_values where key = 'quote_id'
  )),
  (select value::uuid from fixture_values where key = 'input_manifest_id'),
  repeat('8', 64), 'provider-request-primary-001',
  'a1940000-0000-4000-8000-000000000001', null
)::text;

select ok(
  (
    select constraint_row.convalidated
      and not constraint_row.condeferrable
      and constraint_row.conkey::smallint[] = array[attribute.attnum]::smallint[]
    from pg_catalog.pg_constraint constraint_row
    join pg_catalog.pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
      and attribute.attname = 'micro_quote_line_id'
      and not attribute.attisdropped
    where constraint_row.conrelid =
        'private.provider_request_quote_claims'::regclass
      and constraint_row.contype = 'u'
      and constraint_row.conkey::smallint[] = array[attribute.attnum]::smallint[]
  ),
  'one provider slot retains one immediate validated quote-line constraint'
);
select is(
  public.command_claim_micro_provider_slot(
    'a1100000-0000-4000-8000-000000000001',
    (select value::uuid from fixture_values where key = 'preflight_run_id'),
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId')::uuid,
    (select id from private.micro_quote_lines where micro_quote_id = (
      select value::uuid from fixture_values where key = 'quote_id'
    )),
    (select value::uuid from fixture_values where key = 'input_manifest_id'),
    repeat('8', 64), 'provider-request-replay-002',
    'a1940000-0000-4000-8000-000000000099', null
  )::text,
  (select value from fixture_values where key = 'provider_request_id'),
  'a repeated caller converges on the exact authoritative provider request'
);
select is(
  format(
    '%s/%s',
    (select count(*) from private.provider_requests where id = (
      select value::uuid from fixture_values where key = 'provider_request_id'
    )),
    (select count(*) from private.provider_request_quote_claims where micro_quote_line_id = (
      select id from private.micro_quote_lines where micro_quote_id = (
        select value::uuid from fixture_values where key = 'quote_id'
      )
    ))
  ),
  '1/1',
  'a repeated provider-slot claim leaves exactly one request and one quote claim'
);
select is(
  (
    select idempotency_key || '/' || correlation_id::text
    from private.provider_requests
    where id = (select value::uuid from fixture_values where key = 'provider_request_id')
  ),
  'provider-request-primary-001/a1940000-0000-4000-8000-000000000001',
  'the first caller tokens remain immutable audit evidence after convergence'
);

insert into fixture_values (key, value)
values ('capability_jti', 'a1950000-0000-4000-8000-000000000001');
insert into fixture_values (key, value)
select 'capability_grant_id', public.command_issue_worker_capability_grant(
  'a1100000-0000-4000-8000-000000000001',
  (select value::uuid from fixture_values where key = 'provider_request_id'),
  (select value::uuid from fixture_values where key = 'capability_jti'),
  repeat('6', 64), statement_timestamp() + interval '4 minutes'
)::text;

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into fixture_values (key, value)
select 'broker_client_id', public.command_register_broker_client(
  'a1100000-0000-4000-8000-000000000001', 'test',
  'genie-trigger-test', 'genie-client-one',
  'https://content-genie-three.vercel.app/api/internal/provider-broker'
)::text;
insert into fixture_values (key, value)
select 'broker_key_id', public.command_add_broker_client_key(
  (select value::uuid from fixture_values where key = 'broker_client_id'),
  1, 'test-key-one', repeat('A', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '1 hour', null, 'initial test key'
)::text;
select lives_ok(
  format(
    'select public.command_activate_broker_client_key(%L,%L,2,1)',
    (select value from fixture_values where key = 'broker_client_id'),
    (select value from fixture_values where key = 'broker_key_id')
  ),
  'an AAL2 workspace admin activates the exact broker key'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"a1210000-0000-4000-8000-000000000002"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1200000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
insert into fixture_values (key, value)
select 'broker_client_two', public.command_register_broker_client(
  'a1100000-0000-4000-8000-000000000002', 'test',
  'genie-trigger-test', 'genie-client-two',
  'https://content-genie-three.vercel.app/api/internal/provider-broker'
)::text;
insert into fixture_values (key, value)
select 'broker_key_two', public.command_add_broker_client_key(
  (select value::uuid from fixture_values where key = 'broker_client_two'),
  1, 'test-key-two', repeat('B', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '1 hour', null, 'cross workspace test key'
)::text;
select lives_ok(
  format(
    'select public.command_activate_broker_client_key(%L,%L,2,1)',
    (select value from fixture_values where key = 'broker_client_two'),
    (select value from fixture_values where key = 'broker_key_two')
  ),
  'the second workspace has an independently scoped broker identity'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select throws_ok(
  format(
    'select public.command_consume_provider_broker_authority(%L,%L,%L,%L,%L,%L,%L,%L,statement_timestamp(),statement_timestamp()+interval ''45 seconds'',%L)',
    (select value from fixture_values where key = 'provider_request_id'),
    (select value from fixture_values where key = 'capability_grant_id'),
    'genie-client-two', 'test-key-two', 'test', 'genie-trigger-test',
    'a1960000-0000-4000-8000-000000000001',
    'trigger:task:cross-workspace',
    (select value from fixture_values where key = 'capability_jti')
  ),
  '42501', 'broker assertion scope crosses authority boundaries',
  'a valid key from another workspace cannot consume provider authority'
);

select lives_ok(
  format(
    'select public.command_consume_provider_broker_authority(%L,%L,%L,%L,%L,%L,%L,%L,statement_timestamp(),statement_timestamp()+interval ''45 seconds'',%L)',
    (select value from fixture_values where key = 'provider_request_id'),
    (select value from fixture_values where key = 'capability_grant_id'),
    'genie-client-one', 'test-key-one', 'test', 'genie-trigger-test',
    'a1960000-0000-4000-8000-000000000002',
    'trigger:task:secure-ingest',
    (select value from fixture_values where key = 'capability_jti')
  ),
  'the exact broker identity consumes the one-attempt grant'
);
select is(
  (select state::text from private.provider_requests where id = (
    select value::uuid from fixture_values where key = 'provider_request_id'
  )),
  'queued',
  'consuming authority queues one provider request'
);
select throws_ok(
  format(
    'select public.command_consume_provider_broker_authority(%L,%L,%L,%L,%L,%L,%L,%L,statement_timestamp(),statement_timestamp()+interval ''45 seconds'',%L)',
    (select value from fixture_values where key = 'provider_request_id'),
    (select value from fixture_values where key = 'capability_grant_id'),
    'genie-client-one', 'test-key-one', 'test', 'genie-trigger-test',
    'a1960000-0000-4000-8000-000000000002',
    'trigger:task:secure-ingest',
    (select value from fixture_values where key = 'capability_jti')
  ),
  '40001', 'broker authority is stale',
  'the consumed request and grant cannot be replayed'
);

select lives_ok(
  format(
    'select public.command_transition_provider_request(%L,2,%L,null,null,null)',
    (select value from fixture_values where key = 'provider_request_id'), 'submit'
  ),
  'the broker marks network submission before making the provider call'
);
select lives_ok(
  format(
    'select public.command_transition_provider_request(%L,3,%L,%L,%L,null)',
    (select value from fixture_values where key = 'provider_request_id'),
    'accept', 'fal-job-primary-001', repeat('7', 64)
  ),
  'the accepted provider job keeps only safe identity and response hash'
);

do $test$
declare
  manifest jsonb;
begin
  manifest:=public.get_provider_dispatch_manifest(
    (select value::uuid from fixture_values where key='provider_request_id')
  );
  if manifest->>'providerRequestId'<>(
    select value from fixture_values where key='provider_request_id'
  ) then
    raise exception 'accepted FAL recovery manifest is unavailable';
  end if;
end;
$test$;

select is(
  public.get_fal_webhook_binding(
    (select value::uuid from fixture_values where key = 'provider_request_id')
  ) ->> 'targetAssetId',
  'a1910000-0000-4000-8000-000000000001',
  'the signed callback route resolves only the immutable target asset binding'
);

insert into fixture_values (key, value)
select 'fal_webhook_result', public.command_record_fal_signed_webhook(
  (select value::uuid from fixture_values where key = 'provider_request_id'),
  'fal-job-primary-001', 'fal-job-primary-001', 'fal-gateway-primary-001',
  'OK', repeat('4', 64), repeat('5', 64),
  '{"gatewayRequestId":"fal-gateway-primary-001","hasPayload":true,"outputCount":1,"status":"OK"}'::jsonb,
  jsonb_build_array(jsonb_build_object(
    'ordinal', 1, 'url', 'https://v3.fal.media/files/primary.png',
    'urlSha256', repeat('6', 64), 'contentType', 'image/png',
    'width', 1024, 'height', 1792,
    'targetAssetId', 'a1910000-0000-4000-8000-000000000001'
  ))
)::text;
select is(
  (select value::jsonb ->> 'disposition' from fixture_values
    where key = 'fal_webhook_result'),
  'accepted',
  'a signed FAL completion is accepted as inbox evidence, not as promoted media'
);
select is(
  (select state::text from private.provider_requests where id = (
    select value::uuid from fixture_values where key = 'provider_request_id'
  )),
  'polling',
  'the callback adopts or confirms the external job without marking it succeeded'
);
select is(
  (select count(*)::integer from private.provider_output_candidates where
    provider_request_id = (
      select value::uuid from fixture_values where key = 'provider_request_id'
    )),
  1,
  'the signed payload creates exactly one non-authoritative ingest candidate'
);
select is(
  (public.command_record_fal_signed_webhook(
    (select value::uuid from fixture_values where key = 'provider_request_id'),
    'fal-job-primary-001', 'fal-job-primary-001', 'fal-gateway-primary-001',
    'OK', repeat('4', 64), repeat('5', 64),
    '{"gatewayRequestId":"fal-gateway-primary-001","hasPayload":true,"outputCount":1,"status":"OK"}'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'ordinal', 1, 'url', 'https://v3.fal.media/files/primary.png',
      'urlSha256', repeat('6', 64), 'contentType', 'image/png',
      'width', 1024, 'height', 1792,
      'targetAssetId', 'a1910000-0000-4000-8000-000000000001'
    ))
  ) ->> 'duplicate')::boolean,
  true,
  'a repeated signed delivery returns the original inbox outcome idempotently'
);
select is(
  (select count(*)::integer from private.provider_output_candidates where
    provider_request_id = (
      select value::uuid from fixture_values where key = 'provider_request_id'
    )),
  1,
  'a repeated signed delivery cannot create another output candidate'
);

insert into fixture_values (key, value)
select 'provider_output_claim', public.command_claim_provider_output_candidate(
  (select id from private.provider_output_candidates where provider_request_id = (
    select value::uuid from fixture_values where key = 'provider_request_id'
  )), 'a19c0000-0000-4000-8000-000000000001', 120
)::text;
select is(
  (select value::jsonb ->> 'leaseToken' from fixture_values
    where key = 'provider_output_claim'),
  'a19c0000-0000-4000-8000-000000000001',
  'secure ingest receives a bounded lease tied to the still-current stage fence'
);

insert into fixture_values (key, value)
select 'provider_remote_fetch_id', public.command_record_provider_output_remote_fetch(
  ((select value::jsonb from fixture_values where key = 'provider_output_claim')
    ->> 'candidateId')::uuid,
  'a19c0000-0000-4000-8000-000000000001',
  'test', 'cdn.fal.media',
  (select value::uuid from fixture_values where key = 'allowlist_v2'),
  repeat('6', 64), repeat('a', 64), repeat('2', 64),
  jsonb_build_array(repeat('4', 64)), 0, 26214400, 60000,
  repeat('c', 64)
)::text;

select is(
  (select provider_output_candidate_id from private.remote_fetch_requests
    where id = (select value::uuid from fixture_values
      where key = 'provider_remote_fetch_id')),
  ((select value::jsonb from fixture_values where key = 'provider_output_claim')
    ->> 'candidateId')::uuid,
  'remote fetch evidence is immutably bound to the exact claimed output candidate'
);

select is(
  public.command_record_provider_output_remote_fetch(
    ((select value::jsonb from fixture_values where key = 'provider_output_claim')
      ->> 'candidateId')::uuid,
    'a19c0000-0000-4000-8000-000000000001',
    'test', 'cdn.fal.media',
    (select value::uuid from fixture_values where key = 'allowlist_v2'),
    repeat('6', 64), repeat('a', 64), repeat('2', 64),
    jsonb_build_array(repeat('4', 64)), 0, 26214400, 60000,
    repeat('c', 64)
  ),
  (select value::uuid from fixture_values where key = 'provider_remote_fetch_id'),
  'an exact secure-fetch evidence replay returns the original immutable row'
);

insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata, version
)
values
  (
    'a1970000-0000-4000-8000-000000000001', 'quarantine',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000001/source',
    null, '{"size":100,"mimetype":"image/png"}', '{}', 'q1'
  ),
  (
    'a1970000-0000-4000-8000-000000000002', 'quarantine',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000002/source',
    null, '{"size":100,"mimetype":"image/png"}', '{}', 'q2'
  ),
  (
    'a1970000-0000-4000-8000-000000000005', 'quarantine',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000099/a1980000-0000-4000-8000-000000000099/source',
    null, '{"size":100,"mimetype":"image/png"}', '{}', 'q-wrong-target'
  ),
  (
    'a1970000-0000-4000-8000-000000000006', 'quarantine',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000006/source',
    null, '{"size":100,"mimetype":"image/png"}', '{}', 'q-unbound-fetch'
  );

select throws_ok(
  format(
    'select public.command_register_quarantine_asset(%L,%L,%L,%L,null,%L,%L,%L,%L,100,%L,%L)',
    'a1980000-0000-4000-8000-000000000099',
    'a1100000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000099',
    (select value from fixture_values where key = 'provider_request_id'),
    'provider_output',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000099/a1980000-0000-4000-8000-000000000099/source',
    'wrong-target.png', 'image/png', repeat('6', 64), repeat('7', 64)
  ),
  '40001', 'provider quarantine scope is invalid',
  'a valid provider request cannot quarantine bytes for an unrelated target asset'
);

select throws_ok(
  format(
    'select public.command_register_quarantine_asset(%L,%L,%L,%L,%L,%L,%L,%L,%L,100,%L,%L)',
    'a1980000-0000-4000-8000-000000000006',
    'a1100000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'provider_request_id'),
    (select id from private.remote_fetch_requests
      where provider_output_candidate_id is null
        and canonical_url_hash = repeat('3', 64) limit 1),
    'provider_output',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000006/source',
    'unbound-fetch.png', 'image/png', repeat('5', 64), repeat('7', 64)
  ),
  '40001', 'provider remote fetch binding is invalid',
  'generic fetch evidence cannot be repurposed for a provider output candidate'
);

select lives_ok(
  format(
    'select public.command_register_quarantine_asset(%L,%L,%L,%L,null,%L,%L,%L,%L,100,%L,%L)',
    'a1980000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'provider_request_id'),
    'provider_output',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000001/source',
    'rejected-source.png', 'image/png', repeat('8', 64), repeat('9', 64)
  ),
  'provider bytes first enter the isolated quarantine bucket'
);

insert into fixture_values (key, value)
select 'rejected_attestation_id', public.command_record_ingest_attestation(
  'a1100000-0000-4000-8000-000000000001',
  'a1980000-0000-4000-8000-000000000001',
  'a1990000-0000-4000-8000-000000000001',
  'clamav', '1.0', 'clean', true, true, 'image/jpeg', 'image/jpeg',
  1000, 1024, 1792, null, null, repeat('a', 64), repeat('b', 64),
  100, 'scanner-task-001', 'scanner-v1'
)::text;
select is(
  (select disposition from private.media_ingest_attestations where id = (
    select value::uuid from fixture_values where key = 'rejected_attestation_id'
  )),
  'rejected',
  'a MIME mismatch persists immutable rejection evidence'
);
select is(
  (select state::text from private.quarantine_assets
    where id = 'a1980000-0000-4000-8000-000000000001'),
  'rejected',
  'failed ingest remains rejected after the command commits'
);

select lives_ok(
  format(
    'select public.command_register_quarantine_asset(%L,%L,%L,%L,%L,%L,%L,%L,%L,100,%L,%L)',
    'a1980000-0000-4000-8000-000000000002',
    'a1100000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'provider_request_id'),
    (select value from fixture_values where key = 'provider_remote_fetch_id'),
    'provider_output',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000002/source',
    'accepted-source.png', 'image/png', repeat('c', 64), repeat('d', 64)
  ),
  'a second exact provider output enters quarantine'
);
select lives_ok(
  format(
    'select public.command_complete_provider_output_candidate(%L,%L,%L)',
    ((select value::jsonb from fixture_values where key = 'provider_output_claim')
      ->> 'candidateId'),
    'a19c0000-0000-4000-8000-000000000001',
    'a1980000-0000-4000-8000-000000000002'
  ),
  'only the claimed secure-ingest worker can bind the exact quarantine version'
);
select is(
  (select state::text from private.provider_output_candidates where id = (
    ((select value::jsonb from fixture_values where key = 'provider_output_claim')
      ->> 'candidateId')::uuid
  )),
  'quarantined',
  'the signed provider output becomes only quarantined evidence after ingest'
);
insert into fixture_values (key, value)
select 'accepted_attestation_id', public.command_record_ingest_attestation(
  'a1100000-0000-4000-8000-000000000001',
  'a1980000-0000-4000-8000-000000000002',
  'a1990000-0000-4000-8000-000000000001',
  'clamav', '1.0', 'clean', true, true, 'image/png', 'image/png',
  1000, 1024, 1792, null, null, repeat('e', 64), repeat('f', 64),
  100, 'scanner-task-002', 'scanner-v1'
)::text;

insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata, version
)
values (
  'a1970000-0000-4000-8000-000000000003', 'workspace-media',
  'a1100000-0000-4000-8000-000000000001/generated_image/a1910000-0000-4000-8000-000000000001/a19a0000-0000-4000-8000-000000000001/source',
  null, '{"size":100,"mimetype":"image/png"}',
  jsonb_build_object('sha256', repeat('f', 64)), 'media-v1'
);

select throws_ok(
  format(
    'select public.command_promote_quarantine_asset(%L,%L,%L,%L,%L,%L,%L)',
    'a1100000-0000-4000-8000-000000000001',
    'a1980000-0000-4000-8000-000000000002',
    (select value from fixture_values where key = 'accepted_attestation_id'),
    'generated_image', 'a19a0000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001/generated_image/a1910000-0000-4000-8000-000000000001/a19a0000-0000-4000-8000-000000000001/source',
    'wrong-version'
  ),
  '55000', 'promoted storage object is not hash-bound',
  'promotion rejects a storage version that is not hash-bound to attestation evidence'
);

select lives_ok(
  format(
    'select public.command_promote_quarantine_asset(%L,%L,%L,%L,%L,%L,%L)',
    'a1100000-0000-4000-8000-000000000001',
    'a1980000-0000-4000-8000-000000000002',
    (select value from fixture_values where key = 'accepted_attestation_id'),
    'generated_image', 'a19a0000-0000-4000-8000-000000000001',
    'a1100000-0000-4000-8000-000000000001/generated_image/a1910000-0000-4000-8000-000000000001/a19a0000-0000-4000-8000-000000000001/source',
    'media-v1'
  ),
  'only the exact scanned and hash-bound media object is promoted'
);
select is(
  (select state::text from private.provider_requests where id = (
    select value::uuid from fixture_values where key = 'provider_request_id'
  )),
  'succeeded',
  'promotion is the only event that marks a media provider request succeeded'
);

insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata, version
)
values (
  'a1970000-0000-4000-8000-000000000004', 'quarantine',
  'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000003/source',
  null, '{"size":100,"mimetype":"image/png"}', '{}', 'q3'
);
select is(
  (public.command_register_quarantine_asset(
    'a1980000-0000-4000-8000-000000000003',
    'a1100000-0000-4000-8000-000000000001',
    'a1910000-0000-4000-8000-000000000001',
    (select value::uuid from fixture_values where key = 'provider_request_id'),
    null, 'provider_output',
    'a1100000-0000-4000-8000-000000000001/quarantine/a1910000-0000-4000-8000-000000000001/a1980000-0000-4000-8000-000000000003/source',
    'late.png', 'image/png', 100, repeat('1', 64), repeat('2', 64)
  ) ->> 'state'),
  'late_evidence',
  'late provider output is retained as evidence and never exposed as production media'
);

select lives_ok(
  format(
    'select public.command_complete_preflight_attempt(%L,1,1,%L,%L,%L,%L,null)',
    ((select value::jsonb from fixture_values where key = 'claim_response')
      ->> 'stageAttemptId'), repeat('8', 64), 'succeeded',
    'a19b0000-0000-4000-8000-000000000001', repeat('3', 64)
  ),
  'the current stage fence can complete with an exact output manifest'
);
select lives_ok(
  format(
    'select public.command_transition_preflight_run(%L,3,%L,null)',
    (select value from fixture_values where key = 'preflight_run_id'), 'succeed'
  ),
  'a run succeeds only after every required stage succeeds'
);

insert into fixture_values (key, value)
select 'failed_run_id', (
  public.command_create_preflight_run(
    'a1100000-0000-4000-8000-000000000001',
    'a1400000-0000-4000-8000-000000000001',
    'a1600000-0000-4000-8000-000000000001',
    'a1500000-0000-4000-8000-000000000001', 'narration_clock', false,
    null, null, null, 'a1820000-0000-4000-8000-000000000003',
    'preflight-create-clock-001', repeat('4', 64)
  ) ->> 'preflightRunId'
);
select public.command_transition_preflight_run(
  (select value::uuid from fixture_values where key = 'failed_run_id'),
  1, 'enqueue', null
);
select public.command_transition_preflight_run(
  (select value::uuid from fixture_values where key = 'failed_run_id'),
  2, 'started', 'trigger-run-clock-001'
);
insert into fixture_values (key, value)
select 'failed_stage_id', id::text from public.preflight_stage_runs
where preflight_run_id = (
  select value::uuid from fixture_values where key = 'failed_run_id'
);
select public.command_make_preflight_stage_ready(
  (select value::uuid from fixture_values where key = 'failed_stage_id'),
  1, 'a1900000-0000-4000-8000-000000000002', repeat('5', 64)
);
insert into fixture_values (key, value)
select 'failed_claim', public.command_claim_preflight_stage(
  (select value::uuid from fixture_values where key = 'failed_stage_id'),
  2, 1, 'trigger.worker.clock.001', 120
)::text;
select public.command_start_preflight_attempt(
  ((select value::jsonb from fixture_values where key = 'failed_claim')
    ->> 'stageAttemptId')::uuid,
  1, 1, repeat('5', 64), 'task-clock-001', 'task-run-clock-001'
);
select lives_ok(
  format(
    'select public.command_transition_preflight_run(%L,3,%L,null)',
    (select value from fixture_values where key = 'failed_run_id'), 'fail'
  ),
  'a failed preflight transitions terminally'
);
select is(
  (select state::text from public.preflight_stage_attempts where id = (
    ((select value::jsonb from fixture_values where key = 'failed_claim')
      ->> 'stageAttemptId')::uuid
  )),
  'failed_terminal',
  'failing a run terminalizes its active attempt'
);
select is(
  (select state::text from public.preflight_stage_leases where id = (
    ((select value::jsonb from fixture_values where key = 'failed_claim')
      ->> 'leaseId')::uuid
  )),
  'revoked',
  'failing a run revokes its active lease'
);
select throws_ok(
  format(
    'select public.command_record_agent_injection_finding(%L,%L,%L,%L,%L,%L,%L)',
    'a1100000-0000-4000-8000-000000000001',
    (select value from fixture_values where key = 'failed_run_id'),
    ((select value::jsonb from fixture_values where key = 'failed_claim')
      ->> 'stageAttemptId'), 'model_text', repeat('6', 64),
    'PROMPT_INJECTION', 'rejected'
  ),
  '40001', 'injection finding authority is stale',
  'a terminal attempt cannot append new agent evidence'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

insert into fixture_values (key, value)
select 'broker_key_invalid_overlap', public.command_add_broker_client_key(
  (select value::uuid from fixture_values where key = 'broker_client_id'),
  3, 'test-key-invalid-overlap', repeat('C', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '16 minutes', 'invalid overlap test key'
)::text;
select throws_ok(
  format(
    'select public.command_activate_broker_client_key(%L,%L,4,1)',
    (select value from fixture_values where key = 'broker_client_id'),
    (select value from fixture_values where key = 'broker_key_invalid_overlap')
  ),
  '22023', 'broker key overlap window is invalid',
  'rotation rejects an overlap longer than the documented fifteen-minute maximum'
);

insert into fixture_values (key, value)
select 'broker_key_rotated', public.command_add_broker_client_key(
  (select value::uuid from fixture_values where key = 'broker_client_id'),
  4, 'test-key-rotated', repeat('D', 64),
  statement_timestamp() - interval '1 minute',
  statement_timestamp() + interval '1 hour',
  statement_timestamp() + interval '10 minutes', 'bounded overlap rotation key'
)::text;
select lives_ok(
  format(
    'select public.command_activate_broker_client_key(%L,%L,5,1)',
    (select value from fixture_values where key = 'broker_client_id'),
    (select value from fixture_values where key = 'broker_key_rotated')
  ),
  'an AAL2 admin activates a second key only with a bounded overlap'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select is(
  public.get_broker_verification_context(
    'genie-client-one', 'test-key-one', 'test', 'genie-trigger-test'
  ) ->> 'kid',
  'test-key-one',
  'the prior key remains usable during the explicit overlap window'
);
select is(
  public.get_broker_verification_context(
    'genie-client-one', 'test-key-rotated', 'test', 'genie-trigger-test'
  ) ->> 'kid',
  'test-key-rotated',
  'the new key is independently usable during the explicit overlap window'
);
select is(
  (select count(*)::integer from private.broker_client_key_versions
    where broker_client_id = (
      select value::uuid from fixture_values where key = 'broker_client_id'
    ) and state = 'active'),
  2,
  'rotation exposes exactly two active kids during overlap'
);
select ok(
  (select overlap_until <= statement_timestamp() + interval '15 minutes'
    from private.broker_client_key_versions where id = (
      select value::uuid from fixture_values where key = 'broker_key_id'
    )),
  'the prior key stores the same bounded overlap deadline enforced by verification'
);

reset role;
update private.broker_assertion_jtis
set expires_at = statement_timestamp() + interval '5 minutes'
where broker_key_version_id = (
  select value::uuid from fixture_values where key = 'broker_key_id'
);
insert into private.broker_assertion_jtis (
  broker_client_id, broker_key_version_id, jti_hash, assertion_subject,
  provider_request_id, capability_grant_id, issued_at, expires_at
) values (
  (select value::uuid from fixture_values where key = 'broker_client_id'),
  (select value::uuid from fixture_values where key = 'broker_key_rotated'),
  encode(extensions.digest(convert_to(
    'a1960000-0000-4000-8000-000000000003', 'UTF8'
  ), 'sha256'), 'hex'),
  'trigger:task:rotation-overlap',
  (select value::uuid from fixture_values where key = 'provider_request_id'),
  (select value::uuid from fixture_values where key = 'capability_grant_id'),
  statement_timestamp(), statement_timestamp() + interval '5 minutes'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  format(
    'select public.command_revoke_broker_client_key(%L,%L,3,%L)',
    (select value from fixture_values where key = 'broker_client_id'),
    (select value from fixture_values where key = 'broker_key_id'),
    'rotation overlap ended early'
  ),
  'revocation immediately removes the prior kid'
);
reset role;
select is(
  (select state::text from private.broker_client_key_versions where id = (
    select value::uuid from fixture_values where key = 'broker_key_id'
  )),
  'revoked',
  'the revoked key has a terminal lifecycle state'
);
select ok(
  (select bool_and(revoked_at is not null)
    from private.broker_assertion_jtis where broker_key_version_id = (
      select value::uuid from fixture_values where key = 'broker_key_id'
    )),
  'revocation invalidates every unexpired assertion JTI for the compromised kid'
);
set local role authenticated;
select throws_ok(
  format(
    'select public.command_revoke_broker_client_key(%L,%L,3,%L)',
    (select value from fixture_values where key = 'broker_client_id'),
    (select value from fixture_values where key = 'broker_key_id'),
    'stale duplicate revocation'
  ),
  '40001', 'broker key revocation is stale',
  'a stale concurrent key-revocation writer loses without side effects'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok(
  $$select public.get_broker_verification_context(
    'genie-client-one', 'test-key-one', 'test', 'genie-trigger-test'
  )$$,
  '42501', 'broker key is unavailable',
  'verification fails closed for a revoked kid before consume or dispatch'
);
select is(
  public.get_broker_verification_context(
    'genie-client-one', 'test-key-rotated', 'test', 'genie-trigger-test'
  ) ->> 'kid',
  'test-key-rotated',
  'revoking the prior kid does not disturb the current key'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"a1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config('request.jwt.claim.sub', 'a1200000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  format(
    'select public.command_disable_broker_client(%L,6,%L)',
    (select value from fixture_values where key = 'broker_client_id'),
    'client incident response'
  ),
  'client disable atomically revokes every remaining key and assertion'
);
reset role;
select is(
  (select state::text from private.broker_clients where id = (
    select value::uuid from fixture_values where key = 'broker_client_id'
  )),
  'disabled',
  'the broker client is disabled immediately'
);
select is(
  (select state::text from private.broker_client_key_versions where id = (
    select value::uuid from fixture_values where key = 'broker_key_rotated'
  )),
  'revoked',
  'client disable revokes the current key'
);
select ok(
  (select revoked_at is not null from private.broker_assertion_jtis
    where broker_key_version_id = (
      select value::uuid from fixture_values where key = 'broker_key_rotated'
    )),
  'client disable invalidates the current key unexpired assertion JTI'
);
set local role authenticated;
select throws_ok(
  format(
    'select public.command_disable_broker_client(%L,6,%L)',
    (select value from fixture_values where key = 'broker_client_id'),
    'stale duplicate disable'
  ),
  '40001', 'broker client disable is stale',
  'a stale concurrent client-disable writer loses without side effects'
);

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok(
  $$select public.get_broker_verification_context(
    'genie-client-one', 'test-key-rotated', 'test', 'genie-trigger-test'
  )$$,
  '42501', 'broker client is unavailable',
  'client disable wins before any later key verification or provider dispatch'
);
select lives_ok(
  $$select public.command_record_broker_security_rejection(
    'test', 'genie-trigger-test', 'genie-client-one', 'test-key-rotated',
    'replay_or_stale'
  )$$,
  'the broker records a safe append-only rejection alert in a separate transaction'
);
select is(
  (select count(*)::integer from private.diagnostic_events
    where event_type = 'provider_broker.authority_rejected'
      and error_class = 'replay_or_stale'),
  1,
  'a replay or stale-authority rejection creates one safe security alert'
);

reset role;
select ok(
  (select count(*) >= 10 from audit.events
    where action in (
      'provider_broker.client_registered', 'provider_broker.key_added',
      'provider_broker.key_activated', 'provider_broker.key_revoked',
      'provider_broker.client_disabled'
    )),
  'broker register/add/activate/revoke/disable commands append immutable audit events'
);
select ok(
  (select count(*) >= 10 from private.diagnostic_events
    where event_type like 'provider_broker.%'
      and retention_class = 'security'),
  'broker lifecycle and rejection events are retained as security evidence'
);

select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in (
      'preflight_runs','preflight_stage_runs','preflight_stage_dependencies',
      'preflight_stage_attempts','preflight_stage_leases','assets',
      'asset_versions','media_probes','asset_references'
    )
  ),
  'every exposed Phase 2 control-plane and asset table has RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'private.quarantine_assets', 'select')
  and not has_table_privilege('authenticated', 'private.provider_requests', 'select')
  and not has_table_privilege('authenticated', 'private.agent_tool_calls', 'select'),
  'authenticated users cannot inspect private quarantine, provider, or agent ledgers'
);

select * from finish();
rollback;

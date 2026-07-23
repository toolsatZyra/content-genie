begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, storage, private, audit, pg_catalog;

select plan(183);

select is(
  private.estimate_hindi_narration_duration_v2(
    pg_catalog.repeat('शिव ', 119) || 'शिव'
  ),
  59.520::numeric,
  'the pinned Hindi duration profile includes deterministic performance breaths'
);

select is(
  private.estimate_hindi_narration_duration_v2(
    pg_catalog.repeat('शिव ', 119) || E'शिव।\nकथा?'
  ),
  61.090::numeric,
  'punctuation and line direction can cross the launch acknowledgement boundary'
);

select is(
  private.estimate_hindi_narration_duration_v1(
    pg_catalog.repeat(U&'\0936\093f\0935 ', 119) ||
      U&'\0936\093f\0935\0964\000a\0915\0925\093e?'
  ),
  60.670::numeric,
  'the historical v1 duration profile remains exactly reconstructible'
);

insert into public.organizations (id, name, slug)
values ('91000000-0000-4000-8000-000000000001', 'Phase Two Zyra', 'phase-two-zyra');

insert into public.workspaces (id, organization_id, name, slug)
values
  (
    '91100000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'Phase Two One',
    'phase-two-one'
  ),
  (
    '91100000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    'Phase Two Two',
    'phase-two-two'
  );

insert into auth.users (
  id, email, email_confirmed_at, created_at, updated_at, aud, role
)
values
  (
    '92000000-0000-4000-8000-000000000001',
    'phase2.one@zyra.test',
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp(),
    'authenticated',
    'authenticated'
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    'phase2.two@zyra.test',
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp(),
    'authenticated',
    'authenticated'
  );

insert into public.profiles (user_id, display_name)
values
  ('92000000-0000-4000-8000-000000000001', 'Phase Two One'),
  ('92000000-0000-4000-8000-000000000002', 'Phase Two Two');

insert into public.memberships (
  workspace_id, user_id, role, status, authority_epoch, activated_at
)
values
  (
    '91100000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'member',
    'active',
    1,
    statement_timestamp()
  ),
  (
    '91100000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002',
    'member',
    'active',
    1,
    statement_timestamp()
  );

insert into public.series (
  id, workspace_id, slug, title, owner_user_id, created_by
)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-series-one',
    'Phase Two Series One',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '91100000-0000-4000-8000-000000000002',
    'phase-two-series-two',
    'Phase Two Series Two',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002'
  );

insert into public.episodes (
  id,
  workspace_id,
  series_id,
  episode_number,
  title,
  owner_user_id,
  created_by
)
values
  (
    '94000000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    1,
    'Exact Script',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '91100000-0000-4000-8000-000000000002',
    '93000000-0000-4000-8000-000000000002',
    1,
    'Other Workspace',
    '92000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000002'
  ),
  (
    '94000000-0000-4000-8000-000000000003',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    2,
    'Duration Guard',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '94000000-0000-4000-8000-000000000004',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000001',
    3,
    'Uploaded Script',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001'
  );

insert into private.aggregate_versions (
  workspace_id, aggregate_type, aggregate_id, current_version
)
values
  (
    '91100000-0000-4000-8000-000000000001',
    'episode',
    '94000000-0000-4000-8000-000000000001',
    1
  ),
  (
    '91100000-0000-4000-8000-000000000002',
    'episode',
    '94000000-0000-4000-8000-000000000002',
    1
  ),
  (
    '91100000-0000-4000-8000-000000000001',
    'episode',
    '94000000-0000-4000-8000-000000000003',
    1
  ),
  (
    '91100000-0000-4000-8000-000000000001',
    'episode',
    '94000000-0000-4000-8000-000000000004',
    1
  );

insert into public.script_revisions (
  id,
  workspace_id,
  episode_id,
  revision_number,
  source_kind,
  raw_text,
  raw_utf8,
  raw_utf8_sha256,
  processing_text,
  processing_utf8_sha256,
  processing_profile,
  coordinate_map,
  runtime_evidence,
  raw_utf16_code_units,
  raw_scalar_count,
  raw_grapheme_count,
  processing_utf16_code_units,
  processing_scalar_count,
  processing_grapheme_count,
  estimated_duration_seconds,
  duration_out_of_band,
  duration_acknowledged,
  created_by
)
values (
  '95000000-0000-4000-8000-000000000002',
  '91100000-0000-4000-8000-000000000002',
  '94000000-0000-4000-8000-000000000002',
  1,
  'browser_text',
  'other',
  convert_to('other', 'UTF8'),
  encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
  'other',
  encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
  'genie-script-processing.v1',
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}'::jsonb,
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
  5,
  5,
  5,
  5,
  5,
  5,
  60,
  false,
  false,
  '92000000-0000-4000-8000-000000000002'
);

select is((select count(*) from public.look_versions), 117::bigint, 'exactly 117 looks are pinned');
select is(
  (select count(distinct look_key) from public.look_versions),
  117::bigint,
  'all look keys are unique'
);
select is(
  (select count(distinct family) from public.look_versions),
  9::bigint,
  'the look pack retains nine families'
);
select is(
  (
    select count(*)
    from public.look_versions l
    join public.look_version_availability a on a.look_version_id = l.id
    where l.look_key = 'glowing-divine-realism' and a.status = 'active'
  ),
  1::bigint,
  'Glowing Divine Realism is one active exact default'
);
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'look_versions'
      and column_name = 'recommended'
  ),
  0::bigint,
  'the production registry has no Recommended pseudo-group'
);
select is((select count(*) from public.look_packs), 1::bigint, 'one reviewed look pack is pinned');
select is(
  (
    select manifest_sha256
    from public.look_packs
    where id = 'ai-director-curated-looks'
  ),
  'dc411ef2b205a220262ea12862a195ec63b729cee88020a09aeb0a07dadaa67f',
  'database pack pin matches the checked-in manifest'
);
select is(
  (
    select jsonb_build_object(
      'repository', source_repository,
      'commit', source_commit,
      'catalogSha256', source_catalog_sha256
    )
    from public.look_packs
    where id = 'ai-director-curated-looks'
  ),
  jsonb_build_object(
    'repository', 'https://github.com/toolsatZyra/doctor-z',
    'commit', '3d57ccf4cebd30019cc862c692c83a8049169d3a',
    'catalogSha256',
      '6b12dac1e8c7beec096ee1fcff755a814ecab58bb921bf8ad4901167334e0033'
  ),
  'persisted look-pack provenance exactly matches the immutable source manifest'
);
select is(
  (select count(distinct preview_sha256) from public.look_versions),
  117::bigint,
  'every look has a distinct pinned preview'
);
select is(
  (
    select count(*)
    from public.look_versions
    where negative_policy ->> 'schemaVersion' = 'genie-look-negative-policy.v1'
      and jsonb_array_length(negative_policy -> 'rules') = 5
      and negative_policy_sha256 ~ '^[a-f0-9]{64}$'
  ),
  117::bigint,
  'every look persists a versioned blocking generation-negative policy'
);
select is(
  (
    select count(*)
    from public.look_versions
    where visual_qc_baseline ->> 'schemaVersion' =
        'genie-look-visual-qc-baseline.v1'
      and visual_qc_baseline ->> 'sourceLookBlockSha256' =
        locked_look_block_sha256
      and visual_qc_baseline ->> 'negativePolicySha256' =
        negative_policy_sha256
      and jsonb_array_length(visual_qc_baseline -> 'checks') = 3
      and visual_qc_baseline_sha256 ~ '^[a-f0-9]{64}$'
  ),
  117::bigint,
  'every look persists its hash-bound colour, contrast, lens, light, and texture QC baseline'
);
select is((select count(*) from public.voice_versions), 2::bigint, 'only two narrator versions exist');
select is(
  (
    select c.external_voice_id
    from public.voice_versions v
    join private.voice_provider_configurations c on c.voice_version_id = v.id
    where v.gender = 'male'
  ),
  'b0oby86k6n7Uh5LZcOBR',
  'male identity is exact'
);
select is(
  (
    select c.external_voice_id
    from public.voice_versions v
    join private.voice_provider_configurations c on c.voice_version_id = v.id
    where v.gender = 'female'
  ),
  'GSdeLRB8detpjZjN63Wn',
  'female identity is exact'
);
set local session_replication_role = replica;
update public.voice_version_availability
set status = 'pending_authenticated_canary',
    aggregate_version = 1,
    verified_at = null,
    withdrawn_at = null,
    verification_expires_at = null;
set local session_replication_role = origin;
select is(
  (
    select count(*)
    from public.voice_version_availability
    where status = 'pending_authenticated_canary'
  ),
  2::bigint,
  'neither voice is falsely marked canary-verified'
);
select ok(
  (
    select bool_and(c.relrowsecurity and c.relforcerowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'script_revisions',
        'script_lock_events',
        'script_annotations',
        'voice_versions',
        'voice_version_availability',
        'look_packs',
        'look_version_availability',
        'look_versions',
        'episode_configuration_candidates'
      )
  ),
  'all Phase 2 slice tables force RLS'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'script_revisions'
      and c.contype = 'c'
      and c.convalidated
      and pg_catalog.strpos(
        pg_catalog.pg_get_constraintdef(c.oid),
        'pg_column_size(coordinate_map) <= 8388608'
      ) > 0
  ),
  'script revisions enforce the 8 MiB PostgreSQL JSONB coordinate-map limit'
);
select ok(
  (
    select count(*) = 5 and bool_and(c.convalidated)
    from pg_catalog.pg_constraint c
    where c.conrelid = 'public.script_revisions'::regclass
      and c.conname = any(array[
        'script_revisions_raw_utf8_size_check',
        'script_revisions_size_policy_version_check',
        'script_revisions_coordinate_map_verifier_v2_check',
        'script_revisions_coordinate_map_shape_v2_check',
        'script_revisions_coordinate_map_semantics_v2_check'
      ])
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.script_revisions'::regclass
      and a.attname = 'coordinate_map_verifier'
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) =
        '''postgres-structural-v2''::text'
  )
  and exists (
    select 1
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_attrdef d
      on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.script_revisions'::regclass
      and a.attname = 'script_size_policy_version'
      and a.attnotnull
      and pg_catalog.pg_get_expr(d.adbin, d.adrelid) = '2'
  )
  and exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.script_revisions'::regclass
      and t.tgname = 'script_revisions_insert_size_policy'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  )
  and exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class index_relation
      on index_relation.oid = i.indexrelid
    join pg_catalog.pg_namespace index_namespace
      on index_namespace.oid = index_relation.relnamespace
    where index_namespace.nspname = 'private'
      and index_relation.relname = 'script_coordinate_attestations_request_idx'
      and not i.indisunique
  ),
  'the forward correction leaves named v2 constraints, default, and nonunique attestation index'
);
select is(
  (
    select script_size_policy_version
    from public.script_revisions
    where id = '95000000-0000-4000-8000-000000000002'
  ),
  2::smallint,
  'new script revisions receive the v2 8 KiB size policy'
);
select throws_ok(
  $$
    insert into public.script_revisions
    select (
      jsonb_populate_record(
        null::public.script_revisions,
        to_jsonb(revision) || jsonb_build_object(
          'id', '95000000-0000-4000-8000-000000000099',
          'revision_number', 2,
          'script_size_policy_version', 1
        )
      )
    ).*
    from public.script_revisions revision
    where revision.id = '95000000-0000-4000-8000-000000000002'
  $$,
  '22023',
  'new script revisions require size policy v2 and at most 8192 bytes',
  'new rows cannot claim the grandfathered predecessor size policy'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.command_lock_episode_script(uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,uuid,uuid,text,text,uuid)',
    'execute'
  ),
  'anon cannot lock scripts'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.command_lock_episode_script(uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,uuid,uuid,text,text,uuid)',
    'execute'
  ),
  'authenticated can invoke the exact script command'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.command_select_episode_voice(uuid,uuid,uuid,bigint,public.narrator_gender,uuid,uuid,text,text,uuid)',
    'execute'
  ),
  'authenticated can invoke the exact voice command'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.command_select_episode_look(uuid,uuid,uuid,bigint,uuid,uuid,text,text,uuid)',
    'execute'
  ),
  'authenticated can invoke the exact look command'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.attest_script_coordinate_map(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.revoke_script_coordinate_attestation(uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_set_voice_version_availability(uuid,bigint,public.voice_version_availability_status,jsonb,uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_withdraw_voice_version(uuid,bigint,jsonb,uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_withdraw_look_version(uuid,bigint,jsonb,uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_claim_live_broker_request(uuid,text,bigint,text,text,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_record_live_broker_created(text,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_record_live_broker_state(text,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_live_broker_lifecycle(text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_reconcile_live_broker_cancellation(text,text,text,text)',
    'execute'
  ),
  'authenticated callers cannot invoke service-authority functions'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.attest_script_coordinate_map(uuid,uuid,uuid,uuid,text,text,text,jsonb,jsonb)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.revoke_script_coordinate_attestation(uuid,uuid,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_set_voice_version_availability(uuid,bigint,public.voice_version_availability_status,jsonb,uuid,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_withdraw_voice_version(uuid,bigint,jsonb,uuid,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_withdraw_look_version(uuid,bigint,jsonb,uuid,text,text,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_claim_live_broker_request(uuid,text,bigint,text,text,text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_record_live_broker_created(text,text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_record_live_broker_state(text,text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.get_live_broker_lifecycle(text,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_reconcile_live_broker_cancellation(text,text,text,text)',
    'execute'
  ),
  'only service authority receives attestation and availability commands'
);
select is(
  (
    select array_agg(p.proname::text order by p.proname::text)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  array[
    'authorize_storage_sign',
    'command_accept_invitation',
    'command_activate_broker_client_key',
    'command_add_broker_client_key',
    'command_answer_mvp_repair_clarification',
    'command_appoint_cultural_reviewer',
    'command_archive_series',
    'command_authorize_micro_quote',
    'command_authorize_world_build_intent',
    'command_claim_work_item',
    'command_confirm_episode_narration_upload',
    'command_confirm_production_quote',
    'command_create_episode',
    'command_create_invitation',
    'command_create_series',
    'command_decide_world_candidate',
    'command_disable_broker_client',
    'command_lock_episode_script',
    'command_lock_episode_script_v2',
    'command_lock_first_episode_world',
    'command_offboard_member',
    'command_prepare_episode_narration_upload',
    'command_prepare_world_upload',
    'command_record_mvp_master_cultural_decision',
    'command_register_broker_client',
    'command_retry_mvp_production',
    'command_review_mvp_master',
    'command_revoke_broker_client_key',
    'command_select_episode_look',
    'command_select_episode_voice',
    'command_start_mvp_production',
    'command_submit_source_review',
    'get_mvp_episode_costs',
    'prepare_first_episode_world_lock'
  ]::text[],
  'authenticated can execute only the reviewed Phase 1 and Phase 2 commands'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"96000000-0000-4000-8000-000000000001","email":"phase2.one@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '92000000-0000-4000-8000-000000000001',
  true
);

create temp table script_coordinate_fixture (
  coordinate_map jsonb not null
) on commit drop;
insert into script_coordinate_fixture (coordinate_map)
values (
  $json$
  {"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5,6,7],[0,3,6,9,10,11,12,14],[2,3,5,7]],"p":[[0,1,2,3,4,5],[0,3,6,9,10,12],[2,3,4,5]],"s":[[0,0,2,0,2],[1,2,3,2,3],[2,3,4,3,4]]}
  $json$::jsonb
);
grant select on script_coordinate_fixture to authenticated;

create temp table short_script_coordinate_fixture (
  coordinate_map jsonb not null
) on commit drop;
insert into short_script_coordinate_fixture (coordinate_map)
values (
  $json$
  {"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}
  $json$::jsonb
);
grant select on short_script_coordinate_fixture to authenticated;

select ok(
  private.verify_script_coordinate_map_envelope(
    (select coordinate_map from script_coordinate_fixture),
    U&'शिव\000D\000Ae\0301',
    U&'शिव\000A\00E9',
    7, 7, 4, 5, 5, 4
  ),
  'the exact server-generated coordinate map passes semantic verification'
);
select ok(
  (
    select bool_and(
      not private.verify_script_coordinate_map_envelope(
        mutation.mutated_map,
        U&'\0936\093F\0935\000D\000Ae\0301',
        U&'\0936\093F\0935\000A\00E9',
        7, 7, 4, 5, 5, 4
      )
    )
    from script_coordinate_fixture
    cross join lateral (
      values
        (coordinate_map || '{"x":0}'::jsonb),
        (coordinate_map - 'c'),
        (jsonb_set(coordinate_map, '{v}', '"2"'::jsonb)),
        (
          jsonb_set(
            coordinate_map,
            '{r}',
            (coordinate_map -> 'r') || jsonb_build_array('[]'::jsonb)
          )
        ),
        (jsonb_set(coordinate_map, '{r,0,1}', '"1"'::jsonb)),
        (jsonb_set(coordinate_map, '{r,0,1}', 'true'::jsonb)),
        (jsonb_set(coordinate_map, '{r,0,1}', 'null'::jsonb)),
        (jsonb_set(coordinate_map, '{r,0,1}', '1.5'::jsonb)),
        (jsonb_set(coordinate_map, '{r,0,1}', '1e100'::jsonb)),
        (jsonb_set(coordinate_map, '{r,0,1}', '-1'::jsonb)),
        (jsonb_set(coordinate_map, '{r,0,1}', '2147483648'::jsonb)),
        (jsonb_set(coordinate_map, '{r,0,1}', '999'::jsonb)),
        (jsonb_set(coordinate_map, '{r,1,1}', '999'::jsonb)),
        (jsonb_set(coordinate_map, '{p,0,1}', '999'::jsonb)),
        (jsonb_set(coordinate_map, '{p,1,1}', '999'::jsonb)),
        (jsonb_set(coordinate_map, '{r,2,1}', '2'::jsonb)),
        (jsonb_set(coordinate_map, '{r,2,3}', '6'::jsonb)),
        (jsonb_set(coordinate_map, '{s,0}', '[0,0,2,0]'::jsonb)),
        (jsonb_set(coordinate_map, '{s,0,0}', '4'::jsonb)),
        (jsonb_set(coordinate_map, '{s,0,1}', 'true'::jsonb)),
        (jsonb_set(coordinate_map, '{s,0,1}', '-1'::jsonb)),
        (jsonb_set(coordinate_map, '{s,0,1}', '1.5'::jsonb)),
        (jsonb_set(coordinate_map, '{s,1,1}', '3'::jsonb)),
        (jsonb_set(coordinate_map, '{s,2,0}', '0'::jsonb)),
        (
          jsonb_set(
            coordinate_map,
            '{s}',
            jsonb_build_array(coordinate_map -> 's' -> 0)
          )
        )
    ) as mutation(mutated_map)
  ),
  'v2 rejects hostile keys, tuple shapes/types, offsets, coverage, and reasons'
);
select ok(
  private.verify_script_coordinate_map_envelope(
    jsonb_set(
      (select coordinate_map from script_coordinate_fixture),
      '{s}',
      '[[4,0,4,0,4]]'::jsonb
    ),
    U&'\0936\093F\0935\000D\000Ae\0301',
    U&'\0936\093F\0935\000A\00E9',
    7, 7, 4, 5, 5, 4
  ),
  'the bounded global fallback preserves full indexes while foregoing local reasons'
);

create temp table boundary_coordinate_fixture (
  label text primary key,
  raw_text text not null,
  processing_text text not null,
  coordinate_map jsonb not null
) on commit drop;
with compact_index as (
  select jsonb_build_array(
    (
      select jsonb_agg(value order by value)
      from pg_catalog.generate_series(0, 8192) as generated_offset(value)
    ),
    (
      select jsonb_agg(value order by value)
      from pg_catalog.generate_series(0, 8192) as generated_offset(value)
    ),
    (
      select jsonb_agg(value order by value)
      from pg_catalog.generate_series(1, 8192) as boundary(value)
    )
  ) as value
)
insert into boundary_coordinate_fixture (
  label,
  raw_text,
  processing_text,
  coordinate_map
)
select
  'cr-heavy',
  'a' || repeat(E'\r', 8191),
  'a' || repeat(E'\n', 8191),
  jsonb_build_object(
    'v', 2,
    'c', 'zero-based-half-open',
    'r', value,
    'p', value,
    's', '[[0,0,1,0,1],[1,1,8192,1,8192]]'::jsonb
  )
from compact_index
union all
select
  'alternating-reasons',
  repeat(E'a\r', 4096),
  repeat(E'a\n', 4096),
  jsonb_build_object(
    'v', 2,
    'c', 'zero-based-half-open',
    'r', value,
    'p', value,
    's', '[[4,0,8192,0,8192]]'::jsonb
  )
from compact_index;

select ok(
  (
    select bool_and(
      octet_length(raw_text) = 8192
      and pg_column_size(coordinate_map) <= 2097152
      and private.verify_script_coordinate_map_envelope(
        coordinate_map,
        raw_text,
        processing_text,
        8192, 8192, 8192, 8192, 8192, 8192
      )
    )
    from boundary_coordinate_fixture
  ),
  'PostgreSQL accepts compact CR-heavy and alternating exact-boundary maps below 2 MiB'
);
select ok(
  (
    with compact_legacy_index as (
      select jsonb_build_array(
        (
          select jsonb_agg(value order by value)
          from pg_catalog.generate_series(0, 8193) as generated_offset(value)
        ),
        (
          select jsonb_agg(value order by value)
          from pg_catalog.generate_series(0, 8193) as generated_offset(value)
        ),
        (
          select jsonb_agg(value order by value)
          from pg_catalog.generate_series(1, 8193) as boundary(value)
        )
      ) as value
    )
    select private.verify_script_coordinate_map_envelope(
      jsonb_build_object(
        'v', 2,
        'c', 'zero-based-half-open',
        'r', value,
        'p', value,
        's', '[[0,0,8193,0,8193]]'::jsonb
      ),
      repeat('a', 8193),
      repeat('a', 8193),
      8193, 8193, 8193, 8193, 8193, 8193
    )
    from compact_legacy_index
  ),
  'v2 semantic verification retains a converted legacy row above the new-write cap'
);

insert into private.script_coordinate_attestations (
  id,
  workspace_id,
  episode_id,
  actor_user_id,
  request_hash,
  raw_utf8_sha256,
  processing_utf8_sha256,
  coordinate_map_sha256,
  runtime_evidence_sha256,
  expires_at
)
values
  (
    '9a000000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    repeat('0', 64),
    '78a5d6a15df7b6fee16cde6d73f5446588a638bef669458ffd26c9538d7276e4',
    '0405b6dc9035e6d704e51f5e2b7b4ec44c0f3eb9fe0e675702ee80dada992fda',
    encode(
      extensions.digest(
        convert_to(
          '{"v":2,"c":"zero-based-half-open","r":[],"p":[],"s":[]}'::jsonb::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    encode(
      extensions.digest(
        convert_to(
          '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}'::jsonb::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    statement_timestamp() + interval '10 minutes'
  ),
  (
    '9a000000-0000-4000-8000-000000000002',
    '91100000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    '78a5d6a15df7b6fee16cde6d73f5446588a638bef669458ffd26c9538d7276e4',
    '0405b6dc9035e6d704e51f5e2b7b4ec44c0f3eb9fe0e675702ee80dada992fda',
    encode(
      extensions.digest(
        convert_to((select coordinate_map::text from script_coordinate_fixture), 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    encode(
      extensions.digest(
        convert_to(
          '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}'::jsonb::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    statement_timestamp() + interval '10 minutes'
  ),
  (
    '9a000000-0000-4000-8000-000000000003',
    '91100000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000001',
    repeat('8', 64),
    'f9b0078b5df596d2ea19010c001bbd009e651de2c57e8fb7e355f31eb9d3f739',
    'f9b0078b5df596d2ea19010c001bbd009e651de2c57e8fb7e355f31eb9d3f739',
    encode(
      extensions.digest(
        convert_to(
          (select coordinate_map::text from short_script_coordinate_fixture),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    encode(
      extensions.digest(
        convert_to(
          '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}'::jsonb::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    statement_timestamp() + interval '10 minutes'
  );

insert into private.script_coordinate_attestations (
  id,
  workspace_id,
  episode_id,
  actor_user_id,
  request_hash,
  raw_utf8_sha256,
  processing_utf8_sha256,
  coordinate_map_sha256,
  runtime_evidence_sha256,
  created_at,
  expires_at
)
values (
  '9a000000-0000-4000-8000-000000000004',
  '91100000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  repeat('d', 64),
  repeat('d', 64),
  repeat('d', 64),
  repeat('d', 64),
  repeat('d', 64),
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '1 minute'
);
create temp table issued_attestations (id uuid not null) on commit drop;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
insert into issued_attestations (id)
select public.attest_script_coordinate_map(
  requested.attestation_id,
  '91100000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  repeat('e', 64),
  repeat('e', 64),
  repeat('e', 64),
  '{"v":2,"c":"zero-based-half-open","r":[],"p":[],"s":[]}',
  '{}'
)
from (
  values
    ('9a000000-0000-4000-8000-000000000005'::uuid),
    ('9a000000-0000-4000-8000-000000000006'::uuid)
) as requested(attestation_id);
select is(
  (select count(distinct id) from issued_attestations),
  2::bigint,
  'identical service requests preserve distinct server-selected attestation IDs'
);
select throws_ok(
  $command$
    select public.attest_script_coordinate_map(
      '9a000000-0000-1000-8000-000000000007',
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000003',
      '92000000-0000-4000-8000-000000000001',
      repeat('f', 64),
      repeat('f', 64),
      repeat('f', 64),
      '{"v":2,"c":"zero-based-half-open","r":[],"p":[],"s":[]}',
      '{}'
    )
  $command$,
  '22023',
  'invalid script attestation identity',
  'service authority cannot issue a non-v4 attestation identity'
);
select is(
  (
    select count(*)
    from private.script_coordinate_attestations
    where id = '9a000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'issuing an attestation removes expired residual authority'
);
delete from private.script_coordinate_attestations
where request_hash = repeat('e', 64);
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"96000000-0000-4000-8000-000000000001","email":"phase2.one@zyra.test"}',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.series (
  id, workspace_id, slug, title, state, owner_user_id, created_by, archived_at
)
values
  (
    '93000000-0000-4000-8000-000000000003',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-archived-series',
    'Phase Two Archived Series',
    'archived',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    statement_timestamp()
  ),
  (
    '93000000-0000-4000-8000-000000000004',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-superseded-release',
    'Phase Two Superseded Release',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '93000000-0000-4000-8000-000000000005',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-missing-release-status',
    'Phase Two Missing Release Status',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '93000000-0000-4000-8000-000000000006',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-continuity-owner',
    'Phase Two Continuity Owner',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '93000000-0000-4000-8000-000000000007',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-cross-series-continuity',
    'Phase Two Cross-Series Continuity',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '93000000-0000-4000-8000-000000000008',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-missing-look-availability',
    'Phase Two Missing Look Availability',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '93000000-0000-4000-8000-000000000009',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-first-unreleased-episode',
    'Phase Two First Unreleased Episode',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '93000000-0000-4000-8000-000000000010',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-exact-creative-release',
    'Phase Two Exact Creative Release',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  ),
  (
    '93000000-0000-4000-8000-000000000011',
    '91100000-0000-4000-8000-000000000001',
    'phase-two-legacy-release-identity',
    'Phase Two Legacy Release Identity',
    'active',
    '92000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    null
  );

insert into public.continuity_state_versions (
  id, workspace_id, series_id, version_no, content_hash, created_by
)
values (
  '93500000-0000-4000-8000-000000000001',
  '91100000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000006',
  1,
  repeat('e', 64),
  '92000000-0000-4000-8000-000000000001'
);

insert into public.series_releases (
  id, workspace_id, series_id, release_number, manifest_hash,
  look_version_id, continuity_state_version_id, narrator_gender,
  voice_version_id, created_by
)
values
  (
    '93600000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000004',
    1,
    repeat('a', 64),
    (select id from public.look_versions where look_key = 'divine-fury'),
    null,
    'male',
    'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '93600000-0000-4000-8000-000000000002',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000005',
    1,
    repeat('b', 64),
    (select id from public.look_versions where look_key = 'divine-fury'),
    null,
    'male',
    'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '93600000-0000-4000-8000-000000000004',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000008',
    1,
    repeat('d', 64),
    (select id from public.look_versions where look_key = 'silver-nitrate-silent-flicker'),
    null,
    'male',
    'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
    '92000000-0000-4000-8000-000000000001'
  );

insert into public.series_releases (
  id, workspace_id, series_id, release_number, manifest_hash,
  look_version_id, continuity_state_version_id, narrator_gender,
  voice_version_id, created_by
)
values (
  '93600000-0000-4000-8000-000000000005',
  '91100000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000010',
  1,
  repeat('f', 64),
  (select id from public.look_versions where look_key = 'divine-fury'),
  null,
  'female',
  'bb2db360-9e44-5e17-95d3-a1e38ef21fa7',
  '92000000-0000-4000-8000-000000000001'
);

-- Reconstruct a predecessor-corrupt release while FK triggers are suppressed.
-- The authenticated command must still reject it even if catalog integrity was
-- bypassed by an earlier privileged defect.
set local session_replication_role = replica;
insert into public.series_releases (
  id, workspace_id, series_id, release_number, manifest_hash,
  creative_identity_schema_version, look_version_id,
  continuity_state_version_id, narrator_gender, voice_version_id, created_by
)
values (
  '93600000-0000-4000-8000-000000000003',
  '91100000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000007',
  1,
  repeat('c', 64),
  1,
  (select id from public.look_versions where look_key = 'divine-fury'),
  '93500000-0000-4000-8000-000000000001',
  'male',
  'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
  '92000000-0000-4000-8000-000000000001'
);

-- Reconstruct a genuine pre-creative-identity immutable release. Its manifest
-- stays untouched and no narrator or voice is invented for it.
insert into public.series_releases (
  id, workspace_id, series_id, release_number, manifest_hash,
  creative_identity_schema_version, look_version_id,
  continuity_state_version_id, narrator_gender, voice_version_id, created_by
)
values (
  '93600000-0000-4000-8000-000000000006',
  '91100000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000011',
  1,
  repeat('9', 64),
  0,
  null,
  null,
  null,
  null,
  '92000000-0000-4000-8000-000000000001'
);
set local session_replication_role = origin;

insert into public.series_release_statuses (
  release_id, workspace_id, series_id, status, changed_by
)
values
  (
    '93600000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000004',
    'superseded',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '93600000-0000-4000-8000-000000000003',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000007',
    'active',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '93600000-0000-4000-8000-000000000004',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000008',
    'active',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '93600000-0000-4000-8000-000000000005',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000010',
    'active',
    '92000000-0000-4000-8000-000000000001'
  ),
  (
    '93600000-0000-4000-8000-000000000006',
    '91100000-0000-4000-8000-000000000001',
    '93000000-0000-4000-8000-000000000011',
    'active',
    '92000000-0000-4000-8000-000000000001'
  );

update public.series
set active_release_id = case id
  when '93000000-0000-4000-8000-000000000004'::uuid
    then '93600000-0000-4000-8000-000000000001'::uuid
  when '93000000-0000-4000-8000-000000000005'::uuid
    then '93600000-0000-4000-8000-000000000002'::uuid
  when '93000000-0000-4000-8000-000000000007'::uuid
    then '93600000-0000-4000-8000-000000000003'::uuid
  when '93000000-0000-4000-8000-000000000008'::uuid
    then '93600000-0000-4000-8000-000000000004'::uuid
  when '93000000-0000-4000-8000-000000000010'::uuid
    then '93600000-0000-4000-8000-000000000005'::uuid
  when '93000000-0000-4000-8000-000000000011'::uuid
    then '93600000-0000-4000-8000-000000000006'::uuid
  else active_release_id
end
where id in (
  '93000000-0000-4000-8000-000000000004',
  '93000000-0000-4000-8000-000000000005',
  '93000000-0000-4000-8000-000000000007',
  '93000000-0000-4000-8000-000000000008',
  '93000000-0000-4000-8000-000000000010',
  '93000000-0000-4000-8000-000000000011'
);

select throws_ok(
  $command$
    insert into public.series_releases (
      workspace_id, series_id, release_number, manifest_hash, created_by
    ) values (
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000009',
      1,
      repeat('8', 64),
      '92000000-0000-4000-8000-000000000001'
    )
  $command$,
  '23514',
  'new Series releases require an exact look, narrator, and voice',
  'a newly-authored release cannot rely on implicit or incomplete creative identity'
);

delete from public.look_version_availability
where look_version_id = (
  select id from public.look_versions where look_key = 'silver-nitrate-silent-flicker'
);

set local role authenticated;

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'series_releases_continuity_workspace_series_fk'
      and constraint_row.conrelid = 'public.series_releases'::regclass
      and constraint_row.confrelid = 'public.continuity_state_versions'::regclass
  ),
  'the terminal continuity FK binds Series releases to exact ownership evidence'
);

select has_column(
  'public',
  'series_releases',
  'creative_identity_schema_version',
  'Series releases disclose whether creative identity was authored explicitly'
);
select ok(
  (
    select creative_identity_schema_version = 0
      and narrator_gender is null
      and voice_version_id is null
      and manifest_hash = repeat('9', 64)
    from public.series_releases
    where id = '93600000-0000-4000-8000-000000000006'
  ),
  'legacy immutable releases retain their manifest without invented narrator or voice semantics'
);

select throws_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000003',
      'Archived Series Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000001',
      'phase2-episode-archived-0001',
      repeat('1', 64),
      '93800000-0000-4000-8000-000000000001'
    )
  $command$,
  'P0002',
  'active Series not found',
  'an archived Series cannot create an Episode'
);

select throws_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000004',
      'Superseded Release Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000002',
      'phase2-episode-superseded-0001',
      repeat('2', 64),
      '93800000-0000-4000-8000-000000000002'
    )
  $command$,
  '23503',
  'active Series release is unavailable',
  'a superseded active-release pin cannot create an Episode'
);

select throws_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000005',
      'Missing Status Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000003',
      'phase2-episode-missing-status-0001',
      repeat('3', 64),
      '93800000-0000-4000-8000-000000000003'
    )
  $command$,
  '23503',
  'active Series release is unavailable',
  'missing release-status evidence fails Episode creation closed'
);

select throws_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000007',
      'Cross-Series Continuity Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000004',
      'phase2-episode-cross-continuity-0001',
      repeat('4', 64),
      '93800000-0000-4000-8000-000000000004'
    )
  $command$,
  '23503',
  'active Series continuity is unavailable',
  'a crafted cross-Series continuity pin fails the authenticated command closed'
);

select throws_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000008',
      'Missing Look Availability Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000005',
      'phase2-episode-missing-look-0001',
      repeat('5', 64),
      '93800000-0000-4000-8000-000000000005'
    )
  $command$,
  '23503',
  'active Series look is unavailable',
  'missing pinned-look availability evidence fails Episode creation closed'
);

select throws_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000011',
      'Legacy Creative Identity Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000011',
      'phase2-episode-legacy-identity-0001',
      repeat('9', 64),
      '93800000-0000-4000-8000-000000000011'
    )
  $command$,
  '23503',
  'active Series release creative identity is unavailable',
  'a legacy release cannot create an Episode from invented creative identity'
);
select is(
  (
    select count(*)
    from public.episodes
    where series_id = '93000000-0000-4000-8000-000000000011'
  ),
  0::bigint,
  'failed legacy release creation leaves no partial Episode behind'
);

select lives_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000009',
      'First Unreleased Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000006',
      'phase2-episode-unreleased-0001',
      repeat('6', 64),
      '93800000-0000-4000-8000-000000000006'
    )
  $command$,
  'an active unreleased Series can create its first Episode'
);

select ok(
  (
    select episode_number = 1
      and pinned_series_release_id is null
      and pinned_continuity_version_id is null
    from public.episodes
    where series_id = '93000000-0000-4000-8000-000000000009'
      and title = 'First Unreleased Episode'
  ),
  'the first unreleased Episode persists without invented release pins'
);

select has_column(
  'public',
  'series_releases',
  'voice_version_id',
  'Series releases persist an exact narrator voice identity'
);
select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_row
    where constraint_row.conname = 'series_releases_voice_identity_fk'
      and constraint_row.conrelid = 'public.series_releases'::regclass
      and constraint_row.confrelid = 'public.voice_versions'::regclass
  ),
  'the Series release voice and narrator gender are one foreign-key identity'
);
select lives_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000010',
      'Inherited Creative Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000020',
      'phase2-episode-inherited-creative-0001',
      repeat('7', 64),
      '93800000-0000-4000-8000-000000000020'
    )
  $command$,
  'an active release with an available exact voice can create an Episode'
);
select ok(
  (
    select pinned_series_release_id = '93600000-0000-4000-8000-000000000005'
      and pinned_continuity_version_id is null
    from public.episodes
    where series_id = '93000000-0000-4000-8000-000000000010'
      and title = 'Inherited Creative Episode'
  ),
  'the Episode pins the exact active Series release without invented continuity'
);

reset role;
select lives_ok(
  $command$
    insert into public.script_revisions (
      id, workspace_id, episode_id, revision_number, source_kind, raw_text,
      raw_utf8, raw_utf8_sha256, processing_text, processing_utf8_sha256,
      processing_profile, coordinate_map, runtime_evidence,
      raw_utf16_code_units, raw_scalar_count, raw_grapheme_count,
      processing_utf16_code_units, processing_scalar_count,
      processing_grapheme_count, estimated_duration_seconds,
      duration_out_of_band, duration_acknowledged, created_by
    ) values (
      '95000000-0000-4000-8000-000000000010',
      '91100000-0000-4000-8000-000000000001',
      (
        select id from public.episodes
        where series_id = '93000000-0000-4000-8000-000000000010'
          and title = 'Inherited Creative Episode'
      ),
      1, 'browser_text', 'other', convert_to('other', 'UTF8'),
      encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
      'other',
      encode(extensions.digest(convert_to('other', 'UTF8'), 'sha256'), 'hex'),
      'genie-script-processing.v1',
      '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}'::jsonb,
      '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      5, 5, 5, 5, 5, 5, 60, false, false,
      '92000000-0000-4000-8000-000000000001'
    )
  $command$,
  'script insertion creates the released-Series configuration candidate'
);
set local role authenticated;
select is(
  (
    select concat_ws(
      '|',
      c.narrator_gender::text,
      c.voice_version_id::text,
      l.look_key,
      coalesce(c.voice_confirmed_by::text, 'null'),
      coalesce(c.look_confirmed_by::text, 'null')
    )
    from public.episode_configuration_candidates c
    join public.look_versions l on l.id = c.look_version_id
    where c.script_revision_id = '95000000-0000-4000-8000-000000000010'
  ),
  'female|bb2db360-9e44-5e17-95d3-a1e38ef21fa7|divine-fury|null|null',
  'the candidate inherits the release look, narrator and voice exactly without forging human confirmation'
);

reset role;
set local session_replication_role = replica;
update public.voice_version_availability
set status = 'withdrawn',
    withdrawn_at = statement_timestamp()
where voice_version_id = 'bb2db360-9e44-5e17-95d3-a1e38ef21fa7';
set local session_replication_role = origin;
set local role authenticated;
select throws_ok(
  $command$
    select public.command_create_episode(
      '91100000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000010',
      'Withdrawn Voice Episode',
      '',
      '92000000-0000-4000-8000-000000000001',
      '93700000-0000-4000-8000-000000000021',
      'phase2-episode-withdrawn-voice-0001',
      repeat('8', 64),
      '93800000-0000-4000-8000-000000000021'
    )
  $command$,
  '23503',
  'active Series release creative identity is unavailable',
  'a withdrawn pinned Series voice fails Episode creation closed'
);
reset role;
set local session_replication_role = replica;
update public.voice_version_availability
set status = 'pending_authenticated_canary',
    verified_at = null,
    withdrawn_at = null,
    verification_expires_at = null
where voice_version_id = 'bb2db360-9e44-5e17-95d3-a1e38ef21fa7';
set local session_replication_role = origin;
set local role authenticated;

select throws_ok(
  $command$
    select external_voice_id
    from private.voice_provider_configurations
    limit 1
  $command$,
  '42501',
  null,
  'authenticated clients cannot read provider voice identifiers'
);

select throws_ok(
  $command$
    insert into public.script_revisions (
      workspace_id, episode_id, revision_number, source_kind, raw_text, raw_utf8,
      raw_utf8_sha256, processing_text, processing_utf8_sha256,
      processing_profile, coordinate_map, runtime_evidence,
      raw_utf16_code_units, raw_scalar_count, raw_grapheme_count,
      processing_utf16_code_units, processing_scalar_count,
      processing_grapheme_count, estimated_duration_seconds,
      duration_out_of_band, duration_acknowledged, created_by
    ) values (
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      9, 'browser_text', 'direct', convert_to('direct', 'UTF8'),
      repeat('a', 64), 'direct', repeat('a', 64),
      'genie-script-processing.v1', '{}', '{}',
      6, 6, 6, 6, 6, 6, 60, false, false,
      '92000000-0000-4000-8000-000000000001'
    )
  $command$,
  '42501',
  null,
  'direct script insertion is denied'
);
select is(
  (
    select count(*)
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'the target Episode has no script before the command'
);

select throws_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      1,
      U&'शिव\000D\000Ae\0301',
      convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'),
      encode(
        extensions.digest(convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'), 'sha256'),
        'hex'
      ),
      U&'शिव\000A\00E9',
      encode(
        extensions.digest(convert_to(U&'शिव\000A\00E9', 'UTF8'), 'sha256'),
        'hex'
      ),
      'genie-script-processing.v1',
      (select coordinate_map from script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      7, 7, 4, 5, 5, 4, true,
      '9a000000-0000-4000-8000-000000000099',
      '97000000-0000-4000-8000-000000000099',
      'phase2-script-unattested-0001',
      repeat('7', 64),
      '98000000-0000-4000-8000-000000000099'
    )
  $command$,
  '42501',
  'trusted coordinate-map attestation required',
  'direct authenticated RPC cannot forge server coordinate evidence'
);

select throws_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      1,
      U&'शिव\000D\000Ae\0301',
      convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'),
      encode(
        extensions.digest(convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'), 'sha256'),
        'hex'
      ),
      U&'शिव\000A\00E9',
      encode(
        extensions.digest(convert_to(U&'शिव\000A\00E9', 'UTF8'), 'sha256'),
        'hex'
      ),
      'genie-script-processing.v1',
      '{"v":2,"c":"zero-based-half-open","r":[],"p":[],"s":[]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      7,
      7,
      4,
      5,
      5,
      4,
      true,
      '9a000000-0000-4000-8000-000000000001',
      '97000000-0000-4000-8000-000000000000',
      'phase2-script-lock-bad-map',
      repeat('0', 64),
      '98000000-0000-4000-8000-000000000000'
    )
  $command$,
  '22023',
  'script integrity envelope rejected',
  'a caller-derived empty coordinate map is rejected'
);

select lives_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      1,
      U&'शिव\000D\000Ae\0301',
      convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'),
      encode(
        extensions.digest(convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'), 'sha256'),
        'hex'
      ),
      U&'शिव\000A\00E9',
      encode(
        extensions.digest(convert_to(U&'शिव\000A\00E9', 'UTF8'), 'sha256'),
        'hex'
      ),
      'genie-script-processing.v1',
      (select coordinate_map from script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      7,
      7,
      4,
      5,
      5,
      4,
      true,
      '9a000000-0000-4000-8000-000000000002',
      '97000000-0000-4000-8000-000000000001',
      'phase2-script-lock-0001',
      repeat('a', 64),
      '98000000-0000-4000-8000-000000000001'
    )
  $command$,
  'exact script command succeeds'
);
select is(
  (
    select count(*)
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'one authorized script is visible for the target Episode'
);
select is(
  (select raw_text from public.script_revisions where episode_id = '94000000-0000-4000-8000-000000000001'),
  U&'शिव\000D\000Ae\0301',
  'raw text round-trips without trimming or normalization'
);
select is(
  (
    select raw_utf8_sha256
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  encode(
    extensions.digest(convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'), 'sha256'),
    'hex'
  ),
  'raw UTF-8 hash is exact'
);
select is(
  (
    select processing_text
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  U&'शिव\000A\00E9',
  'processing text is LF and NFC without changing raw authority'
);
select is(
  (
    select coordinate_map ->> 'c'
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'zero-based-half-open',
  'coordinate intervals are explicitly half-open'
);
select is(
  (
    select count(*)
    from public.domain_events
    where event_type = 'episode.script_locked.v1'
      and aggregate_id = '94000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'script lock emits one domain event'
);
select is(
  (
    select count(*)
    from public.script_lock_events
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'script lock creates immutable actor-bound evidence'
);
select is(
  (
    select count(*)
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'script lock creates one active configuration candidate'
);
select is(
  (
    select narrator_gender::text
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'male',
  'the configuration defaults to male narration'
);
select is(
  (
    select l.look_key
    from public.episode_configuration_candidates c
    join public.look_versions l on l.id = c.look_version_id
    where c.episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'glowing-divine-realism',
  'the configuration defaults to Glowing Divine Realism'
);
select is(
  (
    select performance_profile_id
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'genie-launch-hindi-delhi-sanskrit-performance.v1',
  'the fixed Hindi Delhi Sanskrit performance direction is versioned and system locked'
);
select ok(
  (
    select voice_confirmed_by is null
      and voice_confirmed_at is null
      and look_confirmed_by is null
      and look_confirmed_at is null
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'system defaults are not represented as human-confirmed choices'
);
select is(
  (
    select workflow_state::text
    from public.episodes
    where id = '94000000-0000-4000-8000-000000000001'
  ),
  'world_setup',
  'locking the script advances the Episode to world setup'
);

reset role;
select throws_ok(
  $command$
    update public.episode_configuration_candidates
    set state = 'preflight'
    where episode_id = '94000000-0000-4000-8000-000000000001'
  $command$,
  '23514',
  null,
  'configuration progression is blocked until both human confirmations exist'
);
select is(
  (
    select count(*)
    from private.script_coordinate_attestations
    where id = '9a000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'the successful script command consumes its exact attestation once'
);
select throws_ok(
  $command$
    update public.script_revisions
    set raw_text = 'mutated'
    where episode_id = '94000000-0000-4000-8000-000000000001'
  $command$,
  '55000',
  'immutable record cannot be updated or deleted',
  'even the table owner cannot mutate a script revision'
);
select throws_ok(
  $command$
    insert into public.episode_configuration_candidates (
      id,
      workspace_id,
      episode_id,
      candidate_number,
      script_revision_id,
      narrator_gender,
      voice_version_id,
      look_version_id,
      selected_by
    )
    values (
      '9b000000-0000-4000-8000-000000000001',
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000003',
      1,
      (
        select id
        from public.script_revisions
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      'male',
      'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
      (select id from public.look_versions where look_key = 'glowing-divine-realism'),
      '92000000-0000-4000-8000-000000000001'
    )
  $command$,
  '23503',
  null,
  'same-workspace configuration cannot pair a script with another Episode'
);
set local role authenticated;

select throws_ok(
  $command$
    select public.command_select_episode_voice(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id
        from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      1,
      'female',
      'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
      '97000000-0000-4000-8000-000000000002',
      'phase2-voice-invalid-0001',
      repeat('b', 64),
      '98000000-0000-4000-8000-000000000002'
    )
  $command$,
  '23503',
  'exact voice version is unavailable',
  'gender cannot be paired with another voice identity'
);
select lives_ok(
  $command$
    select public.command_select_episode_voice(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id
        from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      1,
      'female',
      'bb2db360-9e44-5e17-95d3-a1e38ef21fa7',
      '97000000-0000-4000-8000-000000000003',
      'phase2-voice-select-0001',
      repeat('c', 64),
      '98000000-0000-4000-8000-000000000003'
    )
  $command$,
  'the exact female version can be selected'
);
select is(
  (
    select narrator_gender::text
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'female',
  'female selection is authoritative'
);
select ok(
  (
    select voice_confirmed_by = '92000000-0000-4000-8000-000000000001'
      and voice_confirmed_at is not null
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'the explicit voice command records durable human confirmation'
);
select ok(
  (
    select look_confirmed_by is null and look_confirmed_at is null
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'voice confirmation does not imply look confirmation'
);
select throws_ok(
  $command$
    select public.command_select_episode_look(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id
        from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      2,
      '99000000-0000-4000-8000-000000000099',
      '97000000-0000-4000-8000-000000000004',
      'phase2-look-invalid-0001',
      repeat('d', 64),
      '98000000-0000-4000-8000-000000000004'
    )
  $command$,
  '23503',
  'exact look version is unavailable',
  'an unknown look version is rejected'
);
select lives_ok(
  $command$
    select public.command_select_episode_look(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id
        from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      2,
      (select id from public.look_versions where look_key = 'divine-fury'),
      '97000000-0000-4000-8000-000000000005',
      'phase2-look-select-0001',
      repeat('e', 64),
      '98000000-0000-4000-8000-000000000005'
    )
  $command$,
  'a reviewed exact look version can be selected'
);
select is(
  (
    select l.look_key
    from public.episode_configuration_candidates c
    join public.look_versions l on l.id = c.look_version_id
    where c.episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'divine-fury',
  'look selection pins Divine Fury exactly'
);
select ok(
  (
    select look_confirmed_by = '92000000-0000-4000-8000-000000000001'
      and look_confirmed_at is not null
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'the explicit look command records durable human confirmation'
);
select throws_ok(
  $command$
    select public.command_select_episode_look(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id
        from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      2,
      (select id from public.look_versions where look_key = 'divine-fury'),
      '97000000-0000-4000-8000-000000000006',
      'phase2-look-stale-0001',
      repeat('f', 64),
      '98000000-0000-4000-8000-000000000006'
    )
  $command$,
  '40001',
  'stale configuration candidate',
  'stale look selection loses the compare-and-swap race'
);

reset role;
set local session_replication_role = replica;
update public.episodes
set workflow_state = 'delivered'
where id = '94000000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
set local role authenticated;
select throws_ok(
  $command$
    select public.command_select_episode_voice(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      3,
      'male',
      'ec4e61a6-dc45-53d9-ba4b-fd5c7f267b2f',
      '97000000-0000-4000-8000-000000000022',
      'phase2-voice-delivered-0001',
      repeat('7', 64),
      '98000000-0000-4000-8000-000000000022'
    )
  $command$,
  '55000',
  'Episode creative configuration is read-only',
  'a delivered Episode rejects direct authenticated voice mutation'
);
select throws_ok(
  $command$
    select public.command_select_episode_look(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      3,
      (select id from public.look_versions where look_key = 'glowing-divine-realism'),
      '97000000-0000-4000-8000-000000000023',
      'phase2-look-delivered-0001',
      repeat('8', 64),
      '98000000-0000-4000-8000-000000000023'
    )
  $command$,
  '55000',
  'Episode creative configuration is read-only',
  'a delivered Episode rejects direct authenticated look mutation'
);
select ok(
  (
    select c.aggregate_version = 3
      and c.narrator_gender = 'female'
      and l.look_key = 'divine-fury'
    from public.episode_configuration_candidates c
    join public.look_versions l on l.id = c.look_version_id
    where c.episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  'rejected post-lifecycle mutations leave the creative candidate unchanged'
);
select lives_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      1,
      U&'शिव\000D\000Ae\0301',
      convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'),
      encode(
        extensions.digest(convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'), 'sha256'),
        'hex'
      ),
      U&'शिव\000A\00E9',
      encode(
        extensions.digest(convert_to(U&'शिव\000A\00E9', 'UTF8'), 'sha256'),
        'hex'
      ),
      'genie-script-processing.v1',
      (select coordinate_map from script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      7, 7, 4, 5, 5, 4, true,
      '9a000000-0000-4000-8000-000000000002',
      '97000000-0000-4000-8000-000000000007',
      'phase2-script-lock-0001',
      repeat('a', 64),
      '98000000-0000-4000-8000-000000000007'
    )
  $command$,
  'idempotent script replay returns the original result'
);
select is(
  (
    select count(*)
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'idempotent replay creates no duplicate script'
);
select throws_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      4,
      U&'शिव\000D\000Ae\0301',
      convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'),
      encode(
        extensions.digest(convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'), 'sha256'),
        'hex'
      ),
      U&'शिव\000A\00E9',
      encode(
        extensions.digest(convert_to(U&'शिव\000A\00E9', 'UTF8'), 'sha256'),
        'hex'
      ),
      'genie-script-processing.v1',
      (select coordinate_map from script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      7, 7, 4, 5, 5, 4, true,
      '9a000000-0000-4000-8000-000000000099',
      '97000000-0000-4000-8000-000000000010',
      'phase2-script-relock-0001',
      repeat('6', 64),
      '98000000-0000-4000-8000-000000000010'
    )
  $command$,
  '55000',
  'Episode script is already locked',
  'a new idempotency key cannot create a second script lock'
);
select throws_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      4,
      'changed',
      convert_to('changed', 'UTF8'),
      encode(extensions.digest(convert_to('changed', 'UTF8'), 'sha256'), 'hex'),
      'changed',
      encode(extensions.digest(convert_to('changed', 'UTF8'), 'sha256'), 'hex'),
      'genie-script-processing.v1',
      (select coordinate_map from script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      7, 7, 7, 7, 7, 7, true,
      '9a000000-0000-4000-8000-000000000002',
      '97000000-0000-4000-8000-000000000008',
      'phase2-script-lock-0001',
      repeat('9', 64),
      '98000000-0000-4000-8000-000000000008'
    )
  $command$,
  '22023',
  'idempotency key was already used with a different request',
  'a changed script cannot reuse the lock key'
);
select throws_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000003',
      1,
      'short',
      convert_to('short', 'UTF8'),
      encode(extensions.digest(convert_to('short', 'UTF8'), 'sha256'), 'hex'),
      'short',
      encode(extensions.digest(convert_to('short', 'UTF8'), 'sha256'), 'hex'),
      'genie-script-processing.v1',
      (select coordinate_map from short_script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      5, 5, 5, 5, 5, 5, false,
      '9a000000-0000-4000-8000-000000000003',
      '97000000-0000-4000-8000-000000000009',
      'phase2-script-short-0001',
      repeat('8', 64),
      '98000000-0000-4000-8000-000000000009'
    )
  $command$,
  '22023',
  'duration estimate requires acknowledgement',
  'out-of-band duration cannot be silently accepted'
);
select is(
  (
    select count(*)
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the target Episode retains exactly one script after all commands'
);
select is(
  (
    select aggregate_version
    from public.episode_configuration_candidates
    where episode_id = '94000000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'voice and look selections advance the candidate version'
);
select is(
  (
    select aggregate_version
    from public.episodes
    where id = '94000000-0000-4000-8000-000000000001'
  ),
  4::bigint,
  'script, voice, and look commands advance the Episode aggregate'
);
select throws_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000003',
      null,
      'short',
      convert_to('short', 'UTF8'),
      encode(extensions.digest(convert_to('short', 'UTF8'), 'sha256'), 'hex'),
      'short',
      encode(extensions.digest(convert_to('short', 'UTF8'), 'sha256'), 'hex'),
      'genie-script-processing.v1',
      (select coordinate_map from short_script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      5, 5, 5, 5, 5, 5, true,
      '9a000000-0000-4000-8000-000000000003',
      '97000000-0000-4000-8000-000000000012',
      'phase2-script-null-version-0001',
      repeat('1', 64),
      '98000000-0000-4000-8000-000000000012'
    )
  $command$,
  '40001',
  'stale Episode version',
  'a null expected Episode version cannot bypass script-lock CAS'
);
select throws_ok(
  $command$
    select public.command_select_episode_voice(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      null,
      'male',
      (select id from public.voice_versions where gender = 'male'),
      '97000000-0000-4000-8000-000000000013',
      'phase2-voice-null-version-0001',
      repeat('2', 64),
      '98000000-0000-4000-8000-000000000013'
    )
  $command$,
  '40001',
  'stale configuration candidate',
  'a null expected candidate version cannot bypass voice-selection CAS'
);
select throws_ok(
  $command$
    select public.command_select_episode_look(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      (
        select id from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000001'
      ),
      null,
      (select id from public.look_versions where look_key = 'glowing-divine-realism'),
      '97000000-0000-4000-8000-000000000014',
      'phase2-look-null-version-0001',
      repeat('3', 64),
      '98000000-0000-4000-8000-000000000014'
    )
  $command$,
  '40001',
  'stale configuration candidate',
  'a null expected candidate version cannot bypass look-selection CAS'
);

reset role;
insert into private.auth_session_revocations (
  workspace_id,
  user_id,
  session_id,
  revoked_by,
  reason
)
values (
  '91100000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  'Phase 2 action-time replay test'
);
set local role authenticated;
select throws_ok(
  $command$
    select public.command_lock_episode_script(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      1,
      U&'शिव\000D\000Ae\0301',
      convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'),
      encode(
        extensions.digest(convert_to(U&'शिव\000D\000Ae\0301', 'UTF8'), 'sha256'),
        'hex'
      ),
      U&'शिव\000A\00E9',
      encode(
        extensions.digest(convert_to(U&'शिव\000A\00E9', 'UTF8'), 'sha256'),
        'hex'
      ),
      'genie-script-processing.v1',
      (select coordinate_map from script_coordinate_fixture),
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      7, 7, 4, 5, 5, 4, true,
      '9a000000-0000-4000-8000-000000000002',
      '97000000-0000-4000-8000-000000000011',
      'phase2-script-lock-0001',
      repeat('a', 64),
      '98000000-0000-4000-8000-000000000011'
    )
  $command$,
  '42501',
  'active workspace session required',
  'revoked sessions cannot replay a previously successful command receipt'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000000","role":"service_role"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000000',
  true
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select throws_ok(
  $command$
    select public.command_set_voice_version_availability(
      (select id from public.voice_versions where gender = 'female'),
      null,
      'verified',
      jsonb_build_object(
        'kind','authenticated_canary','provider','elevenlabs','result','passed',
        'checkedAt','2026-07-17T00:00:00Z','artifactSha256',repeat('e', 64)
      ),
      '9b000000-0000-4000-8000-000000000010',
      'phase2-voice-null-version-0002',
      repeat('4', 64),
      '9c000000-0000-4000-8000-000000000010'
    )
  $command$,
  '22023',
  'availability evidence is required',
  'a null expected version cannot enter the voice availability command'
);
select throws_ok(
  $command$
    select public.command_withdraw_look_version(
      (select id from public.look_versions where look_key = 'divine-fury'),
      null,
      jsonb_build_object(
        'kind','curation_withdrawal','reason','adversarial-test',
        'actor','phase2-pgtap'
      ),
      '9b000000-0000-4000-8000-000000000011',
      'phase2-look-null-version-0002',
      repeat('5', 64),
      '9c000000-0000-4000-8000-000000000011'
    )
  $command$,
  '22023',
  'withdrawal evidence is required',
  'a null expected version cannot enter the look availability command'
);
select throws_ok(
  $command$
    select public.command_set_voice_version_availability(
      (select id from public.voice_versions where gender = 'female'),
      1,
      'verified',
      '{"kind":null}',
      '9b000000-0000-4000-8000-000000000012',
      'phase2-voice-null-evidence-0001',
      repeat('6', 64),
      '9c000000-0000-4000-8000-000000000012'
    )
  $command$,
  '22023',
  'availability evidence is required',
  'JSON null cannot satisfy authenticated voice-canary evidence'
);
select throws_ok(
  $command$
    select public.command_withdraw_look_version(
      (select id from public.look_versions where look_key = 'divine-fury'),
      1,
      '{"kind":null}',
      '9b000000-0000-4000-8000-000000000013',
      'phase2-look-null-evidence-0001',
      repeat('7', 64),
      '9c000000-0000-4000-8000-000000000013'
    )
  $command$,
  '22023',
  'withdrawal evidence is required',
  'JSON null cannot satisfy look-withdrawal evidence'
);
select throws_ok(
  $command$
    select public.command_set_voice_version_availability(
      (select id from public.voice_versions where gender = 'female'),
      1,
      'verified',
      jsonb_build_object(
        'kind','authenticated_canary','provider','elevenlabs','result','passed',
        'checkedAt','2026-07-17T00:00:00Z','artifactSha256',repeat('e', 64)
      ),
      '9b000000-0000-4000-8000-000000000001',
      'phase2-voice-availability-0001',
      repeat('b', 64),
      '9c000000-0000-4000-8000-000000000001'
    )
  $command$,
  '55000',
  'voice verification requires an authenticated provider receipt',
  'caller-authored canary metadata cannot verify a voice'
);
select is(
  (
    select count(*)
    from public.voice_version_availability
    where status = 'verified'
  ),
  0::bigint,
  'no voice availability row can be self-certified as verified'
);
reset role;
select is(
  (
    select count(*)
    from private.voice_version_availability_events
    where new_status = 'verified'
  ),
  0::bigint,
  'no self-certified verification event is persisted'
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $command$
    select public.command_withdraw_look_version(
      (select id from public.look_versions where look_key = 'divine-fury'),
      1,
      '{"kind":"curation_withdrawal","reason":"adversarial-test","actor":"phase2-pgtap"}',
      '9b000000-0000-4000-8000-000000000003',
      'phase2-look-availability-0001',
      repeat('d', 64),
      '9c000000-0000-4000-8000-000000000003'
    )
  $command$,
  'service authority can withdraw a look through the audited command'
);
select is(
  (
    public.command_withdraw_look_version(
      (select id from public.look_versions where look_key = 'divine-fury'),
      1,
      '{"kind":"curation_withdrawal","reason":"adversarial-test","actor":"phase2-pgtap"}',
      '9b000000-0000-4000-8000-000000000003',
      'phase2-look-availability-0001',
      repeat('d', 64),
      '9c000000-0000-4000-8000-000000000003'
    )->>'aggregateVersion'
  ),
  '2',
  'look withdrawal command replays the original receipt idempotently'
);
select lives_ok(
  $command$
    select public.command_withdraw_voice_version(
      (select id from public.voice_versions where gender = 'female'),
      1,
      '{"kind":"administrative_withdrawal","reason":"pre-canary retirement","actor":"phase2-pgtap"}',
      '9b000000-0000-4000-8000-000000000014',
      'phase2-voice-withdrawal-0001',
      repeat('8', 64),
      '9c000000-0000-4000-8000-000000000014'
    )
  $command$,
  'a pending female voice can be withdrawn through the explicit administrative path'
);
select ok(
  (
    select verified_at is null and withdrawn_at is not null
    from public.voice_version_availability
    where voice_version_id = (
      select id from public.voice_versions where gender = 'female'
    )
  ),
  'pending-to-withdrawn never fabricates a verification timestamp'
);
reset role;
update public.voice_version_availability
set status = 'verified',
    verified_at = statement_timestamp(),
    withdrawn_at = null,
    verification_expires_at = statement_timestamp() + interval '1 day'
where voice_version_id = (
  select id from public.voice_versions where gender = 'male'
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select lives_ok(
  $command$
    select public.command_withdraw_voice_version(
      (select id from public.voice_versions where gender = 'male'),
      1,
      '{"kind":"administrative_withdrawal","reason":"pre-canary retirement","actor":"phase2-pgtap"}',
      '9b000000-0000-4000-8000-000000000015',
      'phase2-voice-withdrawal-0002',
      repeat('9', 64),
      '9c000000-0000-4000-8000-000000000015'
    )
  $command$,
  'a verified voice can be withdrawn through the separate administrative path'
);
select ok(
  (
    select status = 'withdrawn'
      and verified_at is not null
      and withdrawn_at is not null
    from public.voice_version_availability
    where voice_version_id = (
      select id from public.voice_versions where gender = 'male'
    )
  ),
  'verified-to-withdrawn preserves the authenticated verification timestamp'
);

reset role;
insert into private.live_broker_request_nonces (
  nonce, signer_id, issued_at_ms, body_sha256, action, sandbox_name,
  candidate_commit, candidate_tree, broker_deployment_commit, created_at
) values (
  '97000000-0000-4000-8000-000000000099', 'genie-ci-ed25519-v1',
  (extract(epoch from clock_timestamp()) * 1000)::bigint, repeat('0', 64),
  'status', 'genie-live-999999999999999999999999', repeat('a', 40),
  repeat('b', 40), repeat('c', 40), statement_timestamp() - interval '11 minutes'
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select has_index(
  'private',
  'live_broker_request_nonces',
  'live_broker_request_nonces_signer_created_idx',
  'the bounded nonce ledger has a signer and time-window index'
);
select is(
  public.command_claim_live_broker_request(
    '97000000-0000-4000-8000-000000000001',
    'genie-ci-ed25519-v1',
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    repeat('d', 64),
    'start',
    'genie-live-111111111111111111111111',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'creating',
  'a signed start durably claims the sandbox lifecycle before creation'
);
reset role;
select is(
  (select count(*)::integer from private.live_broker_request_nonces
   where nonce = '97000000-0000-4000-8000-000000000099'),
  0,
  'a signed request prunes nonce rows older than the full replay window'
);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok(
  $$
    select public.command_claim_live_broker_request(
      '97000000-0000-4000-8000-000000000001',
      'genie-ci-ed25519-v1',
      (extract(epoch from clock_timestamp()) * 1000)::bigint,
      repeat('d', 64),
      'start',
      'genie-live-111111111111111111111111',
      repeat('a', 40),
      repeat('b', 40),
      repeat('c', 40)
    )
  $$,
  '23505',
  'live broker nonce replayed',
  'a broker nonce is consumed exactly once across process restarts'
);
select is(
  public.command_record_live_broker_created(
    'genie-live-111111111111111111111111', repeat('a', 40), repeat('b', 40),
    'session_12345678', repeat('c', 40)
  )->>'state',
  'running',
  'the pinned broker records the exact created sandbox session'
);
select is(
  public.command_claim_live_broker_request(
    '97000000-0000-4000-8000-000000000002',
    'genie-ci-ed25519-v1',
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    repeat('e', 64),
    'status',
    'genie-live-111111111111111111111111',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'running',
  'a status nonce can inspect only its deployment-bound lifecycle'
);
select is(
  public.command_record_live_broker_state(
    'genie-live-111111111111111111111111', repeat('a', 40), repeat('b', 40),
    'finished', repeat('c', 40)
  )->>'state',
  'finished',
  'the running lifecycle can finish under the same broker deployment'
);
select is(
  public.command_claim_live_broker_request(
    '97000000-0000-4000-8000-000000000003',
    'genie-ci-ed25519-v1',
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    repeat('f', 64),
    'stop',
    'genie-live-222222222222222222222222',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'cancel_requested',
  'stop-before-start creates a durable cancellation tombstone'
);
select is(
  public.command_claim_live_broker_request(
    '97000000-0000-4000-8000-000000000004',
    'genie-ci-ed25519-v1',
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    repeat('1', 64),
    'start',
    'genie-live-222222222222222222222222',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'cancel_requested',
  'a late creator observes rather than revives the cancellation tombstone'
);
select throws_ok(
  $$
    select public.command_record_live_broker_created(
      'genie-live-222222222222222222222222', repeat('a', 40), repeat('b', 40),
      'session_22345678', repeat('c', 40)
    )
  $$,
  '22023',
  'live broker lifecycle identity mismatch',
  'a cancelled lifecycle cannot be marked running by a late creator'
);
select throws_ok(
  $$
    select public.command_claim_live_broker_request(
      '97000000-0000-4000-8000-000000000005',
      'genie-ci-ed25519-v1',
      (extract(epoch from clock_timestamp()) * 1000)::bigint,
      repeat('2', 64),
      'status',
      'genie-live-111111111111111111111111',
      repeat('a', 40),
      repeat('b', 40),
      repeat('d', 40)
    )
  $$,
  '22023',
  'live broker lifecycle identity mismatch',
  'a different broker deployment cannot adopt an existing lifecycle'
);
select is(
  public.command_claim_live_broker_request(
    '97000000-0000-4000-8000-000000000006',
    'genie-ci-ed25519-v1',
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    repeat('3', 64),
    'start',
    'genie-live-333333333333333333333333',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'creating',
  'a creator receives a bounded durable lease'
);
select is(
  public.command_claim_live_broker_request(
    '97000000-0000-4000-8000-000000000007',
    'genie-ci-ed25519-v1',
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    repeat('4', 64),
    'stop',
    'genie-live-333333333333333333333333',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'creating',
  'stop durably marks cancellation while the creator lease remains live'
);
reset role;
update private.live_broker_lifecycles
set create_lease_expires_at = statement_timestamp() - interval '1 minute'
where sandbox_name = 'genie-live-333333333333333333333333';
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select is(
  public.command_reconcile_live_broker_cancellation(
    'genie-live-333333333333333333333333',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'cancel_requested',
  'an abandoned cancelled creator is reconciled after lease expiry'
);
select is(
  public.command_claim_live_broker_request(
    '97000000-0000-4000-8000-000000000008',
    'genie-ci-ed25519-v1',
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    repeat('5', 64),
    'start',
    'genie-live-444444444444444444444444',
    repeat('a', 40),
    repeat('b', 40),
    repeat('c', 40)
  )->>'state',
  'creating',
  'a second lifecycle can be created independently'
);
select is(
  public.command_record_live_broker_created(
    'genie-live-444444444444444444444444', repeat('a', 40), repeat('b', 40),
    'session_42345678', repeat('c', 40)
  )->>'state',
  'running',
  'the second lifecycle reaches running before deletion'
);
select is(
  public.command_record_live_broker_state(
    'genie-live-444444444444444444444444', repeat('a', 40), repeat('b', 40),
    'deleted', repeat('c', 40)
  )->>'state',
  'deleted',
  'deletion creates the terminal durable tombstone'
);
select throws_ok(
  $$
    select public.command_record_live_broker_state(
      'genie-live-444444444444444444444444', repeat('a', 40), repeat('b', 40),
      'failed', repeat('c', 40)
    )
  $$,
  '55000',
  'live broker deletion tombstone is terminal',
  'a deleted lifecycle cannot be revived as failed'
);

reset role;
select has_table(
  'private',
  'live_branch_cleanup_leases',
  'production control-plane state persists disposable branch cleanup leases'
);
select has_index(
  'private',
  'live_branch_cleanup_leases',
  'live_branch_cleanup_leases_reaper_idx',
  'cleanup claims have a production, state, expiry, and age index'
);
select ok(
  not has_table_privilege(
    'authenticated', 'private.live_branch_cleanup_leases', 'select'
  )
  and not has_table_privilege(
    'service_role', 'private.live_branch_cleanup_leases', 'select'
  )
  and not has_function_privilege(
    'service_role',
    'private.register_live_branch_cleanup_lease(uuid,text,text,text,text,text,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.claim_live_branch_cleanup_leases(text,uuid,integer)',
    'execute'
  ),
  'candidate and broker authorities cannot read or mutate branch cleanup leases'
);
select is(
  private.register_live_branch_cleanup_lease(
    '98000000-0000-4000-8000-000000000001',
    'genie-live-12345678-9ab',
    repeat('b', 20),
    repeat('p', 20),
    repeat('a', 40),
    repeat('b', 40),
    '98100000-0000-4000-8000-000000000001',
    '98200000-0000-4000-8000-000000000001'
  )->>'state',
  'registered',
  'exact candidate branch identity is durably registered before execution'
);
select is(
  private.register_live_branch_cleanup_lease(
    '98000000-0000-4000-8000-000000000001',
    'genie-live-12345678-9ab',
    repeat('b', 20),
    repeat('p', 20),
    repeat('a', 40),
    repeat('b', 40),
    '98100000-0000-4000-8000-000000000001',
    '98200000-0000-4000-8000-000000000001'
  )->>'leaseSource',
  'candidate',
  'registered cleanup provenance remains candidate-bound'
);
select is(
  private.register_live_branch_cleanup_lease(
    '98000000-0000-4000-8000-000000000001',
    'genie-live-12345678-9ab',
    repeat('b', 20),
    repeat('p', 20),
    repeat('a', 40),
    repeat('b', 40),
    '98100000-0000-4000-8000-000000000001',
    '98200000-0000-4000-8000-000000000001'
  )->>'cleanupLeaseId',
  '98100000-0000-4000-8000-000000000001',
  'exact cleanup registration is idempotent'
);
select is(
  private.register_live_branch_cleanup_lease(
    '98000000-0000-4000-8000-000000000010',
    'genie-live-bbbbbbbb-ccc',
    repeat('d', 20),
    repeat('p', 20),
    repeat('a', 40),
    repeat('b', 40),
    '98100000-0000-4000-8000-000000000010',
    '98200000-0000-4000-8000-000000000003'
  )->>'state',
  'registered',
  'a concurrent candidate receives its own unexpired coordinator lease'
);
select throws_ok(
  $$
    select private.register_live_branch_cleanup_lease(
      '98000000-0000-4000-8000-000000000002',
      'genie-live-12345678-9ab',
      repeat('c', 20),
      repeat('p', 20),
      repeat('a', 40),
      repeat('b', 40),
      '98100000-0000-4000-8000-000000000002',
      '98200000-0000-4000-8000-000000000001'
    )
  $$,
  '22023',
  'live branch cleanup lease identity mismatch',
  'a partial branch-name collision cannot replace exact cleanup identity'
);
select is(
  (
    select count(*)::integer
    from private.claim_live_branch_cleanup_leases(
      repeat('p', 20),
      '98200000-0000-4000-8000-000000000001',
      20
    )
  ),
  1,
  'the first trusted reaper atomically claims the registered cleanup lease'
);
select ok(
  (
    select state = 'reaping'
      and reaper_owner = '98200000-0000-4000-8000-000000000001'
      and reaper_lease_expires_at > statement_timestamp()
    from private.live_branch_cleanup_leases
    where branch_id = '98000000-0000-4000-8000-000000000001'
  ),
  'the cleanup claim records bounded exact ownership'
);
select is(
  (
    select count(*)::integer
    from private.claim_live_branch_cleanup_leases(
      repeat('p', 20),
      '98200000-0000-4000-8000-000000000002',
      20
    )
  ),
  0,
  'a concurrent reaper cannot steal an unexpired cleanup claim'
);
update private.live_branch_cleanup_leases
set coordinator_lease_expires_at = statement_timestamp() - interval '1 minute'
where branch_id = '98000000-0000-4000-8000-000000000010';
select is(
  (
    select count(*)::integer
    from private.claim_live_branch_cleanup_leases(
      repeat('p', 20),
      '98200000-0000-4000-8000-000000000002',
      20
    )
  ),
  1,
  'another trusted reaper can claim the candidate only after coordinator expiry'
);
select is(
  private.complete_live_branch_cleanup_lease(
    '98100000-0000-4000-8000-000000000010',
    '98000000-0000-4000-8000-000000000010',
    'genie-live-bbbbbbbb-ccc',
    repeat('d', 20),
    repeat('p', 20),
    '98200000-0000-4000-8000-000000000002',
    3,
    true
  )->>'state',
  'deleted',
  'the expired concurrent candidate can be tombstoned by its new exact owner'
);
select throws_ok(
  $$
    select private.complete_live_branch_cleanup_lease(
      '98100000-0000-4000-8000-000000000001',
      '98000000-0000-4000-8000-000000000001',
      'genie-live-12345678-9ab',
      repeat('b', 20),
      repeat('p', 20),
      '98200000-0000-4000-8000-000000000001',
      2,
      true
    )
  $$,
  '22023',
  'three absence snapshots are required',
  'cleanup cannot clear its lease after fewer than three absent snapshots'
);
select throws_ok(
  $$
    select private.complete_live_branch_cleanup_lease(
      '98100000-0000-4000-8000-000000000001',
      '98000000-0000-4000-8000-000000000001',
      'genie-live-12345678-9ab',
      repeat('b', 20),
      repeat('p', 20),
      '98200000-0000-4000-8000-000000000002',
      3,
      true
    )
  $$,
  '55000',
  'live branch cleanup lease owner mismatch',
  'a competing owner cannot complete another reaper claim'
);
select is(
  private.complete_live_branch_cleanup_lease(
    '98100000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    'genie-live-12345678-9ab',
    repeat('b', 20),
    repeat('p', 20),
    '98200000-0000-4000-8000-000000000001',
    3,
    true
  )->>'state',
  'deleted',
  'three confirmed absence snapshots create the durable deletion tombstone'
);
select is(
  private.complete_live_branch_cleanup_lease(
    '98100000-0000-4000-8000-000000000001',
    '98000000-0000-4000-8000-000000000001',
    'genie-live-12345678-9ab',
    repeat('b', 20),
    repeat('p', 20),
    '98200000-0000-4000-8000-000000000002',
    3,
    true
  )->>'confirmedAbsentSnapshots',
  '3',
  'cleanup completion is idempotent after the exact tombstone exists'
);
select is(
  private.adopt_orphan_live_branch_cleanup_lease(
    '98000000-0000-4000-8000-000000000003',
    'genie-live-aaaaaaaa-bbb',
    repeat('c', 20),
    repeat('p', 20),
    '98100000-0000-4000-8000-000000000003',
    '98200000-0000-4000-8000-000000000001'
  )->>'leaseSource',
  'orphan_discovery',
  'a stale unleased branch receives explicit orphan provenance before deletion'
);
select is(
  private.adopt_orphan_live_branch_cleanup_lease(
    '98000000-0000-4000-8000-000000000003',
    'genie-live-aaaaaaaa-bbb',
    repeat('c', 20),
    repeat('p', 20),
    '98100000-0000-4000-8000-000000000004',
    '98200000-0000-4000-8000-000000000002'
  )->>'reaperOwner',
  '98200000-0000-4000-8000-000000000001',
  'a concurrent orphan adopter cannot steal an unexpired claim'
);
select throws_ok(
  $$
    select private.release_live_branch_cleanup_lease(
      '98100000-0000-4000-8000-000000000003',
      '98200000-0000-4000-8000-000000000002'
    )
  $$,
  '55000',
  'live branch cleanup lease owner mismatch',
  'only the exact orphan claim owner can release after cleanup failure'
);
select is(
  private.release_live_branch_cleanup_lease(
    '98100000-0000-4000-8000-000000000003',
    '98200000-0000-4000-8000-000000000001'
  )->>'state',
  'registered',
  'a failed trusted cleanup returns the orphan lease to reconciliation'
);
select is(
  (
    select count(*)::integer
    from private.claim_live_branch_cleanup_leases(
      repeat('p', 20),
      '98200000-0000-4000-8000-000000000002',
      20
    )
  ),
  1,
  'a later trusted reaper can claim a safely released orphan lease'
);

select has_column(
  'public',
  'script_revisions',
  'original_source_bytes',
  'uploaded scripts preserve their exact original source bytes'
);
select has_column(
  'public',
  'script_revisions',
  'original_source_sha256',
  'uploaded scripts bind the original bytes to an immutable digest'
);
select has_trigger(
  'public',
  'script_revisions',
  'script_revisions_uploaded_source',
  'uploaded source binding occurs inside the script-lock transaction'
);
select is(
  private.decode_uploaded_script_source_v1(
    decode('efbbbf616263', 'hex'),
    jsonb_build_object(
      'bom', 'utf-8',
      'byteLength', 6,
      'decoderProfile', 'genie-uploaded-script-decoder.v1',
      'encoding', 'utf-8',
      'originalSha256',
      encode(extensions.digest(decode('efbbbf616263', 'hex'), 'sha256'), 'hex')
    )
  ),
  'abc',
  'UTF-8 upload decoding removes only the source BOM'
);
select is(
  private.decode_uploaded_script_source_v1(
    decode('fffe610062006300', 'hex'),
    jsonb_build_object(
      'bom', 'utf-16le',
      'byteLength', 8,
      'decoderProfile', 'genie-uploaded-script-decoder.v1',
      'encoding', 'utf-16le',
      'originalSha256',
      encode(
        extensions.digest(decode('fffe610062006300', 'hex'), 'sha256'),
        'hex'
      )
    )
  ),
  'abc',
  'UTF-16 upload decoding is deterministic and byte preserving'
);
select throws_ok(
  $command$
    select private.decode_uploaded_script_source_v1(
      decode('fffe61', 'hex'),
      jsonb_build_object(
        'bom', 'utf-16le',
        'byteLength', 3,
        'decoderProfile', 'genie-uploaded-script-decoder.v1',
        'encoding', 'utf-16le',
        'originalSha256',
        encode(extensions.digest(decode('fffe61', 'hex'), 'sha256'), 'hex')
      )
    )
  $command$,
  '22023',
  'uploaded script source bytes rejected',
  'malformed UTF-16 source bytes fail closed'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.command_lock_episode_script_v2(uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,uuid,uuid,text,text,uuid,public.script_source_kind,bytea,text,jsonb)',
    'execute'
  ),
  'anonymous callers cannot lock uploaded scripts'
);

set local session_replication_role = replica;
update public.voice_version_availability
set status = 'pending_authenticated_canary',
    verified_at = null,
    withdrawn_at = null,
    verification_expires_at = null
where voice_version_id = (select id from public.voice_versions where gender = 'male');
set local session_replication_role = origin;

select set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select public.attest_script_coordinate_map(
  '9a000000-0000-4000-8000-000000000010',
  '91100000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000004',
  '92000000-0000-4000-8000-000000000001',
  repeat('b', 64),
  encode(extensions.digest(convert_to('abc', 'UTF8'), 'sha256'), 'hex'),
  encode(extensions.digest(convert_to('abc', 'UTF8'), 'sha256'), 'hex'),
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3],[0,1,2,3],[1,2,3]],"p":[[0,1,2,3],[0,1,2,3],[1,2,3]],"s":[[0,0,3,0,3]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}'
);
reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"92000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"96000000-0000-4000-8000-000000000004","email":"phase2.one@zyra.test"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  '92000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select lives_ok(
  $command$
    select public.command_lock_episode_script_v2(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000004',
      1,
      'abc',
      convert_to('abc', 'UTF8'),
      encode(extensions.digest(convert_to('abc', 'UTF8'), 'sha256'), 'hex'),
      'abc',
      encode(extensions.digest(convert_to('abc', 'UTF8'), 'sha256'), 'hex'),
      'genie-script-processing.v1',
      '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3],[0,1,2,3],[1,2,3]],"p":[[0,1,2,3],[0,1,2,3],[1,2,3]],"s":[[0,0,3,0,3]]}',
      '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
      3,
      3,
      3,
      3,
      3,
      3,
      true,
      '9a000000-0000-4000-8000-000000000010',
      '97000000-0000-4000-8000-000000000010',
      'phase2-uploaded-script-lock-0001',
      repeat('b', 64),
      '98000000-0000-4000-8000-000000000010',
      'uploaded_text',
      decode('fffe610062006300', 'hex'),
      encode(
        extensions.digest(decode('fffe610062006300', 'hex'), 'sha256'),
        'hex'
      ),
      jsonb_build_object(
        'bom', 'utf-16le',
        'byteLength', 8,
        'decoderProfile', 'genie-uploaded-script-decoder.v1',
        'encoding', 'utf-16le',
        'originalSha256',
        encode(
          extensions.digest(decode('fffe610062006300', 'hex'), 'sha256'),
          'hex'
        )
      )
    )
  $command$,
  'uploaded script source bytes seal through the atomic script command'
);
select ok(
  (
    select source_kind = 'uploaded_text'
      and raw_text = 'abc'
      and original_source_bytes = decode('fffe610062006300', 'hex')
      and original_source_sha256 =
        encode(
          extensions.digest(decode('fffe610062006300', 'hex'), 'sha256'),
          'hex'
        )
      and source_encoding_evidence ->> 'encoding' = 'utf-16le'
    from public.script_revisions
    where episode_id = '94000000-0000-4000-8000-000000000004'
  ),
  'the sealed uploaded revision retains exact bytes, digest, decoding evidence, and text'
);
reset role;

-- Script-rubric suggestions are durable advice, never source authority.
create temporary table script_rubric_fixture on commit drop as
select
  jsonb_build_object(
    'continuationExpected',true,'episodePosition','first',
    'hasRevealOrDecisiveTurn',true,'market','hi-IN','mode','script_only',
    'platformModel','other','priorEpisodesAvailable',true,
    'seriesContext','pinned'
  ) as context_json,
  jsonb_build_array(
    jsonb_build_object(
      'evaluatorConfigurationId','script-rubric-config-1',
      'evaluatorRunId','9d000000-0000-4000-8000-000000000001',
      'modelFamily','independent-family-1','promptSha256',repeat('1',64),
      'promptVersion','script-rubric-prompt-v1'
    ),
    jsonb_build_object(
      'evaluatorConfigurationId','script-rubric-config-2',
      'evaluatorRunId','9d000000-0000-4000-8000-000000000002',
      'modelFamily','independent-family-2','promptSha256',repeat('2',64),
      'promptVersion','script-rubric-prompt-v2'
    )
  ) as evaluator_runs,
  (
    select jsonb_agg(
      jsonb_build_object(
        'applicability','applicable',
        'consensusScore',case when parameter_id='opening_hook' then 3 else 8 end,
        'evidence',case when parameter_id='opening_hook' then
          jsonb_build_array(
            jsonb_build_object(
              'rationale','The opening image is not yet explicit.',
              'scriptEndUtf16',1,'scriptStartUtf16',0
            ),
            jsonb_build_object(
              'rationale','The opening beat lacks a status change.',
              'scriptEndUtf16',2,'scriptStartUtf16',1
            )
          )
        else jsonb_build_array(
          jsonb_build_object(
            'rationale','Observable evidence is present in the locked text.',
            'scriptEndUtf16',1,'scriptStartUtf16',0
          )
        ) end,
        'notApplicableReason',null,'parameterId',parameter_id,'spread',0
      ) order by ordinal
    )
    from unnest(array[
      'opening_hook','protagonist_clarity','conflict_stakes','structure_pacing',
      'twist_reveal','cliffhanger_pull','dialogue_economy',
      'relationship_legibility','series_continuity','genre_freshness',
      'localization_fit','monetization_compliance'
    ]) with ordinality as parameter(parameter_id,ordinal)
  ) as parameter_results,
  jsonb_build_object(
    'commercialPull','76.875','commercialPullDisplay','76.9',
    'commercialPullProjectedDenominator','1','craftQuality','74.5',
    'craftQualityDisplay','74.5','craftQualityProjectedDenominator','100',
    'overall','65.8625','overallDisplay','65.9','risk','20',
    'riskDisplay','20.0'
  ) as composites,
  jsonb_build_array(jsonb_build_object(
    'effect','advisory','gateId','first_episode_hook',
    'sourceEffect','cap-verdict'
  )) as gates,
  '[]'::jsonb as priority_items,
  jsonb_build_object(
    'displayLabel','Rework','internalLabel','rewrite_heavily'
  ) as verdict;
grant select on script_rubric_fixture to service_role;

select has_table(
  'public','script_rubric_runs',
  'completed script-rubric advice has a durable public projection'
);
select has_column(
  'public','preflight_runs','script_rubric_run_id',
  'plan evaluation can pin the exact completed script-rubric run'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.command_record_script_rubric_run(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb,jsonb,boolean)',
    'execute'
  ) and has_function_privilege(
    'service_role',
    'public.command_record_script_rubric_run(uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb,jsonb,boolean)',
    'execute'
  ),
  'only service authority can persist deterministic script-rubric advice'
);
select throws_ok(
  $command$
    select private.validate_script_rubric_payload_v1(
      (select evaluator_runs from script_rubric_fixture),
      (select parameter_results from script_rubric_fixture),
      (select composites from script_rubric_fixture),
      '[{"effect":"hard_block_stage"}]'::jsonb,
      '[]'::jsonb,
      (select verdict from script_rubric_fixture)
    )
  $command$,
  '22023','script rubric deterministic result is invalid',
  'a script-rubric gate cannot be promoted into production authority'
);

reset role;
update public.episode_configuration_candidates
set voice_confirmed_by='92000000-0000-4000-8000-000000000001',
    voice_confirmed_at=statement_timestamp(),
    look_confirmed_by='92000000-0000-4000-8000-000000000001',
    look_confirmed_at=statement_timestamp()
where episode_id='94000000-0000-4000-8000-000000000004';

select has_table(
  'private',
  'script_rubric_legacy_waivers',
  'the legacy script-rubric exception is an explicit private relation'
);
select ok(
  not has_table_privilege(
    'authenticated',
    'private.script_rubric_legacy_waivers',
    'select'
  ) and not has_table_privilege(
    'service_role',
    'private.script_rubric_legacy_waivers',
    'select'
  ),
  'application roles cannot read or extend the legacy waiver allowlist'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select throws_ok(
  $command$
    select public.command_create_preflight_run(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000004',
      (select id from public.episode_configuration_candidates
       where episode_id='94000000-0000-4000-8000-000000000004'
       order by created_at desc limit 1),
      (select id from public.script_revisions
       where episode_id='94000000-0000-4000-8000-000000000004'),
      'plan_evaluation',false,null,null,null,
      '9e000000-0000-4000-8000-000000000001',
      'rubric-plan-unwaived-0001',repeat('b',64)
    )
  $command$,
  '55000',
  'completed advisory script rubric is required before planning',
  'a new unwaived configuration cannot plan without script-rubric evidence'
);

reset role;
insert into private.script_rubric_legacy_waivers (
  workspace_id,
  episode_id,
  configuration_candidate_id,
  script_revision_id,
  waiver_reason
)
select
  configuration.workspace_id,
  configuration.episode_id,
  configuration.id,
  configuration.script_revision_id,
  'captured-existing-world-lock-before-required-rubric.v1'
from public.episode_configuration_candidates configuration
where configuration.episode_id = '94000000-0000-4000-8000-000000000004';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok(
  $command$
    select public.command_create_preflight_run(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000004',
      (select id from public.episode_configuration_candidates
       where episode_id='94000000-0000-4000-8000-000000000004'
       order by created_at desc limit 1),
      (select id from public.script_revisions
       where episode_id='94000000-0000-4000-8000-000000000004'),
      'plan_evaluation',false,null,null,null,
      '9e000000-0000-4000-8000-000000000001',
      'rubric-plan-missing-0001',repeat('c',64)
    )
  $command$,
  'only a migration-captured legacy configuration can resume without rubric evidence'
);
select is(
  (
    select script_rubric_run_id
    from public.preflight_runs
    where workspace_id = '91100000-0000-4000-8000-000000000001'
      and episode_id = '94000000-0000-4000-8000-000000000004'
      and configuration_candidate_id = (
        select id from public.episode_configuration_candidates
        where episode_id = '94000000-0000-4000-8000-000000000004'
        order by created_at desc limit 1
      )
      and kind = 'plan_evaluation'
    order by run_number desc
    limit 1
  ),
  null::uuid,
  'the scoped legacy waiver is represented honestly rather than fabricated'
);
select public.command_transition_preflight_run(
  (
    select id
    from public.preflight_runs
    where workspace_id='91100000-0000-4000-8000-000000000001'
      and episode_id='94000000-0000-4000-8000-000000000004'
      and kind='plan_evaluation'
      and script_rubric_run_id is null
    order by run_number desc
    limit 1
  ),
  (
    select aggregate_version
    from public.preflight_runs
    where workspace_id='91100000-0000-4000-8000-000000000001'
      and episode_id='94000000-0000-4000-8000-000000000004'
      and kind='plan_evaluation'
      and script_rubric_run_id is null
    order by run_number desc
    limit 1
  ),
  'fail',null
);
select lives_ok(
  $command$
    select public.command_record_script_rubric_run(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000004',
      (select id from public.script_revisions
       where episode_id='94000000-0000-4000-8000-000000000004'),
      '9e000000-0000-4000-8000-000000000002',
      (select raw_utf8_sha256 from public.script_revisions
       where episode_id='94000000-0000-4000-8000-000000000004'),
      (select context_json from script_rubric_fixture),
      (select evaluator_runs from script_rubric_fixture),
      (select parameter_results from script_rubric_fixture),
      (select composites from script_rubric_fixture),100,
      (select gates from script_rubric_fixture),
      (select priority_items from script_rubric_fixture),
      (select verdict from script_rubric_fixture),true
    )
  $command$,
  'a weak script-rubric result persists as deterministic advisory evidence'
);
select ok(
  (
    select advisory_only and script_sha256_before=script_sha256_after
      and source_rubric_sha256=
        '714fef20f2151ee63bce3307267f531485f3f3c29215bb8a5fa552ee9dd165b4'
      and gates @> '[{"effect":"advisory","gateId":"first_episode_hook"}]'::jsonb
      and verdict ->> 'internalLabel'='rewrite_heavily'
      and result_hash ~ '^[a-f0-9]{64}$'
    from public.script_rubric_runs
    where script_revision_id=(
      select id from public.script_revisions
      where episode_id='94000000-0000-4000-8000-000000000004'
    )
  ),
  'rewrite advice retains exact config, source, gate, verdict, and result bindings'
);
select ok(
  (
    select raw_text='abc' and raw_utf8_sha256=encode(
      extensions.digest(convert_to('abc','UTF8'),'sha256'),'hex'
    )
    from public.script_revisions
    where episode_id='94000000-0000-4000-8000-000000000004'
  ),
  'script-rubric rewrite advice leaves the immutable user source unchanged'
);
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok(
  $command$
    select public.command_create_preflight_run(
      '91100000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000004',
      (select id from public.episode_configuration_candidates
       where episode_id='94000000-0000-4000-8000-000000000004'
       order by created_at desc limit 1),
      (select id from public.script_revisions
       where episode_id='94000000-0000-4000-8000-000000000004'),
      'plan_evaluation',false,null,null,null,
      '9e000000-0000-4000-8000-000000000003',
      'rubric-plan-ready-0001',repeat('d',64)
    )
  $command$,
  'planning can begin after the advisory diagnostic is complete'
);
select ok(
  (
    select p.script_rubric_run_id=r.id
    from public.preflight_runs p
    join public.script_rubric_runs r
      on r.script_revision_id=p.script_revision_id
    where p.episode_id='94000000-0000-4000-8000-000000000004'
      and p.kind='plan_evaluation'
      and p.script_rubric_run_id is not null
  ),
  'the plan run pins the exact script-rubric evidence it consumed'
);
reset role;
select throws_ok(
  $command$
    update public.script_rubric_runs set advisory_only=false
    where script_revision_id=(
      select id from public.script_revisions
      where episode_id='94000000-0000-4000-8000-000000000004'
    )
  $command$,
  '55000','immutable record cannot be updated or deleted',
  'even the table owner cannot turn advisory script evidence into a blocker'
);
select * from finish();
rollback;

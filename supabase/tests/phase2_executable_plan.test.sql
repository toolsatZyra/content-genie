begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth,storage,private,audit,pg_catalog;
select plan(74);
grant usage on schema private to service_role;
grant select on all tables in schema private to service_role;

insert into public.organizations(id,name,slug) values
  ('c1000000-0000-4000-8000-000000000001','Genie Plan Test','genie-plan-test');
insert into public.workspaces(id,organization_id,name,slug) values
  ('c1100000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001','Genie Plan Preview','genie-plan-preview');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

select ok(
  not has_function_privilege(
    'authenticated',
    'public.command_ensure_video_production_profile(uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz)',
    'execute'
  ) and has_function_privilege(
    'service_role',
    'public.command_ensure_video_production_profile(uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz)',
    'execute'
  ),
  'authenticated video profiles can only be materialized by the service boundary'
);

select is(
  (
    select regexp_replace(setting,'^statement_timeout=','')
    from unnest(
      coalesce(
        (
          select proconfig
          from pg_proc
          where oid='public.command_record_preflight_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb)'::regprocedure
        ),
        array[]::text[]
      )
    ) setting
    where setting like 'statement_timeout=%'
  ),
  '30s',
  'the bounded plan ledger has a function-local API timeout exemption'
);

select lives_ok($sql$
  select public.command_ensure_video_production_profile(
    'c1100000-0000-4000-8000-000000000001','preview',
    'kling-2.5-simple-camera-subject',
    '89719e9bbf2864ef733e61182f87c3884ad4fcce269cd3fb304aa37ea9207ae2',
    '979783417dfb1e319ffbf84bdafb878ec32f305aa70b7d926fcb728d0dd00f52',
    '28e7f619a30bd4c4f16e4ba48e9208896beb80caa7db23d4a62a09dd99b436f4',
    'd23838b52b03f64e40f3b67850a4df5dc53664003dc6e25c8d8c8f23db9a38db',
    '0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084',
    '20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d',
    '2026-07-19T13:06:06.255Z','2026-10-17T13:06:06.255Z'
  )
$sql$,'the authenticated vertical Kling 2.5 profile materializes');

select lives_ok($sql$
  select public.command_ensure_video_production_profile(
    'c1100000-0000-4000-8000-000000000001','preview','kling-3-camera-led',
    'e48bb88661f8eebe3d40904f4be71659e823006fcbf9a0789a8cd9d39a9de7e8',
    '19bada0f4b6bed681b54f490d73cc69618e646ee1c6a96ca95d2a0b26a59489a',
    '9e667248a8dd4a0dc98939fbf6c5b700cbd24e9b3a1dce9c2e085e3bf42743fb',
    '09c0c10d2573dc3fca20644cd2d4700edbe97da111f339fb574bb10e79db636e',
    '0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084',
    '20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d',
    '2026-07-19T13:06:06.255Z','2026-10-17T13:06:06.255Z'
  )
$sql$,'the authenticated vertical Kling 3 profile materializes');

select lives_ok($sql$
  select public.command_ensure_video_production_profile(
    'c1100000-0000-4000-8000-000000000001','preview','seedance-2-complex-general',
    '3700d3b348f00102d600d252d3980cdb835a2e8b39a0240976e4e841246fcac1',
    'f49614fd15f016e958008ef2b6878f56295366983d1362b3747ce379d1abaabb',
    'a2418f1901a1562ffe15e9b99f9390c7e5df802cf3031d7294ad8190e963fcfc',
    'ae939ee262141ef8d3862203297518bbf75c305216bb1c50baf99dc962d4521e',
    '0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084',
    '20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d',
    '2026-07-19T13:06:06.255Z','2026-10-17T13:06:06.255Z'
  )
$sql$,'the authenticated vertical Seedance profile materializes');

select is(
  (select count(*) from private.production_provider_capability_versions capability
   join private.provider_accounts account on account.id=capability.provider_account_id
   where account.workspace_id='c1100000-0000-4000-8000-000000000001'),
  3::bigint,'the workspace receives exactly three qualified production capabilities'
);
select is(
  (select count(distinct capability.motion_class) from private.production_provider_capability_versions capability
   join private.provider_accounts account on account.id=capability.provider_account_id
   where account.workspace_id='c1100000-0000-4000-8000-000000000001'),
  3::bigint,'the preferred profiles cover all three exact motion classes'
);
select is(
  (select jsonb_agg(jsonb_build_array(
    capability.motion_class,capability.duration_min_ms,capability.duration_max_ms,
    capability.duration_quantum_ms,capability.maximum_reference_count,
    capability.maximum_width,capability.maximum_height
  ) order by capability.motion_class)
   from private.production_provider_capability_versions capability
   join private.provider_accounts account on account.id=capability.provider_account_id
   where account.workspace_id='c1100000-0000-4000-8000-000000000001'),
  '[
    ["camera_led",3000,15000,1000,1,1080,1920],
    ["complex_general",4000,15000,1000,9,720,1280],
    ["simple_camera_subject",5000,10000,5000,1,1080,1920]
  ]'::jsonb,
  'durations, quanta, references, and verified vertical resolutions are exact'
);
select is(
  (select jsonb_agg(jsonb_build_array(rate.rate_key,rate.unit_price_microusd)
     order by rate.rate_key)
   from private.production_rate_card_versions rate
   join private.production_provider_capability_versions capability
     on capability.id=rate.capability_version_id
   join private.provider_accounts account on account.id=capability.provider_account_id
   where account.workspace_id='c1100000-0000-4000-8000-000000000001'),
  '[["video.kling25.simple",350000],["video.kling3.camera",112000],["video.seedance2.complex",303400]]'::jsonb,
  'each preferred profile has its authenticated microusd billing quantum'
);

select lives_ok($sql$
  select public.command_ensure_video_production_profile(
    'c1100000-0000-4000-8000-000000000001','preview',
    'kling-2.5-simple-camera-subject',
    '89719e9bbf2864ef733e61182f87c3884ad4fcce269cd3fb304aa37ea9207ae2',
    '979783417dfb1e319ffbf84bdafb878ec32f305aa70b7d926fcb728d0dd00f52',
    '28e7f619a30bd4c4f16e4ba48e9208896beb80caa7db23d4a62a09dd99b436f4',
    'd23838b52b03f64e40f3b67850a4df5dc53664003dc6e25c8d8c8f23db9a38db',
    '0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084',
    '20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d',
    '2026-07-19T13:06:06.255Z','2026-10-17T13:06:06.255Z'
  )
$sql$,'reconciliation of an identical profile is retry-safe');
select is(
  (select count(*) from private.production_provider_capability_versions capability
   join private.provider_accounts account on account.id=capability.provider_account_id
   where account.workspace_id='c1100000-0000-4000-8000-000000000001'),
  3::bigint,'profile replay does not mint duplicate capability authority'
);
select throws_ok($sql$
  select public.command_ensure_video_production_profile(
    'c1100000-0000-4000-8000-000000000001','preview',
    'kling-2.5-simple-camera-subject',
    '89719e9bbf2864ef733e61182f87c3884ad4fcce269cd3fb304aa37ea9207ae2',
    '979783417dfb1e319ffbf84bdafb878ec32f305aa70b7d926fcb728d0dd00f52',
    repeat('0',64),
    'd23838b52b03f64e40f3b67850a4df5dc53664003dc6e25c8d8c8f23db9a38db',
    '0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084',
    '20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d',
    '2026-07-19T13:06:06.255Z','2026-10-17T13:06:06.255Z'
  )
$sql$,'40001','video production evidence differs from the qualified profile',
  'tampered canary evidence cannot qualify a production profile');

select has_column('public','preflight_provider_request_slots','retained_duration_ms',
  'request slots preserve their exact retained master-clock duration');
select has_column('public','preflight_provider_request_slots','input_strategy',
  'request slots distinguish composed frames from direct provider references');
select ok(
  position('mod((slot->>''durationMs'')::integer,capability.duration_quantum_ms)<>0'
    in pg_get_functiondef('public.command_record_preflight_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb)'::regprocedure))>0,
  'the plan command rejects durations that do not obey provider quanta'
);
select ok(
  position('input_strategy=''composited_start_frame'''
    in pg_get_functiondef('public.command_record_preflight_plan(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric,numeric,jsonb,jsonb)'::regprocedure))>0,
  'the plan command validates composed versus direct reference expansion'
);

reset role;
set local session_replication_role=replica;

insert into auth.users(
  id,email,email_confirmed_at,created_at,updated_at,aud,role
) values(
  'c3000000-0000-4000-8000-000000000002','plan.negative@zyra.test',
  statement_timestamp(),statement_timestamp(),statement_timestamp(),
  'authenticated','authenticated'
);
insert into public.profiles(user_id,display_name) values(
  'c3000000-0000-4000-8000-000000000002','Plan Negative Owner'
);
insert into public.memberships(
  workspace_id,user_id,role,status,authority_epoch,activated_at
) values(
  'c1100000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000002','admin','active',1,
  statement_timestamp()
);
insert into private.workspace_authority_profiles(
  id,workspace_id,profile_kind,owner_user_id,profile_epoch,activated_at
) values(
  'c3010000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001','single_owner_developer',
  'c3000000-0000-4000-8000-000000000002',1,statement_timestamp()
);

insert into public.series(id,workspace_id,slug,title,owner_user_id,created_by) values(
  'c3000000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'plan-negative-series','Plan Negative Series','c3000000-0000-4000-8000-000000000002',
  'c3000000-0000-4000-8000-000000000002'
);
insert into public.episodes(
  id,workspace_id,series_id,episode_number,title,owner_user_id,created_by
) values(
  'c3100000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001',1,'Plan Negative Episode',
  'c3000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000002'
);
insert into public.script_revisions(
  id,workspace_id,episode_id,revision_number,source_kind,raw_text,raw_utf8,
  raw_utf8_sha256,processing_text,processing_utf8_sha256,processing_profile,
  coordinate_map,runtime_evidence,raw_utf16_code_units,raw_scalar_count,
  raw_grapheme_count,processing_utf16_code_units,processing_scalar_count,
  processing_grapheme_count,estimated_duration_seconds,duration_out_of_band,
  duration_acknowledged,created_by
) values(
  'c3110000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3100000-0000-4000-8000-000000000001',1,'browser_text','abcdef',
  convert_to('abcdef','UTF8'),
  encode(extensions.digest(convert_to('abcdef','UTF8'),'sha256'),'hex'),'abcdef',
  encode(extensions.digest(convert_to('abcdef','UTF8'),'sha256'),'hex'),
  'genie-script-processing.v1',
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5,6],[0,1,2,3,4,5,6],[1,2,3,4,5,6]],"p":[[0,1,2,3,4,5,6],[0,1,2,3,4,5,6],[1,2,3,4,5,6]],"s":[[0,0,6,0,6]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
  6,6,6,6,6,6,60,false,false,'c3000000-0000-4000-8000-000000000002'
);
insert into public.episode_configuration_candidates(
  id,workspace_id,episode_id,candidate_number,script_revision_id,narrator_gender,
  voice_version_id,look_version_id,voice_confirmed_by,voice_confirmed_at,
  look_confirmed_by,look_confirmed_at,state,selected_by
) values(
  'c3120000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3100000-0000-4000-8000-000000000001',1,
  'c3110000-0000-4000-8000-000000000001','male',
  (select id from public.voice_versions where gender='male' order by registry_version limit 1),
  (select id from public.look_versions where look_key='glowing-divine-realism'),
  'c3000000-0000-4000-8000-000000000002',statement_timestamp(),
  'c3000000-0000-4000-8000-000000000002',statement_timestamp(),'preflight',
  'c3000000-0000-4000-8000-000000000002'
);

insert into public.assets(id,workspace_id,asset_kind) values
  ('c3130000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001','character_anchor'),
  ('c3130000-0000-4000-8000-000000000002','c1100000-0000-4000-8000-000000000001','location_anchor'),
  ('c3130000-0000-4000-8000-000000000003','c1100000-0000-4000-8000-000000000001','narration');
insert into public.asset_versions(
  id,workspace_id,asset_id,version_number,source_quarantine_version_id,bucket_id,
  object_name,storage_version,content_sha256,media_mime,byte_length,policy_version_id,
  provenance_hash
)
select version_id,'c1100000-0000-4000-8000-000000000001',asset_id,1,quarantine_id,
  'workspace-media',
  'c1100000-0000-4000-8000-000000000001/'||kind||'/'||asset_id::text||'/'||version_id::text||'/source',
  'v1',repeat(hash_char,64),mime,1000,
  (select id from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
  repeat(provenance_char,64)
from (values
  ('c3140000-0000-4000-8000-000000000001'::uuid,'c3130000-0000-4000-8000-000000000001'::uuid,'c3150000-0000-4000-8000-000000000001'::uuid,'character_anchor','a','image/png','1'),
  ('c3140000-0000-4000-8000-000000000002'::uuid,'c3130000-0000-4000-8000-000000000002'::uuid,'c3150000-0000-4000-8000-000000000002'::uuid,'location_anchor','b','image/png','2'),
  ('c3140000-0000-4000-8000-000000000003'::uuid,'c3130000-0000-4000-8000-000000000003'::uuid,'c3150000-0000-4000-8000-000000000003'::uuid,'narration','c','audio/mpeg','3')
) media(version_id,asset_id,quarantine_id,kind,hash_char,mime,provenance_char);

insert into public.character_versions(
  id,workspace_id,character_id,character_form_id,configuration_candidate_id,
  script_revision_id,look_version_id,version_number,source_kind,prompt_text,
  prompt_sha256,negative_prompt_text,anchor_asset_version_id,identity_manifest,
  identity_manifest_hash
) values(
  'c3160000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3160000-0000-4000-8000-000000000002','c3160000-0000-4000-8000-000000000003',
  'c3120000-0000-4000-8000-000000000001','c3110000-0000-4000-8000-000000000001',
  (select id from public.look_versions where look_key='glowing-divine-realism'),1,'generated',
  'locked character',repeat('1',64),'','c3140000-0000-4000-8000-000000000001',
  '{"fixture":"character"}',repeat('2',64)
);
insert into public.character_selections(
  id,workspace_id,configuration_candidate_id,character_form_id,candidate_version_id,
  selected_version_id,state,accepted_by,accepted_at
) values(
  'c3170000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3160000-0000-4000-8000-000000000003',
  'c3160000-0000-4000-8000-000000000001','c3160000-0000-4000-8000-000000000001',
  'accepted','c3000000-0000-4000-8000-000000000002',statement_timestamp()
);
insert into public.location_versions(
  id,workspace_id,location_id,configuration_candidate_id,script_revision_id,
  look_version_id,version_number,source_kind,prompt_text,prompt_sha256,
  negative_prompt_text,empty_anchor_asset_version_id,location_manifest,
  location_manifest_hash,temple_evidence_set_hash
) values(
  'c3180000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3180000-0000-4000-8000-000000000002','c3120000-0000-4000-8000-000000000001',
  'c3110000-0000-4000-8000-000000000001',
  (select id from public.look_versions where look_key='glowing-divine-realism'),1,'generated',
  'locked location',repeat('3',64),'','c3140000-0000-4000-8000-000000000002',
  '{"fixture":"location"}',repeat('4',64),null
);
insert into public.location_selections(
  id,workspace_id,configuration_candidate_id,location_id,candidate_version_id,
  selected_version_id,state,accepted_by,accepted_at
) values(
  'c3190000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3180000-0000-4000-8000-000000000002',
  'c3180000-0000-4000-8000-000000000001','c3180000-0000-4000-8000-000000000001',
  'accepted','c3000000-0000-4000-8000-000000000002',statement_timestamp()
);
insert into public.world_reference_pack_versions(
  id,workspace_id,configuration_candidate_id,version_number,selection_set_hash,
  manifest,manifest_hash,qc_evidence_hash,state
) values(
  'c3200000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001',1,repeat('5',64),
  '{"fixture":"world"}',repeat('6',64),repeat('7',64),'verified'
);
insert into public.source_review_packets(
  id,workspace_id,series_id,configuration_candidate_id,script_revision_id,
  policy_version_id,packet_version,subject_hash,source_set_hash,evidence_set_hash,
  tradition,region,language,content_classes,interpretation_labels,machine_verdict,
  machine_evidence_hash
) values(
  'c3210000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3000000-0000-4000-8000-000000000001','c3120000-0000-4000-8000-000000000001',
  'c3110000-0000-4000-8000-000000000001',
  (select id from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
  1,repeat('8',64),repeat('9',64),repeat('a',64),'shaiva','north-india','Hindi',
  array['narrative'],array['devotional'],'eligible',repeat('b',64)
);
insert into public.source_review_statuses(
  source_review_packet_id,workspace_id,status
) values(
  'c3210000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001','approved'
);
insert into public.source_review_packet_world_bindings(
  source_review_packet_id,workspace_id,configuration_candidate_id,
  world_reference_pack_version_id,world_extraction_result_id,script_sha256,
  extraction_hash,world_reference_pack_hash,cultural_policy_hash,subject_hash
) values(
  'c3210000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3200000-0000-4000-8000-000000000001',
  'c3210000-0000-4000-8000-000000000002',
  encode(extensions.digest(convert_to('abcdef','UTF8'),'sha256'),'hex'),repeat('c',64),
  repeat('6',64),
  (select manifest_hash from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
  repeat('8',64)
);
insert into public.preflight_runs(
  id,workspace_id,episode_id,configuration_candidate_id,script_revision_id,kind,
  run_number,authority_epoch,state,requires_micro_authority,trigger_run_id,started_at
) values(
  'c3300000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3100000-0000-4000-8000-000000000001','c3120000-0000-4000-8000-000000000001',
  'c3110000-0000-4000-8000-000000000001','plan_evaluation',1,1,'running',false,
  'plan_negative_fixture',statement_timestamp()
);
insert into public.preflight_stage_runs(
  id,workspace_id,preflight_run_id,stage_key,queue_key,state,next_attempt_no,
  highest_fencing_token,input_manifest_id,input_manifest_hash
) values(
  'c3310000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001','plan_evaluation',
  'genie-preflight-plan-evaluation','running',2,1,
  'c3320000-0000-4000-8000-000000000001',repeat('d',64)
);
insert into public.preflight_stage_attempts(
  id,workspace_id,preflight_run_id,preflight_stage_run_id,attempt_no,authority_epoch,
  fencing_token,input_manifest_id,input_manifest_hash,state,trigger_task_id,
  trigger_run_id,started_at
) values(
  'c3330000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001','c3310000-0000-4000-8000-000000000001',
  1,1,1,'c3320000-0000-4000-8000-000000000001',repeat('d',64),'running',
  'plan-negative-task','plan-negative-run',statement_timestamp()
);
insert into public.preflight_stage_leases(
  id,workspace_id,preflight_run_id,stage_attempt_id,lease_owner,fencing_token,
  state,issued_at,heartbeat_at,expires_at
) values(
  'c3340000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001','c3330000-0000-4000-8000-000000000001',
  'plan-negative-worker',1,'active',statement_timestamp(),statement_timestamp(),
  statement_timestamp()+interval '1 hour'
);
insert into public.narration_master_clock_versions(
  id,workspace_id,configuration_candidate_id,preflight_run_id,script_revision_id,
  audio_identity_selection_id,narration_asset_version_id,version_number,duration_ms,
  processing_text_sha256,alignment_hash,audio_evidence_hash,performance_profile_hash,
  segment_count,state
) values(
  'c3400000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3300000-0000-4000-8000-000000000001',
  'c3110000-0000-4000-8000-000000000001','c3400000-0000-4000-8000-000000000002',
  'c3140000-0000-4000-8000-000000000003',1,60000,
  encode(extensions.digest(convert_to('abcdef','UTF8'),'sha256'),'hex'),repeat('e',64),
  repeat('f',64),repeat('0',64),1,'verified'
);

set local session_replication_role=origin;

create temporary table executable_plan_fixture(plan jsonb not null) on commit drop;
insert into executable_plan_fixture(plan)
select jsonb_build_object(
  'story',jsonb_build_object('fixture','story'),
  'beats',jsonb_build_array(jsonb_build_object(
    'beatNumber',1,'startScalar',0,'endScalar',6,'exactText','abcdef',
    'startMs',0,'endMs',60000,'beatType','devotional_arc','revealLevel','none',
    'requiresProof',false,'requiresReaction',false,'requiresConsequence',false
  )),
  'shots',(select jsonb_agg(jsonb_build_object(
    'shotNumber',shot,'beatNumber',1,'startMs',(shot-1)*10000,'endMs',shot*10000,
    'motionClass','simple_camera_subject',
    'locationVersionId','c3180000-0000-4000-8000-000000000001',
    'characterVersionIds',jsonb_build_array('c3160000-0000-4000-8000-000000000001'),
    'safeAreaPass',true,'suppliesProof',false,'suppliesReaction',false,
    'suppliesConsequence',false,'shotContentHash',repeat(shot::text,64)
  ) order by shot) from generate_series(1,6) shot),
  'sound',jsonb_build_object('fixture','sound'),
  'composition',jsonb_build_object('fixture','composition'),
  'safety',jsonb_build_object('fixture','safety'),
  'routing',jsonb_build_object('fixture','routing'),
  'edd',jsonb_build_object('fixture','edd'),
  'requestSlots',(select jsonb_agg(jsonb_build_object(
    'slotKey','shot.'||shot::text||'.primary','shotNumber',shot,'slotKind','primary',
    'capabilityVersionId',capability.id,'durationMs',10000,'retainedDurationMs',10000,
    'inputStrategy','direct_multi_reference','referenceCount',1,'outputWidth',1080,
    'outputHeight',1920,'billingQuantumCount',2,'expectedOutputKind','video/mp4'
  ) order by shot)
  from generate_series(1,6) shot
  cross join lateral (
    select capability.id
    from private.production_provider_capability_versions capability
    join private.provider_accounts account on account.id=capability.provider_account_id
    where account.workspace_id='c1100000-0000-4000-8000-000000000001'
      and capability.motion_class='simple_camera_subject' and capability.state='verified'
    order by capability.created_at desc limit 1
  ) capability),
  'references',(select jsonb_agg(jsonb_build_object(
    'shotNumber',shot,
    'sourceShotNumber',case when shot=1 then '' else (shot-1)::text end,
    'referenceKind',case when shot=1 then 'character' else 'continuity' end,
    'referenceOrdinal',1,
    'assetVersionId',case when shot=1 then 'c3140000-0000-4000-8000-000000000001' else '' end,
    'contentHash',case when shot=1 then repeat('a',64) else repeat((shot-1)::text,64) end,
    'requiresUpstreamSuccess',shot>1
  ) order by shot) from generate_series(1,6) shot)
);
grant select on executable_plan_fixture to service_role;

create function pg_temp.attempt_executable_plan(p_plan jsonb)
returns uuid language sql as $function$
  select public.command_record_preflight_plan(
    'c3600000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    'c3120000-0000-4000-8000-000000000001',
    'c3300000-0000-4000-8000-000000000001',
    'c3400000-0000-4000-8000-000000000001',
    'c3210000-0000-4000-8000-000000000001',
    'c3200000-0000-4000-8000-000000000001',
    encode(extensions.digest(convert_to(p_plan::text,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to(jsonb_build_object(
      'shots',p_plan->'shots','requestSlots',p_plan->'requestSlots',
      'references',p_plan->'references'
    )::text,'UTF8'),'sha256'),'hex'),
    90,90,90,90,90,
    jsonb_build_object(
      'story','c3500000-0000-4000-8000-000000000001',
      'beat','c3500000-0000-4000-8000-000000000002',
      'shot','c3500000-0000-4000-8000-000000000003',
      'sound','c3500000-0000-4000-8000-000000000004',
      'composition','c3500000-0000-4000-8000-000000000005',
      'safety','c3500000-0000-4000-8000-000000000006',
      'routing','c3500000-0000-4000-8000-000000000007',
      'edd','c3500000-0000-4000-8000-000000000008'
    ),p_plan
  )
$function$;
grant execute on function pg_temp.attempt_executable_plan(jsonb) to service_role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

select throws_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',
    jsonb_set(plan,'{references,1,sourceShotNumber}','2'::jsonb)),
  '40001','reference graph is cyclic, stale, later-bound, or unsafe',
  'a self-dependent shot cycle is rejected before plan publication'
) from executable_plan_fixture;
select throws_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',
    jsonb_set(plan,'{references,1,sourceShotNumber}','3'::jsonb)),
  '40001','reference graph is cyclic, stale, later-bound, or unsafe',
  'a later-shot dependency is rejected before plan publication'
) from executable_plan_fixture;
select throws_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',
    jsonb_set(plan,'{requestSlots,0,referenceCount}','2'::jsonb)),
  '40001','provider request slot breaches its authenticated capability',
  'a plan cannot exceed the authenticated provider reference cap'
) from executable_plan_fixture;
select throws_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',
    jsonb_set(plan,'{references,0,contentHash}',to_jsonb(repeat('f',64)))),
  '40001','reference graph is cyclic, stale, later-bound, or unsafe',
  'an external reference with a stale asset hash is rejected'
) from executable_plan_fixture;
select throws_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',
    jsonb_set(plan,'{references,1,contentHash}',to_jsonb(repeat('e',64)))),
  '40001','reference graph is cyclic, stale, later-bound, or unsafe',
  'a continuity edge with a stale upstream shot hash is rejected'
) from executable_plan_fixture;
select throws_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',
    jsonb_set(plan,'{references,1,requiresUpstreamSuccess}','false'::jsonb)),
  '40001','reference graph is cyclic, stale, later-bound, or unsafe',
  'a downstream reference cannot bypass explicit upstream-success gating'
) from executable_plan_fixture;
select is(
  jsonb_build_object(
    'plans',(select count(*) from public.preflight_plan_bundles
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'requests',(select count(*) from private.provider_requests
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'costEvents',(select count(*) from private.provider_cost_events
      where workspace_id='c1100000-0000-4000-8000-000000000001')
  ),
  '{"costEvents":0,"plans":0,"requests":0}'::jsonb,
  'rejected reference graphs leave no plan, downstream request, or spend'
);

select throws_ok(format(
  'select public.command_record_agent_model_call(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,4,1,16000,180000,131072,%L,%L)',
  'c1100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3110000-0000-4000-8000-000000000001',
  (select id from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
  'c3300000-0000-4000-8000-000000000001','c3330000-0000-4000-8000-000000000001',
  'story.plan',repeat('1',64),repeat('2',64),repeat('9',64),'gpt-5.6-sol',repeat('3',64)
), '22023','agent model-call envelope is invalid',
  'model-call fan-out above three is rejected');
select throws_ok(format(
  'select public.command_record_agent_model_call(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,1,2,16000,180000,131072,%L,%L)',
  'c1100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3110000-0000-4000-8000-000000000001',
  (select id from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
  'c3300000-0000-4000-8000-000000000001','c3330000-0000-4000-8000-000000000001',
  'story.plan',repeat('1',64),repeat('2',64),repeat('9',64),'gpt-5.6-sol',repeat('3',64)
), '22023','agent model-call envelope is invalid',
  'model-call dependency depth above one is rejected');
select throws_ok(format(
  'select public.command_record_agent_model_call(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,1,1,16001,180000,131072,%L,%L)',
  'c1100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3110000-0000-4000-8000-000000000001',
  (select id from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
  'c3300000-0000-4000-8000-000000000001','c3330000-0000-4000-8000-000000000001',
  'story.plan',repeat('1',64),repeat('2',64),repeat('9',64),'gpt-5.6-sol',repeat('3',64)
), '22023','agent model-call envelope is invalid',
  'model-call token authority above sixteen thousand is rejected');
select throws_ok(format(
  'select public.command_record_agent_model_call(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,1,1,16000,180001,131072,%L,%L)',
  'c1100000-0000-4000-8000-000000000001','c3100000-0000-4000-8000-000000000001',
  'c3120000-0000-4000-8000-000000000001','c3110000-0000-4000-8000-000000000001',
  (select id from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
  'c3300000-0000-4000-8000-000000000001','c3330000-0000-4000-8000-000000000001',
  'story.plan',repeat('1',64),repeat('2',64),repeat('9',64),'gpt-5.6-sol',repeat('3',64)
), '22023','agent model-call envelope is invalid',
  'model-call execution time above one hundred eighty seconds is rejected');

reset role;
set local session_replication_role=replica;
select throws_ok($sql$
  insert into private.agent_tool_calls(
    id,workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    policy_version_id,preflight_run_id,stage_attempt_id,tool_name,classification,
    trusted_scope_hash,arguments_hash,source_set_hash,schema_version,maximum_fan_out,
    maximum_depth,maximum_tokens,maximum_duration_ms,maximum_result_bytes,
    maximum_cost_minor,model_family,model_version,prompt_hash,status
  ) values(
    'c3700000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001',
    'c3100000-0000-4000-8000-000000000001','c3120000-0000-4000-8000-000000000001',
    'c3110000-0000-4000-8000-000000000001',
    (select id from public.cultural_policy_versions where state='active' order by created_at desc limit 1),
    'c3300000-0000-4000-8000-000000000001','c3330000-0000-4000-8000-000000000001',
    'story.plan','read_only',repeat('1',64),repeat('2',64),repeat('9',64),
    'genie.restricted-tools.v1',1,1,16000,180000,131072,1,'openai','gpt-5.6-sol',
    repeat('3',64),'authorized'
  )
$sql$,'23514',
  'new row for relation "agent_tool_calls" violates check constraint "agent_tool_calls_maximum_cost_minor_check"',
  'read-only model-call authority cannot carry a nonzero cost cap');
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select is(
  (select count(*) from private.agent_tool_calls
    where workspace_id='c1100000-0000-4000-8000-000000000001'),
  0::bigint,'rejected fan-out, depth, token, time, and cost envelopes mint no agent authority'
);

select throws_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',
    jsonb_set(plan,'{beats,0,exactText}',to_jsonb('abcdeg'::text))),
  '40001','beats do not cover the locked script/master clock',
  'one mutated script scalar invalidates executable-plan eligibility'
) from executable_plan_fixture;
select throws_ok($sql$
  select public.get_production_quote_input(
    'c1100000-0000-4000-8000-000000000001',
    'c3120000-0000-4000-8000-000000000001',array[]::uuid[]
  )
$sql$,'40001','production quote input is incomplete or stale',
  'the scalar-mutated script cannot become production-quote input');

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"c3000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c3000000-0000-4000-8000-000000000003"}',
  true
);
select set_config('request.jwt.claim.sub','c3000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($sql$
  select public.prepare_first_episode_world_lock(
    'c1100000-0000-4000-8000-000000000001',
    'c3120000-0000-4000-8000-000000000001',
    'c3710000-0000-4000-8000-000000000001',
    'c3710000-0000-4000-8000-000000000002',
    'c3710000-0000-4000-8000-000000000003',1,1,1
  )
$sql$,'22023','production spend envelope is invalid',
  'the scalar-mutated script cannot become World Lock eligibility');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select is(
  jsonb_build_object(
    'plans',(select count(*) from public.preflight_plan_bundles
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'quotes',(select count(*) from public.production_quotes
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'confirmations',(select count(*) from public.production_quote_confirmations
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'releases',(select count(*) from public.series_releases
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'authorizations',(select count(*) from private.production_budget_authorizations
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'reservations',(select count(*) from private.production_budget_reservations
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'productionRuns',(select count(*) from public.production_runs
      where workspace_id='c1100000-0000-4000-8000-000000000001')
  ),
  '{"authorizations":0,"confirmations":0,"plans":0,"productionRuns":0,"quotes":0,"releases":0,"reservations":0}'::jsonb,
  'one script-scalar mutation leaves zero plan, quote, World Lock, or spend authority'
);

reset role;
create temporary table plan_qc_context on commit drop as
select
  encode(extensions.digest(convert_to(plan::text,'UTF8'),'sha256'),'hex') as plan_hash,
  (
    select encode(extensions.digest(convert_to(
      rubric.source_visual_hash||':'||rubric.source_checks_hash||':'||rubric.contract_hash,
      'UTF8'),'sha256'),'hex')
    from private.plan_qc_rubric_versions rubric
    where rubric.rubric_key='mythological-devotional-plan'
      and rubric.rubric_version='1.0.0' and rubric.state='active'
  ) as rubric_hash
from executable_plan_fixture;
create temporary table plan_qc_scores(
  fixture_key text primary key,scores jsonb not null
) on commit drop;
insert into plan_qc_scores(fixture_key,scores)
select fixture_key,jsonb_agg(jsonb_build_object(
  'parameterId',parameter.parameter_id,
  'score',case when fixture_key='rubric-corrupt' then 7 else 8 end,
  'applicable',case
    when fixture_key='applicability-corrupt'
      and parameter.parameter_id='first_frame_hook' then false
    else true end,
  'applicabilityReason','fixture evidence',
  'evidenceVersionId','c3900000-0000-4000-8000-000000000001'
) order by parameter.parameter_id)
from (values('rubric-corrupt'),('applicability-corrupt')) fixture(fixture_key)
cross join private.plan_qc_rubric_parameters parameter
where parameter.rubric_key='mythological-devotional-plan'
  and parameter.rubric_version='1.0.0'
group by fixture_key;
create temporary table plan_qc_ids(
  fixture_key text primary key,fixture_id uuid not null
) on commit drop;
grant select on plan_qc_context,plan_qc_scores,plan_qc_ids to service_role;
grant insert on plan_qc_ids to service_role;

update public.preflight_stage_runs
set input_manifest_hash=(select plan_hash from plan_qc_context)
where id='c3310000-0000-4000-8000-000000000001';
update public.preflight_stage_attempts
set input_manifest_hash=(select plan_hash from plan_qc_context)
where id='c3330000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok(
  format('select pg_temp.attempt_executable_plan(%L::jsonb)',plan),
  'the exact locked script publishes one candidate plan for sealed evaluator negatives'
) from executable_plan_fixture;
select lives_ok($sql$
  select public.command_issue_plan_evaluator_challenges(
    'c1100000-0000-4000-8000-000000000001',
    'c3300000-0000-4000-8000-000000000001',
    'c3330000-0000-4000-8000-000000000001',
    'c3600000-0000-4000-8000-000000000001',
    'c3810000-0000-4000-8000-000000000001',
    '[
      {"challengeId":"c3800000-0000-4000-8000-000000000001","evaluatorKey":"evaluator.alpha","deploymentFamily":"family.alpha"},
      {"challengeId":"c3800000-0000-4000-8000-000000000002","evaluatorKey":"evaluator.beta","deploymentFamily":"family.beta"}
    ]'::jsonb
  )
$sql$,'two independent sealed evaluator challenges bind to the exact candidate plan');

insert into plan_qc_ids(fixture_key,fixture_id)
select 'bad-rubric',public.command_record_evaluator_record(
  'c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001',
  'c3330000-0000-4000-8000-000000000001','evaluator.alpha','family.alpha',
  'gpt-5.6-sol',repeat('1',64),(select plan_hash from plan_qc_context),
  (select plan_hash from plan_qc_context),repeat('2',64),repeat('f',64),80,'pass','[]',
  encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex')
) from plan_qc_scores where fixture_key='rubric-corrupt';
insert into plan_qc_ids(fixture_key,fixture_id)
select 'bad-output',public.command_record_evaluator_record(
  'c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001',
  'c3330000-0000-4000-8000-000000000001','evaluator.alpha','family.alpha',
  'gpt-5.6-sol',repeat('2',64),(select plan_hash from plan_qc_context),
  (select plan_hash from plan_qc_context),repeat('3',64),
  (select rubric_hash from plan_qc_context),80,'pass','[]',repeat('e',64)
);
insert into plan_qc_ids(fixture_key,fixture_id)
select 'bad-plan',public.command_record_evaluator_record(
  'c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001',
  'c3330000-0000-4000-8000-000000000001','evaluator.alpha','family.alpha',
  'gpt-5.6-sol',repeat('3',64),(select plan_hash from plan_qc_context),
  repeat('d',64),repeat('4',64),(select rubric_hash from plan_qc_context),80,'pass','[]',
  encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex')
) from plan_qc_scores where fixture_key='applicability-corrupt';
insert into plan_qc_ids(fixture_key,fixture_id)
select 'valid-alpha',public.command_record_evaluator_record(
  'c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001',
  'c3330000-0000-4000-8000-000000000001','evaluator.alpha','family.alpha',
  'gpt-5.6-sol',repeat('4',64),(select plan_hash from plan_qc_context),
  (select plan_hash from plan_qc_context),repeat('5',64),
  (select rubric_hash from plan_qc_context),80,'pass','[]',
  encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex')
) from plan_qc_scores where fixture_key='applicability-corrupt';
insert into plan_qc_ids(fixture_key,fixture_id)
select 'valid-beta',public.command_record_evaluator_record(
  'c1100000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001',
  'c3330000-0000-4000-8000-000000000001','evaluator.beta','family.beta',
  'gpt-5.6-terra',repeat('5',64),(select plan_hash from plan_qc_context),
  (select plan_hash from plan_qc_context),repeat('6',64),
  (select rubric_hash from plan_qc_context),80,'pass','[]',
  encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex')
) from plan_qc_scores where fixture_key='applicability-corrupt';

select throws_ok(
  format(
    'select public.command_record_plan_evaluator_score_set(%L,%L,%L,%L::jsonb)',
    'c3800000-0000-4000-8000-000000000001',
    (select fixture_id from plan_qc_ids where fixture_key='bad-rubric'),
    encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex'),scores
  ),
  '40001','evaluator score set is not bound to its sealed challenge',
  'a corrupt rubric hash cannot become plan-QC evidence'
) from plan_qc_scores where fixture_key='rubric-corrupt';
select throws_ok(
  format(
    'select public.command_record_plan_evaluator_score_set(%L,%L,%L,%L::jsonb)',
    'c3800000-0000-4000-8000-000000000001',
    (select fixture_id from plan_qc_ids where fixture_key='bad-output'),
    encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex'),scores
  ),
  '40001','evaluator score set is not bound to its sealed challenge',
  'a corrupt evaluator output hash cannot become plan-QC evidence'
) from plan_qc_scores where fixture_key='applicability-corrupt';
select throws_ok(
  format(
    'select public.command_record_plan_evaluator_score_set(%L,%L,%L,%L::jsonb)',
    'c3800000-0000-4000-8000-000000000001',
    (select fixture_id from plan_qc_ids where fixture_key='valid-alpha'),
    repeat('0',64),scores
  ),
  '40001','evaluator score set is not bound to its sealed challenge',
  'corrupt score-set math or hash is rejected before consensus'
) from plan_qc_scores where fixture_key='applicability-corrupt';
select throws_ok(
  format(
    'select public.command_record_plan_evaluator_score_set(%L,%L,%L,%L::jsonb)',
    'c3800000-0000-4000-8000-000000000001',
    (select fixture_id from plan_qc_ids where fixture_key='bad-plan'),
    encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex'),scores
  ),
  '40001','evaluator score set is not bound to its sealed challenge',
  'evaluator evidence for another plan hash is rejected'
) from plan_qc_scores where fixture_key='applicability-corrupt';

select lives_ok($command$
  do $body$
  declare score_value jsonb; score_hash_value text;
  begin
    select scores,encode(extensions.digest(convert_to(scores::text,'UTF8'),'sha256'),'hex')
      into score_value,score_hash_value
    from plan_qc_scores where fixture_key='applicability-corrupt';
    perform public.command_record_plan_evaluator_score_set(
      'c3800000-0000-4000-8000-000000000001',
      (select fixture_id from plan_qc_ids where fixture_key='valid-alpha'),
      score_hash_value,score_value
    );
    perform public.command_record_plan_evaluator_score_set(
      'c3800000-0000-4000-8000-000000000002',
      (select fixture_id from plan_qc_ids where fixture_key='valid-beta'),
      score_hash_value,score_value
    );
  end
  $body$
$command$,'the exact score hashes persist for both independent evaluators');
select lives_ok($sql$
  select public.command_create_preflight_plan_consensus(
    'c1100000-0000-4000-8000-000000000001',
    'c3810000-0000-4000-8000-000000000001'
  )
$sql$,'consensus deterministically recomputes score math and applicability');
select ok(
  exists(
    select 1 from private.preflight_plan_qc_consensus consensus
    join public.preflight_plan_bundles bundle on bundle.id=consensus.plan_bundle_id
    where consensus.blind_group_id='c3810000-0000-4000-8000-000000000001'
      and consensus.verdict='block' and consensus.evidence_density=0
      and 'EVIDENCE_CONFIDENCE'=any(consensus.gate_codes)
      and bundle.state='blocked'
  ),
  'corrupt applicability deterministically blocks the plan with zero evidence density'
);
select throws_ok($sql$
  select public.get_production_quote_input(
    'c1100000-0000-4000-8000-000000000001',
    'c3120000-0000-4000-8000-000000000001',array[]::uuid[]
  )
$sql$,'40001','production quote input is incomplete or stale',
  'corrupt rubric, score, applicability, or plan evidence fails before quote compilation');
select is(
  jsonb_build_object(
    'quotes',(select count(*) from public.production_quotes
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'authorizations',(select count(*) from private.production_budget_authorizations
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'reservations',(select count(*) from private.production_budget_reservations
      where workspace_id='c1100000-0000-4000-8000-000000000001'),
    'productionRuns',(select count(*) from public.production_runs
      where workspace_id='c1100000-0000-4000-8000-000000000001')
  ),
  '{"authorizations":0,"productionRuns":0,"quotes":0,"reservations":0}'::jsonb,
  'corrupt plan-QC evidence creates no quote, World Lock, or spend authority'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)',
    'execute'
  ) and has_function_privilege(
    'service_role',
    'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)',
    'execute'
  ),
  'only the service boundary can authorize a plan model call'
);
select ok(
  position('lease.expires_at>statement_timestamp()'
    in pg_get_functiondef('public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)'::regprocedure))>0,
  'model-call authorization requires the exact current live lease'
);
select ok(
  position('authorization_call_id=prior.id'
    in pg_get_functiondef('public.command_reject_agent_model_call(uuid,text,text,jsonb)'::regprocedure))>0,
  'model-call rejection is one-successor and replay-safe'
);
select has_column('public','preflight_plan_bundles','plan_iteration',
  'plan bundles record their bounded immutable iteration');
select has_column('public','preflight_plan_bundles','parent_plan_bundle_id',
  'a repair is parented to the exact blocked plan');
select has_column('public','preflight_plan_bundles','repair_basis_consensus_id',
  'a repair is bound to the exact failed consensus');
select has_trigger('public','preflight_plan_bundles','plan_repair_lineage_bind',
  'the database binds plan-repair lineage before insert');
select ok(
  exists(select 1 from pg_constraint
    where conrelid='public.preflight_plan_bundles'::regclass
      and conname='preflight_plan_run_iteration_uq'
      and pg_get_constraintdef(oid) like 'UNIQUE (preflight_run_id, plan_iteration)%'),
  'a run cannot publish two plans at the same repair iteration'
);
select ok(
  exists(select 1 from pg_constraint
    where conrelid='private.plan_evaluator_challenges'::regclass
      and conname='plan_evaluator_challenge_plan_key_uq'
      and pg_get_constraintdef(oid)
        like 'UNIQUE (stage_attempt_id, plan_bundle_id, evaluator_key)%'),
  'each immutable repair receives its own blind evaluator pair'
);
select ok(
  position('''repairAvailable'',false'
    in pg_get_functiondef(
      'public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)'::regprocedure))>0
  and position('bundle.plan_iteration>=3'
    in pg_get_functiondef(
      'public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)'::regprocedure))>0,
  'genuine repair-budget exhaustion is returned as a typed sealed state'
);
select ok(
  not has_function_privilege(
    'authenticated','public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)','execute'
  ) and has_function_privilege(
    'service_role','public.get_plan_repair_feedback(uuid,uuid,uuid,uuid)','execute'
  ),
  'only the service worker can read exact plan repair evidence'
);
select ok(
  exists(select 1 from pg_enum value
    join pg_type type on type.oid=value.enumtypid
    join pg_namespace namespace on namespace.oid=type.typnamespace
    where namespace.nspname='private' and type.typname='agent_tool_name'
      and value.enumlabel='audio.pronunciation'),
  'pronunciation is an explicit restricted read-only agent tool'
);
select ok(
  position('p_tool_name=''source.extract'' and run.kind=''world_anchor'''
    in pg_get_functiondef(
      'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)'::regprocedure))>0
  and position('p_source_set_hash=script.raw_utf8_sha256'
    in pg_get_functiondef(
      'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)'::regprocedure))>0,
  'World Extraction model calls are bound to the exact world stage and script bytes'
);
select ok(
  position('p_tool_name in (''audio.pronunciation'',''audio.delivery'') and run.kind=''narration_clock'''
    in pg_get_functiondef(
      'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)'::regprocedure))>0
  and position('status.status=''approved'''
    in pg_get_functiondef(
      'public.command_record_agent_model_call(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,integer,integer,text,text)'::regprocedure))>0,
  'Pronunciation Director calls require the exact narration stage and approved source review'
);
select ok(
  position('''episodeId'',run.episode_id'
    in pg_get_functiondef(
      'public.get_preflight_control_execution_input(uuid,bigint,bigint,text)'::regprocedure))>0
  and position('''policyVersionId'',policy.id'
    in pg_get_functiondef(
      'public.get_preflight_control_execution_input(uuid,bigint,bigint,text)'::regprocedure))>0,
  'the control read model derives episode and cultural-policy scope server-side'
);
select ok(
  position('''policyVersionId'',packet.policy_version_id'
    in pg_get_functiondef(
      'public.get_audio_identity_preflight_input(uuid,uuid)'::regprocedure))>0
  and position('''sourceSetHash'',packet.source_set_hash'
    in pg_get_functiondef(
      'public.get_audio_identity_preflight_input(uuid,uuid)'::regprocedure))>0,
  'the audio read model returns only packet-derived policy and source scope'
);
select is(
  jsonb_array_length(public.command_ensure_production_allowance_rates(
    'c1100000-0000-4000-8000-000000000001')),
  8,'the quote compiler registers all eight mandatory allowance rates'
);
select is(
  (select jsonb_agg(jsonb_build_array(
    rate.rate_key,rate.unit_name,rate.unit_price_microusd,
    rate.minimum_quantity,rate.maximum_line_microusd
  ) order by rate.rate_key)
  from private.production_rate_card_versions rate
  where rate.rate_key=any(array[
    'upscale','narration_master_reuse','score_music','sfx_ambience','storyboard_generation',
    'qc_judges','render_export','repair_allowance'
  ])),
  '[
    ["narration_master_reuse","episode",0,1,0],
    ["qc_judges","judge_call",250000,4,3000000],
    ["render_export","render_minute",500000,1,1500000],
    ["repair_allowance","episode",500000,1,1000000],
    ["score_music","episode",1250000,1,2500000],
    ["sfx_ambience","credit",100,0,1000000],
    ["storyboard_generation","billing_quantum",80000,0,50000000],
    ["upscale","minute",1200000,0,5000000]
  ]'::jsonb,
  'allowance quantities and conservative microusd ceilings are exact'
);
select is(
  jsonb_array_length(public.command_ensure_production_allowance_rates(
    'c1100000-0000-4000-8000-000000000001')),
  8,'allowance-rate registration is replay-safe'
);
select is(
  (select count(*) from private.production_rate_card_versions rate
    where rate.rate_key=any(array[
      'upscale','narration_master_reuse','score_music','sfx_ambience','storyboard_generation',
      'qc_judges','render_export','repair_allowance'
    ])),
  8::bigint,'allowance-rate replay does not mint duplicate versions'
);
select ok(
  not has_function_privilege(
    'authenticated','public.command_ensure_production_allowance_rates(uuid)','execute'
  ) and not has_function_privilege(
    'authenticated','public.get_production_quote_input(uuid,uuid,uuid[])','execute'
  ) and not has_function_privilege(
    'authenticated','public.prepare_production_quote(uuid,uuid,uuid,bigint,timestamptz,jsonb)','execute'
  ),
  'quote compilation internals are restricted to the service boundary'
);
select ok(
  position('state=''qc_passed'''
    in pg_get_functiondef(
      'public.get_production_quote_input(uuid,uuid,uuid[])'::regprocedure))>0
  and position('jsonb_array_length(coalesce(allowance_value,''[]''::jsonb))<>8'
    in pg_get_functiondef(
      'public.get_production_quote_input(uuid,uuid,uuid[])'::regprocedure))>0,
  'quote input requires a passed plan and every mandatory allowance'
);
select has_trigger(
  'public','preflight_stage_attempts','surface_terminal_preflight_failure',
  'terminal plan and quote outcomes create one durable recovery item'
);
select ok(
  position('No production spend was authorized'
    in pg_get_functiondef('private.surface_terminal_preflight_failure()'::regprocedure))>0
  and position('preflight-blocked:'
    in pg_get_functiondef('private.surface_terminal_preflight_failure()'::regprocedure))>0,
  'terminal feedback is safe, explicit about zero spend, and deduplicated per attempt'
);
select ok(
  position('''failure''' in pg_get_viewdef('public.creation_readiness_projections'::regclass,true))>0
  and position('safe_error_class' in pg_get_viewdef('public.creation_readiness_projections'::regclass,true))>0,
  'the creation projection exposes the latest sealed safe failure instead of waiting forever'
);
select ok(
  has_function_privilege(
    'authenticated','public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)','execute'
  )
  and position('private.workspace_action_is_authorized(p_workspace_id,''production_quote_confirm'')'
    in pg_get_functiondef('public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure))>0
  and position('quote.expires_at<=statement_timestamp()'
    in pg_get_functiondef('public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure))>0,
  'quote confirmation uses the exact workspace authority profile and current authenticated rate evidence'
);
select ok(
  position('p_quote_hash is distinct from quote.quote_hash'
    in pg_get_functiondef('public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure))>0
  and position('p_hard_ceiling_microusd is distinct from quote.hard_ceiling_microusd'
    in pg_get_functiondef('public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure))>0,
  'quote confirmation is pinned to the immutable hash and exact hard ceiling'
);
select ok(
  has_function_privilege(
    'authenticated','public.prepare_first_episode_world_lock(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint)','execute'
  )
  and position('series_row.aggregate_version<>p_expected_series_version'
    in pg_get_functiondef('public.prepare_first_episode_world_lock(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint)'::regprocedure))>0
  and position('plan_qc_consensus_id=consensus.id'
    in pg_get_functiondef('public.prepare_first_episode_world_lock(uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint)'::regprocedure))>0,
  'World Lock preparation pins every aggregate and the exact passed-plan quote'
);
select ok(
  position('every World identity must be accepted and sheet-verified'
    in pg_get_functiondef('public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure))>0
  and position('capability, reference graph, or rate evidence became stale'
    in pg_get_functiondef('public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure))>0,
  'the mutating World Lock recomputes World, capability, reference, and rate readiness under locks'
);
select ok(
  position('insert into private.production_budget_authorizations'
    in pg_get_functiondef('public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure))>0
  and position('insert into private.production_budget_reservations'
    in pg_get_functiondef('public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure))>0
  and position('insert into public.production_runs'
    in pg_get_functiondef('public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure))>0
  and position('production.run.authorized.v1'
    in pg_get_functiondef('public.command_lock_first_episode_world(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,uuid,text,text,uuid)'::regprocedure))>0,
  'one atomic World Lock creates the release, bounded spend authority, production run, and outbox baton'
);

select * from finish();
rollback;

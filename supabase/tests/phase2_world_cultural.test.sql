begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth,storage,private,audit,pg_catalog;
select plan(109);

create temp table world_fixture(key text primary key,value text not null) on commit drop;
grant select,insert,update,delete on world_fixture to authenticated,service_role;
grant usage on schema private to service_role;
grant select on all tables in schema private to service_role;

insert into world_fixture(key,value) values
('shiva_identity_manifest',$manifest$
{
  "schemaVersion":"genie-character-identity-manifest.v2",
  "isDeity":true,
  "identity":{
    "characterKey":"shiva",
    "canonicalName":"Shiva",
    "formKey":"mahadeva",
    "formName":"Mahadeva",
    "essentialAttributes":["third-eye","matted-hair"]
  },
  "form":{
    "topology":{"headCount":1,"armCount":2,"handCount":2,"legCount":2},
    "rules":{
      "required":["human-form","third-eye-visible"],
      "prohibited":["extra-heads","extra-limbs"]
    }
  },
  "wardrobe":{
    "required":["tiger-skin-wrap"],
    "prohibited":["modern-clothing"]
  },
  "skin":{
    "toneRules":["ash-blue-tone"],
    "formRules":["sacred-ash-markings"]
  },
  "ornaments":[{"key":"rudraksha","placement":"neck","required":true}],
  "dignity":{
    "required":["reverent-bearing"],
    "prohibited":["comic-caricature"]
  },
  "allowedTransitions":[],
  "deity":{
    "arms":[
      {"armId":"left-1","side":"left","ordinal":1,"handId":"left-hand-1"},
      {"armId":"right-1","side":"right","ordinal":1,"handId":"right-hand-1"}
    ],
    "handObjectAssignments":[
      {"handId":"left-hand-1","assignmentKind":"attribute","objectKey":"damaru"},
      {"handId":"right-hand-1","assignmentKind":"weapon","objectKey":"trishula"}
    ],
    "vahana":{"status":"specified","key":"nandi"},
    "weapons":[{"key":"trishula","required":true}]
  }
}
$manifest$),
('non_deity_identity_manifest',$manifest$
{
  "schemaVersion":"genie-character-identity-manifest.v2",
  "isDeity":false,
  "identity":{
    "characterKey":"contract-fixture",
    "canonicalName":"Contract Fixture",
    "formKey":"standard",
    "formName":"Standard Form",
    "essentialAttributes":["adult","calm-bearing"]
  },
  "form":{
    "topology":{"headCount":1,"armCount":2,"handCount":2,"legCount":2},
    "rules":{"required":["human-form"],"prohibited":["extra-limbs"]}
  },
  "wardrobe":{
    "required":["period-appropriate-clothing"],
    "prohibited":["modern-clothing"]
  },
  "skin":{
    "toneRules":["match-accepted-reference"],
    "formRules":["no-unplanned-age-change"]
  },
  "ornaments":[],
  "dignity":{"required":["respectful-bearing"],"prohibited":[]},
  "allowedTransitions":[],
  "deity":null
}
$manifest$);

insert into public.organizations(id,name,slug) values
('b1000000-0000-4000-8000-000000000001','Genie World Test','genie-world-test');
insert into public.workspaces(id,organization_id,name,slug) values
('b1100000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','World One','world-one');
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,aud,role) values
('b1200000-0000-4000-8000-000000000001','world.one@zyra.test',statement_timestamp(),statement_timestamp(),statement_timestamp(),'authenticated','authenticated'),
('b1200000-0000-4000-8000-000000000002','world.two@zyra.test',statement_timestamp(),statement_timestamp(),statement_timestamp(),'authenticated','authenticated');
insert into public.profiles(user_id,display_name) values
('b1200000-0000-4000-8000-000000000001','World Reviewer One'),
('b1200000-0000-4000-8000-000000000002','World Reviewer Two');
insert into public.memberships(workspace_id,user_id,role,status,authority_epoch,activated_at) values
('b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000001','admin','active',1,statement_timestamp()),
('b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000002','admin','active',1,statement_timestamp());
insert into public.series(id,workspace_id,slug,title,owner_user_id,created_by) values
('b1300000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001','world-series','World Series','b1200000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000001');
insert into public.episodes(id,workspace_id,series_id,episode_number,title,owner_user_id,created_by) values
('b1400000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001',1,'World Episode','b1200000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000001');
insert into private.aggregate_versions(workspace_id,aggregate_type,aggregate_id,current_version) values
('b1100000-0000-4000-8000-000000000001','episode','b1400000-0000-4000-8000-000000000001',1);

set local session_replication_role=replica;
insert into public.script_revisions(
 id,workspace_id,episode_id,revision_number,source_kind,raw_text,raw_utf8,
 raw_utf8_sha256,processing_text,processing_utf8_sha256,processing_profile,
 coordinate_map,runtime_evidence,raw_utf16_code_units,raw_scalar_count,
 raw_grapheme_count,processing_utf16_code_units,processing_scalar_count,
 processing_grapheme_count,estimated_duration_seconds,duration_out_of_band,
 duration_acknowledged,created_by
) values (
 'b1500000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
 'b1400000-0000-4000-8000-000000000001',1,'browser_text','other',convert_to('other','UTF8'),
 encode(extensions.digest(convert_to('other','UTF8'),'sha256'),'hex'),'other',
 encode(extensions.digest(convert_to('other','UTF8'),'sha256'),'hex'),'genie-script-processing.v1',
 '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
 '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
 5,5,5,5,5,5,60,false,false,'b1200000-0000-4000-8000-000000000001'
);
insert into public.episode_configuration_candidates(
 id,workspace_id,episode_id,candidate_number,script_revision_id,narrator_gender,
 voice_version_id,look_version_id,voice_confirmed_by,voice_confirmed_at,
 look_confirmed_by,look_confirmed_at,state,selected_by
) values (
 'b1600000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
 'b1400000-0000-4000-8000-000000000001',1,'b1500000-0000-4000-8000-000000000001','male',
 (select id from public.voice_versions where gender='male' and registry_version=1),
 (select id from public.look_versions where look_key='glowing-divine-realism'),
 'b1200000-0000-4000-8000-000000000001',statement_timestamp(),
 'b1200000-0000-4000-8000-000000000001',statement_timestamp(),'world_design',
 'b1200000-0000-4000-8000-000000000001'
);
insert into public.assets(id,workspace_id,asset_kind) values
('b1700000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001','character_anchor'),
('b1700000-0000-4000-8000-000000000002','b1100000-0000-4000-8000-000000000001','character_anchor'),
('b1700000-0000-4000-8000-000000000003','b1100000-0000-4000-8000-000000000001','location_anchor'),
('b1700000-0000-4000-8000-000000000004','b1100000-0000-4000-8000-000000000001','character_anchor');
insert into public.asset_versions(
 id,workspace_id,asset_id,version_number,source_quarantine_version_id,bucket_id,
 object_name,storage_version,content_sha256,media_mime,byte_length,policy_version_id,provenance_hash
)
select version_id,'b1100000-0000-4000-8000-000000000001',asset_id,1,quarantine_id,
 'workspace-media','b1100000-0000-4000-8000-000000000001/'||kind||'/'||asset_id::text||'/'||version_id::text||'/source',
 'v1',repeat(hash_char,64),'image/png',100,'b1710000-0000-4000-8000-000000000001',repeat(prov_char,64)
from (values
 ('b1720000-0000-4000-8000-000000000001'::uuid,'b1700000-0000-4000-8000-000000000001'::uuid,'b1730000-0000-4000-8000-000000000001'::uuid,'character_anchor','1','a'),
 ('b1720000-0000-4000-8000-000000000002'::uuid,'b1700000-0000-4000-8000-000000000002'::uuid,'b1730000-0000-4000-8000-000000000002'::uuid,'character_anchor','2','b'),
 ('b1720000-0000-4000-8000-000000000003'::uuid,'b1700000-0000-4000-8000-000000000003'::uuid,'b1730000-0000-4000-8000-000000000003'::uuid,'location_anchor','3','c'),
 ('b1720000-0000-4000-8000-000000000004'::uuid,'b1700000-0000-4000-8000-000000000004'::uuid,'b1730000-0000-4000-8000-000000000004'::uuid,'character_anchor','4','d')
) as media(version_id,asset_id,quarantine_id,kind,hash_char,prov_char);

insert into public.episode_configuration_candidates(
 id,workspace_id,episode_id,candidate_number,script_revision_id,narrator_gender,
 voice_version_id,look_version_id,state,selected_by,superseded_at
)
select
 'b1600000-0000-4000-8000-000000000002',
 'b1100000-0000-4000-8000-000000000001',
 'b1400000-0000-4000-8000-000000000001',
 2,
 'b1500000-0000-4000-8000-000000000001',
 'male',
 voice_version_id,
 look_version_id,
 'superseded',
 'b1200000-0000-4000-8000-000000000001',
 statement_timestamp()
from public.episode_configuration_candidates
where id='b1600000-0000-4000-8000-000000000001';

insert into public.preflight_runs(
 id,workspace_id,episode_id,configuration_candidate_id,script_revision_id,
 kind,run_number,authority_epoch,state,requires_micro_authority,trigger_run_id,
 completed_at
) values
(
 'b2460000-0000-4000-8000-000000000001',
 'b1100000-0000-4000-8000-000000000001',
 'b1400000-0000-4000-8000-000000000001',
 'b1600000-0000-4000-8000-000000000002',
 'b1500000-0000-4000-8000-000000000001',
 'world_anchor',97,1,'failed',false,null,statement_timestamp()
),
(
 'b2460000-0000-4000-8000-000000000002',
 'b1100000-0000-4000-8000-000000000001',
 'b1400000-0000-4000-8000-000000000001',
 'b1600000-0000-4000-8000-000000000002',
 'b1500000-0000-4000-8000-000000000001',
 'world_anchor',98,2,'running',false,'trigger-cross-run-replay',null
);
insert into public.preflight_stage_runs(
 id,workspace_id,preflight_run_id,stage_key,queue_key,state,
 next_attempt_no,highest_fencing_token,input_manifest_id,input_manifest_hash,
 completed_at
) values
(
 'b2470000-0000-4000-8000-000000000001',
 'b1100000-0000-4000-8000-000000000001',
 'b2460000-0000-4000-8000-000000000001',
 'world_anchor.root','genie-preflight-world-images','failed_terminal',
 2,1,'b24b0000-0000-4000-8000-000000000001',repeat('7',64),
 statement_timestamp()
),
(
 'b2470000-0000-4000-8000-000000000002',
 'b1100000-0000-4000-8000-000000000001',
 'b2460000-0000-4000-8000-000000000002',
 'world_anchor.root','genie-preflight-world-images','claimed',
 2,1,'b24b0000-0000-4000-8000-000000000002',repeat('7',64),
 null
);
insert into public.preflight_stage_attempts(
 id,workspace_id,preflight_run_id,preflight_stage_run_id,attempt_no,
 authority_epoch,fencing_token,input_manifest_id,input_manifest_hash,state,
 safe_error_class,completed_at
) values
(
 'b2480000-0000-4000-8000-000000000001',
 'b1100000-0000-4000-8000-000000000001',
 'b2460000-0000-4000-8000-000000000001',
 'b2470000-0000-4000-8000-000000000001',
 1,1,1,'b24b0000-0000-4000-8000-000000000001',repeat('7',64),
 'failed_terminal','candidate_review_conflict',statement_timestamp()
),
(
 'b2480000-0000-4000-8000-000000000002',
 'b1100000-0000-4000-8000-000000000001',
 'b2460000-0000-4000-8000-000000000002',
 'b2470000-0000-4000-8000-000000000002',
 1,2,1,'b24b0000-0000-4000-8000-000000000002',repeat('7',64),
 'claimed',null,null
);
insert into public.preflight_stage_leases(
 id,workspace_id,preflight_run_id,stage_attempt_id,lease_owner,fencing_token,
 state,issued_at,heartbeat_at,expires_at
) values (
 'b2490000-0000-4000-8000-000000000002',
 'b1100000-0000-4000-8000-000000000001',
 'b2460000-0000-4000-8000-000000000002',
 'b2480000-0000-4000-8000-000000000002',
 'pgtap-cross-run-replay',1,'active',statement_timestamp(),
 statement_timestamp(),statement_timestamp() + interval '10 minutes'
);
insert into private.world_extraction_results(
 id,workspace_id,preflight_run_id,stage_attempt_id,
 configuration_candidate_id,script_revision_id,script_sha256,look_version_id,
 schema_version,extraction_json,extraction_hash,model_key,model_request_hash,
 provider_response_id_hash,provider_request_id_hash
)
select
 'b24a0000-0000-4000-8000-000000000001',
 'b1100000-0000-4000-8000-000000000001',
 'b2460000-0000-4000-8000-000000000001',
 'b2480000-0000-4000-8000-000000000001',
 'b1600000-0000-4000-8000-000000000002',
 'b1500000-0000-4000-8000-000000000001',
 script.raw_utf8_sha256,
 configuration.look_version_id,
 'genie.world-extraction.v3',
 fixture.extraction_json,
 encode(extensions.digest(convert_to(fixture.extraction_json::text,'UTF8'),'sha256'),'hex'),
 'gpt-5.6',repeat('8',64),repeat('9',64),repeat('a',64)
from public.script_revisions script
join public.episode_configuration_candidates configuration
  on configuration.script_revision_id=script.id
cross join lateral (
  select '{
    "schemaVersion":"genie.world-extraction.v3",
    "characters":[{
      "characterKey":"fixture",
      "canonicalName":"Fixture",
      "forms":[{
        "formKey":"standard",
        "formName":"Standard",
        "identityManifest":{
          "schemaVersion":"genie-character-identity-manifest.v2"
        }
      }]
    }],
    "locations":[{"locationKey":"fixture","canonicalName":"Fixture"}],
    "props":[]
  }'::jsonb as extraction_json
) fixture
where script.id='b1500000-0000-4000-8000-000000000001'
  and configuration.id='b1600000-0000-4000-8000-000000000002';
insert into public.world_build_progress_items(
 id,workspace_id,configuration_candidate_id,preflight_run_id,item_key,
 item_kind,display_name,state,sort_order,safe_detail
) values
(
 'b24c0000-0000-4000-8000-000000000001',
 'b1100000-0000-4000-8000-000000000001',
 'b1600000-0000-4000-8000-000000000002',
 'b2460000-0000-4000-8000-000000000002',
 'system.cross-run-research','system','Cross-run research','researching',0,
 'Researching factual references'
),
(
 'b24c0000-0000-4000-8000-000000000002',
 'b1100000-0000-4000-8000-000000000001',
 'b1600000-0000-4000-8000-000000000002',
 'b2460000-0000-4000-8000-000000000002',
 'character.cross-run-ready','character','Ready anchor','review_ready',100,
 'Secure image is ready for review'
);
set local session_replication_role=origin;

create function pg_temp.record_contract_character_manifest(
  p_version_id uuid,
  p_manifest jsonb,
  p_manifest_hash text default null
)
returns jsonb
language sql
set search_path=public,extensions,auth,storage,private,pg_catalog
as $$
  select public.command_record_character_candidate(
    'b1100000-0000-4000-8000-000000000001',
    'b1600000-0000-4000-8000-000000000001',
    'b1800000-0000-4000-8000-000000000099',
    'b1810000-0000-4000-8000-000000000099',
    'contract-fixture','Contract Fixture','standard','Standard Form',
    p_version_id,'generated','Contract portrait',
    encode(extensions.digest(convert_to('Contract portrait','UTF8'),'sha256'),'hex'),
    'preserve identity','b1720000-0000-4000-8000-000000000004',
    p_manifest,coalesce(p_manifest_hash,encode(extensions.digest(
      convert_to(p_manifest::text,'UTF8'),'sha256'),'hex')),null
  )
$$;
grant execute on function pg_temp.record_contract_character_manifest(uuid,jsonb,text)
to service_role;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

select ok(
 not has_function_privilege('authenticated','public.command_record_character_candidate(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid,jsonb,text,uuid)','execute')
 and has_function_privilege('service_role','public.command_record_character_candidate(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text,uuid,jsonb,text,uuid)','execute'),
 'world candidate creation is service-only'
);
select lives_ok(
 $$select public.get_world_extraction_replay_result(
   'b2480000-0000-4000-8000-000000000002',2,1,repeat('7',64)
 )$$,
 'a fenced retry replays an exact prior-run World extraction'
);
select ok(
 exists(
   select 1
   from private.world_extraction_results replay
   join private.world_extraction_results source
     on source.id=replay.source_extraction_result_id
   where replay.preflight_run_id='b2460000-0000-4000-8000-000000000002'
     and replay.stage_attempt_id='b2480000-0000-4000-8000-000000000002'
     and replay.source_extraction_result_id='b24a0000-0000-4000-8000-000000000001'
     and replay.extraction_hash=source.extraction_hash
     and replay.extraction_json=source.extraction_json
 ),
 'the replay is current-run evidence with explicit immutable source lineage'
);
select throws_ok(
 $$select public.get_world_extraction_replay_result(
   'b2480000-0000-4000-8000-000000000002',2,1,repeat('6',64)
 )$$,
 '40001',
 'world extraction replay authority is stale',
 'a mismatched input manifest cannot replay prior World evidence'
);
reset role;
update public.preflight_runs
set state='failed',completed_at=statement_timestamp()
where id='b2460000-0000-4000-8000-000000000002';
set local role service_role;
select is(
 (select state from public.world_build_progress_items
  where id='b24c0000-0000-4000-8000-000000000001'),
 'failed',
 'a terminal World run projects its failure into active studio progress'
);
select is(
 (select state from public.world_build_progress_items
  where id='b24c0000-0000-4000-8000-000000000002'),
 'review_ready',
 'terminal reconciliation preserves secure candidates already ready for review'
);
select lives_ok(format(
 'select public.command_record_character_candidate(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,null)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1800000-0000-4000-8000-000000000001','b1810000-0000-4000-8000-000000000001',
 'shiva','Shiva','mahadeva','Mahadeva','b1820000-0000-4000-8000-000000000001',
 'generated','Shiva portrait',encode(extensions.digest(convert_to('Shiva portrait','UTF8'),'sha256'),'hex'),
 'no drift','b1720000-0000-4000-8000-000000000001',
 (select value from world_fixture where key='shiva_identity_manifest'),
 encode(extensions.digest(convert_to((select value::jsonb from world_fixture
   where key='shiva_identity_manifest')::text,'UTF8'),'sha256'),'hex')
 ),'a generated character is an immutable review candidate');

select ok(
  exists(
    select 1 from public.character_versions version
    where version.id='b1820000-0000-4000-8000-000000000001'
      and version.identity_manifest->>'schemaVersion'=
        'genie-character-identity-manifest.v2'
      and (version.identity_manifest->>'isDeity')::boolean
      and version.identity_manifest#>>'{identity,characterKey}'='shiva'
      and (version.identity_manifest#>>'{form,topology,armCount}')::integer=2
      and jsonb_array_length(version.identity_manifest#>'{deity,arms}')=2
      and jsonb_array_length(
        version.identity_manifest#>'{deity,handObjectAssignments}')=2
      and version.identity_manifest#>>'{deity,vahana,key}'='nandi'
      and jsonb_array_length(version.identity_manifest#>'{deity,weapons}')=1
      and jsonb_array_length(version.identity_manifest->'ornaments')=1
      and jsonb_typeof(version.identity_manifest->'wardrobe')='object'
      and jsonb_typeof(version.identity_manifest->'skin')='object'
      and jsonb_typeof(version.identity_manifest#>'{form,rules}')='object'
      and jsonb_typeof(version.identity_manifest->'dignity')='object'
      and jsonb_typeof(version.identity_manifest->'allowedTransitions')='array'
      and version.identity_manifest_hash=encode(extensions.digest(convert_to(
        version.identity_manifest::text,'UTF8'),'sha256'),'hex')
  ),
  'GQC-WORLD-002/003: the deity candidate stores the exact measurable manifest and canonical content hash'
);
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb,%L)',
  'b1820000-0000-4000-8000-000000000099',
  (select value from world_fixture where key='shiva_identity_manifest'),repeat('f',64)
 ),'22023','character identity manifest hash does not match canonical content',
 'GQC-WORLD-002: a manifest hash must match its canonical JSON content');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{form}',(value::jsonb->'form')-'topology')::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: form keys must be exact',
 'GQC-WORLD-003: deity topology is explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{deity}',(value::jsonb->'deity')-'arms')::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: deity keys must be exact',
 'GQC-WORLD-003: deity arms are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{deity}',
      (value::jsonb->'deity')-'handObjectAssignments')::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: deity keys must be exact',
 'GQC-WORLD-003: deity hand-object assignments are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{deity}',(value::jsonb->'deity')-'vahana')::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: deity keys must be exact',
 'GQC-WORLD-003: a deity vahana or explicit none value is required');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{deity}',(value::jsonb->'deity')-'weapons')::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: deity keys must be exact',
 'GQC-WORLD-003: deity weapons are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select (value::jsonb-'ornaments')::text from world_fixture
    where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: top-level keys must be exact for schema v2',
 'GQC-WORLD-002/003: ornament rules are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select (value::jsonb-'wardrobe')::text from world_fixture
    where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: top-level keys must be exact for schema v2',
 'GQC-WORLD-002: wardrobe rules are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select (value::jsonb-'skin')::text from world_fixture
    where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: top-level keys must be exact for schema v2',
 'GQC-WORLD-002/003: skin tone and form rules are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{form}',(value::jsonb->'form')-'rules')::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: form keys must be exact',
 'GQC-WORLD-002: form rules are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select (value::jsonb-'dignity')::text from world_fixture
    where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: top-level keys must be exact for schema v2',
 'GQC-WORLD-003: dignity rules are explicit');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select (value::jsonb-'allowedTransitions')::text from world_fixture
    where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: top-level keys must be exact for schema v2',
 'GQC-WORLD-003: allowed form transitions are explicit even when none are allowed');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(jsonb_set(value::jsonb,'{form,topology,armCount}','3'::jsonb),
      '{form,topology,handCount}','3'::jsonb)::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: deity arms must enumerate the topology arm count',
 'GQC-WORLD-003: declared arms exactly match topology counts');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{deity,weapons}','[]'::jsonb)::text
    from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest is invalid: held deity weapons must appear in weapons',
 'GQC-WORLD-003: hand-object weapon assignments resolve to the explicit weapon list');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select value from world_fixture where key='shiva_identity_manifest')
 ),'22023','character identity manifest does not match its character form',
 'GQC-WORLD-002: manifest identity keys and names bind to the exact character form row');
select throws_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select jsonb_set(value::jsonb,'{deity}',
      (select value::jsonb->'deity' from world_fixture
        where key='shiva_identity_manifest'))::text
    from world_fixture where key='non_deity_identity_manifest')
 ),'22023','character identity manifest is invalid: non-deity manifests must set deity to null',
 'GQC-WORLD-002: non-deity manifests cannot claim deity-only anatomy or attributes');
select lives_ok(format(
  'select pg_temp.record_contract_character_manifest(%L,%L::jsonb)',
  'b1820000-0000-4000-8000-000000000099',
  (select value from world_fixture where key='non_deity_identity_manifest')
 ),'GQC-WORLD-002: a measurable non-deity manifest records deity as not applicable');
select ok(
  exists(select 1 from public.character_versions version
    where version.id='b1820000-0000-4000-8000-000000000099'
      and not (version.identity_manifest->>'isDeity')::boolean
      and jsonb_typeof(version.identity_manifest->'deity')='null'
      and jsonb_typeof(version.identity_manifest->'ornaments')='array'
      and version.identity_manifest_hash=encode(extensions.digest(convert_to(
        version.identity_manifest::text,'UTF8'),'sha256'),'hex')),
  'GQC-WORLD-002: the stored non-deity manifest remains explicit and content-bound'
);

reset role;
select throws_ok(
  $$update public.character_versions
    set identity_manifest_hash=repeat('0',64)
    where id='b1820000-0000-4000-8000-000000000001'$$,
  '55000','immutable record cannot be updated or deleted',
  'P2-08: accepted media-version identity manifests are immutable'
);

set local session_replication_role=replica;
delete from public.character_selections
where character_form_id='b1810000-0000-4000-8000-000000000099';
delete from public.character_versions
where id='b1820000-0000-4000-8000-000000000099';
delete from public.character_forms
where id='b1810000-0000-4000-8000-000000000099';
delete from public.characters
where id='b1800000-0000-4000-8000-000000000099';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select is((select state from public.character_selections),'review_required','the initial character waits for human review');
select lives_ok(format(
 'select public.command_record_character_candidate(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,null)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1800000-0000-4000-8000-000000000001','b1810000-0000-4000-8000-000000000001',
 'shiva','Shiva','mahadeva','Mahadeva','b1820000-0000-4000-8000-000000000006',
 'generated','Retry Shiva portrait',encode(extensions.digest(convert_to('Retry Shiva portrait','UTF8'),'sha256'),'hex'),
 'no drift','b1720000-0000-4000-8000-000000000002',
 (select value from world_fixture where key='shiva_identity_manifest'),
 encode(extensions.digest(convert_to((select value::jsonb from world_fixture
   where key='shiva_identity_manifest')::text,'UTF8'),'sha256'),'hex')
 ),'a fresh fenced World retry can replace an unaccepted generated character candidate');
select ok(
  exists(
    select 1
    from public.character_selections
    where configuration_candidate_id='b1600000-0000-4000-8000-000000000001'
      and character_form_id='b1810000-0000-4000-8000-000000000001'
      and candidate_version_id='b1820000-0000-4000-8000-000000000006'
      and selected_version_id is null
      and state='review_required'
      and aggregate_version=2
  ),
  'the retry replaces only the review candidate and advances its aggregate fence'
);
reset role;
set local session_replication_role=replica;
update public.character_selections
set candidate_version_id='b1820000-0000-4000-8000-000000000001',
  selected_version_id=null,
  state='review_required',
  aggregate_version=1
where configuration_candidate_id='b1600000-0000-4000-8000-000000000001'
  and character_form_id='b1810000-0000-4000-8000-000000000001';
delete from public.character_versions
where id='b1820000-0000-4000-8000-000000000006';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(format(
 'select public.command_decide_world_candidate(%L,%L,%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001','character',
 'b1810000-0000-4000-8000-000000000001','b1820000-0000-4000-8000-000000000001','accept','',repeat('0',64),
 'b1900000-0000-4000-8000-000000000001','world-accept-001',repeat('1',64),'b1910000-0000-4000-8000-000000000001'
 ),'the user accepts the exact character candidate');
select is((select state from public.character_selections),'accepted','acceptance changes only the selection envelope');
select is((select selected_version_id from public.character_selections),'b1820000-0000-4000-8000-000000000001'::uuid,'the selected identity is exact');
select lives_ok($sql$
insert into world_fixture(key,value)
select 'regeneration',public.command_decide_world_candidate(
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001','character',
 'b1810000-0000-4000-8000-000000000001','b1820000-0000-4000-8000-000000000001',2,'regenerate',
 'Shiva portrait with calmer eyes',encode(extensions.digest(convert_to('Shiva portrait with calmer eyes','UTF8'),'sha256'),'hex'),
 'b1900000-0000-4000-8000-000000000002','world-regenerate-001',repeat('2',64),'b1910000-0000-4000-8000-000000000002'
)::text
$sql$,'the accepted identity queues one exact replacement request');
select is((select state from public.character_selections),'generating','an accepted identity can be reopened for a replacement');
select is((select selected_version_id from public.character_selections),'b1820000-0000-4000-8000-000000000001'::uuid,'the accepted version remains the active fallback while generating');
reset role;
set local role service_role;
select is((select count(*)::integer from private.outbox_events where event_type='world.asset.regeneration_requested.v1'),1,'one regeneration request creates one durable dispatch');

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select throws_ok(format(
 'select public.command_record_character_candidate(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1800000-0000-4000-8000-000000000001','b1810000-0000-4000-8000-000000000001',
 'shiva','Shiva','mahadeva','Mahadeva','b1820000-0000-4000-8000-000000000002',
 'generated','Shiva portrait with calmer eyes',encode(extensions.digest(convert_to('Shiva portrait with calmer eyes','UTF8'),'sha256'),'hex'),
 'no drift','b1720000-0000-4000-8000-000000000002',
 (select value from world_fixture where key='shiva_identity_manifest'),
 encode(extensions.digest(convert_to((select value::jsonb from world_fixture
   where key='shiva_identity_manifest')::text,'UTF8'),'sha256'),'hex'),
 'b1930000-0000-4000-8000-000000000099'
 ),'40001','character generation response is stale','an unrelated request cannot replace the accepted candidate');
select lives_ok(format(
 'select public.command_record_character_candidate(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1800000-0000-4000-8000-000000000001','b1810000-0000-4000-8000-000000000001',
 'shiva','Shiva','mahadeva','Mahadeva','b1820000-0000-4000-8000-000000000002',
 'generated','Shiva portrait with calmer eyes',encode(extensions.digest(convert_to('Shiva portrait with calmer eyes','UTF8'),'sha256'),'hex'),
 'no drift','b1720000-0000-4000-8000-000000000002',
 (select value from world_fixture where key='shiva_identity_manifest'),
 encode(extensions.digest(convert_to((select value::jsonb from world_fixture
   where key='shiva_identity_manifest')::text,'UTF8'),'sha256'),'hex'),
 ((select value::jsonb from world_fixture where key='regeneration')->>'regenerationRequestId')
 ),'the bound generation response creates a new immutable version');
select is((select selected_version_id from public.character_selections),'b1820000-0000-4000-8000-000000000001'::uuid,'reviewing a replacement preserves the prior selection');

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(format(
 'select public.command_decide_world_candidate(%L,%L,%L,%L,%L,4,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001','character',
 'b1810000-0000-4000-8000-000000000001','b1820000-0000-4000-8000-000000000002','accept','',repeat('0',64),
 'b1900000-0000-4000-8000-000000000003','world-accept-002',repeat('3',64),'b1910000-0000-4000-8000-000000000003'
 ),'the replacement can become the selected version');
select is((select count(*)::integer from public.character_versions),2,'replacement preserves both immutable character versions');

-- V-P2-007: execute the authenticated replacement-upload boundary and the
-- service completion boundary, then select the exact immutable upload version.
select lives_ok(format(
 'select public.command_prepare_world_upload(%L,%L,%L,%L,%L,5,%L,%L,%L,%L,%L,1000,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'character','b1810000-0000-4000-8000-000000000001','b1820000-0000-4000-8000-000000000002',
 'b1940000-0000-4000-8000-000000000001','b1930000-0000-4000-8000-000000000005',
 'b1700000-0000-4000-8000-000000000005','b1730000-0000-4000-8000-000000000005',
 'image/png',repeat('5',64),'shiva-upload.png','b1900000-0000-4000-8000-000000000005',
 'world-upload-0001',repeat('6',64),'b1910000-0000-4000-8000-000000000005'
 ),'V-P2-007: an accepted character can enter the exact replacement-upload workflow');

reset role;
set local session_replication_role=replica;
insert into public.assets(id,workspace_id,asset_kind) values(
 'b1700000-0000-4000-8000-000000000005','b1100000-0000-4000-8000-000000000001','character_anchor'
);
insert into public.asset_versions(
 id,workspace_id,asset_id,version_number,source_quarantine_version_id,bucket_id,
 object_name,storage_version,content_sha256,media_mime,byte_length,policy_version_id,
 provenance_hash
) values(
 'b1720000-0000-4000-8000-000000000005','b1100000-0000-4000-8000-000000000001',
 'b1700000-0000-4000-8000-000000000005',1,'b1730000-0000-4000-8000-000000000005',
 'workspace-media',
 'b1100000-0000-4000-8000-000000000001/character_anchor/b1700000-0000-4000-8000-000000000005/b1720000-0000-4000-8000-000000000005/source',
 'v1',repeat('7',64),'image/png',900,'b1710000-0000-4000-8000-000000000001',repeat('8',64)
);
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok(format(
 'select public.command_mark_world_upload_scanning(%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1940000-0000-4000-8000-000000000001'
 ),'V-P2-007: the registered replacement upload enters the scanning state');
select lives_ok(format(
 'select public.command_complete_world_upload(%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1940000-0000-4000-8000-000000000001',
 'b1720000-0000-4000-8000-000000000005','b1820000-0000-4000-8000-000000000005'
 ),'V-P2-007: the promoted replacement creates a new immutable uploaded character version');
select ok(
  (select source_kind='uploaded'
      and anchor_asset_version_id='b1720000-0000-4000-8000-000000000005'
      and version_number=3
    from public.character_versions
    where id='b1820000-0000-4000-8000-000000000005')
  and (select count(*)=3 from public.character_versions
    where character_form_id='b1810000-0000-4000-8000-000000000001'),
  'V-P2-007: upload completion adds exactly one version with exact promoted-asset provenance'
);
select ok(
  exists(select 1 from public.character_versions
    where id='b1820000-0000-4000-8000-000000000002'
      and identity_manifest_hash=encode(extensions.digest(convert_to(
        (select value::jsonb from world_fixture
          where key='shiva_identity_manifest')::text,'UTF8'),'sha256'),'hex')
      and prompt_sha256=encode(extensions.digest(
        convert_to('Shiva portrait with calmer eyes','UTF8'),'sha256'),'hex')),
  'V-P2-007: the original accepted version and both immutable hashes remain exact'
);

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(format(
 'select public.command_decide_world_candidate(%L,%L,%L,%L,%L,7,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001','character',
 'b1810000-0000-4000-8000-000000000001','b1820000-0000-4000-8000-000000000005','accept','',repeat('0',64),
 'b1900000-0000-4000-8000-000000000006','world-upload-accept',repeat('9',64),'b1910000-0000-4000-8000-000000000006'
 ),'V-P2-007: the reviewer accepts the exact uploaded replacement candidate');
select is(
  (select selected_version_id from public.character_selections
    where configuration_candidate_id='b1600000-0000-4000-8000-000000000001'
      and character_form_id='b1810000-0000-4000-8000-000000000001'),
  'b1820000-0000-4000-8000-000000000005'::uuid,
  'V-P2-007: selection resolves to the exact new immutable upload version'
);

-- Restore the original accepted World fixture before building its reference
-- pack; the enclosing transaction still rolls back the entire suite.
reset role;
set local session_replication_role=replica;
update public.character_selections
set candidate_version_id='b1820000-0000-4000-8000-000000000002',
  selected_version_id='b1820000-0000-4000-8000-000000000002',
  state='accepted',aggregate_version=5
where configuration_candidate_id='b1600000-0000-4000-8000-000000000001'
  and character_form_id='b1810000-0000-4000-8000-000000000001';
delete from private.world_asset_decisions
where version_id='b1820000-0000-4000-8000-000000000005';
delete from public.character_versions
where id='b1820000-0000-4000-8000-000000000005';
delete from private.world_upload_intakes
where id='b1940000-0000-4000-8000-000000000001';
delete from private.world_regeneration_requests
where id='b1930000-0000-4000-8000-000000000005';
delete from public.asset_versions
where id='b1720000-0000-4000-8000-000000000005';
delete from public.assets
where id='b1700000-0000-4000-8000-000000000005';
set local session_replication_role=origin;

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select throws_ok(format(
 'select public.command_record_location_candidate(%L,%L,%L,%L,%L,true,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,null,null)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1840000-0000-4000-8000-000000000001','kedarnath','Kedarnath Temple','Kedarnath, Uttarakhand',
 'b1850000-0000-4000-8000-000000000001','generated','Empty Kedarnath courtyard',
 encode(extensions.digest(convert_to('Empty Kedarnath courtyard','UTF8'),'sha256'),'hex'),'no people',
 'b1720000-0000-4000-8000-000000000003','{"namedTemple":true}',repeat('c',64)
 ),'22023','location candidate envelope is invalid','V-P2-009: a named temple cannot omit its required provenance evidence-set hash');
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-009: missing named-temple provenance creates no release, run, authority, reservation, or production outbox event'
);
select lives_ok(format(
 'select public.command_record_location_candidate(%L,%L,%L,%L,%L,true,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%L,null)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1840000-0000-4000-8000-000000000001','kedarnath','Kedarnath Temple','Kedarnath, Uttarakhand',
 'b1850000-0000-4000-8000-000000000001','generated','Empty Kedarnath courtyard',
 encode(extensions.digest(convert_to('Empty Kedarnath courtyard','UTF8'),'sha256'),'hex'),'no people',
  'b1720000-0000-4000-8000-000000000003','{"namedTemple":true}',repeat('c',64),repeat('d',64)
 ),'a named temple candidate carries research provenance');
select lives_ok(format(
 'select public.command_record_location_candidate(%L,%L,%L,%L,%L,true,%L,%L,%L,%L,%L,%L,%L,%L::jsonb,%L,%L,null)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1840000-0000-4000-8000-000000000001','kedarnath','Kedarnath Temple','Kedarnath, Uttarakhand',
 'b1850000-0000-4000-8000-000000000002','generated','Retry empty Kedarnath courtyard',
 encode(extensions.digest(convert_to('Retry empty Kedarnath courtyard','UTF8'),'sha256'),'hex'),'no people',
 'b1720000-0000-4000-8000-000000000003','{"namedTemple":true}',repeat('c',64),repeat('d',64)
 ),'a fresh fenced World retry can replace an unaccepted generated location candidate');
select ok(
  exists(
    select 1
    from public.location_selections
    where configuration_candidate_id='b1600000-0000-4000-8000-000000000001'
      and location_id='b1840000-0000-4000-8000-000000000001'
      and candidate_version_id='b1850000-0000-4000-8000-000000000002'
      and selected_version_id is null
      and state='review_required'
      and aggregate_version=2
  ),
  'the location retry replaces only the review candidate and advances its aggregate fence'
);
reset role;
set local session_replication_role=replica;
update public.location_selections
set candidate_version_id='b1850000-0000-4000-8000-000000000001',
  selected_version_id=null,
  state='review_required',
  aggregate_version=1
where configuration_candidate_id='b1600000-0000-4000-8000-000000000001'
  and location_id='b1840000-0000-4000-8000-000000000001';
delete from public.location_versions
where id='b1850000-0000-4000-8000-000000000002';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(format(
 'select public.command_decide_world_candidate(%L,%L,%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001','location',
 'b1840000-0000-4000-8000-000000000001','b1850000-0000-4000-8000-000000000001','accept','',repeat('0',64),
 'b1900000-0000-4000-8000-000000000004','world-location-accept',repeat('4',64),'b1910000-0000-4000-8000-000000000004'
 ),'the exact empty-location anchor is accepted');

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select throws_ok(format(
 'select public.command_record_world_reference_pack(%L,%L,%L,%L,%L::jsonb,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1860000-0000-4000-8000-000000000001',repeat('1',64),'{}',repeat('2',64),repeat('3',64),'verified'
 ),'40001','world reference pack prerequisites are incomplete','a verified pack cannot bypass the character sheet');
select lives_ok(format(
 'select public.command_record_character_sheet(%L,%L,%L,%L,%L,%L::jsonb,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1820000-0000-4000-8000-000000000002',
 'b1870000-0000-4000-8000-000000000001','b1720000-0000-4000-8000-000000000004',
 'fal.character-sheet.v1','{"views":["front","profile","back"]}',repeat('4',64),repeat('5',64),'verified'
 ),'a provider-compatible verified character sheet is immutable');
select lives_ok(format(
 'select public.command_record_world_reference_pack(%L,%L,%L,%L,%L::jsonb,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 'b1860000-0000-4000-8000-000000000001',repeat('6',64),'{"characters":1,"locations":1}',repeat('7',64),repeat('8',64),'verified'
 ),'the complete selected world produces one verified reference pack');
select is((select count(*)::integer from public.cultural_policy_rules where non_overridable),6,'launch cultural policy contains six non-overridable rules');

select throws_ok(format(
 'select public.command_record_source_version(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
 'b2000000-0000-4000-8000-000000000099','b2010000-0000-4000-8000-000000000099',
 'b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001',
 'model-lead','model_lead','Model answer','Hindi','','https://example.org/lead','archive:lead',
 'A lead','none','uncertain','verified','none',repeat('1',64),repeat('2',64),'agent:test'
 ),'22023','source version envelope is invalid','model output cannot promote itself into verified evidence');

select lives_ok(format(
 'select public.command_record_source_version(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
 'b2000000-0000-4000-8000-000000000001','b2010000-0000-4000-8000-000000000001',
 'b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001',
 'kedarnath-geometry','rights_cleared_photography','Kedarnath geometry','Hindi','','https://example.org/kedarnath-1','archive:kedarnath:1',
 'Temple geometry','licensed photo','licensed','verified','none',repeat('3',64),repeat('4',64),'source:research'
 ),'the first temple source is verified');
select lives_ok(format(
 'select public.command_record_source_version(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
 'b2000000-0000-4000-8000-000000000002','b2010000-0000-4000-8000-000000000002',
 'b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001',
 'kedarnath-architecture','temple_institutional','Kedarnath architecture','Hindi','','https://example.org/kedarnath-2','archive:kedarnath:2',
 'Temple architecture','institutional use','factual_reference_only','verified','none',repeat('5',64),repeat('6',64),'source:research'
 ),'the second independent temple source is verified');
select lives_ok(format(
 'select public.command_record_source_version(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L)',
 'b2000000-0000-4000-8000-000000000003','b2010000-0000-4000-8000-000000000003',
 'b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001',
 'shiva-form','primary_text','Shiva form source','Sanskrit','Edition 1','https://example.org/shiva','archive:shiva:1',
 'Two-armed form','public domain','public_domain','verified','none',repeat('7',64),repeat('8',64),'source:research'
 ),'the deity-form source is verified');

insert into world_fixture(key,value)
select 'policy_id',id::text from public.cultural_policy_versions where state='active';
insert into world_fixture(key,value)
select 'packet_one',public.command_record_source_review_packet(
 'b2100000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
 'b1300000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 (select value::uuid from world_fixture where key='policy_id'),repeat('9',64),repeat('a',64),repeat('b',64),
 'shaiva','uttarakhand','Hindi',array['deity_form','temple'],array['temple_tradition'],
 'eligible',repeat('c',64),
 jsonb_build_array(
  jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000001','claimClass','temple','subjectKind','location_version','subjectId','b1850000-0000-4000-8000-000000000001','evidenceRole','geometry'),
  jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000002','claimClass','temple','subjectKind','location_version','subjectId','b1850000-0000-4000-8000-000000000001','evidenceRole','architecture'),
  jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000003','claimClass','deity_form','subjectKind','character_version','subjectId','b1820000-0000-4000-8000-000000000002','evidenceRole','form')
 ),'[]'::jsonb
)::text;
select is((select status from public.source_review_statuses where source_review_packet_id='b2100000-0000-4000-8000-000000000001'),'pending_qualified_review','machine readiness never self-approves a source packet');

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(format(
 'select public.command_appoint_cultural_reviewer(%L,%L,%L::text[],%L::text[],%L::text[],%L::text[],%L,%L,statement_timestamp(),statement_timestamp()+interval ''1 year'',%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000001',
 '{all}','{all}','{all}','{all}','Zyra owner appointment',repeat('d',64),
 'b2200000-0000-4000-8000-000000000099','competency-aal1',repeat('e',64),'b2210000-0000-4000-8000-000000000099'
 ),'42501','AAL2 authenticated authority required','competency activation remains strict AAL2 team administration');

select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
insert into world_fixture(key,value)
select 'competency_one',public.command_appoint_cultural_reviewer(
 'b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000001',
 array['all'],array['all'],array['all'],array['all'],'Zyra owner appointment',repeat('d',64),
 statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 year',
 'b2200000-0000-4000-8000-000000000001','competency-one',repeat('1',64),'b2210000-0000-4000-8000-000000000001'
)::text;
select is(((select value::jsonb from world_fixture where key='competency_one')->>'status'),'active','an AAL2 admin explicitly activates broad launch competency');

insert into world_fixture(key,value)
select 'competency_expired',public.command_appoint_cultural_reviewer(
 'b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000002',
 array['all'],array['all'],array['all'],array['all'],'Expired appointment fixture',repeat('f',64),
 statement_timestamp()-interval '2 years',statement_timestamp()-interval '1 year',
 'b2200000-0000-4000-8000-000000000003','competency-expired',repeat('a',64),'b2210000-0000-4000-8000-000000000003'
)::text;

select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000002',true);
insert into world_fixture(key,value)
select 'competency_two',public.command_appoint_cultural_reviewer(
 'b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000002',
 array['all'],array['all'],array['all'],array['all'],'Zyra second appointment',repeat('e',64),
 statement_timestamp()-interval '1 minute',statement_timestamp()+interval '1 year',
 'b2200000-0000-4000-8000-000000000002','competency-two',repeat('2',64),'b2210000-0000-4000-8000-000000000002'
)::text;
select is(((select value::jsonb from world_fixture where key='competency_two')->>'status'),'active','a second reviewer has independently scoped competency');
insert into world_fixture(key,value)
select 'scope_two',encode(extensions.digest(convert_to(
 array_to_string(competency.traditions,',')||':'||array_to_string(competency.regions,',')||':'||
 array_to_string(competency.languages,',')||':'||array_to_string(competency.content_classes,',')||':'||
 competency.appointment_evidence_hash,'UTF8'),'sha256'),'hex')
from public.reviewer_competency_versions competency
where competency.id=((select value::jsonb from world_fixture where key='competency_two')->>'competencyVersionId')::uuid;

insert into world_fixture(key,value)
select 'scope_expired',encode(extensions.digest(convert_to(
 array_to_string(competency.traditions,',')||':'||array_to_string(competency.regions,',')||':'||
 array_to_string(competency.languages,',')||':'||array_to_string(competency.content_classes,',')||':'||
 competency.appointment_evidence_hash,'UTF8'),'sha256'),'hex')
from public.reviewer_competency_versions competency
where competency.id=((select value::jsonb from world_fixture where key='competency_expired')->>'competencyVersionId')::uuid;

select throws_ok(format(
 'select public.command_submit_source_review(%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000001',
 'b2200000-0000-4000-8000-000000000099','approve','missing competency must not publish',repeat('0',64),
 'b2300000-0000-4000-8000-000000000010','review-missing-competency',repeat('b',64),'b2310000-0000-4000-8000-000000000010'
 ),'42501','qualified source review authority is unavailable',
 'V-P2-018: publication rejects a reviewer with no exact competency');
reset role;
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-018: missing competency creates no release, run, authority, reservation, or production outbox event'
);

select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(format(
 'select public.command_submit_source_review(%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000001',
 ((select value::jsonb from world_fixture where key='competency_expired')->>'competencyVersionId'),
 'approve','expired competency must not publish',(select value from world_fixture where key='scope_expired'),
 'b2300000-0000-4000-8000-000000000011','review-expired-competency',repeat('c',64),'b2310000-0000-4000-8000-000000000011'
 ),'42501','qualified source review authority is unavailable',
 'V-P2-018: publication rejects an expired exact reviewer competency');
reset role;
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-018: expired competency creates no release, run, authority, reservation, or production outbox event'
);

set local session_replication_role=replica;
update public.memberships
set status='deactivated',deactivated_at=statement_timestamp()
where workspace_id='b1100000-0000-4000-8000-000000000001'
  and user_id='b1200000-0000-4000-8000-000000000002';
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(format(
 'select public.command_submit_source_review(%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000001',
 ((select value::jsonb from world_fixture where key='competency_two')->>'competencyVersionId'),
 'approve','deactivated reviewer must not publish',(select value from world_fixture where key='scope_two'),
 'b2300000-0000-4000-8000-000000000012','review-deactivated-member',repeat('d',64),'b2310000-0000-4000-8000-000000000012'
 ),'42501','active workspace session required',
 'V-P2-018: publication rejects a deactivated otherwise-qualified reviewer');
reset role;
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-018: deactivated reviewer creates no release, run, authority, reservation, or production outbox event'
);

set local session_replication_role=replica;
update public.memberships
set status='active',deactivated_at=null
where workspace_id='b1100000-0000-4000-8000-000000000001'
  and user_id='b1200000-0000-4000-8000-000000000002';
set local session_replication_role=origin;

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
insert into public.reviewer_recusals(workspace_id,reviewer_user_id,subject_kind,subject_id,reason,effective_at)
values('b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000002','series','b1300000-0000-4000-8000-000000000001','conflict fixture',statement_timestamp()-interval '1 minute');

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(format(
 'select public.command_submit_source_review(%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000001',
 ((select value::jsonb from world_fixture where key='competency_two')->>'competencyVersionId'),
 'approve','recused approval',(select value from world_fixture where key='scope_two'),'b2300000-0000-4000-8000-000000000002','review-two',repeat('3',64),'b2310000-0000-4000-8000-000000000002'
 ),'42501','reviewer recusal applies to this subject',
 'V-P2-018: publication rejects a recused otherwise-qualified reviewer');
reset role;
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-018: recusal creates no release, run, authority, reservation, or production outbox event'
);

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
insert into world_fixture(key,value)
select 'scope_one',encode(extensions.digest(convert_to(
 array_to_string(competency.traditions,',')||':'||array_to_string(competency.regions,',')||':'||
 array_to_string(competency.languages,',')||':'||array_to_string(competency.content_classes,',')||':'||
 competency.appointment_evidence_hash,'UTF8'),'sha256'),'hex')
from public.reviewer_competency_versions competency
where competency.id=((select value::jsonb from world_fixture where key='competency_one')->>'competencyVersionId')::uuid;

-- Complete one exact executable plan and prove that the late World Lock
-- transaction is all-or-nothing before sealing the authoritative run.
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok($sql$
  select public.command_ensure_video_production_profile(
    'b1100000-0000-4000-8000-000000000001','preview',
    'kling-2.5-simple-camera-subject',
    '89719e9bbf2864ef733e61182f87c3884ad4fcce269cd3fb304aa37ea9207ae2',
    '979783417dfb1e319ffbf84bdafb878ec32f305aa70b7d926fcb728d0dd00f52',
    '28e7f619a30bd4c4f16e4ba48e9208896beb80caa7db23d4a62a09dd99b436f4',
    'd23838b52b03f64e40f3b67850a4df5dc53664003dc6e25c8d8c8f23db9a38db',
    '0bbe010c183d0d1b3eb38a4dbd62a71f7fd71a648234011cb1e349462c7df084',
    '20c63f9d979b379afb093e2f09b40fba4d17c2e6347b4c2f320d3bacd74ce50d',
    '2026-07-19T13:06:06.255Z','2026-10-17T13:06:06.255Z'
  )
$sql$,'World Lock uses one current authenticated vertical-video capability');
select is(
  jsonb_array_length(public.command_ensure_production_allowance_rates(
    'b1100000-0000-4000-8000-000000000001')),
  8,'the integration quote carries every mandatory production allowance'
);
select public.command_record_authenticated_voice_canary(
  configuration.voice_version_id,
  configuration.external_voice_id,
  'eleven_multilingual_v2',
  'mp3_44100_128',
  repeat('1',64),
  repeat('2',64),
  repeat('3',64),
  repeat('4',64),
  4096,
  statement_timestamp(),
  statement_timestamp() + interval '30 days',
  'b2360000-0000-4000-8000-000000000001',
  'world-voice-canary-001',
  repeat('5',64)
)
from private.voice_provider_configurations configuration
where configuration.voice_version_id = (
  select candidate.voice_version_id
  from public.episode_configuration_candidates candidate
  where candidate.id = 'b1600000-0000-4000-8000-000000000001'
);

reset role;
set local session_replication_role=replica;
insert into private.aggregate_versions(workspace_id,aggregate_type,aggregate_id,current_version)
values('b1100000-0000-4000-8000-000000000001','series','b1300000-0000-4000-8000-000000000001',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'));
update private.aggregate_versions set current_version=(select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001')
where aggregate_type='episode' and aggregate_id='b1400000-0000-4000-8000-000000000001';
update public.episodes set workflow_state='world_setup'
where id='b1400000-0000-4000-8000-000000000001';
update private.aggregate_versions set current_version=(select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001')
where aggregate_type='episode' and aggregate_id='b1400000-0000-4000-8000-000000000001';
update public.episode_configuration_candidates set state='ready_to_lock'
where id='b1600000-0000-4000-8000-000000000001';
insert into public.script_lock_events(
  id,workspace_id,episode_id,script_revision_id,raw_utf8_sha256,actor_user_id,
  actor_authority_epoch,duration_acknowledged,command_id,correlation_id
) values(
  'b2350000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000001','b1500000-0000-4000-8000-000000000001',
  (select raw_utf8_sha256 from public.script_revisions where id='b1500000-0000-4000-8000-000000000001'),
  'b1200000-0000-4000-8000-000000000001',1,false,
  'b2350000-0000-4000-8000-000000000002','b2350000-0000-4000-8000-000000000003'
);
insert into public.preflight_runs(
  id,workspace_id,episode_id,configuration_candidate_id,script_revision_id,kind,
  run_number,authority_epoch,state,requires_micro_authority,trigger_run_id,
  started_at,completed_at
) values(
  'b2400000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b1400000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b1500000-0000-4000-8000-000000000001','plan_evaluation',1,1,'succeeded',false,
  'run_world_lock_fixture',statement_timestamp(),statement_timestamp()
);
insert into public.preflight_stage_runs(
  id,workspace_id,preflight_run_id,stage_key,queue_key,state,next_attempt_no,
  highest_fencing_token,input_manifest_id,input_manifest_hash,output_manifest_id,
  output_manifest_hash,completed_at
) values(
  'b2410000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b2400000-0000-4000-8000-000000000001','plan_evaluation',
  'genie-preflight-plan-evaluation','succeeded',2,1,
  'b2430000-0000-4000-8000-000000000001',repeat('1',64),
  'b2430000-0000-4000-8000-000000000002',repeat('2',64),statement_timestamp()
);
insert into public.preflight_stage_attempts(
  id,workspace_id,preflight_run_id,preflight_stage_run_id,attempt_no,authority_epoch,
  fencing_token,input_manifest_id,input_manifest_hash,state,trigger_task_id,
  trigger_run_id,output_manifest_id,output_manifest_hash,started_at,completed_at
) values(
  'b2420000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b2400000-0000-4000-8000-000000000001','b2410000-0000-4000-8000-000000000001',
  1,1,1,'b2430000-0000-4000-8000-000000000001',repeat('1',64),'succeeded',
  'genie-preflight-plan-evaluation-v1','run_world_lock_fixture',
  'b2430000-0000-4000-8000-000000000002',repeat('2',64),statement_timestamp(),statement_timestamp()
);
insert into private.world_extraction_results(
  id,workspace_id,preflight_run_id,stage_attempt_id,configuration_candidate_id,
  script_revision_id,script_sha256,look_version_id,schema_version,extraction_json,
  extraction_hash,model_key,model_request_hash,provider_response_id_hash,
  provider_request_id_hash
)
select
  'b2450000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b2400000-0000-4000-8000-000000000001','b2420000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000001','b1500000-0000-4000-8000-000000000001',
  (select raw_utf8_sha256 from public.script_revisions where id='b1500000-0000-4000-8000-000000000001'),
  (select look_version_id from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  'genie.world-extraction.v1',extraction.payload,
  encode(extensions.digest(convert_to(extraction.payload::text,'UTF8'),'sha256'),'hex'),
  'gpt-5.6-sol',repeat('d',64),repeat('e',64),repeat('f',64)
from (select jsonb_build_object(
  'schemaVersion','genie.world-extraction.v1',
  'characters',jsonb_build_array(jsonb_build_object('entityId','shiva')),
  'locations',jsonb_build_array(jsonb_build_object('entityId','kedarnath'))
) as payload) extraction;
with exact as (
  select packet.id,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'scriptSha256',script.raw_utf8_sha256,
      'extractionHash',extraction.extraction_hash,
      'worldReferencePackHash',pack.manifest_hash,
      'culturalPolicyHash',policy.manifest_hash
    )::text,'UTF8'),'sha256'),'hex') as subject_hash,
    encode(extensions.digest(convert_to(jsonb_build_array(
      jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000001','claimClass','temple','subjectKind','location_version','subjectId','b1850000-0000-4000-8000-000000000001','evidenceRole','geometry'),
      jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000002','claimClass','temple','subjectKind','location_version','subjectId','b1850000-0000-4000-8000-000000000001','evidenceRole','architecture'),
      jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000003','claimClass','deity_form','subjectKind','character_version','subjectId','b1820000-0000-4000-8000-000000000002','evidenceRole','form')
    )::text,'UTF8'),'sha256'),'hex') as source_set_hash,
    encode(extensions.digest(convert_to('[]'::jsonb::text,'UTF8'),'sha256'),'hex') as evidence_set_hash,
    policy.manifest_hash as policy_hash
  from public.source_review_packets packet
  join public.script_revisions script on script.id=packet.script_revision_id
  join private.world_extraction_results extraction
    on extraction.configuration_candidate_id=packet.configuration_candidate_id
  join public.world_reference_pack_versions pack
    on pack.configuration_candidate_id=packet.configuration_candidate_id and pack.state='verified'
  join public.cultural_policy_versions policy on policy.id=packet.policy_version_id
  where packet.id='b2100000-0000-4000-8000-000000000001'
)
update public.source_review_packets packet set
  subject_hash=exact.subject_hash,
  source_set_hash=exact.source_set_hash,
  evidence_set_hash=exact.evidence_set_hash,
  machine_evidence_hash=encode(extensions.digest(convert_to(jsonb_build_object(
    'schemaVersion','genie.source-cultural-machine-evidence.v1',
    'subjectHash',exact.subject_hash,
    'sourceSetHash',exact.source_set_hash,
    'evidenceSetHash',exact.evidence_set_hash,
    'policyHash',exact.policy_hash
  )::text,'UTF8'),'sha256'),'hex')
from exact where packet.id=exact.id;
insert into public.source_review_packet_world_bindings(
  source_review_packet_id,workspace_id,configuration_candidate_id,
  world_reference_pack_version_id,world_extraction_result_id,script_sha256,
  extraction_hash,world_reference_pack_hash,cultural_policy_hash,subject_hash
)
select packet.id,packet.workspace_id,packet.configuration_candidate_id,
  pack.id,extraction.id,script.raw_utf8_sha256,extraction.extraction_hash,
  pack.manifest_hash,policy.manifest_hash,packet.subject_hash
from public.source_review_packets packet
join public.script_revisions script on script.id=packet.script_revision_id
join private.world_extraction_results extraction
  on extraction.configuration_candidate_id=packet.configuration_candidate_id
join public.world_reference_pack_versions pack
  on pack.configuration_candidate_id=packet.configuration_candidate_id and pack.state='verified'
join public.cultural_policy_versions policy on policy.id=packet.policy_version_id
where packet.id='b2100000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(coalesce(recorded.result->>'machineState','__missing__'),'eligible',
  'the complete World fixture records its exact P2-09 cultural bundle before qualified approval')
from (
with claims as (
  select jsonb_agg(jsonb_build_object(
    'category',required.category,
    'applicability','not_present',
    'claims','[]'::jsonb,
    'evidenceHash',repeat(substr(md5(required.category),1,1),64),
    'qualifiedReviewTriggered',false
  ) order by required.ordinal) as payload
  from unnest(array[
    'deity_attributes','traditions','named_temples','rituals','shlokas',
    'contested_retellings','violence_romance','caste_social_context',
    'rights_triggers'
  ]::text[]) with ordinality as required(category,ordinal)
), assessments as (
  select jsonb_agg(jsonb_build_object(
    'ruleCode',contract.rule_code,
    'verdict','eligible',
    'claimCategories','[]'::jsonb,
    'evidenceHash',repeat(substr(md5(contract.rule_code),1,1),64),
    'rationale','Exact all-clear World integration assessment.'
  ) order by contract.ordinal) as payload
  from public.p2_09_cultural_rule_contracts contract
), contract as (
  select encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object(
    'ruleCode',rule.rule_code,
    'ordinal',rule.ordinal,
    'effect',rule.effect,
    'nonOverridable',rule.non_overridable,
    'claimCategories',to_jsonb(rule.claim_categories),
    'allowedMachineStates',to_jsonb(rule.allowed_machine_states),
    'requirement',rule.requirement
  ) order by rule.ordinal)::text,'UTF8'),'sha256'),'hex') as hash
  from public.p2_09_cultural_rule_contracts rule
), recorded as (
  select public.command_record_p2_09_cultural_claim_bundle(
    'b1100000-0000-4000-8000-000000000001',
    'b2100000-0000-4000-8000-000000000001',
    'genie.p2-09-cultural-claims.v1',
    claims.payload,
    assessments.payload,
    encode(extensions.digest(convert_to(claims.payload::text,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to(assessments.payload::text,'UTF8'),'sha256'),'hex'),
    contract.hash
  ) as result
  from claims,assessments,contract
)
select result from recorded
) recorded;
reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(format(
 'select public.command_submit_source_review(%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000001',
 ((select value::jsonb from world_fixture where key='competency_one')->>'competencyVersionId'),
 'approve','evidence complete',(select value from world_fixture where key='scope_one'),
 'b2300000-0000-4000-8000-000000000001','review-one',repeat('4',64),'b2310000-0000-4000-8000-000000000001'
 ),'the qualified reviewer approves the exact complete source packet');
select is(
  (select status from public.source_review_statuses where source_review_packet_id='b2100000-0000-4000-8000-000000000001'),
  'approved',
  'qualified approval is a separate selected decision bound to the final World evidence hashes'
);
reset role;
set local session_replication_role=replica;
insert into public.pronunciation_lexicons(id,workspace_id,series_id,lexicon_key) values
  ('b2500000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001','world-lock-lexicon');
insert into public.pronunciation_lexicon_versions(
  id,workspace_id,pronunciation_lexicon_id,configuration_candidate_id,script_revision_id,
  voice_version_id,source_review_packet_id,version_number,manifest_hash,state
) values(
  'b2510000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b2500000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b1500000-0000-4000-8000-000000000001',
  (select voice_version_id from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  'b2100000-0000-4000-8000-000000000001',1,repeat('3',64),'verified'
);
insert into public.score_identities(id,workspace_id,series_id,identity_key) values
  ('b2500000-0000-4000-8000-000000000002','b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001','world-lock-score');
insert into public.score_identity_versions(
  id,workspace_id,score_identity_id,configuration_candidate_id,version_number,
  motif_manifest,motif_manifest_hash,tempo_min_bpm,tempo_max_bpm,instrument_rules,
  prohibited_rules,source_kind,license_status,license_evidence_hash,state
) values(
  'b2520000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b2500000-0000-4000-8000-000000000002','b1600000-0000-4000-8000-000000000001',
  1,'{"motif":"devotional"}',repeat('4',64),60,90,array['bansuri'],array['no kitsch'],
  'curated_library','internal_authorized',repeat('5',64),'verified'
);
insert into public.sound_identities(id,workspace_id,series_id,identity_key) values
  ('b2500000-0000-4000-8000-000000000003','b1100000-0000-4000-8000-000000000001','b1300000-0000-4000-8000-000000000001','world-lock-sound');
insert into public.sound_identity_versions(
  id,workspace_id,sound_identity_id,configuration_candidate_id,version_number,
  ambience_manifest,sfx_manifest,dignity_rules,manifest_hash,license_status,
  license_evidence_hash,state
) values(
  'b2530000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b2500000-0000-4000-8000-000000000003','b1600000-0000-4000-8000-000000000001',
  1,'{"bed":"mountain-wind"}','{"spots":["bell"]}',array['devotional restraint'],
  repeat('6',64),'internal_authorized',repeat('7',64),'verified'
);
insert into public.preflight_audio_identity_selections(
  id,workspace_id,configuration_candidate_id,voice_version_id,
  pronunciation_lexicon_version_id,score_identity_version_id,sound_identity_version_id,
  selection_hash,state
) values(
  'b2540000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000001',
  (select voice_version_id from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  'b2510000-0000-4000-8000-000000000001','b2520000-0000-4000-8000-000000000001',
  'b2530000-0000-4000-8000-000000000001',repeat('8',64),'verified'
);
insert into public.assets(id,workspace_id,asset_kind) values
  ('b2500000-0000-4000-8000-000000000004','b1100000-0000-4000-8000-000000000001','narration');
insert into public.asset_versions(
  id,workspace_id,asset_id,version_number,source_quarantine_version_id,bucket_id,
  object_name,storage_version,content_sha256,media_mime,byte_length,policy_version_id,
  provenance_hash
) values(
  'b2500000-0000-4000-8000-000000000005','b1100000-0000-4000-8000-000000000001',
  'b2500000-0000-4000-8000-000000000004',1,'b2500000-0000-4000-8000-000000000006',
  'workspace-media','b1100000-0000-4000-8000-000000000001/narration/b2500000-0000-4000-8000-000000000004/b2500000-0000-4000-8000-000000000005/source',
  'v1',repeat('9',64),'audio/mpeg',1000,'b1710000-0000-4000-8000-000000000001',repeat('a',64)
);
insert into public.narration_master_clock_versions(
  id,workspace_id,configuration_candidate_id,preflight_run_id,script_revision_id,
  audio_identity_selection_id,narration_asset_version_id,version_number,duration_ms,
  processing_text_sha256,alignment_hash,audio_evidence_hash,performance_profile_hash,
  segment_count,state
) values(
  'b2550000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000001','b2400000-0000-4000-8000-000000000001',
  'b1500000-0000-4000-8000-000000000001','b2540000-0000-4000-8000-000000000001',
  'b2500000-0000-4000-8000-000000000005',1,60000,
  (select processing_utf8_sha256 from public.script_revisions where id='b1500000-0000-4000-8000-000000000001'),
  repeat('b',64),repeat('c',64),repeat('d',64),1,'verified'
);
insert into public.preflight_plan_component_versions(
  id,workspace_id,configuration_candidate_id,master_clock_version_id,
  component_kind,version_number,schema_version,payload,content_hash
)
select id,'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2550000-0000-4000-8000-000000000001',kind,1,'genie.preflight-plan.v1',
  jsonb_build_object('fixture',kind),repeat(hash_char,64)
from (values
  ('b2600000-0000-4000-8000-000000000001'::uuid,'story','1'),
  ('b2600000-0000-4000-8000-000000000002'::uuid,'beat','2'),
  ('b2600000-0000-4000-8000-000000000003'::uuid,'shot','3'),
  ('b2600000-0000-4000-8000-000000000004'::uuid,'sound','4'),
  ('b2600000-0000-4000-8000-000000000005'::uuid,'composition','5'),
  ('b2600000-0000-4000-8000-000000000006'::uuid,'safety','6'),
  ('b2600000-0000-4000-8000-000000000007'::uuid,'routing','7'),
  ('b2600000-0000-4000-8000-000000000008'::uuid,'edd','8')
) component(id,kind,hash_char);
insert into public.preflight_plan_bundles(
  id,workspace_id,configuration_candidate_id,preflight_run_id,master_clock_version_id,
  source_review_packet_id,world_reference_pack_version_id,story_version_id,beat_version_id,
  shot_version_id,sound_version_id,composition_version_id,safety_version_id,
  routing_version_id,edd_version_id,plan_hash,graph_hash,projected_ovs,projected_cvp,
  projected_pfs,projected_confidence,evidence_density,state,plan_iteration
) values(
  'b2610000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000001','b2400000-0000-4000-8000-000000000001',
  'b2550000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000001',
  'b1860000-0000-4000-8000-000000000001','b2600000-0000-4000-8000-000000000001',
  'b2600000-0000-4000-8000-000000000002','b2600000-0000-4000-8000-000000000003',
  'b2600000-0000-4000-8000-000000000004','b2600000-0000-4000-8000-000000000005',
  'b2600000-0000-4000-8000-000000000006','b2600000-0000-4000-8000-000000000007',
  'b2600000-0000-4000-8000-000000000008',repeat('e',64),repeat('f',64),90,95,92,94,96,
  'qc_passed',1
);
insert into public.preflight_beats(
  workspace_id,plan_bundle_id,beat_number,processing_start_scalar,processing_end_scalar,
  exact_text,start_ms,end_ms,beat_type,reveal_level,requires_proof,requires_reaction,
  requires_consequence
) values(
  'b1100000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000001',
  1,0,5,'other',0,60000,'devotional_arc','none',false,false,false
);
insert into public.preflight_shots(
  workspace_id,plan_bundle_id,shot_number,beat_number,start_ms,end_ms,motion_class,
  location_version_id,character_version_ids,safe_area_pass,supplies_proof,
  supplies_reaction,supplies_consequence,shot_content_hash,topological_order
)
select 'b1100000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000001',
  shot,1,(shot-1)*10000,shot*10000,'simple_camera_subject',
  'b1850000-0000-4000-8000-000000000001',array['b1820000-0000-4000-8000-000000000002'::uuid],
  true,false,false,false,repeat(substr('123456',shot,1),64),shot
from generate_series(1,6) shot;
insert into public.preflight_provider_request_slots(
  id,workspace_id,plan_bundle_id,shot_number,slot_key,slot_kind,capability_version_id,
  duration_ms,retained_duration_ms,input_strategy,reference_count,output_width,
  output_height,billing_quantum_count,expected_output_kind
)
select ('b2700000-0000-4000-8000-'||lpad(shot::text,12,'0'))::uuid,
  'b1100000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000001',
  shot,'shot.'||shot::text||'.primary','primary',capability.id,10000,10000,
  'direct_multi_reference',1,1080,1920,2,'video/mp4'
from generate_series(1,6) shot
cross join lateral (
  select capability.id from private.production_provider_capability_versions capability
  join private.provider_accounts account on account.id=capability.provider_account_id
  where account.workspace_id='b1100000-0000-4000-8000-000000000001'
    and capability.motion_class='simple_camera_subject' and capability.state='verified'
  order by capability.created_at desc limit 1
) capability;
insert into public.preflight_reference_edges(
  workspace_id,plan_bundle_id,shot_number,source_shot_number,reference_kind,
  reference_ordinal,asset_version_id,asset_content_hash,requires_upstream_success
)
select 'b1100000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000001',
  shot,null,'character',1,'b1720000-0000-4000-8000-000000000002',repeat('2',64),false
from generate_series(1,6) shot;
insert into private.preflight_plan_qc_consensus(
  id,workspace_id,preflight_run_id,stage_attempt_id,plan_bundle_id,blind_group_id,
  rubric_key,rubric_version,rubric_hash,ovs,cvp,pfs,lcr,confidence,evidence_density,
  maximum_parameter_spread,verdict,gate_codes,consensus_hash
) values(
  'b2620000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b2400000-0000-4000-8000-000000000001','b2420000-0000-4000-8000-000000000001',
  'b2610000-0000-4000-8000-000000000001','b2620000-0000-4000-8000-000000000002',
  'mythological-devotional-plan','1.0.0',repeat('3',64),90,95,92,91,94,96,1,'pass',
  array[]::text[],repeat('4',64)
);
insert into public.production_quotes(
  id,workspace_id,configuration_candidate_id,plan_bundle_id,plan_qc_consensus_id,
  quote_number,quote_hash,rate_snapshot_hash,currency,low_total_microusd,
  expected_total_microusd,high_total_microusd,hard_ceiling_microusd,
  target_40usd_breached,expires_at
) values(
  'b2800000-0000-4000-8000-000000000001','b1100000-0000-4000-8000-000000000001',
  'b1600000-0000-4000-8000-000000000001','b2610000-0000-4000-8000-000000000001',
  'b2620000-0000-4000-8000-000000000001',1,repeat('5',64),repeat('6',64),'USD',
  7950000,7950000,7950000,7950000,false,statement_timestamp()+interval '1 hour'
);
insert into public.production_quote_lines(
  id,workspace_id,production_quote_id,line_number,line_key,line_kind,
  provider_request_slot_id,rate_card_version_id,low_quantity,expected_quantity,
  high_quantity,low_amount_microusd,expected_amount_microusd,high_amount_microusd,
  evidence_hash
)
select ('b2810000-0000-4000-8000-'||lpad(shot::text,12,'0'))::uuid,
  'b1100000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000001',
  shot,'shot.'||shot::text||'.primary','provider_clip',slot.id,rate.id,2,2,2,
  700000,700000,700000,repeat('7',64)
from generate_series(1,6) shot
join public.preflight_provider_request_slots slot
  on slot.plan_bundle_id='b2610000-0000-4000-8000-000000000001' and slot.shot_number=shot
join private.production_rate_card_versions rate
  on rate.capability_version_id=slot.capability_version_id and rate.line_kind='provider_clip';
insert into public.production_quote_lines(
  id,workspace_id,production_quote_id,line_number,line_key,line_kind,
  provider_request_slot_id,rate_card_version_id,low_quantity,expected_quantity,
  high_quantity,low_amount_microusd,expected_amount_microusd,high_amount_microusd,
  evidence_hash
)
select ('b2820000-0000-4000-8000-'||lpad(row_number() over(order by allowance.rate_key)::text,12,'0'))::uuid,
  'b1100000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000001',
  6+row_number() over(order by allowance.rate_key),allowance.rate_key,allowance.line_kind,
  null,allowance.id,allowance.quantity,allowance.quantity,allowance.quantity,
  allowance.amount,allowance.amount,allowance.amount,repeat('8',64)
from (
  select rate.*,
    case rate.rate_key when 'upscale' then 0 when 'qc_judges' then 4 else 1 end::numeric as quantity,
    case rate.rate_key
      when 'upscale' then 0 when 'narration_master_reuse' then 0
      when 'score_music' then 1250000 when 'sfx_ambience' then 500000
      when 'qc_judges' then 1000000 when 'render_export' then 500000
      when 'repair_allowance' then 500000 end::bigint as amount
  from private.production_rate_card_versions rate
  where rate.rate_key=any(array[
    'upscale','narration_master_reuse','score_music','sfx_ambience',
    'qc_judges','render_export','repair_allowance'
  ]) and rate.state='verified'
) allowance;
set local session_replication_role=origin;

select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
insert into world_fixture(key,value)
select 'quote_confirmation',public.command_confirm_production_quote(
  'b1100000-0000-4000-8000-000000000001','b2800000-0000-4000-8000-000000000001',
  repeat('5',64),7950000,'b2830000-0000-4000-8000-000000000001'
)::text;
select is(
  (select count(*) from public.production_quote_confirmations
    where production_quote_id='b2800000-0000-4000-8000-000000000001'),
  1::bigint,'AAL2 confirmation freezes exactly one immutable production ceiling'
);
insert into world_fixture(key,value)
select 'world_prepare_fail',public.prepare_first_episode_world_lock(
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',
  (select value::uuid from world_fixture where key='quote_confirmation'),
  'b2910000-0000-4000-8000-000000000099',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001')
)::text;
select ok(
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'manifestHash')~'^[a-f0-9]{64}$'
  and ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'requestHash')~'^[a-f0-9]{64}$',
  'World Lock preparation derives exact server-side manifest and request hashes'
);

-- V-P2-019: every required audio identity is independently release-blocking.
-- The fixture is restored after each case so the following case and the existing
-- successful World Lock continue to exercise the original exact identities.
reset role;
set local session_replication_role=replica;
update public.pronunciation_lexicon_versions
set state='stale'
where id='b2510000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
set local role authenticated;
select throws_ok(format(
  'select public.command_lock_first_episode_world(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%s,%s,%s,%L,%L,%L,%L,%L)',
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',(select value from world_fixture where key='quote_confirmation'),
  'b2900000-0000-4000-8000-000000000011','b2910000-0000-4000-8000-000000000011',
  'b2920000-0000-4000-8000-000000000011','b2930000-0000-4000-8000-000000000011',
  'b2940000-0000-4000-8000-000000000011','b2950000-0000-4000-8000-000000000011',
  'b2990000-0000-4000-8000-000000000011',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'manifestHash'),
  'b2960000-0000-4000-8000-000000000011','world-lock-missing-pronunciation',
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'requestHash'),
  'b2970000-0000-4000-8000-000000000011'
),'40001','World Lock prerequisite pins are incomplete or stale',
  'V-P2-019: a stale pronunciation identity blocks World Lock');
reset role;
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-019: missing pronunciation creates no release, run, authority, reservation, or production outbox event'
);

set local session_replication_role=replica;
update public.pronunciation_lexicon_versions
set state='verified'
where id='b2510000-0000-4000-8000-000000000001';
update public.score_identity_versions
set state='stale'
where id='b2520000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
set local role authenticated;
select throws_ok(format(
  'select public.command_lock_first_episode_world(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%s,%s,%s,%L,%L,%L,%L,%L)',
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',(select value from world_fixture where key='quote_confirmation'),
  'b2900000-0000-4000-8000-000000000012','b2910000-0000-4000-8000-000000000012',
  'b2920000-0000-4000-8000-000000000012','b2930000-0000-4000-8000-000000000012',
  'b2940000-0000-4000-8000-000000000012','b2950000-0000-4000-8000-000000000012',
  'b2990000-0000-4000-8000-000000000012',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'manifestHash'),
  'b2960000-0000-4000-8000-000000000012','world-lock-missing-score',
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'requestHash'),
  'b2970000-0000-4000-8000-000000000012'
),'40001','World Lock prerequisite pins are incomplete or stale',
  'V-P2-019: a stale score identity blocks World Lock');
reset role;
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-019: missing score creates no release, run, authority, reservation, or production outbox event'
);

set local session_replication_role=replica;
update public.score_identity_versions
set state='verified'
where id='b2520000-0000-4000-8000-000000000001';
update public.sound_identity_versions
set state='stale'
where id='b2530000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
set local role authenticated;
select throws_ok(format(
  'select public.command_lock_first_episode_world(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%s,%s,%s,%L,%L,%L,%L,%L)',
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',(select value from world_fixture where key='quote_confirmation'),
  'b2900000-0000-4000-8000-000000000013','b2910000-0000-4000-8000-000000000013',
  'b2920000-0000-4000-8000-000000000013','b2930000-0000-4000-8000-000000000013',
  'b2940000-0000-4000-8000-000000000013','b2950000-0000-4000-8000-000000000013',
  'b2990000-0000-4000-8000-000000000013',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'manifestHash'),
  'b2960000-0000-4000-8000-000000000013','world-lock-missing-sound',
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'requestHash'),
  'b2970000-0000-4000-8000-000000000013'
),'40001','World Lock prerequisite pins are incomplete or stale',
  'V-P2-019: a stale sound identity blocks World Lock');
reset role;
select ok(
  not exists(select 1 from public.series_releases
    where series_id='b1300000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.production_runs
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(select 1 from private.production_budget_authorizations
    where episode_id='b1400000-0000-4000-8000-000000000001')
  and not exists(
    select 1 from private.production_budget_reservations reservation
    join private.production_budget_authorizations authz
      on authz.id=reservation.authorization_id
    where authz.episode_id='b1400000-0000-4000-8000-000000000001'
  )
  and not exists(select 1 from private.outbox_events
    where event_type='production.run.authorized.v1'
      and payload_json->>'episodeId'='b1400000-0000-4000-8000-000000000001'),
  'V-P2-019: missing sound creates no release, run, authority, reservation, or production outbox event'
);

set local session_replication_role=replica;
update public.sound_identity_versions
set state='verified'
where id='b2530000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
reset role;
set local role service_role;
insert into public.work_items(
  workspace_id,episode_id,series_id,kind,dedupe_key,priority,safe_summary,deep_link
) values(
  'b1100000-0000-4000-8000-000000000001','b1400000-0000-4000-8000-000000000001',
  'b1300000-0000-4000-8000-000000000001','fault.inject',
  'production-start:b2990000-0000-4000-8000-000000000099',100,
  'Late World Lock fault injection.','/episodes/b1400000-0000-4000-8000-000000000001/create'
);
reset role;
set local role authenticated;
select throws_ok(format(
  'select public.command_lock_first_episode_world(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%s,%s,%s,%L,%L,%L,%L,%L)',
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',(select value from world_fixture where key='quote_confirmation'),
  'b2900000-0000-4000-8000-000000000099','b2910000-0000-4000-8000-000000000099',
  'b2920000-0000-4000-8000-000000000099','b2930000-0000-4000-8000-000000000099',
  'b2940000-0000-4000-8000-000000000099','b2950000-0000-4000-8000-000000000099',
  'b2990000-0000-4000-8000-000000000099',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'manifestHash'),
  'b2960000-0000-4000-8000-000000000099','world-lock-fault-0001',
  ((select value::jsonb from world_fixture where key='world_prepare_fail')->>'requestHash'),
  'b2970000-0000-4000-8000-000000000099'
),'23505','duplicate key value violates unique constraint "work_items_open_dedupe_uq"',
  'a forced failure at the final work-item write aborts the entire World Lock');
reset role;
set local role service_role;
select is((select count(*) from public.series_releases where series_id='b1300000-0000-4000-8000-000000000001'),0::bigint,
  'the late fault leaves no partially published Series Release');
select is((select count(*) from public.production_runs where episode_id='b1400000-0000-4000-8000-000000000001'),0::bigint,
  'the late fault leaves no production run');
select is((select count(*) from private.production_budget_authorizations where episode_id='b1400000-0000-4000-8000-000000000001'),0::bigint,
  'the late fault leaves no budget authority or hidden spend lane');
reset role;
set local role authenticated;
insert into world_fixture(key,value)
select 'world_prepare_success',public.prepare_first_episode_world_lock(
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',
  (select value::uuid from world_fixture where key='quote_confirmation'),
  'b2910000-0000-4000-8000-000000000001',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001')
)::text;
select lives_ok(format(
  'select public.command_lock_first_episode_world(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%s,%s,%s,%L,%L,%L,%L,%L)',
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',(select value from world_fixture where key='quote_confirmation'),
  'b2900000-0000-4000-8000-000000000001','b2910000-0000-4000-8000-000000000001',
  'b2920000-0000-4000-8000-000000000001','b2930000-0000-4000-8000-000000000001',
  'b2940000-0000-4000-8000-000000000001','b2950000-0000-4000-8000-000000000001',
  'b2990000-0000-4000-8000-000000000001',
  (select aggregate_version from public.series where id='b1300000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episodes where id='b1400000-0000-4000-8000-000000000001'),
  (select aggregate_version from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  ((select value::jsonb from world_fixture where key='world_prepare_success')->>'manifestHash'),
  'b2960000-0000-4000-8000-000000000001','world-lock-success-0001',
  ((select value::jsonb from world_fixture where key='world_prepare_success')->>'requestHash'),
  'b2970000-0000-4000-8000-000000000001'
),'the exact World Lock seals release, ceiling, reservation, and run in one commit');
select is((select count(*) from public.series_releases where series_id='b1300000-0000-4000-8000-000000000001'),1::bigint,
  'one first Series Release exists after success');
select is((select count(*) from public.production_runs where episode_id='b1400000-0000-4000-8000-000000000001'),1::bigint,
  'one bounded production run exists after success');
reset role;
set local role service_role;
select is((select count(*) from private.production_budget_reservations reservation
  join private.production_budget_authorizations authz on authz.id=reservation.authorization_id
  where authz.episode_id='b1400000-0000-4000-8000-000000000001' and reservation.reserved_microusd=7950000),1::bigint,
  'the sole reservation equals the complete confirmed high envelope');
reset role;
set local role authenticated;
select is((select workflow_state::text from public.episodes where id='b1400000-0000-4000-8000-000000000001'),'ready_to_produce',
  'the Episode advances only after the atomic run envelope exists');
select lives_ok(format(
  'select public.command_lock_first_episode_world(%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%L,%s,%s,%s,%L,%L,%L,%L,%L)',
  'b1100000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
  'b2800000-0000-4000-8000-000000000001',(select value from world_fixture where key='quote_confirmation'),
  'b2900000-0000-4000-8000-000000000001','b2910000-0000-4000-8000-000000000001',
  'b2920000-0000-4000-8000-000000000001','b2930000-0000-4000-8000-000000000001',
  'b2940000-0000-4000-8000-000000000001','b2950000-0000-4000-8000-000000000001',
  'b2990000-0000-4000-8000-000000000001',1,1,
  (select aggregate_version-1 from public.episode_configuration_candidates where id='b1600000-0000-4000-8000-000000000001'),
  ((select value::jsonb from world_fixture where key='world_prepare_success')->>'manifestHash'),
  'b2960000-0000-4000-8000-000000000001','world-lock-success-0001',
  ((select value::jsonb from world_fixture where key='world_prepare_success')->>'requestHash'),
  'b2970000-0000-4000-8000-000000000001'
),'an identical idempotent replay returns the sealed receipt before stale aggregate checks');
select is((select count(*) from public.series_releases where series_id='b1300000-0000-4000-8000-000000000001'),1::bigint,
  'World Lock replay cannot mint a second release, reservation, or run');

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.command_record_source_review_packet(
 'b2100000-0000-4000-8000-000000000002','b1100000-0000-4000-8000-000000000001',
 'b1300000-0000-4000-8000-000000000001','b1600000-0000-4000-8000-000000000001',
 (select value::uuid from world_fixture where key='policy_id'),repeat('1',64),repeat('2',64),repeat('3',64),
 'shaiva','uttarakhand','Hindi',array['deity_form','temple','religious_conflict'],array['temple_tradition'],
 'blocked',repeat('4',64),
 jsonb_build_array(
  jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000001','claimClass','temple','subjectKind','none','subjectId','','evidenceRole','none'),
  jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000002','claimClass','temple','subjectKind','none','subjectId','','evidenceRole','none'),
  jsonb_build_object('sourceRecordVersionId','b2010000-0000-4000-8000-000000000003','claimClass','deity_form','subjectKind','none','subjectId','','evidenceRole','none')
 ),jsonb_build_array(jsonb_build_object(
  'policyRuleId',(select id from public.cultural_policy_rules where rule_code='GCP-CONFLICT-001'),
  'subjectKind','general','subjectId','','verdict','production_blocked','confidence',1,
  'evidenceHash',repeat('5',64),'safeSummary','Religious conflict content detected.'
 )));
select is((select machine_verdict from public.source_review_packets where id='b2100000-0000-4000-8000-000000000002'),'blocked','a non-overridable finding persists as blocked machine evidence');

reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000001"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(format(
 'select public.command_submit_source_review(%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000002',
 ((select value::jsonb from world_fixture where key='competency_one')->>'competencyVersionId'),
 'approve','attempted override',(select value from world_fixture where key='scope_one'),
 'b2300000-0000-4000-8000-000000000003','review-blocked-approve',repeat('6',64),'b2310000-0000-4000-8000-000000000003'
 ),'40001','source review prerequisites are incomplete','a qualified reviewer cannot override a non-overridable rule');
select lives_ok(format(
 'select public.command_submit_source_review(%L,%L,%L,1,%L,%L,%L,%L,%L,%L,%L)',
 'b1100000-0000-4000-8000-000000000001','b2100000-0000-4000-8000-000000000002',
 ((select value::jsonb from world_fixture where key='competency_one')->>'competencyVersionId'),
 'block','non-overridable blocker confirmed',(select value from world_fixture where key='scope_one'),
 'b2300000-0000-4000-8000-000000000004','review-blocked-block',repeat('7',64),'b2310000-0000-4000-8000-000000000004'
 ),'the qualified reviewer records the block without mutating machine evidence');
select is((select status from public.source_review_statuses where source_review_packet_id='b2100000-0000-4000-8000-000000000002'),'blocked','the blocked source packet cannot enter World Lock');
reset role;
select set_config('request.jwt.claims','{"sub":"b1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"b1210000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','b1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(format(
  'select public.command_offboard_member(%L,%L,%L,1,%L,%L,%L,%L,%L)',
  'b1100000-0000-4000-8000-000000000001','b1200000-0000-4000-8000-000000000001',
  'b1200000-0000-4000-8000-000000000002','Owner transferred after bounded run creation',
  'b2980000-0000-4000-8000-000000000001','world-owner-offboard-0001',repeat('9',64),
  'b2980000-0000-4000-8000-000000000002'
),'an AAL2 admin can offboard the prior owner after the immutable run envelope exists');
select ok((select status='deactivated' and authority_epoch=2 from public.memberships
  where workspace_id='b1100000-0000-4000-8000-000000000001'
    and user_id='b1200000-0000-4000-8000-000000000001'),
  'offboarding revokes the prior owner membership epoch');
select ok(
  (select owner_user_id='b1200000-0000-4000-8000-000000000002' from public.series
    where id='b1300000-0000-4000-8000-000000000001')
  and (select owner_user_id='b1200000-0000-4000-8000-000000000002' from public.episodes
    where id='b1400000-0000-4000-8000-000000000001'),
  'Series and Episode release authority transfers to the active replacement');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select ok((select status.state='authorized'
    and run.created_by='b1200000-0000-4000-8000-000000000001'
    and authz.authorized_by='b1200000-0000-4000-8000-000000000001'
    and reservation.reserved_microusd=7950000
  from public.production_runs run
  join public.production_run_statuses status on status.production_run_id=run.id
  join private.production_budget_authorizations authz on authz.id=run.budget_authorization_id
  join private.production_budget_reservations reservation on reservation.id=run.budget_reservation_id
  where run.id='b2990000-0000-4000-8000-000000000001'),
  'offboarding preserves the exact bounded autonomous run and its historical authorization evidence');
select ok(
  exists(select 1 from private.auth_session_revocations
    where workspace_id='b1100000-0000-4000-8000-000000000001'
      and user_id='b1200000-0000-4000-8000-000000000001')
  and not exists(select 1 from public.work_items
    where workspace_id='b1100000-0000-4000-8000-000000000001'
      and assigned_user_id='b1200000-0000-4000-8000-000000000001'
      and state in ('open','claimed'))
  and not exists(select 1 from public.work_leases
    where workspace_id='b1100000-0000-4000-8000-000000000001'
      and holder_user_id='b1200000-0000-4000-8000-000000000001'
      and lease_state='active'),
  'the removed owner retains no session, work, or lease authority over the active run');

select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('characters','character_versions','locations','location_versions','source_review_packets','source_review_decisions')),'world and cultural projections enforce RLS');

select * from finish();
rollback;

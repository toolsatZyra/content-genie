begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth,storage,private,audit,pg_catalog;
select plan(45);
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
  position('p_tool_name=''audio.pronunciation'' and run.kind=''narration_clock'''
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
  7,'the quote compiler registers all seven mandatory allowance rates'
);
select is(
  (select jsonb_agg(jsonb_build_array(
    rate.rate_key,rate.unit_name,rate.unit_price_microusd,
    rate.minimum_quantity,rate.maximum_line_microusd
  ) order by rate.rate_key)
  from private.production_rate_card_versions rate
  where rate.rate_key=any(array[
    'upscale','narration_master_reuse','score_music','sfx_ambience',
    'qc_judges','render_export','repair_allowance'
  ])),
  '[
    ["narration_master_reuse","episode",0,1,0],
    ["qc_judges","judge_call",250000,4,3000000],
    ["render_export","render_minute",500000,1,1500000],
    ["repair_allowance","episode",500000,1,1000000],
    ["score_music","episode",1250000,1,2500000],
    ["sfx_ambience","episode",500000,1,1000000],
    ["upscale","minute",1200000,0,5000000]
  ]'::jsonb,
  'allowance quantities and conservative microusd ceilings are exact'
);
select is(
  jsonb_array_length(public.command_ensure_production_allowance_rates(
    'c1100000-0000-4000-8000-000000000001')),
  7,'allowance-rate registration is replay-safe'
);
select is(
  (select count(*) from private.production_rate_card_versions rate
    where rate.rate_key=any(array[
      'upscale','narration_master_reuse','score_music','sfx_ambience',
      'qc_judges','render_export','repair_allowance'
    ])),
  7::bigint,'allowance-rate replay does not mint duplicate versions'
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
  and position('jsonb_array_length(coalesce(allowance_value,''[]''::jsonb))<>7'
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
  and position('private.current_aal()<>''aal2'''
    in pg_get_functiondef('public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure))>0
  and position('quote.expires_at<=statement_timestamp()'
    in pg_get_functiondef('public.command_confirm_production_quote(uuid,uuid,text,bigint,uuid)'::regprocedure))>0,
  'only an AAL2 actor can confirm a quote whose authenticated rate evidence is still current'
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

-- Focused database contract for the autonomous MVP cinematic pipeline.
-- Run after migrations through 20260722115341.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth,storage,private,audit,pg_catalog;

select plan(91);

create temp table mvp_pipeline_fixture(
  key text primary key,
  value jsonb not null
) on commit drop;
grant select, insert, update, delete on mvp_pipeline_fixture
to authenticated, service_role;

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'mvp_storyboard_frames'
      and column_name = 'frame_role'
  ),
  'storyboard frames persist their single/start/end role'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('storyboard_end_frame_id'),
      ('storyboard_source_attempt_number'),
      ('storyboard_end_source_attempt_number')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'private'
        and actual.table_name = 'mvp_production_clips'
        and actual.column_name = required.column_name
    )
  ),
  'clips preserve start/end storyboard identity and physical source attempts'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('active_repair_request_id'),('total_sfx'),('completed_sfx')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'mvp_production_jobs'
        and actual.column_name = required.column_name
    )
  ),
  'production jobs expose durable repair and sound-design progress'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('planner_lease_token'),('planner_lease_expires_at'),
      ('active_plan_version_id'),('shots_selected')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'mvp_repair_requests'
        and actual.column_name = required.column_name
    )
  ),
  'repair requests persist the planner fence and exact selection progress'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'mvp_repair_shot_decisions'
      and column_name = 'source_storyboard_end_frame_id'
  ),
  'repair decisions preserve source end-frame lineage'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'mvp_attempt_shot_assets'
      and column_name = 'selected_storyboard_end_frame_id'
  ),
  'attempt selections preserve the effective end frame'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'mvp_production_sfx'
      and column_name = 'source_sfx_id'
  ),
  'SFX rows preserve exact cross-attempt reuse lineage'
);

select ok(
  not exists (
    select required.relation_name
    from (values
      ('public','mvp_repair_requests'),
      ('private','mvp_repair_plan_versions'),
      ('private','mvp_repair_shot_decisions'),
      ('private','mvp_attempt_shot_assets'),
      ('private','mvp_production_sfx')
    ) as required(schema_name,relation_name)
    where to_regclass(required.schema_name || '.' || required.relation_name) is null
  ),
  'all durable repair and SFX ledgers exist'
);

select ok(
  not exists (
    select required.relation_name
    from (values
      ('mvp_repair_progress'),
      ('mvp_repair_request_worker'),
      ('mvp_repair_plan_version_worker'),
      ('mvp_repair_shot_decision_worker'),
      ('mvp_attempt_shot_asset_worker'),
      ('mvp_production_sfx_worker')
    ) as required(relation_name)
    where to_regclass('public.' || required.relation_name) is null
  ),
  'member progress and service worker projections exist'
);

select ok(
  not exists (
    select relname
    from pg_class
    join pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname in ('public','private')
      and relname in (
        'mvp_repair_requests','mvp_repair_plan_versions',
        'mvp_repair_shot_decisions','mvp_attempt_shot_assets',
        'mvp_production_sfx'
      )
      and not (relrowsecurity and relforcerowsecurity)
  ),
  'every repair and SFX ledger has forced RLS'
);

select ok(
  not has_table_privilege('authenticated','private.mvp_repair_plan_versions','select')
  and not has_table_privilege('authenticated','private.mvp_repair_shot_decisions','select')
  and not has_table_privilege('authenticated','private.mvp_attempt_shot_assets','select')
  and not has_table_privilege('authenticated','private.mvp_production_sfx','select'),
  'authenticated clients cannot read private repair or SFX evidence'
);

select ok(
  has_table_privilege('service_role','private.mvp_repair_plan_versions','select')
  and has_table_privilege('service_role','private.mvp_repair_shot_decisions','select')
  and has_table_privilege('service_role','private.mvp_attempt_shot_assets','select')
  and has_table_privilege('service_role','private.mvp_production_sfx','select'),
  'the secure service boundary can read its private evidence'
);

select ok(
  not has_table_privilege('authenticated','public.mvp_repair_request_worker','select')
  and not has_table_privilege('authenticated','public.mvp_repair_plan_version_worker','select')
  and not has_table_privilege('authenticated','public.mvp_repair_shot_decision_worker','select')
  and not has_table_privilege('authenticated','public.mvp_attempt_shot_asset_worker','select')
  and not has_table_privilege('authenticated','public.mvp_production_sfx_worker','select'),
  'worker projections are not exposed to authenticated clients'
);

select ok(
  has_table_privilege('service_role','public.mvp_repair_request_worker','select')
  and has_table_privilege('service_role','public.mvp_repair_plan_version_worker','select')
  and has_table_privilege('service_role','public.mvp_repair_shot_decision_worker','select')
  and has_table_privilege('service_role','public.mvp_attempt_shot_asset_worker','select')
  and has_table_privilege('service_role','public.mvp_production_sfx_worker','select'),
  'worker projections remain usable by the secure service boundary'
);

select ok(
  has_table_privilege('authenticated','public.mvp_repair_progress','select')
  and not has_table_privilege('anon','public.mvp_repair_progress','select'),
  'members can observe repair progress without exposing it anonymously'
);

select is(
  (select count(*)
   from pg_proc
   join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where pg_namespace.nspname = 'public'
     and proname in (
       'command_claim_next_mvp_repair',
       'command_publish_mvp_repair_plan',
       'command_update_mvp_repair_progress',
       'command_record_mvp_repair_shot_selection',
       'command_fail_mvp_repair_request',
       'command_materialize_mvp_sfx_cue',
       'command_claim_next_mvp_sfx',
       'command_complete_mvp_sfx',
       'command_fail_mvp_sfx'
     )),
  9::bigint,
  'all nine repair and SFX commands exist exactly once'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and proname in (
        'command_claim_next_mvp_repair',
        'command_update_mvp_repair_progress',
        'command_record_mvp_repair_shot_selection',
        'command_fail_mvp_repair_request',
        'command_materialize_mvp_sfx_cue',
        'command_claim_next_mvp_sfx',
        'command_complete_mvp_sfx',
        'command_fail_mvp_sfx'
      )
      and not prosecdef
  ),
  'every worker command is security-definer'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and proname in (
        'command_claim_next_mvp_repair',
        'command_update_mvp_repair_progress',
        'command_record_mvp_repair_shot_selection',
        'command_fail_mvp_repair_request',
        'command_materialize_mvp_sfx_cue',
        'command_claim_next_mvp_sfx',
        'command_complete_mvp_sfx',
        'command_fail_mvp_sfx'
      )
      and not ('search_path=""' = any(coalesce(proconfig,'{}'::text[])))
  ),
  'every security-definer command has an empty search path'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and proname in (
        'command_claim_next_mvp_repair',
        'command_publish_mvp_repair_plan',
        'command_update_mvp_repair_progress',
        'command_record_mvp_repair_shot_selection',
        'command_fail_mvp_repair_request',
        'command_materialize_mvp_sfx_cue',
        'command_claim_next_mvp_sfx',
        'command_complete_mvp_sfx',
        'command_fail_mvp_sfx'
      )
      and has_function_privilege('authenticated', pg_proc.oid, 'execute')
  ),
  'authenticated clients cannot execute worker commands'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and proname in (
        'command_claim_next_mvp_repair',
        'command_publish_mvp_repair_plan',
        'command_update_mvp_repair_progress',
        'command_record_mvp_repair_shot_selection',
        'command_fail_mvp_repair_request',
        'command_materialize_mvp_sfx_cue',
        'command_claim_next_mvp_sfx',
        'command_complete_mvp_sfx',
        'command_fail_mvp_sfx'
      )
      and proname <> 'command_publish_mvp_repair_plan'
      and not has_function_privilege('service_role', pg_proc.oid, 'execute')
  )
  and
  not has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_plan(uuid,bigint,uuid,uuid,text,text,text,text,jsonb,jsonb)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_plan_grounded(uuid,bigint,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text,text,jsonb,text,jsonb,text,text)',
    'execute'
  ),
  'the service boundary uses grounded evidence for model-authored repair plans'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'mvp_clip_storyboard_roles' and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgname = 'mvp_clip_storyboard_source_attempt' and not tgisinternal
  ),
  'clip writes enforce clean frame roles and physical source attempts'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'mvp_storyboard_frames_terminal_immutable'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgname = 'mvp_production_clips_terminal_immutable'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgname = 'mvp_production_sfx_completed_immutable'
      and not tgisinternal
  ),
  'terminal storyboard, clip and SFX evidence is immutable'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'mvp_storyboard_frames_run_attempt_shot_role_uq'
      and contype = 'u'
  ),
  'each shot has at most one storyboard asset per clean frame role'
);

select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'mvp_production_clips_storyboard_end_source_match_fk'
      and contype = 'f'
  ),
  'clip end frames are bound to their exact source attempt'
);

select ok(
  position('sound_designing' in (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'mvp_production_jobs_state_check'
  )) > 0
  and position('repair_planning' in (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'mvp_production_jobs_state_check'
  )) > 0,
  'the job state machine includes repair planning and sound design'
);

select ok(
  position('awaiting_clarification' in (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conname = 'mvp_repair_requests_state_check'
  )) > 0,
  'the repair state machine can pause for owner clarification'
);

select ok(
  to_regclass('public.mvp_repair_clarification_messages') is not null
  and not exists (
    select required.column_name
    from (values
      ('round_number'),('message_kind'),('reply_to_message_id'),
      ('content'),('content_sha256'),('actor_user_id'),('actor_role'),
      ('created_at')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'mvp_repair_clarification_messages'
        and actual.column_name = required.column_name
    )
  ),
  'clarification messages preserve round, content hash, actor and time evidence'
);

select ok(
  exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'mvp_repair_clarification_messages'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  )
  and exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'mvp_repair_clarification_messages'
      and policyname = 'mvp_repair_clarification_messages_member_select'
      and roles = array['authenticated'::name]
      and cmd = 'SELECT'
  ),
  'clarification evidence is protected by forced member-read RLS'
);

select ok(
  has_table_privilege(
    'authenticated','public.mvp_repair_clarification_messages','select'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_repair_clarification_messages','insert'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_repair_clarification_messages','update'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_repair_clarification_messages','delete'
  )
  and not has_table_privilege(
    'service_role','public.mvp_repair_clarification_messages','insert'
  )
  and not has_table_privilege(
    'service_role','public.mvp_repair_clarification_messages','update'
  )
  and not has_table_privilege(
    'service_role','public.mvp_repair_clarification_messages','delete'
  ),
  'members and workers cannot directly mutate clarification evidence'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'mvp_repair_clarification_messages_insert_guard'
      and not tgisinternal
  )
  and exists (
    select 1 from pg_trigger
    where tgname = 'mvp_repair_clarification_messages_immutable'
      and not tgisinternal
  ),
  'clarification rows are hash-checked and append-only'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('clarification_id'),
      ('clarification_question'),
      ('clarification_round')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'mvp_repair_progress'
        and actual.column_name = required.column_name
    )
  ),
  'member repair progress exposes only the latest pending clarification'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mvp_repair_request_worker'
      and column_name = 'clarification_transcript'
  )
  and has_table_privilege(
    'service_role','public.mvp_repair_request_worker','select'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_repair_request_worker','select'
  ),
  'the secure repair worker can read the complete clarification transcript'
);

select is(
  (select count(*)
   from pg_proc
   join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
   where pg_namespace.nspname = 'public'
     and proname in (
       'command_publish_mvp_repair_clarification',
       'command_answer_mvp_repair_clarification'
     )),
  2::bigint,
  'the clarification loop has exactly one publish and one answer command'
);

select ok(
  not exists (
    select 1
    from pg_proc
    join pg_namespace on pg_namespace.oid = pg_proc.pronamespace
    where pg_namespace.nspname = 'public'
      and proname in (
        'command_publish_mvp_repair_clarification',
        'command_answer_mvp_repair_clarification'
      )
      and (
        not prosecdef
        or not ('search_path=""' = any(coalesce(proconfig,'{}'::text[])))
      )
  ),
  'both clarification commands are security-definer with an empty search path'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_clarification_grounded(uuid,bigint,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_clarification(uuid,bigint,uuid,uuid,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_publish_mvp_repair_clarification_grounded(uuid,bigint,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text,text,text)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.command_answer_mvp_repair_clarification(uuid,uuid,uuid,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.command_answer_mvp_repair_clarification(uuid,uuid,uuid,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.command_answer_mvp_repair_clarification(uuid,uuid,uuid,bigint,text)',
    'execute'
  ),
  'only the grounded worker can ask and only authenticated members can answer'
);

select ok(
  position('next_round > 3' in lower(pg_get_functiondef(
    'public.command_publish_mvp_repair_clarification(uuid,bigint,uuid,uuid,text)'::regprocedure
  ))) > 0
  and position('planner_lease_token = null' in lower(pg_get_functiondef(
    'public.command_publish_mvp_repair_clarification(uuid,bigint,uuid,uuid,text)'::regprocedure
  ))) > 0,
  'question publication caps the conversation at three rounds and clears the planner lease'
);

select ok(
  position('job_row.state <> ''repair_planning''' in pg_get_functiondef(
    'public.command_publish_mvp_repair_clarification(uuid,bigint,uuid,uuid,text)'::regprocedure
  )) > 0
  and position('job_row.active_repair_request_id <> request_row.id' in pg_get_functiondef(
    'public.command_publish_mvp_repair_clarification(uuid,bigint,uuid,uuid,text)'::regprocedure
  )) > 0
  and position('job_row.state <> ''repair_planning''' in pg_get_functiondef(
    'public.command_answer_mvp_repair_clarification(uuid,uuid,uuid,bigint,text)'::regprocedure
  )) > 0,
  'both clarification commands fence the active repair-planning job'
);

select ok(
  position('request_row.version <> p_expected_request_version' in lower(pg_get_functiondef(
    'public.command_answer_mvp_repair_clarification(uuid,uuid,uuid,bigint,text)'::regprocedure
  ))) > 0
  and position('order by question.round_number desc' in lower(pg_get_functiondef(
    'public.command_answer_mvp_repair_clarification(uuid,uuid,uuid,bigint,text)'::regprocedure
  ))) > 0
  and position('state = ''analyzing''' in lower(pg_get_functiondef(
    'public.command_answer_mvp_repair_clarification(uuid,uuid,uuid,bigint,text)'::regprocedure
  ))) > 0,
  'answers use optimistic fencing, target the latest pending round and resume analysis'
);

select ok(
  to_regclass('public.mvp_master_cultural_decisions') is not null
  and to_regclass('public.mvp_master_final_decisions') is not null
  and to_regclass('public.mvp_master_release_authorities') is not null,
  'separate cultural, final and release-authority ledgers exist'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.command_record_mvp_master_cultural_decision(uuid,uuid,bigint,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.command_record_mvp_master_cultural_decision(uuid,uuid,bigint,text,text)',
    'execute'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_master_cultural_decisions','insert'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_master_final_decisions','insert'
  ),
  'only the qualified command can record cultural authority and clients cannot forge decisions'
);

select ok(
  not exists (
    select required.column_name
    from (values ('claim_token'),('lease_expires_at'),('claim_attempt'))
      as required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'mvp_edit_packages'
        and actual.column_name = required.column_name
    )
  ),
  'edit packages persist claim tokens, lease expiry and bounded attempts'
);

select ok(
  to_regprocedure(
    'public.complete_mvp_edit_package(uuid,bigint,uuid,text,text,bigint)'
  ) is not null
  and to_regprocedure(
    'public.fail_mvp_edit_package(uuid,bigint,uuid,text,text)'
  ) is not null
  and to_regprocedure(
    'public.complete_mvp_edit_package(uuid,bigint,text,text,bigint)'
  ) is null
  and to_regprocedure(
    'public.fail_mvp_edit_package(uuid,bigint,text,text)'
  ) is null,
  'edit-package completion and failure require the lease token with no unfenced overload'
);

-- Minimal executable fixture. Foreign keys are intentionally bypassed only
-- while installing the isolated rows; all command and guard triggers execute
-- normally after replication mode is restored.
set local session_replication_role = replica;

insert into public.organizations(id,name,slug) values
('c1000000-0000-4000-8000-000000000001','MVP authority fixture','mvp-authority-fixture');
insert into public.workspaces(id,organization_id,name,slug) values
('c1100000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','MVP authority','mvp-authority');
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at,aud,role) values
('c1200000-0000-4000-8000-000000000001','qualified.mvp@zyra.test',statement_timestamp(),statement_timestamp(),statement_timestamp(),'authenticated','authenticated'),
('c1200000-0000-4000-8000-000000000002','final.mvp@zyra.test',statement_timestamp(),statement_timestamp(),statement_timestamp(),'authenticated','authenticated');
insert into public.memberships(
  workspace_id,user_id,role,status,authority_epoch,activated_at
) values
('c1100000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000001','member','active',1,statement_timestamp()),
('c1100000-0000-4000-8000-000000000001','c1200000-0000-4000-8000-000000000002','member','active',1,statement_timestamp());
insert into private.workspace_authority_profiles(
  id,workspace_id,profile_kind,profile_epoch
) values(
  'c1150000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001','managed_team',1
);
insert into public.series(
  id,workspace_id,slug,title,owner_user_id,created_by
) values(
  'c1300000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001','mvp-release','MVP Release',
  'c1200000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001'
);
insert into public.episodes(
  id,workspace_id,series_id,episode_number,title,owner_user_id,created_by
) values(
  'c1400000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',1,'Release target',
  'c1200000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001'
);
insert into public.episode_configuration_candidates(
  id,workspace_id,episode_id,candidate_number,script_revision_id,
  narrator_gender,voice_version_id,look_version_id,voice_confirmed_by,
  voice_confirmed_at,look_confirmed_by,look_confirmed_at,state,selected_by,
  locked_at
) values(
  'c1500000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',1,
  'c1510000-0000-4000-8000-000000000001','male',
  'c1520000-0000-4000-8000-000000000001',
  'c1530000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',statement_timestamp(),
  'c1200000-0000-4000-8000-000000000001',statement_timestamp(),'locked',
  'c1200000-0000-4000-8000-000000000001',statement_timestamp()
);
insert into public.source_review_packets(
  id,workspace_id,series_id,configuration_candidate_id,script_revision_id,
  policy_version_id,packet_version,subject_hash,source_set_hash,
  evidence_set_hash,tradition,region,language,content_classes,
  interpretation_labels,machine_verdict,machine_evidence_hash
) values(
  'c1600000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1510000-0000-4000-8000-000000000001',
  'c1610000-0000-4000-8000-000000000001',1,
  repeat('1',64),repeat('2',64),repeat('3',64),
  'all','all','all',array['all'],array['fixture'],'eligible',repeat('4',64)
);
insert into public.reviewer_competency_versions(
  id,workspace_id,reviewer_user_id,version_number,traditions,regions,
  languages,content_classes,appointment_issuer,appointment_evidence_hash,
  effective_at,expires_at,appointed_by,command_id,idempotency_key,request_hash
) values(
  'c1700000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001',1,array['all'],array['all'],
  array['all'],array['all'],'fixture appointment',repeat('5',64),
  statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 day',
  'c1200000-0000-4000-8000-000000000001',
  'c1710000-0000-4000-8000-000000000001','fixture-cultural-001',repeat('6',64)
);
insert into public.reviewer_competency_statuses(
  competency_version_id,workspace_id,reviewer_user_id,status,changed_by,reason
) values(
  'c1700000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001','active',
  'c1200000-0000-4000-8000-000000000001','fixture active'
);
insert into public.source_review_decisions(
  id,workspace_id,source_review_packet_id,policy_version_id,
  competency_version_id,reviewer_user_id,decision,subject_hash,
  source_set_hash,evidence_set_hash,competency_scope_hash,recusal_checked,
  actor_aal,rationale,command_id,idempotency_key,request_hash
) values(
  'c1800000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1600000-0000-4000-8000-000000000001',
  'c1610000-0000-4000-8000-000000000001',
  'c1700000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001','approve',
  repeat('1',64),repeat('2',64),repeat('3',64),repeat('7',64),true,'aal2',
  'qualified fixture source review','c1810000-0000-4000-8000-000000000001',
  'fixture-source-review-001',repeat('8',64)
);
insert into public.source_review_statuses(
  source_review_packet_id,workspace_id,status,selected_decision_id
) values(
  'c1600000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001','approved',
  'c1800000-0000-4000-8000-000000000001'
);
insert into public.preflight_plan_bundles(
  id,workspace_id,configuration_candidate_id,preflight_run_id,
  master_clock_version_id,source_review_packet_id,
  world_reference_pack_version_id,story_version_id,beat_version_id,
  shot_version_id,sound_version_id,composition_version_id,safety_version_id,
  routing_version_id,edd_version_id,plan_hash,graph_hash,projected_ovs,
  projected_cvp,projected_pfs,projected_confidence,evidence_density,state,
  plan_iteration
) values(
  'c1900000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1910000-0000-4000-8000-000000000001',
  'c1920000-0000-4000-8000-000000000001',
  'c1600000-0000-4000-8000-000000000001',
  'c1930000-0000-4000-8000-000000000001',
  'c1940000-0000-4000-8000-000000000001',
  'c1950000-0000-4000-8000-000000000001',
  'c1960000-0000-4000-8000-000000000001',
  'c1970000-0000-4000-8000-000000000001',
  'c1980000-0000-4000-8000-000000000001',
  'c1990000-0000-4000-8000-000000000001',
  'c19a0000-0000-4000-8000-000000000001',
  'c19b0000-0000-4000-8000-000000000001',
  repeat('9',64),repeat('a',64),90,90,90,90,90,'qc_passed',1
);
insert into public.production_runs(
  id,workspace_id,episode_id,series_id,configuration_candidate_id,
  series_release_id,series_release_component_id,production_quote_id,
  budget_authorization_id,budget_reservation_id,run_number,authority_epoch,
  pinned_manifest_hash,authorized_high_microusd,hard_ceiling_microusd,created_by,
  authority_profile_id,authority_profile_epoch,authority_provenance
) values(
  'c1a00000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1a10000-0000-4000-8000-000000000001',
  'c1a20000-0000-4000-8000-000000000001',
  'c1a30000-0000-4000-8000-000000000001',
  'c1a40000-0000-4000-8000-000000000001',
  'c1a50000-0000-4000-8000-000000000001',1,1,repeat('b',64),1000000,1000000,
  'c1200000-0000-4000-8000-000000000001',
  (select id from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  (select profile_epoch from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  'verified_aal2'
);
insert into public.production_run_statuses(
  production_run_id,workspace_id,episode_id,state
) values(
  'c1a00000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001','waiting_decision'
);
insert into public.assets(id,workspace_id,asset_kind) values(
  'c1a61000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001','narration'
);
insert into public.asset_versions(
  id,workspace_id,asset_id,version_number,source_quarantine_version_id,
  bucket_id,object_name,storage_version,content_sha256,media_mime,byte_length,
  policy_version_id,provenance_hash
) values(
  'c1a60000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1a61000-0000-4000-8000-000000000001',1,
  'c1a62000-0000-4000-8000-000000000001','workspace-media',
  'c1100000-0000-4000-8000-000000000001/narration/c1a61000-0000-4000-8000-000000000001/c1a60000-0000-4000-8000-000000000001/source',
  'fixture-v1',repeat('e',64),'audio/mpeg',4096,
  'c1a63000-0000-4000-8000-000000000001',repeat('f',64)
);
insert into public.mvp_production_jobs(
  production_run_id,workspace_id,episode_id,plan_bundle_id,
  narration_asset_version_id,state,attempt_number,
  authority_profile_id,authority_profile_epoch,authority_provenance
) values(
  'c1a00000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1900000-0000-4000-8000-000000000001',
  'c1a60000-0000-4000-8000-000000000001','review_ready',1,
  (select id from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  (select profile_epoch from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  'verified_aal2'
);
insert into public.mvp_episode_masters(
  id,workspace_id,episode_id,production_run_id,attempt_number,state,version,
  object_name,content_sha256,byte_length,duration_ms,width,height
) values(
  'c1b00000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000001',1,'pending_review',1,
  'c1100000-0000-4000-8000-000000000001/mvp-masters/c1a00000-0000-4000-8000-000000000001/1/master.mp4',
  repeat('c',64),4096,60000,1080,1920
);
insert into public.mvp_episode_masters(
  id,workspace_id,episode_id,production_run_id,attempt_number,state,version,
  object_name,content_sha256,byte_length,duration_ms,width,height
) values(
  'c1b00000-0000-4000-8000-0000000000e1',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-0000000000e1',1,'superseded',1,
  'c1100000-0000-4000-8000-000000000001/mvp-masters/c1a00000-0000-4000-8000-0000000000e1/1/master.mp4',
  repeat('d',64),4096,60000,1080,1920
);
insert into public.mvp_edit_packages(
  id,workspace_id,episode_id,production_run_id,master_id,master_version,
  attempt_number,state,version,created_by,started_at,claim_token,
  lease_expires_at,claim_attempt,created_at
) values(
  'c1c00000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000001',
  'c1b00000-0000-4000-8000-0000000000e1',1,1,'building',10,
  'c1200000-0000-4000-8000-000000000001',statement_timestamp(),
  'c1c10000-0000-4000-8000-000000000001','2000-01-01 00:00:00+00',1,
  '2000-01-01 00:00:00+00'
);

set local session_replication_role = origin;

select set_config(
  'request.jwt.claims',
  '{"sub":"c1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c1210000-0000-4000-8000-000000000002"}',
  true
);
select set_config('request.jwt.claim.sub','c1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select throws_ok(
  format(
    'select public.command_review_mvp_master(%L,%L,1,%L,true,true,%L)',
    'c1100000-0000-4000-8000-000000000001',
    'c1b00000-0000-4000-8000-000000000001','approve',''
  ),
  '23514',
  'a separate current qualified cultural decision is required',
  'generic AAL2 booleans cannot mint both human authorities'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config('request.jwt.claim.sub','c1200000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select lives_ok(
  format(
    'select public.command_record_mvp_master_cultural_decision(%L,%L,1,%L,%L)',
    'c1100000-0000-4000-8000-000000000001',
    'c1b00000-0000-4000-8000-000000000001','approve',
    'The exact master preserves the qualified cultural evidence.'
  ),
  'a qualified reviewer records the exact-master cultural decision separately'
);

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c1210000-0000-4000-8000-000000000002"}',
  true
);
select set_config('request.jwt.claim.sub','c1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select lives_ok(
  format(
    'select public.command_review_mvp_master(%L,%L,1,%L,true,true,%L)',
    'c1100000-0000-4000-8000-000000000001',
    'c1b00000-0000-4000-8000-000000000001','approve',''
  ),
  'a separate AAL2 final reviewer releases the exact approved cultural target'
);

reset role;

select ok(
  (select actor_user_id from public.mvp_master_cultural_decisions
    where master_id = 'c1b00000-0000-4000-8000-000000000001') =
      'c1200000-0000-4000-8000-000000000001'::uuid
  and
  (select actor_user_id from public.mvp_master_final_decisions
    where master_id = 'c1b00000-0000-4000-8000-000000000001') =
      'c1200000-0000-4000-8000-000000000002'::uuid,
  'cultural and final decisions retain their independent actor authority'
);

select ok(
  exists (
    select 1 from public.mvp_exports export
    join public.mvp_master_release_authorities authority
      on authority.id = export.release_authority_id
    where export.master_id = 'c1b00000-0000-4000-8000-000000000001'
      and export.authority_enforced
      and export.authority_master_version = 1
  )
  and (select state from public.mvp_production_jobs
    where production_run_id = 'c1a00000-0000-4000-8000-000000000001') =
      'export_ready'
  and (select state from public.production_run_statuses
    where production_run_id = 'c1a00000-0000-4000-8000-000000000001') =
      'succeeded',
  'export and run success occur only with the exact combined release authority'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

insert into mvp_pipeline_fixture(key,value)
select 'package-claim-1', public.claim_next_mvp_edit_package();

select ok(
  (select value->>'id' from mvp_pipeline_fixture where key='package-claim-1') =
    'c1c00000-0000-4000-8000-000000000001'
  and (select (value->>'claim_attempt')::integer from mvp_pipeline_fixture
    where key='package-claim-1') = 2
  and (select value->>'claim_token' from mvp_pipeline_fixture
    where key='package-claim-1') <>
      'c1c10000-0000-4000-8000-000000000001',
  'an expired building package is reclaimed with a higher attempt and fresh token'
);

select throws_ok(
  format(
    'select public.complete_mvp_edit_package(%L,10,%L,%L,%L,2048)',
    'c1c00000-0000-4000-8000-000000000001',
    'c1c10000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001/mvp-edit-packages/c1b00000-0000-4000-8000-0000000000e1/1/approved-assets.zip',
    repeat('e',64)
  ),
  '40001','edit package completion is stale',
  'the crashed worker token cannot complete after reclaim'
);

reset role;
update public.mvp_edit_packages
set lease_expires_at = statement_timestamp() - interval '1 second'
where id = 'c1c00000-0000-4000-8000-000000000001';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

insert into mvp_pipeline_fixture(key,value)
select 'package-claim-2', public.claim_next_mvp_edit_package();

select ok(
  (select (value->>'claim_attempt')::integer from mvp_pipeline_fixture
    where key='package-claim-2') = 3
  and (select value->>'claim_token' from mvp_pipeline_fixture
    where key='package-claim-2') <>
    (select value->>'claim_token' from mvp_pipeline_fixture
      where key='package-claim-1'),
  'a second crash is reclaimed with a distinct fence'
);

select throws_ok(
  format(
    'select public.complete_mvp_edit_package(%L,%s,%L,%L,%L,2048)',
    'c1c00000-0000-4000-8000-000000000001',
    (select value->>'version' from mvp_pipeline_fixture where key='package-claim-1'),
    (select value->>'claim_token' from mvp_pipeline_fixture where key='package-claim-1'),
    'c1100000-0000-4000-8000-000000000001/mvp-edit-packages/c1b00000-0000-4000-8000-0000000000e1/1/approved-assets.zip',
    repeat('e',64)
  ),
  '40001','edit package completion is stale',
  'the first reclaimed worker also loses CAS authority after the next reclaim'
);

select lives_ok(
  format(
    'select public.complete_mvp_edit_package(%L,%s,%L,%L,%L,2048)',
    'c1c00000-0000-4000-8000-000000000001',
    (select value->>'version' from mvp_pipeline_fixture where key='package-claim-2'),
    (select value->>'claim_token' from mvp_pipeline_fixture where key='package-claim-2'),
    'c1100000-0000-4000-8000-000000000001/mvp-edit-packages/c1b00000-0000-4000-8000-0000000000e1/1/approved-assets.zip',
    repeat('e',64)
  ),
  'the current lease completes the canonical package'
);

select lives_ok(
  format(
    'select public.complete_mvp_edit_package(%L,%s,%L,%L,%L,2048)',
    'c1c00000-0000-4000-8000-000000000001',
    (select value->>'version' from mvp_pipeline_fixture where key='package-claim-1'),
    (select value->>'claim_token' from mvp_pipeline_fixture where key='package-claim-1'),
    'c1100000-0000-4000-8000-000000000001/mvp-edit-packages/c1b00000-0000-4000-8000-0000000000e1/1/approved-assets.zip',
    repeat('e',64)
  ),
  'an exact completion replay reconciles a lost response idempotently'
);

select throws_ok(
  format(
    'select public.complete_mvp_edit_package(%L,%s,%L,%L,%L,2048)',
    'c1c00000-0000-4000-8000-000000000001',
    (select value->>'version' from mvp_pipeline_fixture where key='package-claim-1'),
    (select value->>'claim_token' from mvp_pipeline_fixture where key='package-claim-1'),
    'c1100000-0000-4000-8000-000000000001/mvp-edit-packages/c1b00000-0000-4000-8000-0000000000e1/1/approved-assets.zip',
    repeat('f',64)
  ),
  '40001','edit package completion conflicts with committed output',
  'a conflicting post-upload replay fails closed'
);

reset role;

select ok(
  (select state from public.mvp_edit_packages
    where id='c1c00000-0000-4000-8000-000000000001') = 'ready'
  and (select claim_token is null and lease_expires_at is null
    from public.mvp_edit_packages
    where id='c1c00000-0000-4000-8000-000000000001'),
  'terminal package evidence clears its lease and remains ready'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('worker_claim_token'),('worker_lease_expires_at'),
      ('worker_fencing_token')
    ) as required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'mvp_production_jobs'
        and actual.column_name = required.column_name
    )
  ),
  'production jobs persist the worker lease and monotonically increasing fence'
);

select ok(
  has_column_privilege(
    'authenticated','public.mvp_production_jobs','state','select'
  )
  and not has_column_privilege(
    'authenticated','public.mvp_production_jobs','worker_claim_token','select'
  )
  and not has_column_privilege(
    'authenticated','public.mvp_production_jobs','worker_fencing_token','select'
  ),
  'member progress remains readable without disclosing worker authority'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.command_claim_next_mvp_production_job(integer)','execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_release_mvp_production_job(uuid,uuid,bigint)','execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_claim_next_mvp_production_job(integer)','execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_release_mvp_production_job(uuid,uuid,bigint)','execute'
  ),
  'only the service worker can claim or release production ownership'
);

select ok(
  to_regprocedure(
    'public.command_reserve_mvp_media_dispatch(uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint)'
  ) is not null
  and to_regprocedure(
    'public.command_claim_mvp_media_dispatch(uuid,bigint,integer)'
  ) is not null
  and to_regprocedure(
    'public.command_record_mvp_media_dispatch_submission(uuid,bigint,uuid,bigint,text,text,text)'
  ) is not null
  and to_regprocedure(
    'public.command_reconcile_mvp_media_dispatch_submission(uuid,bigint,uuid,bigint,uuid,integer,text,text,text,text,text,text)'
  ) is not null
  and to_regprocedure(
    'public.command_bind_mvp_media_dispatch_callback(uuid,bigint,uuid,bigint,text)'
  ) is not null
  and to_regprocedure(
    'public.command_reconcile_mvp_media_dispatch_webhook(uuid,text,text)'
  ) is not null
  and to_regprocedure(
    'public.command_fail_mvp_media_dispatch(uuid,bigint,uuid,bigint,boolean,text,text)'
  ) is not null
  and to_regprocedure(
    'public.command_complete_mvp_media_dispatch_output(uuid,text,text)'
  ) is not null,
  'media dispatch exposes the complete reserve claim receipt failure and output protocol'
);

select ok(
  has_table_privilege(
    'service_role','private.mvp_media_dispatches','select'
  )
  and not has_table_privilege(
    'service_role','private.mvp_media_dispatches','insert'
  )
  and not has_table_privilege(
    'service_role','private.mvp_media_dispatches','update'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_media_dispatch_worker','select'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_reserve_mvp_media_dispatch(uuid,uuid,uuid,integer,integer,text,text,text,text,bigint,bigint)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_reconcile_mvp_media_dispatch_submission(uuid,bigint,uuid,bigint,uuid,integer,text,text,text,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_bind_mvp_media_dispatch_callback(uuid,bigint,uuid,bigint,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_reconcile_mvp_media_dispatch_webhook(uuid,text,text)',
    'execute'
  ),
  'dispatch intent is command-only and provider receipts remain service-private'
);

select ok(
  (select column_default = 'true'
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'mvp_storyboard_frames'
      and column_name = 'provider_dispatch_required')
  and (select column_default = 'true'
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'mvp_production_clips'
      and column_name = 'provider_dispatch_required')
  and exists (
    select 1 from pg_constraint
    where conname = 'mvp_storyboard_frames_provider_dispatch_match_fk'
      and contype = 'f'
  )
  and exists (
    select 1 from pg_constraint
    where conname = 'mvp_production_clips_provider_dispatch_match_fk'
      and contype = 'f'
  ),
  'new storyboard and clip rows require an exact composite dispatch lineage'
);

select ok(
  exists (
    select 1 from information_schema.triggers
    where event_object_schema = 'private'
      and event_object_table = 'mvp_storyboard_frames'
      and trigger_name = 'mvp_storyboard_frames_enforce_provider_dispatch'
  )
  and exists (
    select 1 from information_schema.triggers
    where event_object_schema = 'private'
      and event_object_table = 'mvp_production_clips'
      and trigger_name = 'mvp_production_clips_enforce_provider_dispatch'
  ),
  'provider receipt bindings are revalidated whenever media evidence changes'
);

set local session_replication_role = replica;

insert into public.production_runs(
  id,workspace_id,episode_id,series_id,configuration_candidate_id,
  series_release_id,series_release_component_id,production_quote_id,
  budget_authorization_id,budget_reservation_id,run_number,authority_epoch,
  pinned_manifest_hash,authorized_high_microusd,hard_ceiling_microusd,created_by,
  authority_profile_id,authority_profile_epoch,authority_provenance
) values
(
  'c1a00000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1a10000-0000-4000-8000-000000000002',
  'c1a20000-0000-4000-8000-000000000002',
  'c1a30000-0000-4000-8000-000000000002',
  'c1a40000-0000-4000-8000-000000000002',
  'c1a50000-0000-4000-8000-000000000002',2,2,repeat('1',64),1000000,1000000,
  'c1200000-0000-4000-8000-000000000001',
  (select id from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  (select profile_epoch from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  'verified_aal2'
),
(
  'c1a00000-0000-4000-8000-000000000003',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1a10000-0000-4000-8000-000000000003',
  'c1a20000-0000-4000-8000-000000000003',
  'c1a30000-0000-4000-8000-000000000003',
  'c1a40000-0000-4000-8000-000000000003',
  'c1a50000-0000-4000-8000-000000000003',3,3,repeat('2',64),1000000,1000000,
  'c1200000-0000-4000-8000-000000000001',
  (select id from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  (select profile_epoch from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  'verified_aal2'
);

insert into public.mvp_production_jobs(
  production_run_id,workspace_id,episode_id,plan_bundle_id,
  narration_asset_version_id,state,attempt_number,version,created_at,updated_at,
  worker_claim_token,worker_lease_expires_at,worker_fencing_token,
  authority_profile_id,authority_profile_epoch,authority_provenance
) values
(
  'c1a00000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1900000-0000-4000-8000-000000000001',
  'c1a60000-0000-4000-8000-000000000001','generating',1,1,
  '2000-01-01 00:00:01+00','2000-01-01 00:00:01+00',null,null,0,
  (select id from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  (select profile_epoch from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  'verified_aal2'
),
(
  'c1a00000-0000-4000-8000-000000000003',
  'c1100000-0000-4000-8000-000000000001',
  'c1400000-0000-4000-8000-000000000001',
  'c1900000-0000-4000-8000-000000000001',
  'c1a60000-0000-4000-8000-000000000001','queued',1,7,
  '2000-01-01 00:00:00+00','2000-01-01 00:00:00+00',
  'c1a70000-0000-4000-8000-000000000003','2000-01-01 00:01:00+00',4,
  (select id from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  (select profile_epoch from private.workspace_authority_profiles where workspace_id='c1100000-0000-4000-8000-000000000001'),
  'verified_aal2'
);

set local session_replication_role = origin;

select set_config(
  'request.jwt.claims',
  '{"sub":"c1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
  true
);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select throws_ok(
  'select public.command_claim_next_mvp_production_job(300)',
  '42501','permission denied for function command_claim_next_mvp_production_job',
  'browser sessions cannot claim a production worker lease'
);

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

insert into mvp_pipeline_fixture(key,value)
select 'production-claim-1',
  public.command_claim_next_mvp_production_job(300);

select ok(
  (select value->>'production_run_id' from mvp_pipeline_fixture
    where key = 'production-claim-1') =
      'c1a00000-0000-4000-8000-000000000002'
  and (select (value->>'worker_fencing_token')::bigint
    from mvp_pipeline_fixture where key = 'production-claim-1') = 1
  and (select value->>'worker_claim_token' from mvp_pipeline_fixture
    where key = 'production-claim-1') is not null,
  'the eligible production job is claimed with its first exact fence'
);

select ok(
  (select state from public.mvp_production_jobs
    where production_run_id = 'c1a00000-0000-4000-8000-000000000003') =
      'failed'
  and (select last_error_code from public.mvp_production_jobs
    where production_run_id = 'c1a00000-0000-4000-8000-000000000003') =
      'PRODUCTION_OUTCOME_AMBIGUOUS'
  and (select worker_claim_token is null and worker_lease_expires_at is null
    from public.mvp_production_jobs
    where production_run_id = 'c1a00000-0000-4000-8000-000000000003'),
  'an expired spend-bearing queued claim fails closed and clears authority'
);

select is(
  public.command_claim_next_mvp_production_job(300),
  null::jsonb,
  'an active production lease cannot be claimed by a second worker'
);

reset role;
update public.mvp_production_jobs
set worker_lease_expires_at = statement_timestamp() - interval '1 second'
where production_run_id = 'c1a00000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

insert into mvp_pipeline_fixture(key,value)
select 'production-claim-2',
  public.command_claim_next_mvp_production_job(300);

select ok(
  (select (value->>'worker_fencing_token')::bigint
    from mvp_pipeline_fixture where key = 'production-claim-2') = 2
  and (select value->>'worker_claim_token' from mvp_pipeline_fixture
    where key = 'production-claim-2') <>
      (select value->>'worker_claim_token' from mvp_pipeline_fixture
        where key = 'production-claim-1'),
  'a reclaim mints a fresh token and increments the production fence'
);

select throws_ok(
  format(
    'select public.command_release_mvp_production_job(%L,%L,1)',
    'c1a00000-0000-4000-8000-000000000002',
    (select value->>'worker_claim_token' from mvp_pipeline_fixture
      where key = 'production-claim-1')
  ),
  '40001','production job release fence is stale',
  'the crashed production worker cannot release its successor lease'
);

select lives_ok(
  format(
    'select public.command_release_mvp_production_job(%L,%L,2)',
    'c1a00000-0000-4000-8000-000000000002',
    (select value->>'worker_claim_token' from mvp_pipeline_fixture
      where key = 'production-claim-2')
  ),
  'the current production worker can release its exact fence'
);

select ok(
  (select worker_claim_token is null and worker_lease_expires_at is null
    from public.mvp_production_jobs
    where production_run_id = 'c1a00000-0000-4000-8000-000000000002'),
  'production release clears the bearer lease without resetting its fence'
);

select throws_ok(
  format(
    'select public.command_reserve_mvp_media_dispatch(%L,%L,%L,1,1,%L,%L,%L,%L,25000,50000)',
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000002',
    'c1400000-0000-4000-8000-000000000001',
    'clip:2:motion','storyboard','fal-ai/nano-banana-2',repeat('3',64)
  ),
  '22023','media dispatch reservation is invalid',
  'dispatch kind key and shot number cannot disagree'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-reserve-1', public.command_reserve_mvp_media_dispatch(
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000002',
  'c1400000-0000-4000-8000-000000000001',1,1,
  'storyboard:1:single','storyboard','fal-ai/nano-banana-2',repeat('3',64),
  25000,50000
);

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key = 'dispatch-reserve-1') = 'reserved'
  and not (select (value->>'replayed')::boolean from mvp_pipeline_fixture
    where key = 'dispatch-reserve-1'),
  'the exact provider input is durably reserved before dispatch'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-reserve-replay', public.command_reserve_mvp_media_dispatch(
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000002',
  'c1400000-0000-4000-8000-000000000001',1,1,
  'storyboard:1:single','storyboard','fal-ai/nano-banana-2',repeat('3',64),
  25000,50000
);

select ok(
  (select value->>'id' from mvp_pipeline_fixture
    where key = 'dispatch-reserve-replay') =
      (select value->>'id' from mvp_pipeline_fixture
        where key = 'dispatch-reserve-1')
  and (select (value->>'replayed')::boolean from mvp_pipeline_fixture
    where key = 'dispatch-reserve-replay'),
  'an exact reservation retry reuses the immutable dispatch intent'
);

select throws_ok(
  format(
    'select public.command_reserve_mvp_media_dispatch(%L,%L,%L,1,1,%L,%L,%L,%L,25000,50000)',
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000002',
    'c1400000-0000-4000-8000-000000000001',
    'storyboard:1:single','storyboard','fal-ai/nano-banana-2/edit',repeat('3',64)
  ),
  '40001','media dispatch reservation conflicts with immutable intent',
  'an idempotency key cannot be reused for a different provider endpoint'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-claim-1', public.command_claim_mvp_media_dispatch(
  (select (value->>'id')::uuid from mvp_pipeline_fixture
    where key = 'dispatch-reserve-1'),1,120
);

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key = 'dispatch-claim-1') = 'dispatching'
  and (select (value->>'fencing_token')::bigint from mvp_pipeline_fixture
    where key = 'dispatch-claim-1') = 1
  and (select value->>'claim_token' from mvp_pipeline_fixture
    where key = 'dispatch-claim-1') is not null,
  'provider dispatch begins only after a fenced lease is committed'
);

select throws_ok(
  format(
    'select public.command_record_mvp_media_dispatch_submission(%L,2,%L,1,%L,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture where key='dispatch-claim-1'),
    (select value->>'claim_token' from mvp_pipeline_fixture
      where key='dispatch-claim-1'),
    'request_123456',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/wrong_request/status',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/response'
  ),
  '22023','media dispatch submission receipt is invalid',
  'a queue URL cannot be bound to a different provider request'
);

select throws_ok(
  format(
    'select public.command_reconcile_mvp_media_dispatch_submission(%L,2,%L,1,%L,1,%L,%L,%L,%L,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture where key='dispatch-claim-1'),
    (select value->>'claim_token' from mvp_pipeline_fixture
      where key='dispatch-claim-1'),
    'c1a00000-0000-4000-8000-000000000002',
    'storyboard:1:single','fal-ai/nano-banana-2/edit',repeat('3',64),
    'request_123456',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/status',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/response'
  ),
  '40001','media dispatch reconciliation conflicts with immutable intent',
  'a known provider receipt cannot be attached to different immutable input'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-submit-1', public.command_reconcile_mvp_media_dispatch_submission(
  (select (value->>'id')::uuid from mvp_pipeline_fixture
    where key='dispatch-claim-1'),
  (select (value->>'version')::bigint from mvp_pipeline_fixture
    where key='dispatch-claim-1'),
  (select (value->>'claim_token')::uuid from mvp_pipeline_fixture
    where key='dispatch-claim-1'),1,
  'c1a00000-0000-4000-8000-000000000002',1,
  'storyboard:1:single','fal-ai/nano-banana-2',repeat('3',64),
  'request_123456',
  'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/status',
  'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/response'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-submit-replay', public.command_reconcile_mvp_media_dispatch_submission(
  (select (value->>'id')::uuid from mvp_pipeline_fixture
    where key='dispatch-claim-1'),2,
  'c1a70000-0000-4000-8000-000000000099',99,
  'c1a00000-0000-4000-8000-000000000002',1,
  'storyboard:1:single','fal-ai/nano-banana-2',repeat('3',64),
  'request_123456',
  'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/status',
  'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/response'
);

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key='dispatch-submit-replay') = 'submitted'
  and (select value->>'version' from mvp_pipeline_fixture
    where key='dispatch-submit-replay') =
      (select value->>'version' from mvp_pipeline_fixture
        where key='dispatch-submit-1'),
  'an exact committed provider receipt replays without changing ledger version'
);

select throws_ok(
  format(
    'select public.command_record_mvp_media_dispatch_submission(%L,2,%L,1,%L,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture where key='dispatch-claim-1'),
    (select value->>'claim_token' from mvp_pipeline_fixture
      where key='dispatch-claim-1'),
    'request_654321',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_654321/status',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_654321/response'
  ),
  '40001','media dispatch receipt conflicts with committed submission',
  'a committed dispatch cannot be rebound to a different provider request'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-complete-1', public.command_complete_mvp_media_dispatch_output(
  (select (value->>'id')::uuid from mvp_pipeline_fixture
    where key='dispatch-submit-1'),'request_123456',repeat('4',64)
);
insert into mvp_pipeline_fixture(key,value)
select 'dispatch-complete-replay',
  public.command_complete_mvp_media_dispatch_output(
    (select (value->>'id')::uuid from mvp_pipeline_fixture
      where key='dispatch-submit-1'),'request_123456',repeat('4',64)
  );

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key='dispatch-complete-replay') = 'succeeded'
  and (select value->>'version' from mvp_pipeline_fixture
    where key='dispatch-complete-replay') =
      (select value->>'version' from mvp_pipeline_fixture
        where key='dispatch-complete-1')
  and (select value->>'output_content_sha256' from mvp_pipeline_fixture
    where key='dispatch-complete-replay') = repeat('4',64),
  'provider output completion is exact and idempotent after a lost response'
);

select throws_ok(
  format(
    'select public.command_complete_mvp_media_dispatch_output(%L,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture where key='dispatch-submit-1'),
    'request_123456',repeat('5',64)
  ),
  '40001','media dispatch output completion is stale',
  'a completed dispatch cannot be rebound to conflicting output bytes'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-expiring-reserve', public.command_reserve_mvp_media_dispatch(
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000002',
  'c1400000-0000-4000-8000-000000000001',1,2,
  'storyboard:2:single','storyboard','fal-ai/nano-banana-2',repeat('6',64),
  25000,50000
);
insert into mvp_pipeline_fixture(key,value)
select 'dispatch-expiring-claim', public.command_claim_mvp_media_dispatch(
  (select (value->>'id')::uuid from mvp_pipeline_fixture
    where key='dispatch-expiring-reserve'),1,120
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-expiring-callback-bind',
  public.command_bind_mvp_media_dispatch_callback(
    (select (value->>'id')::uuid from mvp_pipeline_fixture
      where key='dispatch-expiring-claim'),
    (select (value->>'version')::bigint from mvp_pipeline_fixture
      where key='dispatch-expiring-claim'),
    (select (value->>'claim_token')::uuid from mvp_pipeline_fixture
      where key='dispatch-expiring-claim'),
    (select (value->>'fencing_token')::bigint from mvp_pipeline_fixture
      where key='dispatch-expiring-claim'),
    encode(extensions.digest(repeat('A',43),'sha256'),'hex')
  );

select ok(
  (select value->>'callback_token_sha256' from mvp_pipeline_fixture
    where key='dispatch-expiring-callback-bind') =
      encode(extensions.digest(repeat('A',43),'sha256'),'hex'),
  'the opaque callback token is hash-bound before provider submission'
);

reset role;
update private.mvp_media_dispatches
set lease_expires_at = statement_timestamp() - interval '1 second'
where id = (select (value->>'id')::uuid from mvp_pipeline_fixture
  where key='dispatch-expiring-reserve');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

select throws_ok(
  format(
    'select public.command_fail_mvp_media_dispatch(%L,2,%L,1,false,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture
      where key='dispatch-expiring-claim'),
    (select value->>'claim_token' from mvp_pipeline_fixture
      where key='dispatch-expiring-claim'),
    'PROVIDER_SUBMISSION_REJECTED','Provider rejected the request.'
  ),
  '40001','media dispatch failure fence is stale',
  'an expired provider worker cannot author terminal dispatch evidence'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-expired-replay', public.command_reserve_mvp_media_dispatch(
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000002',
  'c1400000-0000-4000-8000-000000000001',1,2,
  'storyboard:2:single','storyboard','fal-ai/nano-banana-2',repeat('6',64),
  25000,50000
);

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key='dispatch-expired-replay') = 'outcome_unknown'
  and (select value->>'last_error_code' from mvp_pipeline_fixture
    where key='dispatch-expired-replay') = 'PROVIDER_OUTCOME_UNKNOWN'
  and (select value->>'claim_token' from mvp_pipeline_fixture
    where key='dispatch-expired-replay') is null,
  'an expired network-bound lease becomes outcome unknown and cannot resubmit'
);

select throws_ok(
  format(
    'select public.command_reconcile_mvp_media_dispatch_webhook(%L,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture
      where key='dispatch-expired-replay'),
    'request_654322',repeat('B',43)
  ),
  '40001','media dispatch callback binding does not match',
  'a signed provider receipt cannot be replayed into another media slot'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-webhook-reconcile',
  public.command_reconcile_mvp_media_dispatch_webhook(
    (select (value->>'id')::uuid from mvp_pipeline_fixture
      where key='dispatch-expired-replay'),
    'request_654322',repeat('A',43)
  );

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key='dispatch-webhook-reconcile') = 'submitted'
  and (select value->>'external_request_id' from mvp_pipeline_fixture
    where key='dispatch-webhook-reconcile') = 'request_654322'
  and (select value->>'status_url' from mvp_pipeline_fixture
    where key='dispatch-webhook-reconcile') =
      'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_654322/status'
  and (select value->>'last_error_code' from mvp_pipeline_fixture
    where key='dispatch-webhook-reconcile') is null,
  'a signed provider callback recovers the exact expired dispatch without resubmission'
);

select lives_ok(
  format(
    'select public.command_reserve_mvp_media_dispatch(%L,%L,%L,1,3,%L,%L,%L,%L,0,900000)',
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000002',
    'c1400000-0000-4000-8000-000000000001',
    'clip:3:motion','clip','fal-ai/bytedance/seedance-v1',repeat('7',64)
  ),
  'aggregate reservation can consume the exact remaining run authority'
);

select throws_ok(
  format(
    'select public.command_reserve_mvp_media_dispatch(%L,%L,%L,1,4,%L,%L,%L,%L,0,1)',
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000002',
    'c1400000-0000-4000-8000-000000000001',
    'clip:4:motion','clip','fal-ai/bytedance/seedance-v1',repeat('8',64)
  ),
  '23514',
  'media dispatch aggregate maximum exceeds production run authority',
  'a distinct dispatch cannot oversubscribe aggregate production authority'
);

select lives_ok(
  format(
    'insert into public.mvp_storyboard_frame_worker(workspace_id,episode_id,production_run_id,plan_bundle_id,attempt_number,shot_number,composition_mode,endpoint,model_key,prompt,system_prompt,binding_manifest,state,external_request_id,status_url,response_url,object_name,content_sha256,byte_length,media_mime,width,height,completed_at,frame_role,provider_dispatch_id) values(%L,%L,%L,%L,1,1,%L,%L,%L,%L,null,%L::jsonb,%L,%L,%L,%L,%L,%L,2048,%L,1080,1920,statement_timestamp(),%L,%L)',
    'c1100000-0000-4000-8000-000000000001',
    'c1400000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000002',
    'c1900000-0000-4000-8000-000000000001','single_frame',
    'fal-ai/nano-banana-2','fal-ai/nano-banana-2',
    'A single respectful devotional frame.','[]','complete','request_123456',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/status',
    'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_123456/response',
    'c1100000-0000-4000-8000-000000000001/mvp-storyboards/c1a00000-0000-4000-8000-000000000002/1/1.png',
    repeat('4',64),'image/png','single',
    (select value->>'id' from mvp_pipeline_fixture where key='dispatch-complete-1')
  ),
  'a completed storyboard binds to its exact succeeded provider output'
);

select throws_ok(
  $sql$
    insert into public.mvp_storyboard_frame_worker(
      workspace_id,episode_id,production_run_id,plan_bundle_id,
      attempt_number,shot_number,composition_mode,endpoint,model_key,prompt,
      system_prompt,binding_manifest,state,external_request_id,status_url,
      response_url,frame_role
    ) values(
      'c1100000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001',
      'c1a00000-0000-4000-8000-000000000002',
      'c1900000-0000-4000-8000-000000000001',1,3,'single_frame',
      'fal-ai/nano-banana-2','fal-ai/nano-banana-2',
      'An unbound provider frame.',null,'[]'::jsonb,'submitted',
      'request_333333',
      'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_333333/status',
      'https://queue.fal.run/fal-ai/nano-banana-2/requests/request_333333/response',
      'single'
    )
  $sql$,
  '23514','provider dispatch evidence is required',
  'new storyboard submissions cannot bypass the durable dispatch ledger'
);

reset role;

select ok(
  exists (
    select 1 from private.mvp_storyboard_frames frame
    join private.mvp_media_dispatches dispatch
      on dispatch.id = frame.provider_dispatch_id
    where frame.production_run_id =
        'c1a00000-0000-4000-8000-000000000002'
      and frame.shot_number = 1
      and frame.content_sha256 = dispatch.output_content_sha256
      and frame.external_request_id = dispatch.external_request_id
      and dispatch.dispatch_key = 'storyboard:1:single'
      and dispatch.state = 'succeeded'
  ),
  'persisted storyboard evidence retains the exact dispatch receipt and bytes'
);

select * from finish();

rollback;

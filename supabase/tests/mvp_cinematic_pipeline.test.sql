-- Focused database contract for the autonomous MVP cinematic pipeline.
-- Run after migrations through 20260722194700.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth,storage,private,audit,pg_catalog;

select plan(120);

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
insert into public.narration_master_clock_versions(
  id,workspace_id,configuration_candidate_id,preflight_run_id,
  script_revision_id,audio_identity_selection_id,narration_asset_version_id,
  version_number,duration_ms,processing_text_sha256,alignment_hash,
  audio_evidence_hash,performance_profile_hash,segment_count,state
) values(
  'c1920000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1910000-0000-4000-8000-000000000001',
  'c1510000-0000-4000-8000-000000000001',
  'c1920000-0000-4000-8000-000000000002',
  'c1a60000-0000-4000-8000-000000000001',1,60000,
  repeat('1',64),repeat('2',64),repeat('3',64),repeat('4',64),1,'verified'
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
    'select public.command_review_mvp_master(%L,%L,1,%L,false,true,%L)',
    'c1100000-0000-4000-8000-000000000001',
    'c1b00000-0000-4000-8000-000000000001','approve',''
  ),
  '23514',
  'explicit cultural review confirmation is required',
  'final approval cannot fabricate a cultural confirmation from a false request flag'
);

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
    'public.command_complete_mvp_media_dispatch_output(uuid,text,text,numeric,text,text,numeric,numeric,numeric,bigint,timestamptz,text)'
  ) is not null
  and to_regprocedure(
    'public.command_record_mvp_media_billing_unreconciled(uuid,text,text)'
  ) is not null,
  'media dispatch exposes reserve claim receipt billing failure and costed output protocols'
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

select ok(
  (select count(*)=8 from information_schema.columns
    where table_schema='private' and table_name='mvp_media_dispatches'
      and column_name=any(array[
        'rate_card_version_id','cost_evidence_state','cost_evidence_required',
        'provider_reported_billable_units','estimated_unit_price_microusd',
        'estimated_cost_microusd','provider_usage_evidence_sha256',
        'billing_error_code'
      ]))
  and (select column_default='true' from information_schema.columns
    where table_schema='private' and table_name='mvp_media_dispatches'
      and column_name='cost_evidence_required')
  and (select count(*)=4 from information_schema.columns
    where table_schema='private' and table_name='mvp_production_sfx'
      and column_name=any(array[
        'provider_usage_unit_price_microusd','provider_actual_cost_microusd',
        'provider_rate_card_version_id','provider_billing_evidence_sha256'
      ])),
  'FAL usage and estimates are not mislabeled as exact provider charges'
);

select ok(
  exists(select 1 from pg_constraint
    where conname='production_rate_card_versions_line_kind_check'
      and pg_get_constraintdef(oid) like '%provider_storyboard%')
  and exists(select 1 from information_schema.triggers
    where event_object_schema='public' and event_object_table='production_quotes'
      and trigger_name='production_quotes_require_storyboard_cost')
  and exists(select 1 from information_schema.triggers
    where event_object_schema='private' and event_object_table='mvp_media_dispatches'
      and trigger_name='mvp_media_dispatches_bind_rate'),
  'new quotes and provider dispatches bind the exact storyboard rate authority'
);

select ok(
  to_regclass('private.mvp_storyboard_quote_compatibility_authorities') is not null
  and to_regclass(
    'private.mvp_storyboard_quote_compatibility_dispatch_terms'
  ) is not null
  and to_regclass(
    'private.mvp_storyboard_quote_compatibility_owner_authorizations'
  ) is not null
  and exists(select 1 from information_schema.triggers
    where event_object_schema='private'
      and event_object_table='mvp_storyboard_quote_compatibility_authorities'
      and trigger_name='mvp_storyboard_quote_compatibility_authorities_immutable')
  and exists(select 1 from information_schema.triggers
    where event_object_schema='private'
      and event_object_table='mvp_storyboard_quote_compatibility_dispatch_terms'
      and trigger_name='mvp_storyboard_quote_compatibility_dispatch_terms_immutable')
  and exists(select 1 from information_schema.triggers
    where event_object_schema='private'
      and event_object_table=
        'mvp_storyboard_quote_compatibility_owner_authorizations'
      and trigger_name=
        'mvp_storyboard_compat_owner_authorizations_immutable')
  and not has_table_privilege(
    'service_role','private.mvp_storyboard_quote_compatibility_authorities','select'
  )
  and not has_table_privilege(
    'service_role',
    'private.mvp_storyboard_quote_compatibility_owner_authorizations','select'
  ),
  'legacy storyboard compatibility and owner authority are immutable and private'
);

select ok(
  has_function_privilege(
    'service_role','public.get_mvp_storyboard_cost_authority(uuid,uuid)','execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_reconcile_legacy_mvp_media_dispatch_rates()','execute'
  )
  and not has_function_privilege(
    'authenticated','public.get_mvp_storyboard_cost_authority(uuid,uuid)','execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.authorize_mvp_legacy_storyboard_owner_start(uuid,uuid,uuid,bigint)',
    'execute'
  )
  and pg_get_functiondef(
    'public.command_start_mvp_production(uuid,uuid)'::regprocedure
  ) like '%authorize_mvp_legacy_storyboard_owner_start%'
  and pg_get_functiondef(
    'private.assert_workspace_action_authority(uuid,text)'::regprocedure
  ) like '%authorityReceiptId%',
  'Start alone binds exact owner authority; workers only read cost authority'
);

select ok(
  has_function_privilege(
    'authenticated','public.get_mvp_episode_costs(uuid)','execute'
  )
  and not has_function_privilege(
    'anon','public.get_mvp_episode_costs(uuid)','execute'
  )
  and not has_table_privilege(
    'authenticated','private.mvp_media_dispatches','select'
  )
  and not has_table_privilege(
    'authenticated','private.mvp_production_sfx','select'
  )
  and pg_get_functiondef('public.get_mvp_episode_costs(uuid)'::regprocedure)
    like '%mvp_repair_feedback_grounding_versions%'
  and pg_get_functiondef('public.get_mvp_episode_costs(uuid)'::regprocedure)
    like '%incomplete_uncosted_repair_director%'
  and pg_get_functiondef('public.get_mvp_episode_costs(uuid)'::regprocedure)
    like '%provider_billing_event_recorded%',
  'members see provider billing-event costs or an explicit incomplete status'
);

set local session_replication_role = replica;

insert into private.production_rate_card_versions(
  id,rate_key,version_number,line_kind,capability_version_id,currency,
  unit_name,unit_price_microusd,minimum_quantity,maximum_line_microusd,
  mandatory_addon,pricing_evidence_snapshot_id,rate_hash,verified_at,
  expires_at,state
) values(
  'c1a80000-0000-4000-8000-000000000001','storyboard_generation',1,
  'provider_storyboard',null,'USD','billing_quantum',80000,0,50000000,true,
  'c1a80000-0000-4000-8000-000000000002',repeat('8',64),
  '2026-01-01 00:00:00+00','2099-01-01 00:00:00+00','verified'
);

insert into public.production_quotes(
  id,workspace_id,configuration_candidate_id,plan_bundle_id,
  plan_qc_consensus_id,quote_number,quote_hash,rate_snapshot_hash,currency,
  low_total_microusd,expected_total_microusd,high_total_microusd,
  hard_ceiling_microusd,target_40usd_breached,expires_at,created_at
) values(
  'c1a30000-0000-4000-8000-000000000003',
  'c1100000-0000-4000-8000-000000000001',
  'c1500000-0000-4000-8000-000000000001',
  'c1900000-0000-4000-8000-000000000001',
  'c1ac0000-0000-4000-8000-000000000003',3,repeat('3',64),repeat('4',64),
  'USD',1000000,1000000,1000000,1000000,false,
  '2099-01-01 00:00:00+00','2026-01-01 00:00:00+00'
);

insert into public.production_quote_confirmations(
  id,workspace_id,production_quote_id,quote_hash,hard_ceiling_microusd,
  confirmed_by,actor_aal,command_id,confirmed_at,authority_profile_id,
  authority_profile_epoch,authority_provenance
) values(
  'c1ad0000-0000-4000-8000-000000000003',
  'c1100000-0000-4000-8000-000000000001',
  'c1a30000-0000-4000-8000-000000000003',repeat('3',64),1000000,
  'c1200000-0000-4000-8000-000000000001','aal2',
  'c1ae0000-0000-4000-8000-000000000003','2000-01-01 00:00:00+00',
  'c1150000-0000-4000-8000-000000000001',1,'verified_aal2'
);

insert into public.production_quote_lines(
  id,workspace_id,production_quote_id,line_number,line_key,line_kind,
  provider_request_slot_id,rate_card_version_id,low_quantity,expected_quantity,
  high_quantity,low_amount_microusd,expected_amount_microusd,
  high_amount_microusd,evidence_hash
) values(
  'c1a90000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1a30000-0000-4000-8000-000000000002',1,
  'storyboard_generation','provider_storyboard',null,
  'c1a80000-0000-4000-8000-000000000001',1.525,1.525,1.525,
  122000,122000,122000,repeat('9',64)
);

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
  'c1a50000-0000-4000-8000-000000000002',2,2,repeat('1',64),366000,366000,
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

insert into private.mvp_storyboard_quote_compatibility_authorities(
  id,workspace_id,production_run_id,production_quote_id,plan_bundle_id,
  quote_hash,source_edd_content_sha256,storyboard_rate_card_version_id,
  storyboard_billing_quantum_count,per_frame_expected_cost_microusd,
  authorized_attempt_count,authorized_additional_maximum_microusd,
  authority_reason,authority_manifest_sha256
) values(
  'c1aa0000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000003',
  'c1a30000-0000-4000-8000-000000000003',
  'c1900000-0000-4000-8000-000000000001',
  repeat('3',64),repeat('e',64),
  'c1a80000-0000-4000-8000-000000000001',3.05,122000,20,4880000,
  'legacy_quote_without_storyboard_line',repeat('a',64)
);

insert into private.mvp_storyboard_quote_compatibility_dispatch_terms(
  id,compatibility_authority_id,workspace_id,production_run_id,
  expected_cost_microusd,maximum_cost_microusd,legacy_contract_git_commit,
  compatibility_reason,terms_manifest_sha256
) values(
  'c1aa0000-0000-4000-8000-000000000002',
  'c1aa0000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000003',120000,120000,
  '35ff40f15af820514913fbf19c4ec0a9e7699845',
  'legacy_storyboard_worker_reservation_replay',repeat('d',64)
);

insert into private.mvp_media_dispatches(
  id,workspace_id,production_run_id,episode_id,attempt_number,shot_number,
  dispatch_key,media_kind,endpoint,input_manifest_sha256,
  expected_cost_microusd,maximum_cost_microusd,state,version,fencing_token,
  external_request_id,status_url,response_url,dispatched_at,
  cost_evidence_state,cost_evidence_required
) values(
  'c1ab0000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000003',
  'c1400000-0000-4000-8000-000000000001',1,2,
  'storyboard:2:single','storyboard','fal-ai/nano-banana-2',repeat('b',64),
  120000,120000,'submitted',2,1,'legacy_request_123456',
  'https://queue.fal.run/fal-ai/nano-banana-2/requests/legacy_request_123456/status',
  'https://queue.fal.run/fal-ai/nano-banana-2/requests/legacy_request_123456/response',
  statement_timestamp(),'pending',false
);

-- A separate exact-single-owner fixture proves that the compatibility amount
-- is authorized by durable owner evidence rather than by the calculation.
insert into public.workspaces(id,organization_id,name,slug) values(
  'c2100000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'Owner compatibility','owner-compatibility'
);
insert into public.memberships(
  workspace_id,user_id,role,status,authority_epoch,activated_at
) values(
  'c2100000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001','admin','active',1,
  '2000-02-01 00:00:00+00'
);
insert into private.workspace_authority_profiles(
  id,workspace_id,profile_kind,owner_user_id,profile_epoch,activated_at
) values(
  'c2150000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001','single_owner_developer',
  'c1200000-0000-4000-8000-000000000001',1,
  '2000-02-01 00:00:00+00'
);
insert into public.series(
  id,workspace_id,slug,title,owner_user_id,created_by
) values(
  'c2300000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001','owner-compatibility',
  'Owner compatibility','c1200000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001'
);
insert into public.episodes(
  id,workspace_id,series_id,episode_number,title,owner_user_id,created_by
) values(
  'c2400000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001',1,'Owner compatibility',
  'c1200000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000001'
);
insert into public.production_quotes(
  id,workspace_id,configuration_candidate_id,plan_bundle_id,
  plan_qc_consensus_id,quote_number,quote_hash,rate_snapshot_hash,currency,
  low_total_microusd,expected_total_microusd,high_total_microusd,
  hard_ceiling_microusd,target_40usd_breached,expires_at,created_at
) values(
  'c2a30000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000001',
  'c2900000-0000-4000-8000-000000000001',
  'c29c0000-0000-4000-8000-000000000001',1,repeat('5',64),repeat('6',64),
  'USD',0,0,0,0,false,'2099-01-01 00:00:00+00',
  '2000-02-01 00:00:00+00'
);
insert into public.production_quote_confirmations(
  id,workspace_id,production_quote_id,quote_hash,hard_ceiling_microusd,
  confirmed_by,actor_aal,command_id,confirmed_at,authority_profile_id,
  authority_profile_epoch,authority_provenance
) values(
  'c2ad0000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001',
  'c2a30000-0000-4000-8000-000000000001',repeat('5',64),0,
  'c1200000-0000-4000-8000-000000000001','aal1',
  'c2ae0000-0000-4000-8000-000000000001','2000-02-01 00:00:00+00',
  'c2150000-0000-4000-8000-000000000001',1,
  'verified_single_owner_developer'
);
insert into public.production_runs(
  id,workspace_id,episode_id,series_id,configuration_candidate_id,
  series_release_id,series_release_component_id,production_quote_id,
  budget_authorization_id,budget_reservation_id,run_number,authority_epoch,
  pinned_manifest_hash,authorized_high_microusd,hard_ceiling_microusd,
  created_by,authority_profile_id,authority_profile_epoch,authority_provenance
) values(
  'c2a00000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001',
  'c2300000-0000-4000-8000-000000000001',
  'c2500000-0000-4000-8000-000000000001',
  'c2a10000-0000-4000-8000-000000000001',
  'c2a20000-0000-4000-8000-000000000001',
  'c2a30000-0000-4000-8000-000000000001',
  'c2a40000-0000-4000-8000-000000000001',
  'c2a50000-0000-4000-8000-000000000001',1,1,repeat('7',64),0,0,
  'c1200000-0000-4000-8000-000000000001',
  'c2150000-0000-4000-8000-000000000001',1,
  'verified_single_owner_developer'
);
insert into public.mvp_production_jobs(
  production_run_id,workspace_id,episode_id,plan_bundle_id,
  narration_asset_version_id,state,attempt_number,version,created_at,updated_at,
  authority_profile_id,authority_profile_epoch,authority_provenance
) values(
  'c2a00000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001',
  'c2900000-0000-4000-8000-000000000001',
  'c2a60000-0000-4000-8000-000000000001','review_ready',1,1,
  '2000-02-01 00:00:00+00','2000-02-01 00:00:00+00',
  'c2150000-0000-4000-8000-000000000001',1,
  'verified_single_owner_developer'
);
insert into private.workspace_authority_receipts(
  workspace_id,authority_profile_id,authority_profile_epoch,action_key,
  actor_user_id,actor_aal,authority_provenance,created_at
) values(
  'c2100000-0000-4000-8000-000000000001',
  'c2150000-0000-4000-8000-000000000001',1,'mvp_start',
  'c1200000-0000-4000-8000-000000000001','aal1',
  'verified_single_owner_developer','2000-02-01 00:00:00+00'
);
insert into private.mvp_storyboard_quote_compatibility_authorities(
  id,workspace_id,production_run_id,production_quote_id,plan_bundle_id,
  quote_hash,source_edd_content_sha256,storyboard_rate_card_version_id,
  storyboard_billing_quantum_count,per_frame_expected_cost_microusd,
  authorized_attempt_count,authorized_additional_maximum_microusd,
  authority_reason,authority_manifest_sha256
) values(
  'c2aa0000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001',
  'c2a00000-0000-4000-8000-000000000001',
  'c2a30000-0000-4000-8000-000000000001',
  'c2900000-0000-4000-8000-000000000001',repeat('5',64),repeat('8',64),
  'c1a80000-0000-4000-8000-000000000001',3.05,122000,20,4880000,
  'legacy_quote_without_storyboard_line',repeat('f',64)
);
insert into private.mvp_storyboard_quote_compatibility_dispatch_terms(
  id,compatibility_authority_id,workspace_id,production_run_id,
  expected_cost_microusd,maximum_cost_microusd,legacy_contract_git_commit,
  compatibility_reason,terms_manifest_sha256
) values(
  'c2aa0000-0000-4000-8000-000000000002',
  'c2aa0000-0000-4000-8000-000000000001',
  'c2100000-0000-4000-8000-000000000001',
  'c2a00000-0000-4000-8000-000000000001',120000,120000,
  '35ff40f15af820514913fbf19c4ec0a9e7699845',
  'legacy_storyboard_worker_reservation_replay',repeat('0',64)
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

select throws_ok(
  $$select public.get_mvp_storyboard_cost_authority(
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000003'
  )$$,
  '23514','storyboard cost authority is unavailable',
  'a synthesized compatibility calculation has no spend authority by itself'
);

reset role;
select is(
  private.reconcile_mvp_legacy_storyboard_owner_authorities(),
  1,
  'the exact owner quote and MVP start evidence authorize compatibility once'
);

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

select ok(
  public.get_mvp_storyboard_cost_authority(
    'c2100000-0000-4000-8000-000000000001',
    'c2a00000-0000-4000-8000-000000000001'
  )->>'source'='legacy_quote_compatibility'
  and not exists(select 1 from public.production_quote_lines
    where production_quote_id='c2a30000-0000-4000-8000-000000000001'
      and line_key='storyboard_generation'),
  'an owner-started legacy run gains authority without changing its quote'
);

select is(
  public.command_reconcile_legacy_mvp_media_dispatch_rates(),
  1,
  'an in-flight legacy FAL dispatch is reconciled to its compatibility rate'
);

reset role;
select ok(
  (select rate_card_version_id='c1a80000-0000-4000-8000-000000000001'
      and cost_evidence_required
    from private.mvp_media_dispatches
    where id='c1ab0000-0000-4000-8000-000000000001'),
  'the reconciled FAL dispatch can complete with exact provider usage evidence'
);

set local role service_role;
insert into mvp_pipeline_fixture(key,value)
select 'legacy-storyboard-dispatch',public.command_reserve_mvp_media_dispatch(
  'c2100000-0000-4000-8000-000000000001',
  'c2a00000-0000-4000-8000-000000000001',
  'c2400000-0000-4000-8000-000000000001',1,1,
  'storyboard:1:single','storyboard','fal-ai/nano-banana-2',repeat('c',64),
  120000,120000
);

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key='legacy-storyboard-dispatch')='reserved'
  and (select value->>'rate_card_version_id' from mvp_pipeline_fixture
    where key='legacy-storyboard-dispatch')=
      'c1a80000-0000-4000-8000-000000000001',
  'an older locked run can reserve a cost-bound storyboard without rewriting its quote'
);

reset role;
set local session_replication_role = replica;
update public.memberships
set role='admin'
where workspace_id='c1100000-0000-4000-8000-000000000001'
  and user_id='c1200000-0000-4000-8000-000000000001';
update public.memberships
set status='deactivated',deactivated_at=statement_timestamp()
where workspace_id='c1100000-0000-4000-8000-000000000001'
  and user_id='c1200000-0000-4000-8000-000000000002';
update private.workspace_authority_profiles
set profile_kind='single_owner_developer',
    owner_user_id='c1200000-0000-4000-8000-000000000001',
    transitioned_at=null,transition_reason=null
where id='c1150000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

select set_config(
  'request.jwt.claims',
  '{"sub":"c1200000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","session_id":"c1210000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub','c1200000-0000-4000-8000-000000000001',true
);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select lives_ok(
  $$select public.command_start_mvp_production(
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000003'
  )$$,
  'the exact owner Start atomically authorizes a post-migration legacy run'
);

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
insert into mvp_pipeline_fixture(key,value)
select 'runtime-legacy-owner-authority',
  public.get_mvp_storyboard_cost_authority(
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000003'
  );
reset role;
select ok(
  (select value->>'source'
   from mvp_pipeline_fixture
   where key='runtime-legacy-owner-authority')='legacy_quote_compatibility'
  and exists(
    select 1
    from private.mvp_storyboard_quote_compatibility_owner_authorizations approval
    join private.workspace_authority_receipts receipt
      on receipt.id=approval.mvp_start_authority_receipt_id
    where approval.production_run_id=
        'c1a00000-0000-4000-8000-000000000003'
      and approval.owner_user_id=
        'c1200000-0000-4000-8000-000000000001'
      and receipt.action_key='mvp_start'
      and receipt.actor_user_id=approval.owner_user_id
      and receipt.actor_aal='aal2'
  ),
  'runtime compatibility authority is bound to that exact owner Start receipt'
);

set local session_replication_role = replica;
update public.memberships
set role='member'
where workspace_id='c1100000-0000-4000-8000-000000000001'
  and user_id='c1200000-0000-4000-8000-000000000001';
update public.memberships
set status='active',deactivated_at=null
where workspace_id='c1100000-0000-4000-8000-000000000001'
  and user_id='c1200000-0000-4000-8000-000000000002';
update private.workspace_authority_profiles
set profile_kind='managed_team',owner_user_id=null,
    transitioned_at=null,transition_reason=null
where id='c1150000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
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
  122000,122000
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
  122000,122000
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
    'select public.command_reserve_mvp_media_dispatch(%L,%L,%L,1,1,%L,%L,%L,%L,122000,122000)',
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
select 'dispatch-billing-unreconciled-1',
  public.command_record_mvp_media_billing_unreconciled(
    (select (value->>'id')::uuid from mvp_pipeline_fixture
      where key='dispatch-submit-1'),
    'request_123456','The provider result is missing exact billing evidence.'
  );
insert into mvp_pipeline_fixture(key,value)
select 'dispatch-billing-unreconciled-replay',
  public.command_record_mvp_media_billing_unreconciled(
    (select (value->>'id')::uuid from mvp_pipeline_fixture
      where key='dispatch-submit-1'),
    'request_123456','The provider result is missing exact billing evidence.'
  );

select ok(
  (select value->>'cost_evidence_state' from mvp_pipeline_fixture
    where key='dispatch-billing-unreconciled-replay')='unreconciled'
  and (select value->>'version' from mvp_pipeline_fixture
    where key='dispatch-billing-unreconciled-replay')=
      (select value->>'version' from mvp_pipeline_fixture
        where key='dispatch-billing-unreconciled-1')
  and (select value->>'estimated_cost_microusd' from mvp_pipeline_fixture
    where key='dispatch-billing-unreconciled-replay') is null,
  'a missing billing header is explicit and an exact retry does not churn or record zero'
);

select throws_ok(
  format(
    'select public.command_record_mvp_media_billing_unreconciled(%L,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture where key='dispatch-submit-1'),
    'request_123456','A conflicting billing failure summary.'
  ),
  '40001','media dispatch billing failure is stale',
  'an unreconciled billing receipt cannot be rebound to conflicting evidence'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-complete-1', public.command_complete_mvp_media_dispatch_output(
  (select (value->>'id')::uuid from mvp_pipeline_fixture
    where key='dispatch-submit-1'),'request_123456',repeat('4',64),
    1.525,repeat('6',64),'fal-ai/nano-banana-2',1.525,0.08,10,
    109800000,'2026-01-02 00:00:00+00',repeat('7',64)
);
insert into mvp_pipeline_fixture(key,value)
select 'dispatch-complete-replay',
  public.command_complete_mvp_media_dispatch_output(
    (select (value->>'id')::uuid from mvp_pipeline_fixture
      where key='dispatch-submit-1'),'request_123456',repeat('4',64),
      1.525,repeat('6',64),'fal-ai/nano-banana-2',1.525,0.08,10,
      109800000,'2026-01-02 00:00:00+00',repeat('7',64)
  );

select ok(
  (select value->>'state' from mvp_pipeline_fixture
    where key='dispatch-complete-replay') = 'succeeded'
  and (select value->>'version' from mvp_pipeline_fixture
    where key='dispatch-complete-replay') =
      (select value->>'version' from mvp_pipeline_fixture
        where key='dispatch-complete-1')
  and (select value->>'output_content_sha256' from mvp_pipeline_fixture
    where key='dispatch-complete-replay') = repeat('4',64)
  and (select value->>'cost_evidence_state'
    from mvp_pipeline_fixture where key='dispatch-complete-replay')=
      'provider_billing_event_recorded'
  and (select (value->>'estimated_cost_microusd')::bigint
    from mvp_pipeline_fixture where key='dispatch-complete-replay')=122000
  and (select value->>'provider_usage_evidence_sha256'
    from mvp_pipeline_fixture where key='dispatch-complete-replay')=repeat('6',64)
  and (select (value->>'provider_billing_event_cost_nano_usd')::bigint
    from mvp_pipeline_fixture where key='dispatch-complete-replay')=109800000
  and (select value->>'provider_billing_event_evidence_sha256'
    from mvp_pipeline_fixture where key='dispatch-complete-replay')=repeat('7',64),
  'provider output completion stores the request billing event and is idempotent'
);

select throws_ok(
  format(
    'select public.command_complete_mvp_media_dispatch_output(%L,%L,%L,1.525,%L,%L,1.525,0.08,10,109800000,%L,%L)',
    (select value->>'id' from mvp_pipeline_fixture where key='dispatch-submit-1'),
    'request_123456',repeat('5',64),repeat('6',64),
    'fal-ai/nano-banana-2','2026-01-02 00:00:00+00',repeat('7',64)
  ),
  '40001','media dispatch cost evidence conflicts with completion',
  'a completed dispatch cannot be rebound to conflicting output bytes'
);

insert into mvp_pipeline_fixture(key,value)
select 'dispatch-expiring-reserve', public.command_reserve_mvp_media_dispatch(
  'c1100000-0000-4000-8000-000000000001',
  'c1a00000-0000-4000-8000-000000000002',
  'c1400000-0000-4000-8000-000000000001',1,2,
  'storyboard:2:single','storyboard','fal-ai/nano-banana-2',repeat('6',64),
  122000,122000
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
  122000,122000
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
    'select public.command_reserve_mvp_media_dispatch(%L,%L,%L,1,3,%L,%L,%L,%L,122000,122000)',
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000002',
    'c1400000-0000-4000-8000-000000000001',
    'storyboard:3:single','storyboard','fal-ai/nano-banana-2',repeat('7',64)
  ),
  'aggregate reservation can consume the exact remaining run authority'
);

select throws_ok(
  format(
    'select public.command_reserve_mvp_media_dispatch(%L,%L,%L,1,4,%L,%L,%L,%L,122000,122000)',
    'c1100000-0000-4000-8000-000000000001',
    'c1a00000-0000-4000-8000-000000000002',
    'c1400000-0000-4000-8000-000000000001',
    'storyboard:4:single','storyboard','fal-ai/nano-banana-2',repeat('8',64)
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

select ok(
  (select count(*) from public.voice_versions) = 2
  and enum_range(null::public.narrator_gender)::text = '{male,female}'
  and exists (
    select 1
    from pg_enum value
    join pg_type enum_type on enum_type.oid = value.enumtypid
    join pg_namespace enum_schema on enum_schema.oid = enum_type.typnamespace
    where enum_schema.nspname = 'public'
      and enum_type.typname = 'script_source_kind'
      and value.enumlabel = 'uploaded_audio_transcript'
  ),
  'uploaded narration preserves the exact two-voice registry and adds one script source kind'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('narration_source_kind'),
      ('selected_narration_upload_version_id'),
      ('narration_source_confirmed_by'),
      ('narration_source_confirmed_at')
    ) as required(column_name)
    where not exists (
      select 1
      from information_schema.columns actual
      where actual.table_schema = 'public'
        and actual.table_name = 'episode_configuration_candidates'
        and actual.column_name = required.column_name
    )
  )
  and to_regclass('public.episode_narration_upload_versions') is not null,
  'Episode configuration and public upload versions expose the authoritative narration source'
);

select ok(
  to_regprocedure(
    'public.command_prepare_episode_narration_upload(uuid,uuid,uuid,bigint,uuid,uuid,uuid,text,bigint,text,text,uuid,text,text,uuid)'
  ) is not null
  and to_regprocedure(
    'public.command_confirm_episode_narration_upload(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,bytea,text,text,text,text,jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,uuid,text,text,uuid)'
  ) is not null
  and to_regprocedure(
    'public.command_record_uploaded_narration_master_clock(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb)'
  ) is not null
  and to_regprocedure(
    'public.get_active_narration_upload_ingest_policy()'
  ) is not null
  and to_regprocedure(
    'public.command_reject_episode_narration_upload(uuid,uuid,text)'
  ) is not null,
  'uploaded narration exposes exact prepare, confirm and master-clock commands'
);

select ok(
  to_regprocedure(
    'public.get_episode_narration_upload_processing_state(uuid,uuid)'
  ) is not null
  and has_function_privilege(
    'service_role',
    'public.get_episode_narration_upload_processing_state(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.get_episode_narration_upload_processing_state(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.get_episode_narration_upload_processing_state(uuid,uuid)',
    'execute'
  )
  and to_regprocedure(
    'public.command_record_episode_narration_upload_recovery_scan(uuid,uuid,uuid,uuid,text,text,boolean,text,bigint,text,bigint,bigint,integer,text)'
  ) is not null
  and has_function_privilege(
    'service_role',
    'public.command_record_episode_narration_upload_recovery_scan(uuid,uuid,uuid,uuid,text,text,boolean,text,bigint,text,bigint,bigint,integer,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_record_episode_narration_upload_recovery_scan(uuid,uuid,uuid,uuid,text,text,boolean,text,bigint,text,bigint,bigint,integer,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.command_record_episode_narration_upload_recovery_scan(uuid,uuid,uuid,uuid,text,text,boolean,text,bigint,text,bigint,bigint,integer,text)',
    'execute'
  ),
  'only service processing can recover and audit retained narration-upload evidence'
);

select ok(
  has_table_privilege(
    'authenticated','public.episode_narration_upload_versions','select'
  )
  and has_table_privilege(
    'service_role','public.episode_narration_upload_versions','select'
  )
  and not has_table_privilege(
    'authenticated','public.episode_narration_upload_versions','insert'
  )
  and not has_table_privilege(
    'anon','public.episode_narration_upload_versions','select'
  )
  and (select relrowsecurity and relforcerowsecurity
       from pg_class
       where oid = 'public.episode_narration_upload_versions'::regclass)
  and has_function_privilege(
    'authenticated',
    'public.command_confirm_episode_narration_upload(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,bytea,text,text,text,text,jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,uuid,text,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_record_uploaded_narration_master_clock(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.command_record_uploaded_narration_master_clock(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb)',
    'execute'
  ),
  'upload rows are member-readable while write and master-clock authority remain scoped'
);

-- A compact executable upload fixture exercises revision replacement, exact
-- replay/reuse, the closed World boundary, generated-voice restoration and
-- the provider-free uploaded-audio master clock.
reset role;
set local session_replication_role = replica;

insert into public.episodes (
  id,workspace_id,series_id,episode_number,title,owner_user_id,created_by,
  workflow_state
) values (
  'd1400000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',2,'Uploaded narration fixture',
  'c1200000-0000-4000-8000-000000000002',
  'c1200000-0000-4000-8000-000000000002','world_setup'
);
insert into private.aggregate_versions (
  workspace_id,aggregate_type,aggregate_id,current_version
) values (
  'c1100000-0000-4000-8000-000000000001','episode',
  'd1400000-0000-4000-8000-000000000001',1
);
insert into public.script_revisions (
  id,workspace_id,episode_id,revision_number,source_kind,raw_text,raw_utf8,
  raw_utf8_sha256,processing_text,processing_utf8_sha256,processing_profile,
  coordinate_map,runtime_evidence,source_encoding_evidence,
  raw_utf16_code_units,raw_scalar_count,raw_grapheme_count,
  processing_utf16_code_units,processing_scalar_count,
  processing_grapheme_count,estimated_duration_seconds,duration_out_of_band,
  duration_acknowledged,created_by
) values (
  'd1510000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',1,'browser_text','abcde',
  convert_to('abcde','UTF8'),
  encode(extensions.digest(convert_to('abcde','UTF8'),'sha256'),'hex'),
  'abcde',encode(extensions.digest(convert_to('abcde','UTF8'),'sha256'),'hex'),
  'genie-script-processing.v1',
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
  '{"kind":"browser-utf16"}',5,5,5,5,5,5,2,true,true,
  'c1200000-0000-4000-8000-000000000002'
);
insert into public.episode_configuration_candidates (
  id,workspace_id,episode_id,candidate_number,script_revision_id,
  narrator_gender,voice_version_id,look_version_id,voice_confirmed_by,
  voice_confirmed_at,look_confirmed_by,look_confirmed_at,state,selected_by
) values (
  'd1500000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',1,
  'd1510000-0000-4000-8000-000000000001','male',
  (select id from public.voice_versions where gender='male' limit 1),
  (select id from public.look_versions where look_key='glowing-divine-realism' limit 1),
  'c1200000-0000-4000-8000-000000000002',statement_timestamp(),
  'c1200000-0000-4000-8000-000000000002',statement_timestamp(),'world_design',
  'c1200000-0000-4000-8000-000000000002'
);
insert into public.assets(id,workspace_id,asset_kind) values
('d1a61000-0000-4000-8000-000000000001','c1100000-0000-4000-8000-000000000001','narration'),
('d1a61000-0000-4000-8000-000000000002','c1100000-0000-4000-8000-000000000001','narration'),
('d1a61000-0000-4000-8000-000000000003','c1100000-0000-4000-8000-000000000001','narration');
insert into public.asset_versions (
  id,workspace_id,asset_id,version_number,source_quarantine_version_id,
  bucket_id,object_name,storage_version,content_sha256,media_mime,byte_length,
  policy_version_id,provenance_hash
) values
(
  'd1a60000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1a61000-0000-4000-8000-000000000001',1,
  'd1a62000-0000-4000-8000-000000000001','workspace-media',
  'c1100000-0000-4000-8000-000000000001/narration/d1a61000-0000-4000-8000-000000000001/d1a60000-0000-4000-8000-000000000001/source',
  'upload-v1',repeat('a',64),'audio/mpeg',4096,
  'a4d82e59-bd43-5f15-90fe-07f68ec9356c',repeat('b',64)
),
(
  'd1a60000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000001',
  'd1a61000-0000-4000-8000-000000000002',1,
  'd1a62000-0000-4000-8000-000000000002','workspace-media',
  'c1100000-0000-4000-8000-000000000001/narration/d1a61000-0000-4000-8000-000000000002/d1a60000-0000-4000-8000-000000000002/source',
  'upload-v2',repeat('c',64),'audio/mpeg',4096,
  'a4d82e59-bd43-5f15-90fe-07f68ec9356c',repeat('d',64)
),
(
  'd1a60000-0000-4000-8000-000000000003',
  'c1100000-0000-4000-8000-000000000001',
  'd1a61000-0000-4000-8000-000000000003',1,
  'd1a62000-0000-4000-8000-000000000003','workspace-media',
  'c1100000-0000-4000-8000-000000000001/narration/d1a61000-0000-4000-8000-000000000003/d1a60000-0000-4000-8000-000000000003/source',
  'upload-v3',repeat('e',64),'audio/mpeg',4096,
  'a4d82e59-bd43-5f15-90fe-07f68ec9356c',repeat('f',64)
);
insert into public.media_probes(
  workspace_id,asset_version_id,probe_version,probe_sha256,duration_ms,streams
) values
('c1100000-0000-4000-8000-000000000001','d1a60000-0000-4000-8000-000000000001','fixture-v1',repeat('1',64),60000,'[{"mime":"audio/mpeg"}]'),
('c1100000-0000-4000-8000-000000000001','d1a60000-0000-4000-8000-000000000002','fixture-v1',repeat('2',64),60000,'[{"mime":"audio/mpeg"}]'),
('c1100000-0000-4000-8000-000000000001','d1a60000-0000-4000-8000-000000000003','fixture-v1',repeat('3',64),60000,'[{"mime":"audio/mpeg"}]');
insert into public.episode_narration_upload_versions (
  id,workspace_id,episode_id,configuration_candidate_id,
  original_script_revision_id,stable_asset_id,quarantine_asset_version_id,
  promoted_asset_version_id,version_number,state,state_version,
  display_filename,declared_mime,source_sha256,sanitized_sha256,byte_length,
  sanitized_byte_length,duration_ms,transcription_text,transcription_sha256,
  alignment_json,alignment_hash,script_comparison_json,script_comparison_hash,
  quality_evidence,quality_evidence_hash,uploaded_by,command_id,
  idempotency_key,request_hash
) values
(
  'd1b00000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1510000-0000-4000-8000-000000000001',
  'd1a61000-0000-4000-8000-000000000001',
  'd1a62000-0000-4000-8000-000000000001',
  'd1a60000-0000-4000-8000-000000000001',1,'verified',2,
  'owner-1.wav','audio/wav',repeat('4',64),repeat('a',64),5000,4096,60000,
  'fghij',encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  '{"segments":[]}',encode(extensions.digest(convert_to('{"segments":[]}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  '{"matchesOriginalScript":false}',encode(extensions.digest(convert_to('{"matchesOriginalScript":false}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  '{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}',
  encode(extensions.digest(convert_to('{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  'c1200000-0000-4000-8000-000000000002',
  'd1b10000-0000-4000-8000-000000000001','owner-audio-0001',repeat('5',64)
),
(
  'd1b00000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1510000-0000-4000-8000-000000000001',
  'd1a61000-0000-4000-8000-000000000002',
  'd1a62000-0000-4000-8000-000000000002',
  'd1a60000-0000-4000-8000-000000000002',2,'verified',2,
  'owner-2.mp3','audio/mpeg',repeat('6',64),repeat('c',64),5000,4096,60000,
  'fghij',encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  '{"segments":[]}',encode(extensions.digest(convert_to('{"segments":[]}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  '{"matchesOriginalScript":true}',encode(extensions.digest(convert_to('{"matchesOriginalScript":true}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  '{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}',
  encode(extensions.digest(convert_to('{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  'c1200000-0000-4000-8000-000000000002',
  'd1b10000-0000-4000-8000-000000000002','owner-audio-0002',repeat('7',64)
),
(
  'd1b00000-0000-4000-8000-000000000003',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1510000-0000-4000-8000-000000000001',
  'd1a61000-0000-4000-8000-000000000003',
  'd1a62000-0000-4000-8000-000000000003',
  'd1a60000-0000-4000-8000-000000000003',3,'verified',2,
  'owner-3.mp3','audio/mpeg',repeat('8',64),repeat('e',64),5000,4096,60000,
  'fghij',encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  '{"segments":[]}',encode(extensions.digest(convert_to('{"segments":[]}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  '{"matchesOriginalScript":true}',encode(extensions.digest(convert_to('{"matchesOriginalScript":true}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  '{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}',
  encode(extensions.digest(convert_to('{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  'c1200000-0000-4000-8000-000000000002',
  'd1b10000-0000-4000-8000-000000000003','owner-audio-0003',repeat('9',64)
);

set local session_replication_role = origin;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.attest_script_coordinate_map(
  'd2a00000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000002',repeat('a',64),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}'
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
select public.command_confirm_episode_narration_upload(
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1b00000-0000-4000-8000-000000000001',1,2,
  'd2a00000-0000-4000-8000-000000000001','fghij',convert_to('fghij','UTF8'),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  'fghij',encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  'genie-script-processing.v1',
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
  5,5,5,5,5,5,true,'d2b00000-0000-4000-8000-000000000001',
  'confirm-owner-audio-0001',repeat('a',64),'d2c00000-0000-4000-8000-000000000001'
);

select ok(
  exists (
    select 1 from public.script_revisions revision
    where revision.episode_id='d1400000-0000-4000-8000-000000000001'
      and revision.revision_number=2
      and revision.source_kind='uploaded_audio_transcript'
      and revision.raw_text='fghij'
      and revision.uploaded_asset_version_id='d1a60000-0000-4000-8000-000000000001'
  )
  and exists (
    select 1 from public.script_lock_events lock_event
    join public.script_revisions revision
      on revision.id=lock_event.script_revision_id
    where revision.episode_id='d1400000-0000-4000-8000-000000000001'
      and revision.revision_number=2
  ),
  'confirming a differing gold transcript creates a new immutable audio-transcript revision'
);

select ok(
  exists (
    select 1 from public.script_revisions revision
    where revision.id='d1510000-0000-4000-8000-000000000001'
      and revision.raw_text='abcde'
  )
  and (select count(*) from public.script_revisions
       where episode_id='d1400000-0000-4000-8000-000000000001')=2,
  'the earlier user script revision remains preserved after transcript confirmation'
);

reset role;
set local session_replication_role = replica;
update public.episode_configuration_candidates
set voice_confirmed_by = null,
    voice_confirmed_at = null
where id = 'd1500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;
select set_config(
  'request.jwt.claims',
  '{"sub":"c1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c1210000-0000-4000-8000-000000000002"}',
  true
);
select set_config(
  'request.jwt.claim.sub',
  'c1200000-0000-4000-8000-000000000002',
  true
);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(
  $sql$
  select public.command_authorize_world_build_intent(
    'c1100000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001',
    (
      select aggregate_version
      from public.episode_configuration_candidates
      where id = 'd1500000-0000-4000-8000-000000000001'
    ),
    500,
    'd2b00000-0000-4000-8000-000000000011',
    'uploaded-world-intent-0001',
    repeat('1', 64)
  )
  $sql$,
  'a confirmed uploaded source reaches the real World authority command with null voice confirmation'
);
reset role;
set local session_replication_role = replica;
update public.episode_configuration_candidates
set voice_confirmed_by = 'c1200000-0000-4000-8000-000000000002',
    voice_confirmed_at = statement_timestamp()
where id = 'd1500000-0000-4000-8000-000000000001';
set local session_replication_role = origin;

reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.attest_script_coordinate_map(
  'd2a00000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000002',repeat('b',64),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}'
);
reset role;
select set_config('request.jwt.claims','{"sub":"c1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c1210000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','c1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select public.command_confirm_episode_narration_upload(
  'c1100000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001','d1b00000-0000-4000-8000-000000000002',
  2,2,'d2a00000-0000-4000-8000-000000000002','fghij',convert_to('fghij','UTF8'),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),'fghij',
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  'genie-script-processing.v1',
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
  5,5,5,5,5,5,true,'d2b00000-0000-4000-8000-000000000002',
  'confirm-owner-audio-0002',repeat('b',64),'d2c00000-0000-4000-8000-000000000002'
);

select ok(
  (select count(*) from public.script_revisions
   where episode_id='d1400000-0000-4000-8000-000000000001')=2
  and (select confirmed_transcript_revision_id
       from public.episode_narration_upload_versions
       where id='d1b00000-0000-4000-8000-000000000002') =
      (select script_revision_id from public.episode_configuration_candidates
       where id='d1500000-0000-4000-8000-000000000001'),
  'confirming an identical transcript reuses the current immutable revision'
);

select public.command_select_episode_voice(
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',3,'male',
  (select voice_version_id from public.episode_configuration_candidates
   where id='d1500000-0000-4000-8000-000000000001'),
  'd2b00000-0000-4000-8000-000000000003','restore-generated-0001',
  repeat('c',64),'d2c00000-0000-4000-8000-000000000003'
);

select ok(
  (select narration_source_kind='elevenlabs_v3'
      and selected_narration_upload_version_id is null
   from public.episode_configuration_candidates
   where id='d1500000-0000-4000-8000-000000000001')
  and (select state='superseded'
       from public.episode_narration_upload_versions
       where id='d1b00000-0000-4000-8000-000000000002'),
  'an explicit generated voice selection clears the active upload and preserves it as superseded'
);

reset role;
set local session_replication_role = replica;
insert into public.preflight_runs(
  id,workspace_id,episode_id,configuration_candidate_id,script_revision_id,
  kind,run_number,authority_epoch,state,requires_micro_authority,trigger_run_id,
  started_at
) values(
  'd3100000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  (select script_revision_id from public.episode_configuration_candidates
   where id='d1500000-0000-4000-8000-000000000001'),
  'narration_clock',1,1,'running',false,'uploaded-audio-fixture',statement_timestamp()
);
set local session_replication_role = origin;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.attest_script_coordinate_map(
  'd2a00000-0000-4000-8000-000000000003',
  'c1100000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'c1200000-0000-4000-8000-000000000002',repeat('d',64),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
  '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}'
);
reset role;
select set_config('request.jwt.claims','{"sub":"c1200000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2","session_id":"c1210000-0000-4000-8000-000000000002"}',true);
select set_config('request.jwt.claim.sub','c1200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(
  $sql$
  select public.command_confirm_episode_narration_upload(
    'c1100000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001','d1b00000-0000-4000-8000-000000000003',
    4,2,'d2a00000-0000-4000-8000-000000000003','fghij',convert_to('fghij','UTF8'),
    encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),'fghij',
    encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
    'genie-script-processing.v1',
    '{"v":2,"c":"zero-based-half-open","r":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"p":[[0,1,2,3,4,5],[0,1,2,3,4,5],[1,2,3,4,5]],"s":[[0,0,5,0,5]]}',
    '{"nodeVersion":"22.14.0","icuVersion":"76.1","unicodeVersion":"17.0.0","graphemeSegmenterProfile":"unicode-segmenter@0.17.0:Unicode-17.0.0:UAX29-revision-47","graphemeProbeSha256":"472911620e8d642248b9e0204b31b347ef80653af0eb128d6a76cb217b5e5096"}',
    5,5,5,5,5,5,true,'d2b00000-0000-4000-8000-000000000004',
    'confirm-owner-audio-0003',repeat('d',64),'d2c00000-0000-4000-8000-000000000004'
  )
  $sql$,
  '55000','narration upload window has closed',
  'uploaded narration cannot be confirmed after World or Preflight work begins'
);

reset role;
set local session_replication_role = replica;
update public.episode_narration_upload_versions
set state='confirmed',state_version=3,
  confirmed_transcript_revision_id=(
    select script_revision_id from public.episode_configuration_candidates
    where id='d1500000-0000-4000-8000-000000000001'
  ),confirmed_by='c1200000-0000-4000-8000-000000000002',
  confirmed_at=statement_timestamp()
where id='d1b00000-0000-4000-8000-000000000003';
update public.episode_configuration_candidates
set state='preflight',narration_source_kind='uploaded_audio',
  selected_narration_upload_version_id='d1b00000-0000-4000-8000-000000000003',
  narration_source_confirmed_by='c1200000-0000-4000-8000-000000000002',
  narration_source_confirmed_at=statement_timestamp()
where id='d1500000-0000-4000-8000-000000000001';
insert into public.preflight_audio_identity_selections(
  id,workspace_id,configuration_candidate_id,voice_version_id,
  pronunciation_lexicon_version_id,score_identity_version_id,
  sound_identity_version_id,selection_hash,state
) values(
  'd3200000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  (select voice_version_id from public.episode_configuration_candidates
   where id='d1500000-0000-4000-8000-000000000001'),
  'd3210000-0000-4000-8000-000000000001',
  'd3220000-0000-4000-8000-000000000001',
  'd3230000-0000-4000-8000-000000000001',repeat('e',64),'verified'
);
set local session_replication_role = origin;

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select public.command_record_uploaded_narration_master_clock(
  'd3300000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd3100000-0000-4000-8000-000000000001',
  'd1b00000-0000-4000-8000-000000000003',
  'd3200000-0000-4000-8000-000000000001',
  encode(extensions.digest(convert_to('fghij','UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to('[{"kind":"spoken","startScalar":0,"endScalar":5,"exactText":"fghij","startMs":0,"endMs":60000,"pronunciationEntryIds":[]}]'::jsonb::text,'UTF8'),'sha256'),'hex'),
  encode(extensions.digest(convert_to('{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  repeat('f',64),
  '{"schemaVersion":"genie.owner-narration-quality-evidence.v1","ownerConfirmationRequired":true,"scriptComparisonAdvisoryOnly":true}',
  '[{"kind":"spoken","startScalar":0,"endScalar":5,"exactText":"fghij","startMs":0,"endMs":60000,"pronunciationEntryIds":[]}]'
);

reset role;

select ok(
  exists (
    select 1 from public.narration_master_clock_versions clock
    where clock.id='d3300000-0000-4000-8000-000000000001'
      and clock.source_kind='uploaded_audio'
      and clock.narration_upload_version_id='d1b00000-0000-4000-8000-000000000003'
      and clock.narration_asset_version_id='d1a60000-0000-4000-8000-000000000003'
  ),
  'the uploaded gold narration creates the verified master clock and exact segment coverage'
);

select ok(
  not exists (
    select 1 from private.narration_generation_jobs job
    where job.preflight_run_id='d3100000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from private.provider_requests request
    where request.preflight_run_id='d3100000-0000-4000-8000-000000000001'
      and request.operation='gen_speech'
  )
  and not exists (
    select 1 from private.micro_quotes quote
    where quote.configuration_candidate_id='d1500000-0000-4000-8000-000000000001'
      and quote.preflight_kind='narration_clock'
  ),
  'uploaded narration creates no ElevenLabs request, grant, quote or reservation state'
);

select * from finish();

rollback;

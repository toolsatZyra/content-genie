-- Focused structural gate for Monica's immutable, UI-safe repair grounding.
-- Run after migrations through 20260722191000.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,auth,storage,private,audit,pg_catalog;
select plan(17);

select ok(
  to_regclass('public.mvp_repair_feedback_grounding_versions') is not null
  and to_regclass('public.mvp_repair_feedback_point_evidence') is not null
  and to_regclass('public.mvp_repair_action_grounding_evidence') is not null,
  'repair grounding persists version, independent point and non-reuse action evidence'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('repair_request_id'),('repair_plan_version_id'),('outcome'),
      ('source_edd_content_sha256'),('feedback_sha256'),
      ('feedback_points_sha256'),('action_grounding_sha256'),
      ('evidence_bundle_sha256')
    ) required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name='mvp_repair_feedback_grounding_versions'
        and actual.column_name=required.column_name
    )
  ),
  'grounding versions bind the request, plan, source EDD and exact aggregates'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('feedback_point_index'),('feedback_point_sha256'),('resolution'),
      ('resolved_shot_numbers'),('evidence_windows'),('point_evidence_sha256')
    ) required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name='mvp_repair_feedback_point_evidence'
        and actual.column_name=required.column_name
    )
  ),
  'each independent feedback point has a hash, resolution, shots and exact windows'
);

select ok(
  not exists (
    select required.column_name
    from (values
      ('shot_number'),('selected_action'),('feedback_point_indexes'),
      ('action_evidence_sha256')
    ) required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name='mvp_repair_action_grounding_evidence'
        and actual.column_name=required.column_name
    )
  ),
  'each non-reuse action is bound to its selected action and feedback point indexes'
);

select ok(
  to_regclass('public.mvp_repair_action_asset_lineage') is not null
  and not exists (
    select required.column_name
    from (values
      ('action_grounding_id'),('feedback_point_indexes'),
      ('source_asset_bundle_sha256'),('selected_asset_bundle_sha256'),
      ('selection_sha256'),('lineage_sha256'),('validation_state')
    ) required(column_name)
    where not exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public'
        and actual.table_name='mvp_repair_action_asset_lineage'
        and actual.column_name=required.column_name
    )
  ),
  'selected repairs persist per-point before/after asset lineage and exact hashes'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where oid='public.mvp_repair_feedback_grounding_versions'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class
   where oid='public.mvp_repair_feedback_point_evidence'::regclass)
  and (select relrowsecurity and relforcerowsecurity from pg_class
   where oid='public.mvp_repair_action_grounding_evidence'::regclass),
  'all repair grounding evidence is force-RLS protected'
);

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where oid='public.mvp_repair_action_asset_lineage'::regclass)
  and has_table_privilege(
    'authenticated','public.mvp_repair_action_asset_lineage','select'
  )
  and not has_table_privilege(
    'authenticated','public.mvp_repair_action_asset_lineage','insert'
  ),
  'members can inspect but cannot forge the selected asset lineage'
);

select ok(
  has_table_privilege('authenticated','public.mvp_repair_feedback_grounding_versions','select')
  and has_table_privilege('authenticated','public.mvp_repair_feedback_point_evidence','select')
  and has_table_privilege('authenticated','public.mvp_repair_action_grounding_evidence','select')
  and not has_table_privilege('authenticated','public.mvp_repair_feedback_grounding_versions','insert')
  and not has_table_privilege('authenticated','public.mvp_repair_feedback_point_evidence','update')
  and not has_table_privilege('authenticated','public.mvp_repair_action_grounding_evidence','delete'),
  'members can read bounded evidence but cannot forge or mutate it'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_plan_grounded(uuid,bigint,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text,text,jsonb,text,jsonb,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_publish_mvp_repair_plan_grounded(uuid,bigint,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text,text,jsonb,text,jsonb,text,text)',
    'execute'
  ),
  'only the service boundary can publish a grounded repair plan'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_clarification_grounded(uuid,bigint,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.command_publish_mvp_repair_clarification_grounded(uuid,bigint,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text,text,text)',
    'execute'
  ),
  'only the service boundary can publish grounded clarification evidence'
);

select ok(
  not has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_plan(uuid,bigint,uuid,uuid,text,text,text,text,jsonb,jsonb)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.command_publish_mvp_repair_clarification(uuid,bigint,uuid,uuid,text)',
    'execute'
  ),
  'the service cannot bypass grounding through the legacy publication commands'
);

select ok(
  position('jsonb_array_length(p_action_grounding) <> 0' in pg_get_functiondef(
    'private.record_mvp_repair_grounding_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text)'::regprocedure
  )) > 0
  and position('clarification grounding cannot contain an action' in pg_get_functiondef(
    'private.guard_mvp_repair_grounding_child_insert()'::regprocedure
  )) > 0,
  'clarification is structurally barred from action or spend-bearing rows'
);

select ok(
  position('repair grounding aggregate hash is invalid' in pg_get_functiondef(
    'private.record_mvp_repair_grounding_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text)'::regprocedure
  )) > 0
  and position('repair grounding bundle hash is invalid' in pg_get_functiondef(
    'private.record_mvp_repair_grounding_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text)'::regprocedure
  )) > 0,
  'database publication recomputes point, action and bundle aggregate hashes'
);

select is(
  (select count(*) from pg_trigger
   where not tgisinternal and tgname in (
     'mvp_repair_feedback_grounding_versions_immutable',
     'mvp_repair_feedback_point_evidence_immutable',
     'mvp_repair_action_grounding_evidence_immutable',
     'mvp_repair_action_asset_lineage_immutable'
   )),
  4::bigint,
  'all committed grounding evidence is immutable'
);

select ok(
  position('feedback_points' in pg_get_viewdef('public.mvp_repair_progress'::regclass, true)) > 0
  and position('feedbackPointIndex' in pg_get_viewdef('public.mvp_repair_progress'::regclass, true)) > 0
  and position('mappedShots' in pg_get_viewdef('public.mvp_repair_progress'::regclass, true)) > 0
  and position('assetStatus' in pg_get_viewdef('public.mvp_repair_progress'::regclass, true)) > 0
  and position('mvp_master_reviews' in pg_get_viewdef('public.mvp_repair_progress'::regclass, true)) = 0,
  'the authenticated repair projection tells the bounded per-point story without owner feedback'
);

select ok(
  position('storyboard_and_clip' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid='public.mvp_repair_action_grounding_evidence'::regclass
       and conname='mvp_repair_action_grounding_evidence_selected_action_check')
  )) > 0
  and position('clip_only' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid='public.mvp_repair_action_grounding_evidence'::regclass
       and conname='mvp_repair_action_grounding_evidence_selected_action_check')
  )) > 0
  and position('re_edit' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid='public.mvp_repair_action_grounding_evidence'::regclass
       and conname='mvp_repair_action_grounding_evidence_selected_action_check')
  )) > 0
  and position('legacy_storyboard_migration' in pg_get_constraintdef(
    (select oid from pg_constraint
     where conrelid='public.mvp_repair_action_grounding_evidence'::regclass
       and conname='mvp_repair_action_grounding_evidence_selected_action_check')
  )) > 0,
  'feedback actions and explicitly labeled legacy storyboard migrations can be persisted'
);

select ok(
  position('selected_action_value = ''legacy_storyboard_migration''' in pg_get_functiondef(
    'private.record_mvp_repair_grounding_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text)'::regprocedure
  )) > 0
  and position('split_screen_two_state' in pg_get_functiondef(
    'private.record_mvp_repair_grounding_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text)'::regprocedure
  )) > 0
  and position('cardinality(feedback_indexes) <> 0' in pg_get_functiondef(
    'private.record_mvp_repair_grounding_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text)'::regprocedure
  )) > 0,
  'zero feedback indexes are reserved for a verified audit-only split-screen migration'
);

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, storage, private, audit, pg_catalog;
select plan(59);

create function pg_temp.p2_09_hash(p_value jsonb)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex');
$$;

create function pg_temp.p2_09_claims()
returns jsonb
language sql
stable
as $$
  select jsonb_agg(jsonb_build_object(
    'category',category,
    'applicability','not_present',
    'claims','[]'::jsonb,
    'evidenceHash',repeat(substr(md5(category),1,1),64),
    'qualifiedReviewTriggered',false
  ) order by ordinal)
  from unnest(private.p2_09_expected_claim_categories())
    with ordinality as required(category,ordinal);
$$;

create function pg_temp.p2_09_rules(
  p_present_categories text[] default '{}'::text[],
  p_override_rule text default null,
  p_override_verdict text default null
)
returns jsonb
language sql
stable
as $$
  select jsonb_agg(jsonb_build_object(
    'ruleCode',contract.rule_code,
    'verdict',case when contract.rule_code=p_override_rule
      then p_override_verdict else 'eligible' end,
    'claimCategories',to_jsonb(array(
      select category
      from unnest(contract.claim_categories) with ordinality mapped(category,ordinal)
      where category=any(p_present_categories)
      order by ordinal
    )),
    'evidenceHash',repeat(substr(md5(contract.rule_code),1,1),64),
    'rationale','Exact P2-09 rule assessment fixture.'
  ) order by contract.ordinal)
  from public.p2_09_cultural_rule_contracts contract;
$$;

create function pg_temp.p2_09_rights_claims(
  p_source_ids jsonb,
  p_qualified_review_triggered boolean default true
)
returns jsonb
language sql
stable
as $$
  select jsonb_set(
    jsonb_set(
      jsonb_set(
        pg_temp.p2_09_claims(),
        '{8,applicability}','"present"'::jsonb
      ),
      '{8,qualifiedReviewTriggered}',to_jsonb(p_qualified_review_triggered)
    ),
    '{8,claims}',jsonb_build_array(jsonb_build_object(
      'claimKey','living-guru-rights-trigger',
      'assertion','A separately approved rights and policy workflow is required.',
      'interpretationLabel','not_applicable',
      'subjectKind','general',
      'subjectId','',
      'sourceRecordVersionIds',p_source_ids,
      'evidenceHash',repeat('9',64)
    ))
  );
$$;

create function pg_temp.p2_09_deity_without_tradition()
returns jsonb
language sql
stable
as $$
  select jsonb_set(
    jsonb_set(
      jsonb_set(
        pg_temp.p2_09_claims(),
        '{0,applicability}','"present"'::jsonb
      ),
      '{0,qualifiedReviewTriggered}','true'::jsonb
    ),
    '{0,claims}',jsonb_build_array(jsonb_build_object(
      'claimKey','vishnu-four-arms',
      'assertion','The depicted form has four arms.',
      'interpretationLabel','canonical_text',
      'subjectKind','general',
      'subjectId','',
      'sourceRecordVersionIds','[]'::jsonb,
      'evidenceHash',repeat('8',64)
    ))
  );
$$;

create function pg_temp.record_p2_09_bundle(
  p_claims jsonb,
  p_rules jsonb,
  p_claims_hash text default null,
  p_rules_hash text default null,
  p_contract_hash text default null
)
returns jsonb
language sql
as $$
  select public.command_record_p2_09_cultural_claim_bundle(
    'd9100000-0000-4000-8000-000000000001',
    'd9200000-0000-4000-8000-000000000001',
    'genie.p2-09-cultural-claims.v1',
    p_claims,
    p_rules,
    coalesce(p_claims_hash,pg_temp.p2_09_hash(p_claims)),
    coalesce(p_rules_hash,pg_temp.p2_09_hash(p_rules)),
    coalesce(p_contract_hash,private.p2_09_cultural_contract_hash())
  );
$$;

select ok(to_regclass('public.p2_09_cultural_rule_contracts') is not null,
  'P2-09 has a stable cultural-rule contract table');
select ok(to_regclass('public.p2_09_cultural_claim_bundles') is not null,
  'P2-09 has immutable cultural-claim bundles');
select ok(to_regclass('public.p2_09_cultural_rule_assessments') is not null,
  'P2-09 has one normalized assessment row per stable rule');
select ok(to_regprocedure(
  'public.command_record_p2_09_cultural_claim_bundle(uuid,uuid,text,jsonb,jsonb,text,text,text)'
  ) is not null,'P2-09 exposes the exact service command');
select has_trigger('public','source_review_statuses',
  'source_review_statuses_p2_09_approval_guard',
  'source-review approval has a P2-09 fail-closed guard');

select is((select count(*)::integer from public.p2_09_cultural_rule_contracts),12,
  'all twelve stable GQC-CULT rules are present');
select is((select array_agg(rule_code order by ordinal)
  from public.p2_09_cultural_rule_contracts),array[
    'GQC-CULT-001','GQC-CULT-002','GQC-CULT-003','GQC-CULT-004',
    'GQC-CULT-005','GQC-CULT-006','GQC-CULT-007','GQC-CULT-008',
    'GQC-CULT-009','GQC-CULT-010','GQC-CULT-011','GQC-CULT-012'
  ]::text[],'GQC-CULT rule identities are exact and canonical');
select is((select array_agg(ordinal order by ordinal)
  from public.p2_09_cultural_rule_contracts),
  array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[],
  'GQC-CULT rule ordinals are gapless');
select is((select array_agg(rule_code order by ordinal)
  from public.p2_09_cultural_rule_contracts where non_overridable),
  array['GQC-CULT-001','GQC-CULT-002']::text[],
  'the two contract-level non-overridable cultural rules are explicit');
select is(private.p2_09_expected_claim_categories(),array[
    'deity_attributes','traditions','named_temples','rituals','shlokas',
    'contested_retellings','violence_romance','caste_social_context',
    'rights_triggers'
  ]::text[],'all nine P2-09 extraction categories are exact and ordered');
select ok(private.p2_09_cultural_contract_hash() ~ '^[a-f0-9]{64}$',
  'the stable twelve-rule contract has a canonical hash');

select is((select effect||'|'||non_overridable::text||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-001'),
  'hard_block_release|true|deity_attributes,violence_romance|eligible,blocked','GQC-CULT-001 is exact and non-overridable');
select is((select effect||'|'||non_overridable::text||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-002'),
  'hard_block_release|true|traditions,contested_retellings|eligible,blocked','GQC-CULT-002 is exact and non-overridable');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-003'),
  'repair_or_critical_block|deity_attributes,traditions|eligible,needs_repair,blocked','GQC-CULT-003 binds deity form and tradition');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-004'),
  'missing_evidence_block_then_repair|traditions,contested_retellings|eligible,needs_evidence,needs_repair,blocked','GQC-CULT-004 binds labelled retelling evidence');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-005'),
  'missing_evidence_block_then_repair|named_temples,rights_triggers|eligible,needs_evidence,needs_repair,blocked','GQC-CULT-005 binds named-temple and rights evidence');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-006'),
  'missing_evidence_block_then_repair|rituals,traditions|eligible,needs_evidence,needs_repair,blocked','GQC-CULT-006 binds rituals to tradition evidence');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-007'),
  'repair_or_severe_block|violence_romance|eligible,needs_repair,blocked','GQC-CULT-007 binds violence and romance restraint');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-008'),
  'repair_or_hate_block|caste_social_context|eligible,needs_repair,blocked','GQC-CULT-008 binds caste and social context');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-009'),
  'hard_block_release|shlokas,rights_triggers|eligible,needs_evidence,needs_qualified_review,blocked','GQC-CULT-009 binds shloka, rights, and human-recording review');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-010'),
  'repair|deity_attributes,violence_romance,caste_social_context|eligible,needs_repair','GQC-CULT-010 binds standalone-frame dignity');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-011'),
  'needs_qualified_review|traditions,contested_retellings|eligible,needs_qualified_review,blocked','GQC-CULT-011 preserves qualified regional-sensitivity review');
select is((select effect||'|'||array_to_string(claim_categories,',')||'|'||array_to_string(allowed_machine_states,',') from public.p2_09_cultural_rule_contracts where rule_code='GQC-CULT-012'),
  'hard_block_release|rights_triggers|eligible,needs_evidence,needs_qualified_review,blocked','GQC-CULT-012 binds the living-guru rights workflow');

select ok((select bool_and(relrowsecurity) from pg_catalog.pg_class
  where oid=any(array[
    'public.p2_09_cultural_rule_contracts'::regclass,
    'public.p2_09_cultural_claim_bundles'::regclass,
    'public.p2_09_cultural_rule_assessments'::regclass
  ])),'all P2-09 public tables enable RLS');
select ok((select bool_and(relforcerowsecurity) from pg_catalog.pg_class
  where oid=any(array[
    'public.p2_09_cultural_rule_contracts'::regclass,
    'public.p2_09_cultural_claim_bundles'::regclass,
    'public.p2_09_cultural_rule_assessments'::regclass
  ])),'all P2-09 public tables force RLS');
select is((select count(*)::integer from pg_catalog.pg_trigger
  where tgrelid=any(array[
    'public.p2_09_cultural_rule_contracts'::regclass,
    'public.p2_09_cultural_claim_bundles'::regclass,
    'public.p2_09_cultural_rule_assessments'::regclass
  ]) and tgname like 'p2_09_%_immutable' and not tgisinternal),3,
  'rule contracts, claim bundles, and assessments are immutable');
select ok(not has_function_privilege('authenticated',
  'public.command_record_p2_09_cultural_claim_bundle(uuid,uuid,text,jsonb,jsonb,text,text,text)','execute'),
  'authenticated callers cannot record machine cultural evidence');
select ok(has_function_privilege('service_role',
  'public.command_record_p2_09_cultural_claim_bundle(uuid,uuid,text,jsonb,jsonb,text,text,text)','execute'),
  'only the trusted service lane can record machine cultural evidence');
select ok(position('auth.role()' in pg_get_functiondef(
  'public.command_record_p2_09_cultural_claim_bundle(uuid,uuid,text,jsonb,jsonb,text,text,text)'::regprocedure
  ))=0,'the service command does not depend on deprecated auth.role inspection');
select ok(
  not has_function_privilege('service_role','private.p2_09_expected_claim_categories()','execute')
  and not has_function_privilege('service_role','private.p2_09_cultural_contract_hash()','execute')
  and not has_function_privilege('service_role','private.assert_p2_09_claim_categories(uuid,uuid,jsonb)','execute')
  and not has_function_privilege('service_role','private.p2_09_cultural_bundle_is_approvable(uuid,uuid)','execute')
  and not has_function_privilege('service_role','private.enforce_p2_09_source_review_approval()','execute'),
  'P2-09 private helpers remain non-callable outside their definer and trigger paths');

select set_config('request.jwt.claims','{"sub":"d9900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','d9900000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok(
  $$select public.command_record_p2_09_cultural_claim_bundle('d9100000-0000-4000-8000-000000000001','d9200000-0000-4000-8000-000000000001','genie.p2-09-cultural-claims.v1','[]'::jsonb,'[]'::jsonb,repeat('1',64),repeat('2',64),repeat('3',64))$$,
  '42501','permission denied for function command_record_p2_09_cultural_claim_bundle',
  'a non-service caller cannot create a P2-09 machine bundle');
reset role;

set local session_replication_role=replica;
insert into public.source_review_packets(
  id,workspace_id,series_id,configuration_candidate_id,script_revision_id,
  policy_version_id,packet_version,subject_hash,source_set_hash,evidence_set_hash,
  tradition,region,language,content_classes,interpretation_labels,
  machine_verdict,machine_evidence_hash
)
select
  'd9200000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'd9300000-0000-4000-8000-000000000001',
  'd9400000-0000-4000-8000-000000000001',
  'd9500000-0000-4000-8000-000000000001',
  policy.id,1,repeat('1',64),repeat('2',64),repeat('3',64),
  'shaiva','india','Hindi',array[
    'deity_attributes','traditions','named_temples','rituals','shlokas',
    'contested_retellings','violence_romance','caste_social_context','rights_triggers'
  ],array['canonical_text'],'eligible',repeat('4',64)
from public.cultural_policy_versions policy
where policy.state='active';
insert into public.source_review_statuses(
  source_review_packet_id,workspace_id,status,version
) values(
  'd9200000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'pending_qualified_review',1
);
insert into public.source_review_packet_world_bindings(
  source_review_packet_id,workspace_id,configuration_candidate_id,
  world_reference_pack_version_id,world_extraction_result_id,script_sha256,
  extraction_hash,world_reference_pack_hash,cultural_policy_hash,subject_hash
)
select
  'd9200000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'd9400000-0000-4000-8000-000000000001',
  'd9600000-0000-4000-8000-000000000001',
  'd9700000-0000-4000-8000-000000000001',
  repeat('5',64),repeat('6',64),repeat('7',64),policy.manifest_hash,repeat('1',64)
from public.cultural_policy_versions policy
where policy.state='active';
set local session_replication_role=origin;

-- Test-only visibility for fixture builders. The surrounding transaction rolls
-- these grants back; production keeps the private helpers non-callable.
grant usage on schema private to service_role;
grant execute on function private.p2_09_expected_claim_categories(),
  private.p2_09_cultural_contract_hash() to service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;

select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_claims(),pg_temp.p2_09_rules(),repeat('f',64))$$,
  '40001','P2-09 claim, assessment, or contract hash is stale',
  'stale client claim hashes fail closed');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_claims()-8,pg_temp.p2_09_rules())$$,
  '22023','P2-09 claim category coverage must contain exactly nine entries',
  'missing extraction category coverage fails closed');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(jsonb_set(pg_temp.p2_09_claims(),'{0,unexpected}','true'),pg_temp.p2_09_rules())$$,
  '22023','P2-09 claim category object is not exact',
  'extra extraction-category keys fail closed');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_rights_claims('[]'::jsonb,false),pg_temp.p2_09_rules(array['rights_triggers']))$$,
  '23514','P2-09 enhanced cultural trigger is not routed to qualified review',
  'an enhanced rights trigger cannot suppress qualified review');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_rights_claims('["d9800000-0000-4000-8000-000000000001"]'::jsonb),pg_temp.p2_09_rules(array['rights_triggers']))$$,
  '23514','P2-09 claim cites a source outside the exact review packet',
  'a claim cannot cite evidence outside its immutable source packet');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_deity_without_tradition(),pg_temp.p2_09_rules(array['deity_attributes']))$$,
  '23514','P2-09 related tradition or rights trigger coverage is missing',
  'deity attributes cannot omit their tradition extraction lane');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_claims(),pg_temp.p2_09_rules()-11)$$,
  '22023','P2-09 rule coverage must contain exactly twelve assessments',
  'missing stable cultural rule coverage fails closed');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_claims(),jsonb_set(pg_temp.p2_09_rules(),'{0,unexpected}','true'))$$,
  '22023','P2-09 cultural rule assessment is not exact',
  'extra cultural assessment keys fail closed');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_claims(),pg_temp.p2_09_rules('{}','GQC-CULT-001','needs_repair'))$$,
  '23514','P2-09 rule verdict is not allowed by the stable contract',
  'a non-overridable rule cannot be downgraded to repair');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_rights_claims('[]'::jsonb),pg_temp.p2_09_rules())$$,
  '23514','P2-09 rule-to-claim mapping is incomplete or non-canonical',
  'every stable rule maps to all triggered extraction categories');
select throws_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_rights_claims('[]'::jsonb),pg_temp.p2_09_rules(array['rights_triggers']))$$,
  '23514','P2-09 missing claim evidence is not represented by a blocking assessment',
  'missing claim evidence cannot be reported as machine eligible');

select lives_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_claims(),pg_temp.p2_09_rules())$$,
  'an exact nine-category and twelve-rule bundle is accepted');
reset role;

select is((select count(*)::integer from public.p2_09_cultural_claim_bundles
  where source_review_packet_id='d9200000-0000-4000-8000-000000000001'),1,
  'the service command records one immutable bundle');
select is((select machine_state from public.p2_09_cultural_claim_bundles
  where source_review_packet_id='d9200000-0000-4000-8000-000000000001'),
  'eligible','the exact all-clear assessment derives machine eligibility');
select ok((select qualified_human_review_required from public.p2_09_cultural_claim_bundles
  where source_review_packet_id='d9200000-0000-4000-8000-000000000001'),
  'machine eligibility still requires a qualified human review');
select is((select count(*)::integer from public.p2_09_cultural_rule_assessments
  where cultural_claim_bundle_id=(select id from public.p2_09_cultural_claim_bundles
    where source_review_packet_id='d9200000-0000-4000-8000-000000000001')),12,
  'the accepted bundle normalizes exactly twelve rule assessments');
select is((select status from public.source_review_statuses
  where source_review_packet_id='d9200000-0000-4000-8000-000000000001'),
  'pending_qualified_review','machine evidence cannot approve its source packet');
select ok(private.p2_09_cultural_bundle_is_approvable(
  'd9100000-0000-4000-8000-000000000001',
  'd9200000-0000-4000-8000-000000000001'),
  'an eligible exact bundle may enter qualified human review');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok(
  $$select pg_temp.record_p2_09_bundle(pg_temp.p2_09_claims(),pg_temp.p2_09_rules())$$,
  'exact replay is idempotent');
reset role;
select is((select count(*)::integer from public.p2_09_cultural_claim_bundles
  where source_review_packet_id='d9200000-0000-4000-8000-000000000001'),1,
  'idempotent replay creates no duplicate bundle');

select throws_ok(
  $$update public.p2_09_cultural_claim_bundles set machine_state='needs_repair' where source_review_packet_id='d9200000-0000-4000-8000-000000000001'$$,
  '55000','immutable record cannot be updated or deleted',
  'a machine claim bundle cannot be mutated');
select throws_ok(
  $$delete from public.p2_09_cultural_rule_assessments where cultural_claim_bundle_id=(select id from public.p2_09_cultural_claim_bundles where source_review_packet_id='d9200000-0000-4000-8000-000000000001') and rule_code='GQC-CULT-012'$$,
  '55000','immutable record cannot be updated or deleted',
  'a normalized rule assessment cannot be deleted');
select throws_ok(
  $$update public.p2_09_cultural_rule_contracts set requirement=requirement where rule_code='GQC-CULT-001'$$,
  '55000','immutable record cannot be updated or deleted',
  'the stable cultural rule contract cannot be mutated');
select throws_ok(
  $$update public.source_review_statuses set status='approved',version=version+1 where source_review_packet_id='d9200000-0000-4000-8000-000000000001'$$,
  '23514','P2-09 qualified cultural approval prerequisites are incomplete or blocked',
  'even an eligible machine bundle cannot self-approve without a selected qualified decision');

set local session_replication_role=replica;
insert into public.reviewer_competency_versions(
  id,workspace_id,reviewer_user_id,version_number,traditions,regions,languages,
  content_classes,appointment_issuer,appointment_evidence_hash,effective_at,
  expires_at,appointed_by,command_id,idempotency_key,request_hash
) values(
  'd9a00000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'd9900000-0000-4000-8000-000000000002',1,
  array['all'],array['all'],array['all'],array['all'],
  'Qualified reviewer fixture',repeat('a',64),
  statement_timestamp()-interval '1 day',statement_timestamp()+interval '1 year',
  'd9900000-0000-4000-8000-000000000003',
  'd9a00000-0000-4000-8000-000000000002',
  'p2-09-qualified-fixture',repeat('b',64)
);
insert into public.reviewer_competency_statuses(
  competency_version_id,workspace_id,reviewer_user_id,status,version,
  changed_by,reason
) values(
  'd9a00000-0000-4000-8000-000000000001',
  'd9100000-0000-4000-8000-000000000001',
  'd9900000-0000-4000-8000-000000000002','active',1,
  'd9900000-0000-4000-8000-000000000003','Qualified fixture activation'
);
insert into public.source_review_decisions(
  id,workspace_id,source_review_packet_id,policy_version_id,
  competency_version_id,reviewer_user_id,decision,subject_hash,
  source_set_hash,evidence_set_hash,competency_scope_hash,recusal_checked,
  actor_aal,rationale,command_id,idempotency_key,request_hash
)
select
  'd9b00000-0000-4000-8000-000000000001',packet.workspace_id,packet.id,
  packet.policy_version_id,'d9a00000-0000-4000-8000-000000000001',
  'd9900000-0000-4000-8000-000000000002','approve',packet.subject_hash,
  packet.source_set_hash,packet.evidence_set_hash,repeat('c',64),true,'aal2',
  'Qualified human reviewed the exact P2-09 bundle.',
  'd9b00000-0000-4000-8000-000000000002',
  'p2-09-qualified-decision',repeat('d',64)
from public.source_review_packets packet
where packet.id='d9200000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select lives_ok(
  $$update public.source_review_statuses set status='approved',version=version+1,selected_decision_id='d9b00000-0000-4000-8000-000000000001' where source_review_packet_id='d9200000-0000-4000-8000-000000000001'$$,
  'the approval guard accepts a selected active qualified-human decision bound to the exact packet');
select ok((select status='approved'
    and selected_decision_id='d9b00000-0000-4000-8000-000000000001'
  from public.source_review_statuses
  where source_review_packet_id='d9200000-0000-4000-8000-000000000001'),
  'qualified human authority remains the only transition to approved');

select set_config('request.jwt.claims','{"sub":"d9900000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','d9900000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select count(*)::integer from public.p2_09_cultural_claim_bundles),0,
  'forced RLS hides P2-09 bundles from an unrelated authenticated user');
reset role;
select ok(
  not has_table_privilege('authenticated','public.p2_09_cultural_rule_contracts','insert')
  and not has_table_privilege('authenticated','public.p2_09_cultural_claim_bundles','insert')
  and not has_table_privilege('authenticated','public.p2_09_cultural_rule_assessments','insert'),
  'authenticated users cannot forge rule contracts, bundles, or assessments');

select * from finish();
rollback;

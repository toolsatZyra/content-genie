-- P2-09 explicit cultural/source claim coverage. Machine extraction and rule
-- assessments remain immutable sidecars. They can make a packet eligible for
-- qualified review, but never create or substitute the human review decision.

create table public.p2_09_cultural_rule_contracts (
  rule_code text primary key check (
    rule_code ~ '^GQC-CULT-(00[1-9]|01[0-2])$'
  ),
  ordinal smallint not null unique check (ordinal between 1 and 12),
  effect text not null check (effect in (
    'hard_block_release','repair_or_critical_block',
    'missing_evidence_block_then_repair','repair_or_severe_block',
    'repair_or_hate_block','repair','needs_qualified_review'
  )),
  non_overridable boolean not null,
  claim_categories text[] not null check (cardinality(claim_categories) between 1 and 9),
  allowed_machine_states text[] not null check (cardinality(allowed_machine_states) between 1 and 5),
  requirement text not null check (char_length(requirement) between 20 and 2000),
  check (
    claim_categories <@ array[
      'deity_attributes','traditions','named_temples','rituals','shlokas',
      'contested_retellings','violence_romance','caste_social_context',
      'rights_triggers'
    ]::text[]
  ),
  check (
    allowed_machine_states <@ array[
      'eligible','needs_evidence','needs_repair',
      'needs_qualified_review','blocked'
    ]::text[]
  ),
  check (not non_overridable or allowed_machine_states <@ array['eligible','blocked']::text[])
);

insert into public.p2_09_cultural_rule_contracts (
  rule_code, ordinal, effect, non_overridable, claim_categories,
  allowed_machine_states, requirement
)
values
  (
    'GQC-CULT-001',1,'hard_block_release',true,
    array['deity_attributes','violence_romance'],array['eligible','blocked'],
    'No nudity or sexualized framing of deities or revered figures.'
  ),
  (
    'GQC-CULT-002',2,'hard_block_release',true,
    array['traditions','contested_retellings'],array['eligible','blocked'],
    'No religious-conflict, interfaith mockery or comparison, or deity-ranking staging.'
  ),
  (
    'GQC-CULT-003',3,'repair_or_critical_block',false,
    array['deity_attributes','traditions'],array['eligible','needs_repair','blocked'],
    'Deity form, topology, attributes, hand assignments, ornaments, vahana, costume, skin and form rules, and dignity match the pinned tradition manifest.'
  ),
  (
    'GQC-CULT-004',4,'missing_evidence_block_then_repair',false,
    array['traditions','contested_retellings'],
    array['eligible','needs_evidence','needs_repair','blocked'],
    'Canonical, regional-tradition, and popular-retelling claims are distinctly labelled and supported.'
  ),
  (
    'GQC-CULT-005',5,'missing_evidence_block_then_repair',false,
    array['named_temples','rights_triggers'],
    array['eligible','needs_evidence','needs_repair','blocked'],
    'Named temple depictions use researched real architectural evidence and do not invent a specific consecrated murti or ritual.'
  ),
  (
    'GQC-CULT-006',6,'missing_evidence_block_then_repair',false,
    array['rituals','traditions'],
    array['eligible','needs_evidence','needs_repair','blocked'],
    'A depicted ritual matches a cited approved ritual template and does not fabricate a worship act.'
  ),
  (
    'GQC-CULT-007',7,'repair_or_severe_block',false,
    array['violence_romance'],array['eligible','needs_repair','blocked'],
    'Violence and romance use the restraint and dignity of mainstream Indian devotional cinema.'
  ),
  (
    'GQC-CULT-008',8,'repair_or_hate_block',false,
    array['caste_social_context'],array['eligible','needs_repair','blocked'],
    'Caste and social roles may be historically realistic but are not humiliating, stereotyped, or framed as present-day hate.'
  ),
  (
    'GQC-CULT-009',9,'hard_block_release',false,
    array['shlokas','rights_triggers'],
    array['eligible','needs_evidence','needs_qualified_review','blocked'],
    'Shloka, source, rights, and pronunciation evidence is complete; restricted recitation lanes use approved human recordings.'
  ),
  (
    'GQC-CULT-010',10,'repair',false,
    array['deity_attributes','violence_romance','caste_social_context'],
    array['eligible','needs_repair'],
    'Thumbnail, cliffhanger freeze, and every reusable standalone frame remain dignified without narration context.'
  ),
  (
    'GQC-CULT-011',11,'needs_qualified_review',false,
    array['traditions','contested_retellings'],
    array['eligible','needs_qualified_review','blocked'],
    'Regional or counter-veneration sensitivity and release targeting are explicitly reviewed when triggered.'
  ),
  (
    'GQC-CULT-012',12,'hard_block_release',false,
    array['rights_triggers'],
    array['eligible','needs_evidence','needs_qualified_review','blocked'],
    'A real living guru is not portrayed without a separately approved rights and policy workflow.'
  );

create trigger p2_09_cultural_rule_contracts_immutable
before update or delete on public.p2_09_cultural_rule_contracts
for each row execute function private.reject_mutation();

create table public.p2_09_cultural_claim_bundles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_review_packet_id uuid not null,
  policy_version_id uuid not null references public.cultural_policy_versions(id) on delete restrict,
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  schema_version text not null check (schema_version = 'genie.p2-09-cultural-claims.v1'),
  claim_categories jsonb not null check (
    jsonb_typeof(claim_categories) = 'array' and pg_column_size(claim_categories) <= 262144
  ),
  rule_assessments jsonb not null check (
    jsonb_typeof(rule_assessments) = 'array' and pg_column_size(rule_assessments) <= 131072
  ),
  claims_hash text not null check (claims_hash ~ '^[a-f0-9]{64}$'),
  rule_assessments_hash text not null check (rule_assessments_hash ~ '^[a-f0-9]{64}$'),
  contract_hash text not null check (contract_hash ~ '^[a-f0-9]{64}$'),
  machine_state text not null check (machine_state in (
    'eligible','needs_evidence','needs_repair','needs_qualified_review','blocked'
  )),
  qualified_human_review_required boolean not null default true
    check (qualified_human_review_required),
  created_at timestamptz not null default statement_timestamp(),
  unique (source_review_packet_id),
  unique (workspace_id,id),
  unique (workspace_id,source_review_packet_id),
  foreign key (workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict
);

create table public.p2_09_cultural_rule_assessments (
  workspace_id uuid not null,
  cultural_claim_bundle_id uuid not null,
  rule_code text not null references public.p2_09_cultural_rule_contracts(rule_code) on delete restrict,
  verdict text not null check (verdict in (
    'eligible','needs_evidence','needs_repair','needs_qualified_review','blocked'
  )),
  claim_categories text[] not null,
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  rationale text not null check (char_length(rationale) between 2 and 2000),
  primary key (cultural_claim_bundle_id,rule_code),
  foreign key (workspace_id,cultural_claim_bundle_id)
    references public.p2_09_cultural_claim_bundles(workspace_id,id) on delete restrict,
  check (
    claim_categories <@ array[
      'deity_attributes','traditions','named_temples','rituals','shlokas',
      'contested_retellings','violence_romance','caste_social_context',
      'rights_triggers'
    ]::text[]
  )
);

create trigger p2_09_cultural_claim_bundles_immutable
before update or delete on public.p2_09_cultural_claim_bundles
for each row execute function private.reject_mutation();
create trigger p2_09_cultural_rule_assessments_immutable
before update or delete on public.p2_09_cultural_rule_assessments
for each row execute function private.reject_mutation();

create or replace function private.p2_09_expected_claim_categories()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'deity_attributes','traditions','named_temples','rituals','shlokas',
    'contested_retellings','violence_romance','caste_social_context',
    'rights_triggers'
  ]::text[];
$$;

create or replace function private.p2_09_cultural_contract_hash()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(jsonb_agg(jsonb_build_object(
    'ruleCode',rule.rule_code,
    'ordinal',rule.ordinal,
    'effect',rule.effect,
    'nonOverridable',rule.non_overridable,
    'claimCategories',to_jsonb(rule.claim_categories),
    'allowedMachineStates',to_jsonb(rule.allowed_machine_states),
    'requirement',rule.requirement
  ) order by rule.ordinal)::text,'UTF8'),'sha256'),'hex')
  from public.p2_09_cultural_rule_contracts rule;
$$;

create or replace function private.assert_p2_09_claim_categories(
  p_workspace_id uuid,
  p_source_review_packet_id uuid,
  p_claim_categories jsonb
)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  expected_categories text[] := private.p2_09_expected_claim_categories();
  actual_categories text[];
  present_categories text[] := '{}'::text[];
  incomplete_categories text[] := '{}'::text[];
  category_row jsonb;
  claim_row jsonb;
  category_name text;
  applicability text;
  source_count integer;
  total_claims integer := 0;
  uuid_pattern constant text := '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$';
begin
  if jsonb_typeof(p_claim_categories) is distinct from 'array'
    or jsonb_array_length(p_claim_categories) <> 9
  then
    raise exception 'P2-09 claim category coverage must contain exactly nine entries'
      using errcode = '22023';
  end if;

  select array_agg(item.value->>'category' order by item.ordinality)
    into actual_categories
  from jsonb_array_elements(p_claim_categories) with ordinality as item(value,ordinality);
  if actual_categories is distinct from expected_categories then
    raise exception 'P2-09 claim categories are missing, duplicated, or out of canonical order'
      using errcode = '22023';
  end if;

  for category_row in select value from jsonb_array_elements(p_claim_categories) loop
    if jsonb_typeof(category_row) is distinct from 'object'
      or (category_row-array[
        'category','applicability','claims','evidenceHash','qualifiedReviewTriggered'
      ]::text[]) <> '{}'::jsonb
      or not (category_row ?& array[
        'category','applicability','claims','evidenceHash','qualifiedReviewTriggered'
      ])
    then
      raise exception 'P2-09 claim category object is not exact'
        using errcode = '22023';
    end if;

    category_name := category_row->>'category';
    applicability := category_row->>'applicability';
    if applicability not in ('not_present','present')
      or coalesce(category_row->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(category_row->'qualifiedReviewTriggered') is distinct from 'boolean'
      or jsonb_typeof(category_row->'claims') is distinct from 'array'
      or jsonb_array_length(category_row->'claims') > 100
      or (applicability='present' and jsonb_array_length(category_row->'claims')=0)
      or (applicability='not_present' and jsonb_array_length(category_row->'claims')<>0)
      or (applicability='not_present' and (category_row->>'qualifiedReviewTriggered')::boolean)
    then
      raise exception 'P2-09 claim category envelope is invalid'
        using errcode = '22023';
    end if;

    if applicability='present' then
      present_categories := array_append(present_categories,category_name);
      if category_name in (
        'deity_attributes','named_temples','rituals','shlokas',
        'contested_retellings','violence_romance','caste_social_context','rights_triggers'
      ) and not (category_row->>'qualifiedReviewTriggered')::boolean then
        raise exception 'P2-09 enhanced cultural trigger is not routed to qualified review'
          using errcode = '23514';
      end if;
    end if;

    for claim_row in select value from jsonb_array_elements(category_row->'claims') loop
      total_claims := total_claims + 1;
      if total_claims > 200 then
        raise exception 'P2-09 claim count exceeds the bounded envelope'
          using errcode = '22023';
      end if;
      if jsonb_typeof(claim_row) is distinct from 'object'
        or (claim_row-array[
          'claimKey','assertion','interpretationLabel','subjectKind','subjectId',
          'sourceRecordVersionIds','evidenceHash'
        ]::text[]) <> '{}'::jsonb
        or not (claim_row ?& array[
          'claimKey','assertion','interpretationLabel','subjectKind','subjectId',
          'sourceRecordVersionIds','evidenceHash'
        ])
      then
        raise exception 'P2-09 extracted claim object is not exact'
          using errcode = '22023';
      end if;
      if coalesce(claim_row->>'claimKey','') !~ '^[a-z0-9][a-z0-9_.-]{2,119}$'
        or char_length(coalesce(claim_row->>'assertion','')) not between 1 and 4000
        or claim_row->>'interpretationLabel' not in (
          'not_applicable','canonical_text','traditional_commentary',
          'regional_retelling','temple_tradition','popular_retelling','creative_bridge'
        )
        or claim_row->>'subjectKind' not in (
          'script_span','character_version','location_version','source_record','world','general'
        )
        or coalesce(claim_row->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(claim_row->'sourceRecordVersionIds') is distinct from 'array'
        or jsonb_array_length(claim_row->'sourceRecordVersionIds') > 50
      then
        raise exception 'P2-09 extracted claim envelope is invalid'
          using errcode = '22023';
      end if;
      if (claim_row->>'subjectKind'='general' and coalesce(claim_row->>'subjectId','')<>'')
        or (claim_row->>'subjectKind'<>'general' and coalesce(claim_row->>'subjectId','') !~ uuid_pattern)
      then
        raise exception 'P2-09 extracted claim subject is invalid'
          using errcode = '22023';
      end if;
      if category_name in ('traditions','contested_retellings')
        and claim_row->>'interpretationLabel'='not_applicable'
      then
        raise exception 'P2-09 tradition claim lacks an interpretation label'
          using errcode = '23514';
      end if;
      if exists (
        select 1
        from jsonb_array_elements_text(claim_row->'sourceRecordVersionIds') as source(value)
        where source.value !~ uuid_pattern
      ) or (
        select count(*) from jsonb_array_elements_text(claim_row->'sourceRecordVersionIds')
      ) <> (
        select count(distinct source.value)
        from jsonb_array_elements_text(claim_row->'sourceRecordVersionIds') as source(value)
      ) then
        raise exception 'P2-09 claim source identities are invalid or duplicated'
          using errcode = '22023';
      end if;
      if exists (
        select 1
        from jsonb_array_elements_text(claim_row->'sourceRecordVersionIds') as source(value)
        where not exists (
          select 1 from public.source_review_packet_sources link
          where link.workspace_id=p_workspace_id
            and link.source_review_packet_id=p_source_review_packet_id
            and link.source_record_version_id=source.value::uuid
        )
      ) then
        raise exception 'P2-09 claim cites a source outside the exact review packet'
          using errcode = '23514';
      end if;
      source_count := jsonb_array_length(claim_row->'sourceRecordVersionIds');
      if source_count=0 or (category_name='named_temples' and source_count<2) then
        if not category_name=any(incomplete_categories) then
          incomplete_categories := array_append(incomplete_categories,category_name);
        end if;
      end if;
    end loop;
  end loop;

  if 'deity_attributes'=any(present_categories) and not 'traditions'=any(present_categories)
    or 'rituals'=any(present_categories) and not 'traditions'=any(present_categories)
    or 'contested_retellings'=any(present_categories) and not 'traditions'=any(present_categories)
    or 'named_temples'=any(present_categories) and not 'rights_triggers'=any(present_categories)
    or 'shlokas'=any(present_categories) and not 'rights_triggers'=any(present_categories)
  then
    raise exception 'P2-09 related tradition or rights trigger coverage is missing'
      using errcode = '23514';
  end if;

  return incomplete_categories;
end;
$$;

create or replace function public.command_record_p2_09_cultural_claim_bundle(
  p_workspace_id uuid,
  p_source_review_packet_id uuid,
  p_schema_version text,
  p_claim_categories jsonb,
  p_rule_assessments jsonb,
  p_claims_hash text,
  p_rule_assessments_hash text,
  p_contract_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  packet public.source_review_packets%rowtype;
  existing public.p2_09_cultural_claim_bundles%rowtype;
  assessment jsonb;
  contract public.p2_09_cultural_rule_contracts%rowtype;
  actual_rule_codes text[];
  expected_rule_codes text[];
  present_categories text[];
  expected_claim_categories text[];
  actual_claim_categories text[];
  incomplete_categories text[];
  expected_claims_hash text;
  expected_assessments_hash text;
  expected_contract_hash text;
  machine_state text := 'eligible';
  bundle_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_source_review_packet_id::text,0));
  select * into packet from public.source_review_packets
  where id=p_source_review_packet_id and workspace_id=p_workspace_id;
  if packet.id is null
    or p_schema_version is distinct from 'genie.p2-09-cultural-claims.v1'
    or not exists (
      select 1 from public.source_review_packet_world_bindings binding
      where binding.workspace_id=p_workspace_id
        and binding.source_review_packet_id=packet.id
        and binding.configuration_candidate_id=packet.configuration_candidate_id
        and binding.subject_hash=packet.subject_hash
    )
    or not exists (
      select 1 from public.source_review_statuses status
      where status.workspace_id=p_workspace_id
        and status.source_review_packet_id=packet.id
        and status.status='pending_qualified_review'
    )
  then
    raise exception 'P2-09 source review packet is missing, stale, or not pending'
      using errcode='40001';
  end if;

  expected_claims_hash:=encode(extensions.digest(convert_to(p_claim_categories::text,'UTF8'),'sha256'),'hex');
  expected_assessments_hash:=encode(extensions.digest(convert_to(p_rule_assessments::text,'UTF8'),'sha256'),'hex');
  expected_contract_hash:=private.p2_09_cultural_contract_hash();
  if p_claims_hash is distinct from expected_claims_hash
    or p_rule_assessments_hash is distinct from expected_assessments_hash
    or p_contract_hash is distinct from expected_contract_hash
  then
    raise exception 'P2-09 claim, assessment, or contract hash is stale'
      using errcode='40001';
  end if;

  select * into existing from public.p2_09_cultural_claim_bundles bundle
  where bundle.workspace_id=p_workspace_id
    and bundle.source_review_packet_id=packet.id;
  if existing.id is not null then
    if existing.schema_version<>p_schema_version
      or existing.claims_hash<>p_claims_hash
      or existing.rule_assessments_hash<>p_rule_assessments_hash
      or existing.contract_hash<>p_contract_hash
    then
      raise exception 'P2-09 cultural claim bundle conflicts with immutable evidence'
        using errcode='40001';
    end if;
    return jsonb_build_object(
      'ok',true,'bundleId',existing.id,'machineState',existing.machine_state,
      'qualifiedHumanReviewRequired',true,'existing',true
    );
  end if;

  incomplete_categories:=private.assert_p2_09_claim_categories(
    p_workspace_id,p_source_review_packet_id,p_claim_categories
  );
  select coalesce(array_agg(item.value->>'category' order by item.ordinality)
    filter (where item.value->>'applicability'='present'),'{}'::text[])
    into present_categories
  from jsonb_array_elements(p_claim_categories) with ordinality as item(value,ordinality);

  if jsonb_typeof(p_rule_assessments) is distinct from 'array'
    or jsonb_array_length(p_rule_assessments)<>12
  then
    raise exception 'P2-09 rule coverage must contain exactly twelve assessments'
      using errcode='22023';
  end if;
  select array_agg(item.value->>'ruleCode' order by item.ordinality)
    into actual_rule_codes
  from jsonb_array_elements(p_rule_assessments) with ordinality as item(value,ordinality);
  select array_agg(rule.rule_code order by rule.ordinal)
    into expected_rule_codes
  from public.p2_09_cultural_rule_contracts rule;
  if actual_rule_codes is distinct from expected_rule_codes then
    raise exception 'P2-09 rules are missing, duplicated, or out of canonical order'
      using errcode='22023';
  end if;

  for assessment in select value from jsonb_array_elements(p_rule_assessments) loop
    if jsonb_typeof(assessment) is distinct from 'object'
      or (assessment-array[
        'ruleCode','verdict','claimCategories','evidenceHash','rationale'
      ]::text[]) <> '{}'::jsonb
      or not (assessment ?& array[
        'ruleCode','verdict','claimCategories','evidenceHash','rationale'
      ])
      or jsonb_typeof(assessment->'claimCategories') is distinct from 'array'
      or coalesce(assessment->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
      or char_length(coalesce(assessment->>'rationale','')) not between 2 and 2000
    then
      raise exception 'P2-09 cultural rule assessment is not exact'
        using errcode='22023';
    end if;
    select * into contract from public.p2_09_cultural_rule_contracts
    where rule_code=assessment->>'ruleCode';
    if contract.rule_code is null
      or not (assessment->>'verdict'=any(contract.allowed_machine_states))
    then
      raise exception 'P2-09 rule verdict is not allowed by the stable contract'
        using errcode='23514';
    end if;
    select coalesce(array_agg(category order by category_position),'{}'::text[])
      into expected_claim_categories
    from unnest(contract.claim_categories) with ordinality as mapped(category,category_position)
    where category=any(present_categories);
    select coalesce(array_agg(value order by ordinality),'{}'::text[])
      into actual_claim_categories
    from jsonb_array_elements_text(assessment->'claimCategories') with ordinality as supplied(value,ordinality);
    if actual_claim_categories is distinct from expected_claim_categories then
      raise exception 'P2-09 rule-to-claim mapping is incomplete or non-canonical'
        using errcode='23514';
    end if;
    if contract.non_overridable and assessment->>'verdict'<>'eligible'
      and assessment->>'verdict'<>'blocked'
    then
      raise exception 'P2-09 non-overridable rule cannot be waived or repaired'
        using errcode='23514';
    end if;
  end loop;

  if exists (
    select 1 from unnest(incomplete_categories) missing(category)
    where not exists (
      select 1 from jsonb_array_elements(p_rule_assessments) a(value)
      where a.value->>'verdict' in ('needs_evidence','blocked')
        and a.value->'claimCategories' ? missing.category
    )
  ) then
    raise exception 'P2-09 missing claim evidence is not represented by a blocking assessment'
      using errcode='23514';
  end if;

  if exists(select 1 from jsonb_array_elements(p_rule_assessments) a(value)
      where a.value->>'verdict'='blocked') then machine_state:='blocked';
  elsif cardinality(incomplete_categories)>0
    or exists(select 1 from jsonb_array_elements(p_rule_assessments) a(value)
      where a.value->>'verdict'='needs_evidence') then machine_state:='needs_evidence';
  elsif exists(select 1 from jsonb_array_elements(p_rule_assessments) a(value)
      where a.value->>'verdict'='needs_repair') then machine_state:='needs_repair';
  elsif exists(select 1 from jsonb_array_elements(p_rule_assessments) a(value)
      where a.value->>'verdict'='needs_qualified_review') then machine_state:='needs_qualified_review';
  end if;

  insert into public.p2_09_cultural_claim_bundles(
    workspace_id,source_review_packet_id,policy_version_id,subject_hash,
    schema_version,claim_categories,rule_assessments,claims_hash,
    rule_assessments_hash,contract_hash,machine_state
  ) values(
    p_workspace_id,packet.id,packet.policy_version_id,packet.subject_hash,
    p_schema_version,p_claim_categories,p_rule_assessments,p_claims_hash,
    p_rule_assessments_hash,p_contract_hash,machine_state
  ) returning id into bundle_id;

  insert into public.p2_09_cultural_rule_assessments(
    workspace_id,cultural_claim_bundle_id,rule_code,verdict,
    claim_categories,evidence_hash,rationale
  )
  select p_workspace_id,bundle_id,assessment->>'ruleCode',assessment->>'verdict',
    array(select jsonb_array_elements_text(assessment->'claimCategories')),
    assessment->>'evidenceHash',assessment->>'rationale'
  from jsonb_array_elements(p_rule_assessments) assessment;

  return jsonb_build_object(
    'ok',true,'bundleId',bundle_id,'machineState',machine_state,
    'qualifiedHumanReviewRequired',true,'existing',false
  );
end;
$$;

create or replace function private.p2_09_cultural_bundle_is_approvable(
  p_workspace_id uuid,
  p_source_review_packet_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.p2_09_cultural_claim_bundles bundle
    where bundle.workspace_id=p_workspace_id
      and bundle.source_review_packet_id=p_source_review_packet_id
      and bundle.schema_version='genie.p2-09-cultural-claims.v1'
      and bundle.qualified_human_review_required
      and bundle.machine_state in ('eligible','needs_qualified_review')
      and bundle.claims_hash=encode(extensions.digest(convert_to(bundle.claim_categories::text,'UTF8'),'sha256'),'hex')
      and bundle.rule_assessments_hash=encode(extensions.digest(convert_to(bundle.rule_assessments::text,'UTF8'),'sha256'),'hex')
      and bundle.contract_hash=private.p2_09_cultural_contract_hash()
      and (select count(*) from public.p2_09_cultural_rule_assessments assessment
        where assessment.cultural_claim_bundle_id=bundle.id)=12
      and not exists(
        select 1
        from public.p2_09_cultural_rule_contracts contract
        left join public.p2_09_cultural_rule_assessments assessment
          on assessment.cultural_claim_bundle_id=bundle.id
         and assessment.rule_code=contract.rule_code
        where assessment.rule_code is null
          or not (assessment.verdict=any(contract.allowed_machine_states))
          or assessment.verdict in ('needs_evidence','needs_repair','blocked')
          or (contract.non_overridable and assessment.verdict<>'eligible')
      )
      and not exists(
        select 1 from public.source_review_packet_sources link
        join public.source_record_versions source
          on source.workspace_id=link.workspace_id
         and source.id=link.source_record_version_id
        where link.workspace_id=p_workspace_id
          and link.source_review_packet_id=p_source_review_packet_id
          and (source.verification_state<>'verified'
            or source.rights_status in ('uncertain','prohibited')
            or source.contradiction_state='material_unresolved')
      )
      and not exists(
        select 1 from public.cultural_readiness_findings finding
        join public.cultural_policy_rules rule on rule.id=finding.policy_rule_id
        where finding.workspace_id=p_workspace_id
          and finding.source_review_packet_id=p_source_review_packet_id
          and rule.non_overridable
          and finding.verdict in ('repair_required','production_blocked','release_blocked')
      )
  );
$$;

create or replace function private.enforce_p2_09_source_review_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status='approved' and (
    old.status is distinct from 'approved'
    or new.selected_decision_id is distinct from old.selected_decision_id
  ) then
    if new.selected_decision_id is null
      or not exists(
        select 1
        from public.source_review_packets packet
        join public.source_review_decisions decision
          on decision.workspace_id=packet.workspace_id
         and decision.source_review_packet_id=packet.id
        join public.reviewer_competency_versions competency
          on competency.workspace_id=decision.workspace_id
         and competency.id=decision.competency_version_id
         and competency.reviewer_user_id=decision.reviewer_user_id
        join public.reviewer_competency_statuses competency_status
          on competency_status.workspace_id=competency.workspace_id
         and competency_status.competency_version_id=competency.id
         and competency_status.status='active'
        where packet.workspace_id=new.workspace_id
          and packet.id=new.source_review_packet_id
          and decision.id=new.selected_decision_id
          and decision.decision='approve'
          and decision.policy_version_id=packet.policy_version_id
          and decision.subject_hash=packet.subject_hash
          and decision.source_set_hash=packet.source_set_hash
          and decision.evidence_set_hash=packet.evidence_set_hash
          and decision.recusal_checked
          and decision.created_at>=competency.effective_at
          and decision.created_at<competency.expires_at
      )
      or not private.p2_09_cultural_bundle_is_approvable(
        new.workspace_id,new.source_review_packet_id
      )
    then
      raise exception 'P2-09 qualified cultural approval prerequisites are incomplete or blocked'
        using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger source_review_statuses_p2_09_approval_guard
before update on public.source_review_statuses
for each row execute function private.enforce_p2_09_source_review_approval();

alter table public.p2_09_cultural_rule_contracts enable row level security;
alter table public.p2_09_cultural_rule_contracts force row level security;
alter table public.p2_09_cultural_claim_bundles enable row level security;
alter table public.p2_09_cultural_claim_bundles force row level security;
alter table public.p2_09_cultural_rule_assessments enable row level security;
alter table public.p2_09_cultural_rule_assessments force row level security;

create policy p2_09_cultural_rule_contracts_authenticated_select
on public.p2_09_cultural_rule_contracts for select to authenticated using (true);
create policy p2_09_cultural_claim_bundles_member_select
on public.p2_09_cultural_claim_bundles for select to authenticated
using(private.is_active_member(workspace_id,(select auth.uid())));
create policy p2_09_cultural_rule_assessments_member_select
on public.p2_09_cultural_rule_assessments for select to authenticated
using(private.is_active_member(workspace_id,(select auth.uid())));

revoke all on table public.p2_09_cultural_rule_contracts,
  public.p2_09_cultural_claim_bundles,
  public.p2_09_cultural_rule_assessments
from public,anon,authenticated;
grant select on table public.p2_09_cultural_rule_contracts,
  public.p2_09_cultural_claim_bundles,
  public.p2_09_cultural_rule_assessments
to authenticated;

revoke all on function public.command_record_p2_09_cultural_claim_bundle(
  uuid,uuid,text,jsonb,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.command_record_p2_09_cultural_claim_bundle(
  uuid,uuid,text,jsonb,jsonb,text,text,text
) to service_role;

revoke all on function private.p2_09_expected_claim_categories(),
  private.p2_09_cultural_contract_hash(),
  private.assert_p2_09_claim_categories(uuid,uuid,jsonb),
  private.p2_09_cultural_bundle_is_approvable(uuid,uuid),
  private.enforce_p2_09_source_review_approval()
from public,anon,authenticated;

-- Preserve the applied P2-09 migration and correct the normalized-assessment
-- insert's PL/pgSQL variable/SQL alias ambiguity forward-only.

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
  assessment_item jsonb;
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

  for assessment_item in select value from jsonb_array_elements(p_rule_assessments) loop
    if jsonb_typeof(assessment_item) is distinct from 'object'
      or (assessment_item-array[
        'ruleCode','verdict','claimCategories','evidenceHash','rationale'
      ]::text[]) <> '{}'::jsonb
      or not (assessment_item ?& array[
        'ruleCode','verdict','claimCategories','evidenceHash','rationale'
      ])
      or jsonb_typeof(assessment_item->'claimCategories') is distinct from 'array'
      or coalesce(assessment_item->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
      or char_length(coalesce(assessment_item->>'rationale','')) not between 2 and 2000
    then
      raise exception 'P2-09 cultural rule assessment is not exact'
        using errcode='22023';
    end if;
    select * into contract from public.p2_09_cultural_rule_contracts
    where rule_code=assessment_item->>'ruleCode';
    if contract.rule_code is null
      or not (assessment_item->>'verdict'=any(contract.allowed_machine_states))
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
    from jsonb_array_elements_text(assessment_item->'claimCategories')
      with ordinality as supplied(value,ordinality);
    if actual_claim_categories is distinct from expected_claim_categories then
      raise exception 'P2-09 rule-to-claim mapping is incomplete or non-canonical'
        using errcode='23514';
    end if;
    if contract.non_overridable and assessment_item->>'verdict'<>'eligible'
      and assessment_item->>'verdict'<>'blocked'
    then
      raise exception 'P2-09 non-overridable rule cannot be waived or repaired'
        using errcode='23514';
    end if;
  end loop;

  if exists (
    select 1 from unnest(incomplete_categories) missing(category)
    where not exists (
      select 1 from jsonb_array_elements(p_rule_assessments) item(value)
      where item.value->>'verdict' in ('needs_evidence','blocked')
        and item.value->'claimCategories' ? missing.category
    )
  ) then
    raise exception 'P2-09 missing claim evidence is not represented by a blocking assessment'
      using errcode='23514';
  end if;

  if exists(select 1 from jsonb_array_elements(p_rule_assessments) item(value)
      where item.value->>'verdict'='blocked') then machine_state:='blocked';
  elsif cardinality(incomplete_categories)>0
    or exists(select 1 from jsonb_array_elements(p_rule_assessments) item(value)
      where item.value->>'verdict'='needs_evidence') then machine_state:='needs_evidence';
  elsif exists(select 1 from jsonb_array_elements(p_rule_assessments) item(value)
      where item.value->>'verdict'='needs_repair') then machine_state:='needs_repair';
  elsif exists(select 1 from jsonb_array_elements(p_rule_assessments) item(value)
      where item.value->>'verdict'='needs_qualified_review') then machine_state:='needs_qualified_review';
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
  select p_workspace_id,bundle_id,
    normalized.value->>'ruleCode',normalized.value->>'verdict',
    array(select jsonb_array_elements_text(normalized.value->'claimCategories')),
    normalized.value->>'evidenceHash',normalized.value->>'rationale'
  from jsonb_array_elements(p_rule_assessments) as normalized(value);

  return jsonb_build_object(
    'ok',true,'bundleId',bundle_id,'machineState',machine_state,
    'qualifiedHumanReviewRequired',true,'existing',false
  );
end;
$$;

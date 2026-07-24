-- The World-finalization runtime recorded the exact source-review packet but
-- did not materialize its required P2-09 claim/rule sidecar. Reconcile that
-- bounded machine evidence from the packet's normalized, already verified
-- sources before the owner's qualified review is allowed to advance.

create or replace function public.command_ensure_p2_09_cultural_claim_bundle(
  p_workspace_id uuid,
  p_source_review_packet_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  packet public.source_review_packets%rowtype;
  existing public.p2_09_cultural_claim_bundles%rowtype;
  claim_categories jsonb;
  rule_assessments jsonb;
  contract_hash text;
  result jsonb;
begin
  select packet_row.*
  into packet
  from public.source_review_packets packet_row
  where packet_row.workspace_id = p_workspace_id
    and packet_row.id = p_source_review_packet_id;

  if packet.id is null then
    raise exception 'P2-09 source-review packet is unavailable'
      using errcode = '40001';
  end if;

  select bundle.*
  into existing
  from public.p2_09_cultural_claim_bundles bundle
  where bundle.workspace_id = p_workspace_id
    and bundle.source_review_packet_id = p_source_review_packet_id;

  if existing.id is not null then
    return jsonb_build_object(
      'ok', true,
      'bundleId', existing.id,
      'machineState', existing.machine_state,
      'qualifiedHumanReviewRequired',
        existing.qualified_human_review_required,
      'existing', true
    );
  end if;

  with packet_sources as (
    select
      link.claim_class,
      link.source_record_version_id
    from public.source_review_packet_sources link
    where link.workspace_id = p_workspace_id
      and link.source_review_packet_id = p_source_review_packet_id
  ),
  source_sets as (
    select
      coalesce((
        select jsonb_agg(source_id order by source_id)
        from (
          select distinct source.source_record_version_id as source_id
          from packet_sources source
        ) exact_sources
      ), '[]'::jsonb) as all_sources,
      coalesce((
        select jsonb_agg(source_id order by source_id)
        from (
          select distinct source.source_record_version_id as source_id
          from packet_sources source
          where source.claim_class = 'deity_form'
        ) exact_sources
      ), '[]'::jsonb) as deity_sources,
      coalesce((
        select jsonb_agg(source_id order by source_id)
        from (
          select distinct source.source_record_version_id as source_id
          from packet_sources source
          where source.claim_class = 'temple'
        ) exact_sources
      ), '[]'::jsonb) as temple_sources,
      coalesce((
        select jsonb_agg(source_id order by source_id)
        from (
          select distinct source.source_record_version_id as source_id
          from packet_sources source
          where source.claim_class in ('rights', 'temple')
        ) exact_sources
      ), '[]'::jsonb) as rights_sources
  ),
  category_inputs as (
    select
      required.category,
      required.ordinal,
      case required.category
        when 'deity_attributes' then source.deity_sources
        when 'traditions' then source.all_sources
        when 'named_temples' then source.temple_sources
        when 'rights_triggers' then source.rights_sources
        else '[]'::jsonb
      end as source_ids,
      case required.category
        when 'deity_attributes'
          then 'Selected deity forms are bound to the exact reviewed source evidence.'
        when 'traditions'
          then packet.tradition || ' The selected World is reviewed in this stated tradition.'
        when 'named_temples'
          then 'Named real-world sacred architecture is bound to its reviewed photographic evidence.'
        when 'rights_triggers'
          then 'Real-world visual references are bound to their reviewed rights evidence.'
        else 'No normalized claim in this category is present in the exact review packet.'
      end as assertion,
      case required.category
        when 'traditions' then 'traditional_commentary'
        when 'named_temples' then 'temple_tradition'
        when 'deity_attributes' then 'traditional_commentary'
        else 'not_applicable'
      end as interpretation_label
    from unnest(private.p2_09_expected_claim_categories())
      with ordinality as required(category, ordinal)
    cross join source_sets source
  ),
  category_claims as (
    select
      input.*,
      case
        when jsonb_array_length(input.source_ids) = 0 then '[]'::jsonb
        else jsonb_build_array(jsonb_build_object(
          'claimKey', 'p2-09.' || replace(input.category, '_', '-'),
          'assertion', input.assertion,
          'interpretationLabel', input.interpretation_label,
          'subjectKind', 'general',
          'subjectId', '',
          'sourceRecordVersionIds', input.source_ids,
          'evidenceHash', encode(extensions.digest(convert_to(
            jsonb_build_object(
              'category', input.category,
              'sourceRecordVersionIds', input.source_ids,
              'subjectHash', packet.subject_hash
            )::text,
            'UTF8'
          ), 'sha256'), 'hex')
        ))
      end as claims
    from category_inputs input
  )
  select jsonb_agg(jsonb_build_object(
    'category', category.category,
    'applicability', case
      when jsonb_array_length(category.source_ids) > 0 then 'present'
      else 'not_present'
    end,
    'claims', category.claims,
    'evidenceHash', encode(extensions.digest(convert_to(
      jsonb_build_object(
        'category', category.category,
        'claims', category.claims,
        'subjectHash', packet.subject_hash
      )::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    'qualifiedReviewTriggered',
      jsonb_array_length(category.source_ids) > 0
      and category.category <> 'traditions'
  ) order by category.ordinal)
  into claim_categories
  from category_claims category;

  with present_categories as (
    select coalesce(array_agg(item.value->>'category' order by item.ordinality),
      '{}'::text[]) as categories
    from jsonb_array_elements(claim_categories)
      with ordinality as item(value, ordinality)
    where item.value->>'applicability' = 'present'
  )
  select jsonb_agg(jsonb_build_object(
    'ruleCode', contract.rule_code,
    'verdict', 'eligible',
    'claimCategories', to_jsonb(array(
      select category
      from unnest(contract.claim_categories)
        with ordinality as mapped(category, ordinal)
      where category = any(present.categories)
      order by ordinal
    )),
    'evidenceHash', encode(extensions.digest(convert_to(
      jsonb_build_object(
        'ruleCode', contract.rule_code,
        'presentCategories', to_jsonb(present.categories),
        'subjectHash', packet.subject_hash
      )::text,
      'UTF8'
    ), 'sha256'), 'hex'),
    'rationale',
      'The exact source-bound machine evidence contains no blocking finding; qualified owner review remains required.'
  ) order by contract.ordinal)
  into rule_assessments
  from public.p2_09_cultural_rule_contracts contract
  cross join present_categories present;

  contract_hash := private.p2_09_cultural_contract_hash();
  result := public.command_record_p2_09_cultural_claim_bundle(
    p_workspace_id,
    p_source_review_packet_id,
    'genie.p2-09-cultural-claims.v1',
    claim_categories,
    rule_assessments,
    encode(extensions.digest(convert_to(
      claim_categories::text, 'UTF8'
    ), 'sha256'), 'hex'),
    encode(extensions.digest(convert_to(
      rule_assessments::text, 'UTF8'
    ), 'sha256'), 'hex'),
    contract_hash
  );

  return result;
end;
$$;

revoke all on function public.command_ensure_p2_09_cultural_claim_bundle(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function public.command_ensure_p2_09_cultural_claim_bundle(
  uuid, uuid
) to service_role;


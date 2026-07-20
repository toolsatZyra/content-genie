-- Forward-only hardening for the customer-visible production quote and World
-- decision idempotency. The projection exposes the quote's exact line items
-- without leaking provider credentials; reused keys must bind to one request.

do $migration$
declare
  function_definition text;
  declaration_count integer;
  select_count integer;
  replay_count integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.command_decide_world_candidate(uuid,uuid,text,uuid,uuid,bigint,text,text,text,uuid,text,text,uuid)'::regprocedure
  ) into function_definition;

  select count(*) into declaration_count
  from regexp_matches(function_definition, E'existing jsonb;', 'g');
  select count(*) into select_count
  from regexp_matches(
    function_definition,
    E'select decision\\.response_json into existing from private\\.world_asset_decisions decision',
    'g'
  );
  select count(*) into replay_count
  from regexp_matches(function_definition, E'if found then return existing; end if;', 'g');

  if declaration_count <> 1 or select_count <> 1 or replay_count <> 1 then
    raise exception 'world decision idempotency predecessor is unexpected';
  end if;

  function_definition := replace(
    function_definition,
    'existing jsonb;',
    E'existing jsonb;\n  existing_request_hash text;'
  );
  function_definition := replace(
    function_definition,
    'select decision.response_json into existing from private.world_asset_decisions decision',
    'select decision.response_json, decision.request_hash into existing, existing_request_hash from private.world_asset_decisions decision'
  );
  function_definition := replace(
    function_definition,
    'if found then return existing; end if;',
    E'if found then\n    if existing_request_hash is distinct from p_request_hash then\n      raise exception ''world decision idempotency key conflicts'' using errcode = ''40001'';\n    end if;\n    return existing;\n  end if;'
  );
  execute function_definition;
end;
$migration$;

create or replace view public.creation_readiness_projections
with (security_invoker=true)
as
select
  configuration.workspace_id,
  configuration.id as configuration_candidate_id,
  jsonb_build_object(
    'characters',coalesce((
      select jsonb_agg(jsonb_build_object(
        'selectionId',selection.id,'entityId',character.id,'formId',form.id,
        'name',character.display_name,'formKey',form.form_key,'state',selection.state,
        'aggregateVersion',selection.aggregate_version,
        'candidateVersionId',selection.candidate_version_id,
        'selectedVersionId',selection.selected_version_id,
        'promptText',candidate.prompt_text,'promptSha256',candidate.prompt_sha256,
        'assetVersionId',candidate.anchor_asset_version_id,
        'bucketId',asset.bucket_id,'objectName',asset.object_name,
        'sheetState',(select sheet.state from public.character_sheet_versions sheet
          where sheet.character_version_id=selection.selected_version_id
          order by sheet.created_at desc limit 1)
      ) order by character.display_name,form.form_key)
      from public.character_selections selection
      join public.character_forms form on form.id=selection.character_form_id
      join public.characters character on character.id=form.character_id
      join public.character_versions candidate on candidate.id=selection.candidate_version_id
      join public.asset_versions asset on asset.id=candidate.anchor_asset_version_id
      where selection.configuration_candidate_id=configuration.id
    ),'[]'::jsonb),
    'locations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'selectionId',selection.id,'entityId',location.id,'name',location.display_name,
        'namedTemple',location.named_temple,'state',selection.state,
        'aggregateVersion',selection.aggregate_version,
        'candidateVersionId',selection.candidate_version_id,
        'selectedVersionId',selection.selected_version_id,
        'promptText',candidate.prompt_text,'promptSha256',candidate.prompt_sha256,
        'assetVersionId',candidate.empty_anchor_asset_version_id,
        'bucketId',asset.bucket_id,'objectName',asset.object_name,
        'templeEvidenceSetHash',candidate.temple_evidence_set_hash
      ) order by location.display_name)
      from public.location_selections selection
      join public.locations location on location.id=selection.location_id
      join public.location_versions candidate on candidate.id=selection.candidate_version_id
      join public.asset_versions asset on asset.id=candidate.empty_anchor_asset_version_id
      where selection.configuration_candidate_id=configuration.id
    ),'[]'::jsonb),
    'referencePack',(select jsonb_build_object('id',pack.id,'state',pack.state,
      'versionNumber',pack.version_number,'manifestHash',pack.manifest_hash)
      from public.world_reference_pack_versions pack
      where pack.configuration_candidate_id=configuration.id
      order by pack.version_number desc limit 1)
  ) as world,
  jsonb_build_object(
    'audioIdentity',(select jsonb_build_object('id',selection.id,'state',selection.state,
      'voiceVersionId',selection.voice_version_id,'selectionHash',selection.selection_hash)
      from public.preflight_audio_identity_selections selection
      where selection.configuration_candidate_id=configuration.id
      order by selection.created_at desc limit 1),
    'masterClock',(select jsonb_build_object('id',clock.id,'state',clock.state,
      'durationMs',clock.duration_ms,'alignmentHash',clock.alignment_hash)
      from public.narration_master_clock_versions clock
      where clock.configuration_candidate_id=configuration.id
      order by clock.version_number desc limit 1),
    'plan',(select jsonb_build_object('id',plan.id,'state',plan.state,
      'planHash',plan.plan_hash,'projectedOvs',plan.projected_ovs,
      'projectedCvp',plan.projected_cvp,'projectedPfs',plan.projected_pfs,
      'projectedConfidence',plan.projected_confidence)
      from public.preflight_plan_bundles plan
      where plan.configuration_candidate_id=configuration.id
      order by plan.created_at desc limit 1),
    'qc',(select jsonb_build_object('id',summary.id,'verdict',summary.verdict,
      'ovs',summary.ovs,'cvp',summary.cvp,'pfs',summary.pfs,'lcr',summary.lcr,
      'confidence',summary.confidence,'evidenceDensity',summary.evidence_density,
      'gateCodes',to_jsonb(summary.gate_codes),'consensusHash',summary.consensus_hash)
      from public.preflight_plan_qc_summaries summary
      join public.preflight_plan_bundles plan on plan.id=summary.plan_bundle_id
      where plan.configuration_candidate_id=configuration.id
      order by summary.created_at desc limit 1),
    'quote',(select jsonb_build_object(
      'id',quote.id,
      'quoteHash',quote.quote_hash,
      'lowTotalMicrousd',quote.low_total_microusd,
      'expectedTotalMicrousd',quote.expected_total_microusd,
      'highTotalMicrousd',quote.high_total_microusd,
      'hardCeilingMicrousd',quote.hard_ceiling_microusd,
      'target40UsdBreached',quote.target_40usd_breached,
      'expiresAt',quote.expires_at,
      'expired',quote.expires_at<=statement_timestamp(),
      'confirmed',exists(select 1 from public.production_quote_confirmations confirmation
        where confirmation.production_quote_id=quote.id),
      'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'lineKey',line.line_key,
        'lineKind',line.line_kind,
        'lowQuantity',line.low_quantity,
        'expectedQuantity',line.expected_quantity,
        'highQuantity',line.high_quantity,
        'lowAmountMicrousd',line.low_amount_microusd,
        'expectedAmountMicrousd',line.expected_amount_microusd,
        'highAmountMicrousd',line.high_amount_microusd
      ) order by line.line_number)
      from public.production_quote_lines line
      where line.production_quote_id=quote.id),'[]'::jsonb)
    )
      from public.production_quotes quote
      where quote.configuration_candidate_id=configuration.id
      order by quote.quote_number desc limit 1),
    'productionRun',(select jsonb_build_object('id',run.id,'runNumber',run.run_number,
      'manifestHash',run.pinned_manifest_hash,'state',status.state,
      'authorizedHighMicrousd',run.authorized_high_microusd,
      'hardCeilingMicrousd',run.hard_ceiling_microusd)
      from public.production_runs run
      join public.production_run_statuses status on status.production_run_id=run.id
      where run.configuration_candidate_id=configuration.id
      order by run.run_number desc limit 1)
  ) as preflight
from public.episode_configuration_candidates configuration
where configuration.state in ('world_design','preflight','ready_to_lock','locked');

revoke all on table public.creation_readiness_projections from public,anon,authenticated;
grant select on table public.creation_readiness_projections to authenticated;

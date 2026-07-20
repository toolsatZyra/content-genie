-- Terminal plan/quote outcomes are durable product states, not transport
-- failures. Surface one safe work item and expose the latest sealed failure in
-- the creation projection so the UI never appears to wait forever.

create or replace function private.surface_terminal_preflight_failure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  run public.preflight_runs%rowtype;
  stage public.preflight_stage_runs%rowtype;
  summary text;
begin
  if new.state <> 'failed_terminal' or old.state = 'failed_terminal' then
    return new;
  end if;
  select * into run from public.preflight_runs where id = new.preflight_run_id;
  select * into stage from public.preflight_stage_runs where id = new.preflight_stage_run_id;
  if run.id is null or stage.id is null then
    raise exception 'terminal preflight scope is missing' using errcode = '40001';
  end if;
  summary := case new.safe_error_class
    when 'plan-quality-blocked' then
      'Monica tried two materially different cinematic-plan repairs; independent evaluators still blocked production. No production spend was authorized.'
    when 'plan-repair-no-change' then
      'Monica could not produce a materially different cinematic repair. No production spend was authorized.'
    when 'production-quote-ceiling-exceeded' then
      'The complete quality-first production envelope exceeds the $50 launch ceiling. No production spend was authorized.'
    else
      'Monica sealed this Preflight attempt because an exact production prerequisite failed. No production spend was authorized.'
  end;
  insert into public.work_items(
    workspace_id,episode_id,series_id,kind,state,required_role,dedupe_key,
    priority,safe_summary,deep_link
  )
  select run.workspace_id,run.episode_id,episode.series_id,'preflight.blocked',
    'open','member','preflight-blocked:' || new.id::text,95,summary,
    '/episodes/' || run.episode_id::text || '/create'
  from public.episodes episode
  where episode.id = run.episode_id
  on conflict do nothing;
  return new;
end;
$$;

revoke all on function private.surface_terminal_preflight_failure()
from public,anon,authenticated;

drop trigger if exists surface_terminal_preflight_failure
on public.preflight_stage_attempts;
create trigger surface_terminal_preflight_failure
after update of state on public.preflight_stage_attempts
for each row
when (new.state = 'failed_terminal' and old.state is distinct from new.state)
execute function private.surface_terminal_preflight_failure();

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
    'failure',(select jsonb_build_object(
      'attemptNo',attempt.attempt_no,
      'code',attempt.safe_error_class,
      'failedAt',attempt.completed_at,
      'stageKey',stage.stage_key
    )
      from public.preflight_stage_attempts attempt
      join public.preflight_stage_runs stage on stage.id=attempt.preflight_stage_run_id
      join public.preflight_runs run on run.id=attempt.preflight_run_id
      where run.configuration_candidate_id=configuration.id
        and attempt.state='failed_terminal'
      order by attempt.completed_at desc limit 1),
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
      'id',quote.id,'quoteHash',quote.quote_hash,
      'lowTotalMicrousd',quote.low_total_microusd,
      'expectedTotalMicrousd',quote.expected_total_microusd,
      'highTotalMicrousd',quote.high_total_microusd,
      'hardCeilingMicrousd',quote.hard_ceiling_microusd,
      'target40UsdBreached',quote.target_40usd_breached,
      'expiresAt',quote.expires_at,'expired',quote.expires_at<=statement_timestamp(),
      'confirmed',exists(select 1 from public.production_quote_confirmations confirmation
        where confirmation.production_quote_id=quote.id),
      'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'lineKey',line.line_key,'lineKind',line.line_kind,
        'lowQuantity',line.low_quantity,'expectedQuantity',line.expected_quantity,
        'highQuantity',line.high_quantity,'lowAmountMicrousd',line.low_amount_microusd,
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

revoke all on table public.creation_readiness_projections
from public,anon,authenticated;
grant select on table public.creation_readiness_projections to authenticated;

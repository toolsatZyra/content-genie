-- Keep cultural and final release authority distinct, and represent mandatory
-- audit-only split-screen cleanup without inventing owner-feedback lineage.

create or replace function public.command_review_mvp_master(
  p_workspace_id uuid,
  p_master_id uuid,
  p_expected_version bigint,
  p_decision text,
  p_cultural_review_confirmed boolean,
  p_final_review_confirmed boolean,
  p_feedback text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  master_row public.mvp_episode_masters%rowtype;
  job_row public.mvp_production_jobs%rowtype;
  cultural_row public.mvp_master_cultural_decisions%rowtype;
  review_id_value uuid;
  final_decision_id_value uuid;
  release_authority_id_value uuid;
  repair_request_id_value uuid;
  export_id uuid;
  feedback_value text;
begin
  perform private.assert_aal2();
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_decision not in ('approve','reject') then
    raise exception 'review decision invalid' using errcode = '22023';
  end if;
  feedback_value := nullif(btrim(p_feedback), '');
  if p_feedback is not null and char_length(p_feedback) > 4000 then
    raise exception 'review feedback is invalid' using errcode = '22023';
  end if;
  if p_decision = 'reject' and feedback_value is null then
    raise exception 'repair feedback is required' using errcode = '23514';
  end if;
  if p_decision = 'approve'
    and p_cultural_review_confirmed is distinct from true
  then
    raise exception 'explicit cultural review confirmation is required'
      using errcode = '23514';
  end if;

  select * into master_row from public.mvp_episode_masters
  where workspace_id = p_workspace_id and id = p_master_id
  for update;
  if not found or master_row.state <> 'pending_review'
    or master_row.version <> p_expected_version
  then
    raise exception 'master review is stale' using errcode = '40001';
  end if;
  if p_decision = 'reject' and master_row.attempt_number >= 20 then
    raise exception 'repair attempt limit reached' using errcode = '23514';
  end if;

  select * into job_row from public.mvp_production_jobs
  where workspace_id = p_workspace_id
    and production_run_id = master_row.production_run_id
  for update;
  if not found or job_row.episode_id <> master_row.episode_id
    or job_row.state <> 'review_ready'
    or job_row.attempt_number <> master_row.attempt_number
    or (master_row.attempt_number > 1 and (
      job_row.active_repair_request_id is null
      or not exists(
        select 1 from public.mvp_repair_requests request
        where request.id = job_row.active_repair_request_id
          and request.workspace_id = p_workspace_id
          and request.production_run_id = master_row.production_run_id
          and request.target_attempt_number = master_row.attempt_number
          and request.state = 'complete'
      )
    ))
  then
    raise exception 'master review lineage is stale' using errcode = '40001';
  end if;

  if p_decision = 'approve' then
    select * into cultural_row
    from public.mvp_master_cultural_decisions
    where workspace_id = p_workspace_id
      and episode_id = master_row.episode_id
      and master_id = master_row.id
      and master_version = master_row.version
      and production_run_id = master_row.production_run_id
      and decision = 'approve'
      and exists (
        select 1
        from public.source_review_statuses status
        where status.workspace_id = p_workspace_id
          and status.source_review_packet_id =
            mvp_master_cultural_decisions.source_review_packet_id
          and status.status = 'approved'
          and status.selected_decision_id =
            mvp_master_cultural_decisions.source_review_decision_id
      );
    if cultural_row.id is null then
      raise exception 'a separate current qualified cultural decision is required'
        using errcode = '23514';
    end if;
    if p_final_review_confirmed is distinct from true then
      raise exception 'final human review confirmation is required'
        using errcode = '23514';
    end if;
  end if;

  insert into public.mvp_master_reviews(
    workspace_id, episode_id, master_id, master_version, decision,
    cultural_review_confirmed, final_review_confirmed, feedback,
    actor_user_id, actor_aal
  ) values(
    p_workspace_id, master_row.episode_id, master_row.id, master_row.version,
    p_decision, cultural_row.id is not null,
    p_decision = 'approve' and p_final_review_confirmed,
    feedback_value, actor_id, 'aal2'
  ) returning id into review_id_value;

  if p_decision = 'reject' then
    repair_request_id_value := gen_random_uuid();
    insert into public.mvp_repair_requests(
      id, workspace_id, episode_id, production_run_id, plan_bundle_id,
      review_id, source_master_id, source_master_version,
      source_attempt_number, opened_job_version, feedback_sha256,
      state, created_by
    ) values(
      repair_request_id_value, p_workspace_id, master_row.episode_id,
      master_row.production_run_id, job_row.plan_bundle_id, review_id_value,
      master_row.id, master_row.version, master_row.attempt_number,
      job_row.version + 1,
      encode(extensions.digest(convert_to(feedback_value, 'UTF8'), 'sha256'), 'hex'),
      'awaiting_retry', actor_id
    );
  else
    insert into public.mvp_master_final_decisions(
      workspace_id, episode_id, master_id, master_version, production_run_id,
      master_review_id, decision, actor_user_id, actor_aal
    ) values(
      p_workspace_id, master_row.episode_id, master_row.id, master_row.version,
      master_row.production_run_id, review_id_value, 'approve', actor_id, 'aal2'
    ) returning id into final_decision_id_value;

    insert into public.mvp_master_release_authorities(
      workspace_id, episode_id, master_id, master_version, production_run_id,
      cultural_decision_id, final_decision_id
    ) values(
      p_workspace_id, master_row.episode_id, master_row.id, master_row.version,
      master_row.production_run_id, cultural_row.id, final_decision_id_value
    ) returning id into release_authority_id_value;
  end if;

  update public.mvp_episode_masters
  set state = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      version = version + 1
  where id = master_row.id;

  if p_decision = 'approve' then
    insert into public.mvp_exports(
      workspace_id, episode_id, master_id, object_name, content_sha256,
      state, created_by, release_authority_id, authority_master_version,
      authority_enforced
    ) values(
      p_workspace_id, master_row.episode_id, master_row.id,
      master_row.object_name, master_row.content_sha256, 'ready', actor_id,
      release_authority_id_value, master_row.version, true
    ) returning id into export_id;
    update public.mvp_production_jobs
    set state = 'export_ready', version = version + 1,
        active_repair_request_id = null,
        completed_at = statement_timestamp()
    where production_run_id = master_row.production_run_id;
    update public.production_run_statuses
    set state = 'succeeded', version = version + 1,
        changed_at = statement_timestamp(), reason = null
    where production_run_id = master_row.production_run_id;
  else
    update public.mvp_production_jobs
    set state = 'needs_repair', version = version + 1,
        active_repair_request_id = repair_request_id_value
    where production_run_id = master_row.production_run_id;
  end if;

  return jsonb_build_object(
    'culturalDecisionId', cultural_row.id,
    'decision', p_decision,
    'exportId', export_id,
    'finalDecisionId', final_decision_id_value,
    'masterId', master_row.id,
    'releaseAuthorityId', release_authority_id_value,
    'reviewId', review_id_value,
    'repairRequestId', repair_request_id_value
  );
end;
$$;

revoke all on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) from public, anon;
grant execute on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) to authenticated;

alter table public.mvp_repair_action_grounding_evidence
  drop constraint mvp_repair_action_grounding_evidence_selected_action_check,
  drop constraint mvp_repair_action_grounding_eviden_feedback_point_indexes_check;
alter table public.mvp_repair_action_grounding_evidence
  add constraint mvp_repair_action_grounding_evidence_selected_action_check check (
    selected_action in (
      'storyboard_and_clip','clip_only','re_edit','legacy_storyboard_migration'
    )
  ),
  add constraint mvp_repair_action_grounding_evidence_feedback_point_indexes_check check (
    array_position(feedback_point_indexes, null) is null
    and (
      (selected_action = 'legacy_storyboard_migration'
        and cardinality(feedback_point_indexes) = 0)
      or (selected_action <> 'legacy_storyboard_migration'
        and cardinality(feedback_point_indexes) between 1 and 8)
    )
  );

alter table public.mvp_repair_action_asset_lineage
  drop constraint mvp_repair_action_asset_lineage_selected_action_check,
  drop constraint mvp_repair_action_asset_lineage_feedback_point_indexes_check;
alter table public.mvp_repair_action_asset_lineage
  add constraint mvp_repair_action_asset_lineage_selected_action_check check (
    selected_action in (
      'storyboard_and_clip','clip_only','re_edit','legacy_storyboard_migration'
    )
  ),
  add constraint mvp_repair_action_asset_lineage_feedback_point_indexes_check check (
    array_position(feedback_point_indexes, null) is null
    and (
      (selected_action = 'legacy_storyboard_migration'
        and cardinality(feedback_point_indexes) = 0)
      or (selected_action <> 'legacy_storyboard_migration'
        and cardinality(feedback_point_indexes) between 1 and 8)
    )
  );

-- The evidence recorder is intentionally patched from the immediately preceding
-- frozen definition. Assertions make this migration fail closed if that trusted
-- definition has drifted instead of silently weakening a later implementation.
do $migration$
declare
  definition text;
  prior_fragment text;
  corrected_fragment text;
begin
  definition := pg_get_functiondef(
    'private.record_mvp_repair_grounding_evidence(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text)'::regprocedure
  );

  prior_fragment := $prior$
      or action_value->>'selectedAction' not in (
        'storyboard_and_clip','clip_only','re_edit'
      )
$prior$;
  corrected_fragment := $corrected$
      or action_value->>'selectedAction' not in (
        'storyboard_and_clip','clip_only','re_edit','legacy_storyboard_migration'
      )
$corrected$;
  if position(prior_fragment in definition) = 0 then
    raise exception 'trusted repair grounding action contract drifted'
      using errcode = '23514';
  end if;
  definition := replace(definition, prior_fragment, corrected_fragment);

  prior_fragment := $prior$
    if cardinality(feedback_indexes) < 1
      or action_value->'feedbackPointIndexes' <> to_jsonb(feedback_indexes)
    then
      raise exception 'repair action feedback indexes are invalid'
        using errcode = '22023';
    end if;
$prior$;
  corrected_fragment := $corrected$
    if action_value->'feedbackPointIndexes' <> to_jsonb(feedback_indexes)
      or (selected_action_value = 'legacy_storyboard_migration' and (
        cardinality(feedback_indexes) <> 0
        or not exists (
          select 1
          from jsonb_array_elements(source_payload->'shots') source_shot(value)
          where (source_shot.value->>'shotNumber')::integer = action_shot
            and source_shot.value->>'storyboardCompositionMode' =
              'split_screen_two_state'
        )
        or not exists (
          select 1
          from jsonb_array_elements(plan_row.repaired_edd_payload->'shots') repaired_shot(value)
          where (repaired_shot.value->>'shotNumber')::integer = action_shot
            and repaired_shot.value->>'storyboardCompositionMode' in (
              'single_frame','two_state_start_end'
            )
        )
      ))
      or (selected_action_value <> 'legacy_storyboard_migration'
        and cardinality(feedback_indexes) < 1)
    then
      raise exception 'repair action feedback indexes are invalid'
        using errcode = '22023';
    end if;
$corrected$;
  if position(prior_fragment in definition) = 0 then
    raise exception 'trusted repair grounding feedback-index contract drifted'
      using errcode = '23514';
  end if;
  definition := replace(definition, prior_fragment, corrected_fragment);

  prior_fragment := $prior$
    if expected_action is null or expected_action <> selected_action_value
      or exists (
        select 1 from unnest(feedback_indexes) feedback_index
        where not exists (
          select 1 from public.mvp_repair_feedback_point_evidence point
          where point.grounding_version_id = p_evidence_version_id
            and point.feedback_point_index = feedback_index
            and point.resolution in ('deterministic','model')
            and (
              action_shot = any(point.resolved_shot_numbers)
              or exists (
                select 1 from private.mvp_repair_shot_decisions dependency
                where dependency.plan_version_id = p_repair_plan_version_id
                  and dependency.shot_number = action_shot
                  and dependency.dependency_reason is not null
              )
            )
        )
      )
    then
$prior$;
  corrected_fragment := $corrected$
    if expected_action is null
      or (selected_action_value = 'legacy_storyboard_migration'
        and expected_action <> 'storyboard_and_clip')
      or (selected_action_value <> 'legacy_storyboard_migration'
        and expected_action <> selected_action_value)
      or (selected_action_value <> 'legacy_storyboard_migration' and exists (
        select 1 from unnest(feedback_indexes) feedback_index
        where not exists (
          select 1 from public.mvp_repair_feedback_point_evidence point
          where point.grounding_version_id = p_evidence_version_id
            and point.feedback_point_index = feedback_index
            and point.resolution in ('deterministic','model')
            and (
              action_shot = any(point.resolved_shot_numbers)
              or exists (
                select 1 from private.mvp_repair_shot_decisions dependency
                where dependency.plan_version_id = p_repair_plan_version_id
                  and dependency.shot_number = action_shot
                  and dependency.dependency_reason is not null
              )
            )
        )
      ))
    then
$corrected$;
  if position(prior_fragment in definition) = 0 then
    raise exception 'trusted repair grounding lineage contract drifted'
      using errcode = '23514';
  end if;
  definition := replace(definition, prior_fragment, corrected_fragment);

  execute definition;
end;
$migration$;

comment on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) is
  'Records an explicit owner review; approval requires both an existing qualified cultural decision and distinct cultural and final confirmations.';

comment on function private.record_mvp_repair_grounding_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text
) is
  'Persists feedback-grounded repairs and separately labeled mandatory cleanup of audit-only legacy split-screen storyboards.';

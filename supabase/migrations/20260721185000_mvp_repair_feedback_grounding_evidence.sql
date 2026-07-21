-- Persist Monica's bounded repair interpretation without exposing owner feedback.
-- The existing repair-plan and clarification commands remain the state machines;
-- the grounded wrappers below make their transition and this evidence atomic.

create table public.mvp_repair_feedback_grounding_versions (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  production_run_id uuid not null,
  repair_request_id uuid not null,
  repair_plan_version_id uuid references private.mvp_repair_plan_versions(id)
    on delete restrict,
  clarification_message_id uuid references public.mvp_repair_clarification_messages(id)
    on delete restrict,
  outcome text not null check (outcome in ('repair','clarification')),
  source_edd_content_sha256 text not null check (
    source_edd_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  feedback_sha256 text not null check (feedback_sha256 ~ '^[a-f0-9]{64}$'),
  input_manifest_sha256 text not null check (
    input_manifest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  prompt_sha256 text not null check (prompt_sha256 ~ '^[a-f0-9]{64}$'),
  model_version text not null check (char_length(model_version) between 3 and 160),
  model_result_sha256 text not null check (
    model_result_sha256 ~ '^[a-f0-9]{64}$'
  ),
  clarification_transcript_sha256 text not null check (
    clarification_transcript_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_summary_sha256 text not null check (
    source_summary_sha256 ~ '^[a-f0-9]{64}$'
  ),
  feedback_points_sha256 text not null check (
    feedback_points_sha256 ~ '^[a-f0-9]{64}$'
  ),
  action_grounding_sha256 text not null check (
    action_grounding_sha256 ~ '^[a-f0-9]{64}$'
  ),
  evidence_bundle_sha256 text not null unique check (
    evidence_bundle_sha256 ~ '^[a-f0-9]{64}$'
  ),
  feedback_point_count integer not null check (feedback_point_count between 1 and 8),
  action_count integer not null check (action_count between 0 and 80),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (repair_request_id, id),
  foreign key (repair_request_id, workspace_id, production_run_id)
    references public.mvp_repair_requests(id, workspace_id, production_run_id)
    on delete restrict,
  check (
    (outcome = 'repair' and repair_plan_version_id is not null
      and clarification_message_id is null and action_count > 0)
    or
    (outcome = 'clarification' and repair_plan_version_id is null
      and clarification_message_id is not null and action_count = 0)
  )
);

create unique index mvp_repair_feedback_grounding_plan_uq
on public.mvp_repair_feedback_grounding_versions(repair_plan_version_id)
where repair_plan_version_id is not null;

create unique index mvp_repair_feedback_grounding_clarification_uq
on public.mvp_repair_feedback_grounding_versions(clarification_message_id)
where clarification_message_id is not null;

create table public.mvp_repair_feedback_point_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  repair_request_id uuid not null,
  grounding_version_id uuid not null,
  repair_plan_version_id uuid,
  source_edd_content_sha256 text not null check (
    source_edd_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  feedback_point_index integer not null check (feedback_point_index between 1 and 8),
  feedback_point_sha256 text not null check (
    feedback_point_sha256 ~ '^[a-f0-9]{64}$'
  ),
  resolution text not null check (
    resolution in ('deterministic','model','clarification')
  ),
  resolved_shot_numbers integer[] not null check (
    cardinality(resolved_shot_numbers) between 0 and 80
    and array_position(resolved_shot_numbers, null) is null
  ),
  evidence_windows jsonb not null check (
    jsonb_typeof(evidence_windows) = 'array'
    and jsonb_array_length(evidence_windows) between 0 and 80
    and pg_column_size(evidence_windows) <= 32768
  ),
  point_evidence_sha256 text not null check (
    point_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (grounding_version_id, feedback_point_index),
  unique (grounding_version_id, point_evidence_sha256),
  foreign key (grounding_version_id, repair_request_id)
    references public.mvp_repair_feedback_grounding_versions(id, repair_request_id)
    on delete restrict,
  foreign key (repair_plan_version_id)
    references private.mvp_repair_plan_versions(id) on delete restrict,
  check (
    (resolution in ('deterministic','model')
      and cardinality(resolved_shot_numbers) > 0
      and jsonb_array_length(evidence_windows) > 0)
    or
    (resolution = 'clarification'
      and cardinality(resolved_shot_numbers) = 0
      and jsonb_array_length(evidence_windows) = 0)
  )
);

create table public.mvp_repair_action_grounding_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  repair_request_id uuid not null,
  grounding_version_id uuid not null,
  repair_plan_version_id uuid not null,
  source_edd_content_sha256 text not null check (
    source_edd_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  shot_number integer not null check (shot_number between 1 and 80),
  selected_action text not null check (
    selected_action in ('storyboard_and_clip','clip_only','re_edit')
  ),
  feedback_point_indexes integer[] not null check (
    cardinality(feedback_point_indexes) between 1 and 8
    and array_position(feedback_point_indexes, null) is null
  ),
  action_evidence_sha256 text not null check (
    action_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (grounding_version_id, shot_number),
  unique (grounding_version_id, action_evidence_sha256),
  foreign key (grounding_version_id, repair_request_id)
    references public.mvp_repair_feedback_grounding_versions(id, repair_request_id)
    on delete restrict,
  foreign key (repair_plan_version_id, shot_number)
    references private.mvp_repair_shot_decisions(plan_version_id, shot_number)
    on delete restrict
);

create table public.mvp_repair_action_asset_lineage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  repair_request_id uuid not null,
  grounding_version_id uuid not null,
  action_grounding_id uuid not null unique
    references public.mvp_repair_action_grounding_evidence(id) on delete restrict,
  repair_plan_version_id uuid not null,
  shot_number integer not null check (shot_number between 1 and 80),
  selected_action text not null check (
    selected_action in ('storyboard_and_clip','clip_only','re_edit')
  ),
  feedback_point_indexes integer[] not null check (
    cardinality(feedback_point_indexes) between 1 and 8
  ),
  source_storyboard_frame_id uuid
    references private.mvp_storyboard_frames(id) on delete restrict,
  source_storyboard_content_sha256 text check (
    source_storyboard_content_sha256 is null
    or source_storyboard_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_storyboard_end_frame_id uuid
    references private.mvp_storyboard_frames(id) on delete restrict,
  source_storyboard_end_content_sha256 text check (
    source_storyboard_end_content_sha256 is null
    or source_storyboard_end_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_clip_id uuid not null
    references private.mvp_production_clips(id) on delete restrict,
  source_clip_content_sha256 text not null check (
    source_clip_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  selected_storyboard_frame_id uuid
    references private.mvp_storyboard_frames(id) on delete restrict,
  selected_storyboard_content_sha256 text check (
    selected_storyboard_content_sha256 is null
    or selected_storyboard_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  selected_storyboard_end_frame_id uuid
    references private.mvp_storyboard_frames(id) on delete restrict,
  selected_storyboard_end_content_sha256 text check (
    selected_storyboard_end_content_sha256 is null
    or selected_storyboard_end_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  selected_clip_id uuid not null
    references private.mvp_production_clips(id) on delete restrict,
  selected_clip_content_sha256 text not null check (
    selected_clip_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  source_asset_bundle_sha256 text not null check (
    source_asset_bundle_sha256 ~ '^[a-f0-9]{64}$'
  ),
  selected_asset_bundle_sha256 text not null check (
    selected_asset_bundle_sha256 ~ '^[a-f0-9]{64}$'
  ),
  selection_sha256 text not null check (selection_sha256 ~ '^[a-f0-9]{64}$'),
  lineage_sha256 text not null unique check (lineage_sha256 ~ '^[a-f0-9]{64}$'),
  validation_state text not null check (
    validation_state = 'selected_complete_assets'
  ),
  created_at timestamptz not null default statement_timestamp(),
  unique (grounding_version_id, shot_number),
  foreign key (grounding_version_id, repair_request_id)
    references public.mvp_repair_feedback_grounding_versions(id, repair_request_id)
    on delete restrict,
  foreign key (repair_plan_version_id, shot_number)
    references private.mvp_repair_shot_decisions(plan_version_id, shot_number)
    on delete restrict,
  check (
    (source_storyboard_frame_id is null
      and source_storyboard_content_sha256 is null)
    or (source_storyboard_frame_id is not null
      and source_storyboard_content_sha256 is not null)
  ),
  check (
    (source_storyboard_end_frame_id is null
      and source_storyboard_end_content_sha256 is null)
    or (source_storyboard_end_frame_id is not null
      and source_storyboard_end_content_sha256 is not null)
  ),
  check (
    (selected_storyboard_frame_id is null
      and selected_storyboard_content_sha256 is null)
    or (selected_storyboard_frame_id is not null
      and selected_storyboard_content_sha256 is not null)
  ),
  check (
    (selected_storyboard_end_frame_id is null
      and selected_storyboard_end_content_sha256 is null)
    or (selected_storyboard_end_frame_id is not null
      and selected_storyboard_end_content_sha256 is not null)
  )
);

create or replace function private.guard_mvp_repair_grounding_child_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare parent_row public.mvp_repair_feedback_grounding_versions%rowtype;
begin
  select * into parent_row
  from public.mvp_repair_feedback_grounding_versions
  where id = new.grounding_version_id;
  if not found
    or new.workspace_id <> parent_row.workspace_id
    or new.repair_request_id <> parent_row.repair_request_id
    or new.repair_plan_version_id is distinct from parent_row.repair_plan_version_id
    or new.source_edd_content_sha256 <> parent_row.source_edd_content_sha256
  then
    raise exception 'repair grounding child lineage is invalid'
      using errcode = '23514';
  end if;
  if tg_table_name = 'mvp_repair_action_grounding_evidence'
    and parent_row.outcome <> 'repair'
  then
    raise exception 'clarification grounding cannot contain an action'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mvp_repair_feedback_point_lineage_guard
before insert on public.mvp_repair_feedback_point_evidence
for each row execute function private.guard_mvp_repair_grounding_child_insert();

create trigger mvp_repair_action_grounding_lineage_guard
before insert on public.mvp_repair_action_grounding_evidence
for each row execute function private.guard_mvp_repair_grounding_child_insert();

create trigger mvp_repair_feedback_grounding_versions_immutable
before update or delete on public.mvp_repair_feedback_grounding_versions
for each row execute function private.reject_mutation();

create trigger mvp_repair_feedback_point_evidence_immutable
before update or delete on public.mvp_repair_feedback_point_evidence
for each row execute function private.reject_mutation();

create trigger mvp_repair_action_grounding_evidence_immutable
before update or delete on public.mvp_repair_action_grounding_evidence
for each row execute function private.reject_mutation();

create trigger mvp_repair_action_asset_lineage_immutable
before update or delete on public.mvp_repair_action_asset_lineage
for each row execute function private.reject_mutation();

alter table public.mvp_repair_feedback_grounding_versions enable row level security;
alter table public.mvp_repair_feedback_grounding_versions force row level security;
alter table public.mvp_repair_feedback_point_evidence enable row level security;
alter table public.mvp_repair_feedback_point_evidence force row level security;
alter table public.mvp_repair_action_grounding_evidence enable row level security;
alter table public.mvp_repair_action_grounding_evidence force row level security;
alter table public.mvp_repair_action_asset_lineage enable row level security;
alter table public.mvp_repair_action_asset_lineage force row level security;

create policy mvp_repair_feedback_grounding_member_select
on public.mvp_repair_feedback_grounding_versions for select to authenticated
using (private.is_active_member(workspace_id, auth.uid()));

create policy mvp_repair_feedback_point_member_select
on public.mvp_repair_feedback_point_evidence for select to authenticated
using (private.is_active_member(workspace_id, auth.uid()));

create policy mvp_repair_action_grounding_member_select
on public.mvp_repair_action_grounding_evidence for select to authenticated
using (private.is_active_member(workspace_id, auth.uid()));

create policy mvp_repair_action_asset_lineage_member_select
on public.mvp_repair_action_asset_lineage for select to authenticated
using (private.is_active_member(workspace_id, auth.uid()));

revoke all on public.mvp_repair_feedback_grounding_versions,
  public.mvp_repair_feedback_point_evidence,
  public.mvp_repair_action_grounding_evidence,
  public.mvp_repair_action_asset_lineage
from public, anon, authenticated;
grant select on public.mvp_repair_feedback_grounding_versions,
  public.mvp_repair_feedback_point_evidence,
  public.mvp_repair_action_grounding_evidence,
  public.mvp_repair_action_asset_lineage
to authenticated, service_role;

create or replace function private.record_mvp_repair_grounding_evidence(
  p_evidence_version_id uuid,
  p_repair_request_id uuid,
  p_repair_plan_version_id uuid,
  p_clarification_message_id uuid,
  p_outcome text,
  p_source_edd_content_sha256 text,
  p_input_manifest_sha256 text,
  p_prompt_sha256 text,
  p_model_version text,
  p_model_result_sha256 text,
  p_clarification_transcript_sha256 text,
  p_source_summary_sha256 text,
  p_feedback_points jsonb,
  p_feedback_points_sha256 text,
  p_action_grounding jsonb,
  p_action_grounding_sha256 text,
  p_evidence_bundle_sha256 text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.mvp_repair_requests%rowtype;
  plan_row private.mvp_repair_plan_versions%rowtype;
  existing_row public.mvp_repair_feedback_grounding_versions%rowtype;
  source_payload jsonb;
  source_hash text;
  point_value jsonb;
  action_value jsonb;
  expected_windows jsonb;
  resolved_shots integer[];
  feedback_indexes integer[];
  point_index integer;
  action_shot integer;
  selected_action_value text;
  expected_action text;
  expected_bundle_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_evidence_version_id is null or p_repair_request_id is null
    or p_outcome not in ('repair','clarification')
    or p_source_edd_content_sha256 !~ '^[a-f0-9]{64}$'
    or p_input_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_prompt_sha256 !~ '^[a-f0-9]{64}$'
    or p_model_result_sha256 !~ '^[a-f0-9]{64}$'
    or p_clarification_transcript_sha256 !~ '^[a-f0-9]{64}$'
    or p_source_summary_sha256 !~ '^[a-f0-9]{64}$'
    or p_feedback_points_sha256 !~ '^[a-f0-9]{64}$'
    or p_action_grounding_sha256 !~ '^[a-f0-9]{64}$'
    or p_evidence_bundle_sha256 !~ '^[a-f0-9]{64}$'
    or char_length(p_model_version) not between 3 and 160
    or jsonb_typeof(p_feedback_points) <> 'array'
    or jsonb_array_length(p_feedback_points) not between 1 and 8
    or jsonb_typeof(p_action_grounding) <> 'array'
    or jsonb_array_length(p_action_grounding) not between 0 and 80
  then
    raise exception 'repair grounding envelope is invalid' using errcode = '22023';
  end if;
  if encode(extensions.digest(convert_to(p_feedback_points::text, 'UTF8'), 'sha256'), 'hex')
      <> p_feedback_points_sha256
    or encode(extensions.digest(convert_to(p_action_grounding::text, 'UTF8'), 'sha256'), 'hex')
      <> p_action_grounding_sha256
  then
    raise exception 'repair grounding aggregate hash is invalid' using errcode = '23514';
  end if;

  select * into existing_row
  from public.mvp_repair_feedback_grounding_versions
  where id = p_evidence_version_id;
  if found then
    if existing_row.repair_request_id = p_repair_request_id
      and existing_row.repair_plan_version_id is not distinct from p_repair_plan_version_id
      and existing_row.clarification_message_id is not distinct from p_clarification_message_id
      and existing_row.outcome = p_outcome
      and existing_row.source_edd_content_sha256 = p_source_edd_content_sha256
      and existing_row.feedback_points_sha256 = p_feedback_points_sha256
      and existing_row.action_grounding_sha256 = p_action_grounding_sha256
      and existing_row.evidence_bundle_sha256 = p_evidence_bundle_sha256
    then
      return;
    end if;
    raise exception 'repair grounding replay conflicts with committed evidence'
      using errcode = '40001';
  end if;

  select * into request_row
  from public.mvp_repair_requests
  where id = p_repair_request_id
  for update;
  if not found then
    raise exception 'repair grounding request is unavailable' using errcode = '40001';
  end if;

  if request_row.source_attempt_number = 1 then
    select component.payload, component.content_hash
    into source_payload, source_hash
    from public.preflight_plan_bundles bundle
    join public.preflight_plan_component_versions component
      on component.workspace_id = bundle.workspace_id
      and component.id = bundle.edd_version_id
    where bundle.workspace_id = request_row.workspace_id
      and bundle.id = request_row.plan_bundle_id
      and component.component_kind = 'edd';
  else
    select prior_plan.repaired_edd_payload,
      prior_plan.repaired_edd_content_sha256
    into source_payload, source_hash
    from public.mvp_repair_requests prior_request
    join private.mvp_repair_plan_versions prior_plan
      on prior_plan.id = prior_request.active_plan_version_id
    where prior_request.production_run_id = request_row.production_run_id
      and prior_request.target_attempt_number = request_row.source_attempt_number
      and prior_request.state = 'complete';
  end if;
  if source_hash is null or source_hash <> p_source_edd_content_sha256
    or jsonb_typeof(source_payload->'shots') <> 'array'
  then
    raise exception 'repair grounding source EDD is stale' using errcode = '23514';
  end if;

  if p_outcome = 'repair' then
    select * into plan_row from private.mvp_repair_plan_versions
    where id = p_repair_plan_version_id;
    if p_clarification_message_id is not null
      or request_row.state not in ('planned','executing','complete')
      or request_row.active_plan_version_id <> p_repair_plan_version_id
      or plan_row.repair_request_id <> request_row.id
      or plan_row.source_edd_content_sha256 <> source_hash
      or plan_row.input_manifest_sha256 <> p_input_manifest_sha256
      or plan_row.prompt_sha256 <> p_prompt_sha256
      or plan_row.model_version <> p_model_version
      or plan_row.model_result_sha256 <> p_model_result_sha256
      or jsonb_array_length(p_action_grounding) <> plan_row.affected_shots
    then
      raise exception 'repair grounding plan lineage is invalid' using errcode = '23514';
    end if;
  else
    if p_repair_plan_version_id is not null
      or p_clarification_message_id is null
      or request_row.state <> 'awaiting_clarification'
      or jsonb_array_length(p_action_grounding) <> 0
      or not exists (
        select 1 from public.mvp_repair_clarification_messages message
        where message.id = p_clarification_message_id
          and message.repair_request_id = request_row.id
          and message.message_kind = 'question'
      )
    then
      raise exception 'repair clarification grounding is invalid' using errcode = '23514';
    end if;
  end if;

  expected_bundle_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'actionGroundingSha256', p_action_grounding_sha256,
    'clarificationMessageId', p_clarification_message_id,
    'clarificationTranscriptSha256', p_clarification_transcript_sha256,
    'feedbackPointsSha256', p_feedback_points_sha256,
    'feedbackSha256', request_row.feedback_sha256,
    'inputManifestSha256', p_input_manifest_sha256,
    'modelResultSha256', p_model_result_sha256,
    'modelVersion', p_model_version,
    'outcome', p_outcome,
    'promptSha256', p_prompt_sha256,
    'repairPlanVersionId', p_repair_plan_version_id,
    'repairRequestId', request_row.id,
    'sourceEddContentSha256', source_hash,
    'sourceSummarySha256', p_source_summary_sha256
  )::text, 'UTF8'), 'sha256'), 'hex');
  if expected_bundle_hash <> p_evidence_bundle_sha256 then
    raise exception 'repair grounding bundle hash is invalid' using errcode = '23514';
  end if;

  insert into public.mvp_repair_feedback_grounding_versions(
    id,workspace_id,episode_id,production_run_id,repair_request_id,
    repair_plan_version_id,clarification_message_id,outcome,
    source_edd_content_sha256,feedback_sha256,input_manifest_sha256,
    prompt_sha256,model_version,model_result_sha256,
    clarification_transcript_sha256,source_summary_sha256,
    feedback_points_sha256,action_grounding_sha256,evidence_bundle_sha256,
    feedback_point_count,action_count
  ) values(
    p_evidence_version_id,request_row.workspace_id,request_row.episode_id,
    request_row.production_run_id,request_row.id,p_repair_plan_version_id,
    p_clarification_message_id,p_outcome,source_hash,request_row.feedback_sha256,
    p_input_manifest_sha256,p_prompt_sha256,p_model_version,p_model_result_sha256,
    p_clarification_transcript_sha256,p_source_summary_sha256,
    p_feedback_points_sha256,p_action_grounding_sha256,p_evidence_bundle_sha256,
    jsonb_array_length(p_feedback_points),jsonb_array_length(p_action_grounding)
  );

  point_index := 0;
  for point_value in select value from jsonb_array_elements(p_feedback_points)
  loop
    point_index := point_index + 1;
    if jsonb_typeof(point_value) <> 'object'
      or not (point_value ?& array[
        'feedbackPointIndex','feedbackPointSha256','resolution',
        'resolvedShotNumbers','evidenceWindows','pointEvidenceSha256'
      ])
      or (point_value - array[
        'feedbackPointIndex','feedbackPointSha256','resolution',
        'resolvedShotNumbers','evidenceWindows','pointEvidenceSha256'
      ]::text[]) <> '{}'::jsonb
      or (point_value->>'feedbackPointIndex')::integer <> point_index
      or point_value->>'feedbackPointSha256' !~ '^[a-f0-9]{64}$'
      or point_value->>'pointEvidenceSha256' !~ '^[a-f0-9]{64}$'
      or point_value->>'resolution' not in ('deterministic','model','clarification')
      or jsonb_typeof(point_value->'resolvedShotNumbers') <> 'array'
      or jsonb_typeof(point_value->'evidenceWindows') <> 'array'
      or encode(extensions.digest(convert_to(
        (point_value - 'pointEvidenceSha256')::text, 'UTF8'
      ), 'sha256'), 'hex') <> point_value->>'pointEvidenceSha256'
    then
      raise exception 'repair feedback point evidence is not exact'
        using errcode = '22023';
    end if;

    select coalesce(array_agg(number_value order by number_value), '{}'::integer[])
    into resolved_shots
    from (
      select distinct value::integer as number_value
      from jsonb_array_elements_text(point_value->'resolvedShotNumbers') item(value)
      where value ~ '^[0-9]+$'
    ) normalized;
    if point_value->'resolvedShotNumbers' <> to_jsonb(resolved_shots)
      or exists (
        select 1 from unnest(resolved_shots) number_value
        where number_value not between 1 and 80
      )
    then
      raise exception 'repair feedback shot numbers are invalid'
        using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'endMs', (shot.value->>'endMs')::integer,
      'shotNumber', number_value,
      'startMs', (shot.value->>'startMs')::integer
    ) order by number_value), '[]'::jsonb)
    into expected_windows
    from unnest(resolved_shots) number_value
    join lateral (
      select candidate.value
      from jsonb_array_elements(source_payload->'shots') candidate(value)
      where (candidate.value->>'shotNumber')::integer = number_value
    ) shot on true;
    if point_value->'evidenceWindows' <> expected_windows
      or (point_value->>'resolution' in ('deterministic','model')
        and cardinality(resolved_shots) = 0)
      or (point_value->>'resolution' = 'clarification'
        and cardinality(resolved_shots) <> 0)
      or (p_outcome = 'repair' and point_value->>'resolution' = 'clarification')
      or (p_outcome = 'clarification' and point_value->>'resolution' = 'model')
    then
      raise exception 'repair feedback resolution is inconsistent'
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.mvp_repair_feedback_point_evidence prior_point
      join public.mvp_repair_feedback_grounding_versions prior_version
        on prior_version.id = prior_point.grounding_version_id
      where prior_version.repair_request_id = request_row.id
        and prior_point.feedback_point_index = point_index
        and prior_point.resolution = 'deterministic'
        and (
          point_value->>'resolution' <> 'deterministic'
          or prior_point.feedback_point_sha256
            <> point_value->>'feedbackPointSha256'
          or prior_point.resolved_shot_numbers <> resolved_shots
          or prior_point.evidence_windows <> expected_windows
        )
    ) then
      raise exception 'deterministic repair feedback grounding cannot be reinterpreted'
        using errcode = '23514';
    end if;

    insert into public.mvp_repair_feedback_point_evidence(
      workspace_id,repair_request_id,grounding_version_id,
      repair_plan_version_id,source_edd_content_sha256,
      feedback_point_index,feedback_point_sha256,resolution,
      resolved_shot_numbers,evidence_windows,point_evidence_sha256
    ) values(
      request_row.workspace_id,request_row.id,p_evidence_version_id,
      p_repair_plan_version_id,source_hash,point_index,
      point_value->>'feedbackPointSha256',point_value->>'resolution',
      resolved_shots,expected_windows,point_value->>'pointEvidenceSha256'
    );
  end loop;

  if p_outcome = 'clarification' and not exists (
    select 1 from public.mvp_repair_feedback_point_evidence point
    where point.grounding_version_id = p_evidence_version_id
      and point.resolution = 'clarification'
  ) then
    raise exception 'clarification grounding has no unresolved feedback point'
      using errcode = '23514';
  end if;

  for action_value in select value from jsonb_array_elements(p_action_grounding)
  loop
    if jsonb_typeof(action_value) <> 'object'
      or not (action_value ?& array[
        'shotNumber','selectedAction','feedbackPointIndexes','actionEvidenceSha256'
      ])
      or (action_value - array[
        'shotNumber','selectedAction','feedbackPointIndexes','actionEvidenceSha256'
      ]::text[]) <> '{}'::jsonb
      or action_value->>'selectedAction' not in (
        'storyboard_and_clip','clip_only','re_edit'
      )
      or jsonb_typeof(action_value->'feedbackPointIndexes') <> 'array'
      or action_value->>'actionEvidenceSha256' !~ '^[a-f0-9]{64}$'
      or encode(extensions.digest(convert_to(
        (action_value - 'actionEvidenceSha256')::text, 'UTF8'
      ), 'sha256'), 'hex') <> action_value->>'actionEvidenceSha256'
    then
      raise exception 'repair action grounding is not exact' using errcode = '22023';
    end if;
    action_shot := (action_value->>'shotNumber')::integer;
    selected_action_value := action_value->>'selectedAction';
    select coalesce(array_agg(index_value order by index_value), '{}'::integer[])
    into feedback_indexes
    from (
      select distinct value::integer as index_value
      from jsonb_array_elements_text(action_value->'feedbackPointIndexes') item(value)
      where value ~ '^[0-9]+$'
    ) normalized;
    if cardinality(feedback_indexes) < 1
      or action_value->'feedbackPointIndexes' <> to_jsonb(feedback_indexes)
    then
      raise exception 'repair action feedback indexes are invalid'
        using errcode = '22023';
    end if;
    select case decision.action
      when 'regenerate_storyboard_and_clip' then 'storyboard_and_clip'
      when 'regenerate_clip' then 'clip_only'
      when 'reedit_only' then 're_edit'
      else null
    end into expected_action
    from private.mvp_repair_shot_decisions decision
    where decision.plan_version_id = p_repair_plan_version_id
      and decision.shot_number = action_shot;
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
      raise exception 'repair action is not grounded to its feedback points'
        using errcode = '23514';
    end if;
    insert into public.mvp_repair_action_grounding_evidence(
      workspace_id,repair_request_id,grounding_version_id,
      repair_plan_version_id,source_edd_content_sha256,shot_number,
      selected_action,feedback_point_indexes,action_evidence_sha256
    ) values(
      request_row.workspace_id,request_row.id,p_evidence_version_id,
      p_repair_plan_version_id,source_hash,action_shot,selected_action_value,
      feedback_indexes,action_value->>'actionEvidenceSha256'
    );
  end loop;

  if p_outcome = 'repair' and exists (
    select 1 from private.mvp_repair_shot_decisions decision
    where decision.plan_version_id = p_repair_plan_version_id
      and decision.action <> 'reuse_all'
      and not exists (
        select 1 from public.mvp_repair_action_grounding_evidence evidence
        where evidence.grounding_version_id = p_evidence_version_id
          and evidence.shot_number = decision.shot_number
      )
  ) then
    raise exception 'repair action grounding coverage is incomplete'
      using errcode = '23514';
  end if;
end;
$$;

create or replace function private.record_mvp_repair_action_asset_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grounding_row public.mvp_repair_action_grounding_evidence%rowtype;
  decision_row private.mvp_repair_shot_decisions%rowtype;
  source_frame private.mvp_storyboard_frames%rowtype;
  source_end_frame private.mvp_storyboard_frames%rowtype;
  source_clip private.mvp_production_clips%rowtype;
  selected_frame private.mvp_storyboard_frames%rowtype;
  selected_end_frame private.mvp_storyboard_frames%rowtype;
  selected_clip private.mvp_production_clips%rowtype;
  source_bundle_hash text;
  selected_bundle_hash text;
  lineage_hash text;
begin
  select action.* into grounding_row
  from public.mvp_repair_action_grounding_evidence action
  where action.repair_plan_version_id = new.plan_version_id
    and action.shot_number = new.shot_number;
  if not found then
    return new;
  end if;
  select * into decision_row
  from private.mvp_repair_shot_decisions decision
  where decision.plan_version_id = new.plan_version_id
    and decision.shot_number = new.shot_number;
  select * into source_clip from private.mvp_production_clips
  where id = decision_row.source_clip_id and state = 'complete';
  select * into selected_clip from private.mvp_production_clips
  where id = new.selected_clip_id and state = 'complete';
  if decision_row.source_storyboard_frame_id is not null then
    select * into source_frame from private.mvp_storyboard_frames
    where id = decision_row.source_storyboard_frame_id and state = 'complete';
  end if;
  if decision_row.source_storyboard_end_frame_id is not null then
    select * into source_end_frame from private.mvp_storyboard_frames
    where id = decision_row.source_storyboard_end_frame_id and state = 'complete';
  end if;
  if new.selected_storyboard_frame_id is not null then
    select * into selected_frame from private.mvp_storyboard_frames
    where id = new.selected_storyboard_frame_id and state = 'complete';
  end if;
  if new.selected_storyboard_end_frame_id is not null then
    select * into selected_end_frame from private.mvp_storyboard_frames
    where id = new.selected_storyboard_end_frame_id and state = 'complete';
  end if;
  if source_clip.id is null or source_clip.content_sha256 is null
    or selected_clip.id is null or selected_clip.content_sha256 is null
    or (decision_row.source_storyboard_frame_id is not null
      and (source_frame.id is null or source_frame.content_sha256 is null))
    or (decision_row.source_storyboard_end_frame_id is not null
      and (source_end_frame.id is null or source_end_frame.content_sha256 is null))
    or (new.selected_storyboard_frame_id is not null
      and (selected_frame.id is null or selected_frame.content_sha256 is null))
    or (new.selected_storyboard_end_frame_id is not null
      and (selected_end_frame.id is null or selected_end_frame.content_sha256 is null))
  then
    raise exception 'repair asset lineage requires complete immutable assets'
      using errcode = '23514';
  end if;
  source_bundle_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'storyboardFrameId', decision_row.source_storyboard_frame_id,
    'storyboardContentSha256', source_frame.content_sha256,
    'storyboardEndFrameId', decision_row.source_storyboard_end_frame_id,
    'storyboardEndContentSha256', source_end_frame.content_sha256,
    'clipId', source_clip.id,
    'clipContentSha256', source_clip.content_sha256
  )::text, 'UTF8'), 'sha256'), 'hex');
  selected_bundle_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'storyboardFrameId', new.selected_storyboard_frame_id,
    'storyboardContentSha256', selected_frame.content_sha256,
    'storyboardEndFrameId', new.selected_storyboard_end_frame_id,
    'storyboardEndContentSha256', selected_end_frame.content_sha256,
    'clipId', selected_clip.id,
    'clipContentSha256', selected_clip.content_sha256
  )::text, 'UTF8'), 'sha256'), 'hex');
  lineage_hash := encode(extensions.digest(convert_to(jsonb_build_object(
    'actionEvidenceSha256', grounding_row.action_evidence_sha256,
    'feedbackPointIndexes', to_jsonb(grounding_row.feedback_point_indexes),
    'repairRequestId', new.repair_request_id,
    'repairPlanVersionId', new.plan_version_id,
    'shotNumber', new.shot_number,
    'selectedAction', grounding_row.selected_action,
    'sourceAssetBundleSha256', source_bundle_hash,
    'selectedAssetBundleSha256', selected_bundle_hash,
    'selectionSha256', new.selection_sha256
  )::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.mvp_repair_action_asset_lineage(
    workspace_id,repair_request_id,grounding_version_id,action_grounding_id,
    repair_plan_version_id,shot_number,selected_action,feedback_point_indexes,
    source_storyboard_frame_id,source_storyboard_content_sha256,
    source_storyboard_end_frame_id,source_storyboard_end_content_sha256,
    source_clip_id,source_clip_content_sha256,
    selected_storyboard_frame_id,selected_storyboard_content_sha256,
    selected_storyboard_end_frame_id,selected_storyboard_end_content_sha256,
    selected_clip_id,selected_clip_content_sha256,
    source_asset_bundle_sha256,selected_asset_bundle_sha256,
    selection_sha256,lineage_sha256,validation_state
  ) values(
    new.workspace_id,new.repair_request_id,grounding_row.grounding_version_id,
    grounding_row.id,new.plan_version_id,new.shot_number,
    grounding_row.selected_action,grounding_row.feedback_point_indexes,
    decision_row.source_storyboard_frame_id,source_frame.content_sha256,
    decision_row.source_storyboard_end_frame_id,source_end_frame.content_sha256,
    source_clip.id,source_clip.content_sha256,
    new.selected_storyboard_frame_id,selected_frame.content_sha256,
    new.selected_storyboard_end_frame_id,selected_end_frame.content_sha256,
    selected_clip.id,selected_clip.content_sha256,
    source_bundle_hash,selected_bundle_hash,new.selection_sha256,lineage_hash,
    'selected_complete_assets'
  );
  return new;
end;
$$;

create trigger mvp_repair_action_asset_lineage_after_selection
after insert on private.mvp_attempt_shot_assets
for each row execute function private.record_mvp_repair_action_asset_lineage();

create or replace function public.command_publish_mvp_repair_plan_grounded(
  p_repair_request_id uuid,
  p_expected_request_version bigint,
  p_planner_lease_token uuid,
  p_plan_version_id uuid,
  p_evidence_version_id uuid,
  p_input_manifest_sha256 text,
  p_prompt_sha256 text,
  p_model_version text,
  p_model_result_sha256 text,
  p_repaired_edd_payload jsonb,
  p_shot_decisions jsonb,
  p_source_edd_content_sha256 text,
  p_clarification_transcript_sha256 text,
  p_source_summary_sha256 text,
  p_feedback_points jsonb,
  p_feedback_points_sha256 text,
  p_action_grounding jsonb,
  p_action_grounding_sha256 text,
  p_evidence_bundle_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  result := public.command_publish_mvp_repair_plan(
    p_repair_request_id,p_expected_request_version,p_planner_lease_token,
    p_plan_version_id,p_input_manifest_sha256,p_prompt_sha256,p_model_version,
    p_model_result_sha256,p_repaired_edd_payload,p_shot_decisions
  );
  perform private.record_mvp_repair_grounding_evidence(
    p_evidence_version_id,p_repair_request_id,p_plan_version_id,null,'repair',
    p_source_edd_content_sha256,p_input_manifest_sha256,p_prompt_sha256,
    p_model_version,p_model_result_sha256,p_clarification_transcript_sha256,
    p_source_summary_sha256,p_feedback_points,p_feedback_points_sha256,
    p_action_grounding,p_action_grounding_sha256,p_evidence_bundle_sha256
  );
  return result;
end;
$$;

create or replace function public.command_publish_mvp_repair_clarification_grounded(
  p_repair_request_id uuid,
  p_expected_request_version bigint,
  p_planner_lease_token uuid,
  p_question_id uuid,
  p_question text,
  p_evidence_version_id uuid,
  p_source_edd_content_sha256 text,
  p_input_manifest_sha256 text,
  p_prompt_sha256 text,
  p_model_version text,
  p_model_result_sha256 text,
  p_clarification_transcript_sha256 text,
  p_source_summary_sha256 text,
  p_feedback_points jsonb,
  p_feedback_points_sha256 text,
  p_action_grounding_sha256 text,
  p_evidence_bundle_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  result := public.command_publish_mvp_repair_clarification(
    p_repair_request_id,p_expected_request_version,p_planner_lease_token,
    p_question_id,p_question
  );
  perform private.record_mvp_repair_grounding_evidence(
    p_evidence_version_id,p_repair_request_id,null,p_question_id,'clarification',
    p_source_edd_content_sha256,p_input_manifest_sha256,p_prompt_sha256,
    p_model_version,p_model_result_sha256,p_clarification_transcript_sha256,
    p_source_summary_sha256,p_feedback_points,p_feedback_points_sha256,
    '[]'::jsonb,p_action_grounding_sha256,p_evidence_bundle_sha256
  );
  return result;
end;
$$;

-- Direct publication would bypass the evidence contract.
revoke execute on function public.command_publish_mvp_repair_plan(
  uuid,bigint,uuid,uuid,text,text,text,text,jsonb,jsonb
) from service_role;
revoke execute on function public.command_publish_mvp_repair_clarification(
  uuid,bigint,uuid,uuid,text
) from service_role;

revoke all on function private.record_mvp_repair_grounding_evidence(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,jsonb,text,jsonb,text,text
) from public, anon, authenticated, service_role;
revoke all on function private.guard_mvp_repair_grounding_child_insert()
from public, anon, authenticated, service_role;
revoke all on function private.record_mvp_repair_action_asset_lineage()
from public, anon, authenticated, service_role;

revoke all on function public.command_publish_mvp_repair_plan_grounded(
  uuid,bigint,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text,text,jsonb,text,jsonb,text,text
) from public, anon, authenticated;
grant execute on function public.command_publish_mvp_repair_plan_grounded(
  uuid,bigint,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,text,text,text,jsonb,text,jsonb,text,text
) to service_role;

revoke all on function public.command_publish_mvp_repair_clarification_grounded(
  uuid,bigint,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text,text,text
) from public, anon, authenticated;
grant execute on function public.command_publish_mvp_repair_clarification_grounded(
  uuid,bigint,uuid,uuid,text,uuid,text,text,text,text,text,text,text,jsonb,text,text,text
) to service_role;

create or replace view public.mvp_repair_progress
with (security_invoker = true)
as
select
  request.id as repair_request_id,
  request.workspace_id,
  request.episode_id,
  request.production_run_id,
  request.source_attempt_number,
  request.target_attempt_number,
  request.state,
  request.version,
  request.total_shots,
  request.affected_shots,
  request.storyboards_reused,
  request.storyboards_missing_legacy,
  request.storyboards_to_regenerate,
  request.storyboards_regenerated,
  request.clips_reused,
  request.clips_to_regenerate,
  request.clips_regenerated,
  request.shots_selected,
  request.last_error_code,
  request.last_error_summary,
  request.created_at,
  request.started_at,
  request.completed_at,
  request.updated_at,
  pending.id as clarification_id,
  pending.content as clarification_question,
  pending.round_number as clarification_round,
  coalesce(safe_grounding.feedback_points, '[]'::jsonb) as feedback_points
from public.mvp_repair_requests request
left join lateral (
  select question.id, question.content, question.round_number
  from public.mvp_repair_clarification_messages question
  where question.repair_request_id = request.id
    and question.message_kind = 'question'
    and not exists (
      select 1 from public.mvp_repair_clarification_messages answer
      where answer.reply_to_message_id = question.id
        and answer.message_kind = 'answer'
    )
  order by question.round_number desc, question.created_at desc
  limit 1
) pending on true
left join lateral (
  select jsonb_agg(jsonb_build_object(
    'feedbackPointIndex', point.feedback_point_index,
    'resolution', point.resolution,
    'mappedShots', to_jsonb(point.resolved_shot_numbers),
    'evidenceWindows', point.evidence_windows,
    'actions', coalesce(actions.values, '[]'::jsonb)
  ) order by point.feedback_point_index) as feedback_points
  from public.mvp_repair_feedback_point_evidence point
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'selectedAction', action.selected_action,
      'shotNumber', action.shot_number,
      'assetStatus', case when lineage.id is null
        then 'planned' else 'selected_complete_assets' end
    ) order by action.shot_number) as values
    from public.mvp_repair_action_grounding_evidence action
    left join public.mvp_repair_action_asset_lineage lineage
      on lineage.action_grounding_id = action.id
    where action.grounding_version_id = point.grounding_version_id
      and point.feedback_point_index = any(action.feedback_point_indexes)
  ) actions on true
  where point.grounding_version_id = (
    select version.id
    from public.mvp_repair_feedback_grounding_versions version
    where version.repair_request_id = request.id
    order by version.created_at desc, version.id desc
    limit 1
  )
) safe_grounding on true;

grant select on public.mvp_repair_progress to authenticated;
revoke all on public.mvp_repair_progress from public, anon;

comment on view public.mvp_repair_progress is
  'Authenticated repair progress with bounded numeric/hash-derived grounding only; owner feedback text remains service-only.';

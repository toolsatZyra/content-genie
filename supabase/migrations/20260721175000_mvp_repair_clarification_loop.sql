-- Preserve ambiguous owner feedback as a durable, append-only conversation.
-- Clarification pauses only the repair planner: the production job remains in
-- repair_planning and therefore cannot release storyboard or clip provider work.

alter table public.mvp_repair_requests
  drop constraint if exists mvp_repair_requests_state_check;
alter table public.mvp_repair_requests
  add constraint mvp_repair_requests_state_check
  check (state in (
    'awaiting_retry','analyzing','awaiting_clarification','planned',
    'executing','complete','failed'
  ));

alter table public.mvp_repair_requests
  drop constraint if exists mvp_repair_requests_state_progress_check;
alter table public.mvp_repair_requests
  add constraint mvp_repair_requests_state_progress_check
  check (
    (state = 'awaiting_retry'
      and target_attempt_number is null
      and active_plan_version_id is null
      and started_at is null and completed_at is null
      and planner_lease_token is null and planner_lease_expires_at is null
      and planner_claimed_at is null
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'analyzing'
      and target_attempt_number is not null
      and active_plan_version_id is null
      and started_at is not null and completed_at is null
      and total_shots = 0
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'awaiting_clarification'
      and target_attempt_number is not null
      and active_plan_version_id is null
      and started_at is not null and completed_at is null
      and total_shots = 0
      and planner_lease_token is null and planner_lease_expires_at is null
      and planner_claimed_at is not null
      and last_error_code is null and last_error_summary is null)
    or
    (state in ('planned','executing')
      and target_attempt_number is not null
      and active_plan_version_id is not null
      and started_at is not null and completed_at is null
      and total_shots > 0
      and planner_lease_token is null and planner_lease_expires_at is null
      and planner_claimed_at is not null
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'complete'
      and target_attempt_number is not null
      and active_plan_version_id is not null
      and started_at is not null and completed_at is not null
      and total_shots > 0 and shots_selected = total_shots
      and storyboards_regenerated = storyboards_to_regenerate
      and clips_regenerated = clips_to_regenerate
      and planner_lease_token is null and planner_lease_expires_at is null
      and planner_claimed_at is not null
      and last_error_code is null and last_error_summary is null)
    or
    (state = 'failed'
      and completed_at is not null
      and planner_lease_token is null and planner_lease_expires_at is null
      and last_error_code is not null and last_error_summary is not null)
  );

alter table public.mvp_repair_requests
  add constraint mvp_repair_requests_clarification_lineage_uq
  unique (id, workspace_id, episode_id, production_run_id);

create table public.mvp_repair_clarification_messages (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  production_run_id uuid not null,
  repair_request_id uuid not null,
  round_number integer not null check (round_number between 1 and 3),
  message_kind text not null check (message_kind in ('question','answer')),
  reply_to_message_id uuid references public.mvp_repair_clarification_messages(id)
    on delete restrict,
  content text not null check (char_length(content) between 1 and 4000),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  actor_user_id uuid references auth.users(id) on delete restrict,
  actor_role text not null check (actor_role in ('service_role','authenticated')),
  created_at timestamptz not null default statement_timestamp(),
  unique (repair_request_id, round_number, message_kind),
  unique (reply_to_message_id),
  unique (workspace_id, id),
  foreign key (
    repair_request_id, workspace_id, episode_id, production_run_id
  ) references public.mvp_repair_requests(
    id, workspace_id, episode_id, production_run_id
  ) on delete restrict,
  check (
    (message_kind = 'question'
      and reply_to_message_id is null
      and actor_user_id is null
      and actor_role = 'service_role'
      and char_length(content) <= 2000)
    or
    (message_kind = 'answer'
      and reply_to_message_id is not null
      and actor_user_id is not null
      and actor_role = 'authenticated')
  )
);

create or replace function private.guard_mvp_repair_clarification_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare question_row public.mvp_repair_clarification_messages%rowtype;
begin
  if new.content_sha256 <> encode(extensions.digest(
    convert_to(new.content, 'UTF8'), 'sha256'
  ), 'hex') then
    raise exception 'clarification content hash is invalid' using errcode = '23514';
  end if;

  if new.message_kind = 'answer' then
    select * into question_row
    from public.mvp_repair_clarification_messages
    where id = new.reply_to_message_id;
    if not found
      or question_row.message_kind <> 'question'
      or question_row.workspace_id <> new.workspace_id
      or question_row.episode_id <> new.episode_id
      or question_row.production_run_id <> new.production_run_id
      or question_row.repair_request_id <> new.repair_request_id
      or question_row.round_number <> new.round_number
    then
      raise exception 'clarification answer lineage is invalid'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger mvp_repair_clarification_messages_insert_guard
before insert on public.mvp_repair_clarification_messages
for each row execute function private.guard_mvp_repair_clarification_insert();

create trigger mvp_repair_clarification_messages_immutable
before update or delete on public.mvp_repair_clarification_messages
for each row execute function private.reject_mutation();

create or replace function private.guard_mvp_repair_request_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
    or new.workspace_id is distinct from old.workspace_id
    or new.episode_id is distinct from old.episode_id
    or new.production_run_id is distinct from old.production_run_id
    or new.plan_bundle_id is distinct from old.plan_bundle_id
    or new.review_id is distinct from old.review_id
    or new.source_master_id is distinct from old.source_master_id
    or new.source_master_version is distinct from old.source_master_version
    or new.source_attempt_number is distinct from old.source_attempt_number
    or new.opened_job_version is distinct from old.opened_job_version
    or new.feedback_sha256 is distinct from old.feedback_sha256
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'repair request lineage is immutable' using errcode = '55000';
  end if;

  if new.version <> old.version + 1 then
    raise exception 'repair request version is not optimistic' using errcode = '40001';
  end if;

  if old.target_attempt_number is not null
    and new.target_attempt_number is distinct from old.target_attempt_number
  then
    raise exception 'repair target attempt is immutable' using errcode = '55000';
  end if;
  if old.target_attempt_number is null and new.target_attempt_number is not null
    and new.target_attempt_number <> old.source_attempt_number + 1
  then
    raise exception 'repair target attempt is invalid' using errcode = '23514';
  end if;

  if old.active_plan_version_id is not null
    and new.active_plan_version_id is distinct from old.active_plan_version_id
  then
    raise exception 'active repair plan is immutable' using errcode = '55000';
  end if;

  if not (
    new.state = old.state
    or (old.state = 'awaiting_retry' and new.state in ('analyzing','failed'))
    or (old.state = 'analyzing'
      and new.state in ('awaiting_clarification','planned','failed'))
    or (old.state = 'awaiting_clarification'
      and new.state in ('analyzing','failed'))
    or (old.state = 'planned' and new.state in ('executing','complete','failed'))
    or (old.state = 'executing' and new.state in ('complete','failed'))
  ) then
    raise exception 'repair request state transition is invalid'
      using errcode = '23514';
  end if;

  if old.total_shots > 0 and (
    new.total_shots is distinct from old.total_shots
    or new.affected_shots is distinct from old.affected_shots
    or new.storyboards_reused is distinct from old.storyboards_reused
    or new.storyboards_missing_legacy is distinct from old.storyboards_missing_legacy
    or new.storyboards_to_regenerate is distinct from old.storyboards_to_regenerate
    or new.clips_reused is distinct from old.clips_reused
    or new.clips_to_regenerate is distinct from old.clips_to_regenerate
  ) then
    raise exception 'repair plan totals are immutable' using errcode = '55000';
  end if;

  if new.storyboards_regenerated < old.storyboards_regenerated
    or new.clips_regenerated < old.clips_regenerated
    or new.shots_selected < old.shots_selected
  then
    raise exception 'repair progress cannot move backward' using errcode = '23514';
  end if;

  return new;
end;
$$;

alter table public.mvp_repair_clarification_messages enable row level security;
alter table public.mvp_repair_clarification_messages force row level security;

create policy mvp_repair_clarification_messages_member_select
on public.mvp_repair_clarification_messages for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

revoke all on public.mvp_repair_clarification_messages
from public, anon, authenticated;
grant select on public.mvp_repair_clarification_messages to authenticated;

revoke insert, update, delete on public.mvp_repair_clarification_messages
from service_role;
grant select on public.mvp_repair_clarification_messages to service_role;

revoke all on function private.guard_mvp_repair_clarification_insert()
from public, anon, authenticated;

create index mvp_repair_clarification_messages_request_idx
on public.mvp_repair_clarification_messages(
  repair_request_id, round_number, message_kind
);
create index mvp_repair_clarification_messages_workspace_idx
on public.mvp_repair_clarification_messages(
  workspace_id, episode_id, created_at desc
);
create index mvp_repair_clarification_messages_actor_idx
on public.mvp_repair_clarification_messages(actor_user_id, created_at desc)
where actor_user_id is not null;

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
  pending.round_number as clarification_round
from public.mvp_repair_requests request
left join lateral (
  select question.id, question.content, question.round_number
  from public.mvp_repair_clarification_messages question
  where question.repair_request_id = request.id
    and question.message_kind = 'question'
    and not exists (
      select 1
      from public.mvp_repair_clarification_messages answer
      where answer.reply_to_message_id = question.id
        and answer.message_kind = 'answer'
    )
  order by question.round_number desc, question.created_at desc
  limit 1
) pending on true;

grant select on public.mvp_repair_progress to authenticated;
revoke all on public.mvp_repair_progress from public, anon;

create or replace view public.mvp_repair_request_worker
with (security_invoker = true)
as
select
  request.*,
  review.feedback,
  master.object_name as source_master_object_name,
  master.content_sha256 as source_master_content_sha256,
  master.duration_ms as source_master_duration_ms,
  coalesce(transcript.messages, '[]'::jsonb) as clarification_transcript
from public.mvp_repair_requests request
join public.mvp_master_reviews review on review.id = request.review_id
join public.mvp_episode_masters master on master.id = request.source_master_id
left join lateral (
  select jsonb_agg(
    jsonb_build_object(
      'id', message.id,
      'round', message.round_number,
      'kind', message.message_kind,
      'replyToMessageId', message.reply_to_message_id,
      'content', message.content,
      'contentSha256', message.content_sha256,
      'actorUserId', message.actor_user_id,
      'actorRole', message.actor_role,
      'createdAt', message.created_at
    ) order by message.round_number,
      case message.message_kind when 'question' then 0 else 1 end,
      message.created_at
  ) as messages
  from public.mvp_repair_clarification_messages message
  where message.repair_request_id = request.id
) transcript on true;

revoke all on public.mvp_repair_request_worker from public, anon, authenticated;
grant select on public.mvp_repair_request_worker to service_role;

create or replace function public.command_publish_mvp_repair_clarification(
  p_repair_request_id uuid,
  p_expected_request_version bigint,
  p_planner_lease_token uuid,
  p_question_id uuid,
  p_question text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.mvp_repair_requests%rowtype;
  job_row public.mvp_production_jobs%rowtype;
  existing_question public.mvp_repair_clarification_messages%rowtype;
  question_value text := btrim(p_question);
  question_hash text;
  next_round integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_repair_request_id is null
    or p_expected_request_version < 1
    or p_planner_lease_token is null
    or p_question_id is null
    or char_length(question_value) not between 1 and 2000
  then
    raise exception 'repair clarification envelope is invalid'
      using errcode = '22023';
  end if;
  question_hash := encode(extensions.digest(
    convert_to(question_value, 'UTF8'), 'sha256'
  ), 'hex');

  select * into request_row
  from public.mvp_repair_requests
  where id = p_repair_request_id
  for update;
  if not found then
    raise exception 'repair clarification request is unavailable'
      using errcode = '40001';
  end if;

  select * into existing_question
  from public.mvp_repair_clarification_messages
  where id = p_question_id;
  if found then
    if existing_question.repair_request_id = request_row.id
      and existing_question.message_kind = 'question'
      and existing_question.content_sha256 = question_hash
      and request_row.state = 'awaiting_clarification'
      and request_row.version = p_expected_request_version + 1
    then
      select * into job_row
      from public.mvp_production_jobs
      where production_run_id = request_row.production_run_id
      for update;
      if not found
        or job_row.workspace_id <> request_row.workspace_id
        or job_row.episode_id <> request_row.episode_id
        or job_row.state <> 'repair_planning'
        or job_row.active_repair_request_id <> request_row.id
        or job_row.attempt_number <> request_row.target_attempt_number
      then
        raise exception 'repair clarification replay is not actively fenced'
          using errcode = '40001';
      end if;
      return jsonb_build_object(
        'repairRequestId', request_row.id,
        'state', request_row.state,
        'version', request_row.version,
        'clarificationId', existing_question.id,
        'round', existing_question.round_number,
        'replayed', true
      );
    end if;
    raise exception 'repair clarification replay conflicts with committed evidence'
      using errcode = '40001';
  end if;

  if request_row.state <> 'analyzing'
    or request_row.version <> p_expected_request_version
    or request_row.planner_lease_token <> p_planner_lease_token
    or request_row.planner_lease_expires_at <= statement_timestamp()
    or request_row.target_attempt_number is null
    or request_row.active_plan_version_id is not null
  then
    raise exception 'repair clarification publication is stale'
      using errcode = '40001';
  end if;

  select * into job_row
  from public.mvp_production_jobs
  where production_run_id = request_row.production_run_id
  for update;
  if not found
    or job_row.workspace_id <> request_row.workspace_id
    or job_row.episode_id <> request_row.episode_id
    or job_row.state <> 'repair_planning'
    or job_row.active_repair_request_id <> request_row.id
    or job_row.attempt_number <> request_row.target_attempt_number
  then
    raise exception 'repair production job is not fenced for clarification'
      using errcode = '40001';
  end if;

  if exists (
    select 1
    from public.mvp_repair_clarification_messages question
    where question.repair_request_id = request_row.id
      and question.message_kind = 'question'
      and not exists (
        select 1
        from public.mvp_repair_clarification_messages answer
        where answer.reply_to_message_id = question.id
          and answer.message_kind = 'answer'
      )
  ) then
    raise exception 'a repair clarification is already awaiting an answer'
      using errcode = '40001';
  end if;

  select coalesce(max(round_number), 0) + 1
  into next_round
  from public.mvp_repair_clarification_messages
  where repair_request_id = request_row.id
    and message_kind = 'question';
  if next_round > 3 then
    raise exception 'repair clarification round limit reached'
      using errcode = '23514';
  end if;

  insert into public.mvp_repair_clarification_messages(
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    round_number, message_kind, content, content_sha256, actor_role
  ) values(
    p_question_id, request_row.workspace_id, request_row.episode_id,
    request_row.production_run_id, request_row.id, next_round, 'question',
    question_value, question_hash, 'service_role'
  );

  update public.mvp_repair_requests
  set state = 'awaiting_clarification', version = version + 1,
      planner_lease_token = null, planner_lease_expires_at = null
  where id = request_row.id
    and version = p_expected_request_version
    and state = 'analyzing'
    and planner_lease_token = p_planner_lease_token
    and planner_lease_expires_at > statement_timestamp()
  returning * into request_row;
  if not found then
    raise exception 'repair clarification publication is stale'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'repairRequestId', request_row.id,
    'state', request_row.state,
    'version', request_row.version,
    'clarificationId', p_question_id,
    'round', next_round,
    'replayed', false
  );
end;
$$;

create or replace function public.command_answer_mvp_repair_clarification(
  p_workspace_id uuid,
  p_repair_request_id uuid,
  p_clarification_id uuid,
  p_expected_request_version bigint,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.mvp_repair_requests%rowtype;
  job_row public.mvp_production_jobs%rowtype;
  question_row public.mvp_repair_clarification_messages%rowtype;
  answer_id uuid := gen_random_uuid();
  answer_value text := btrim(p_answer);
  answer_hash text;
begin
  if actor_id is null
    or not private.is_active_member(p_workspace_id, actor_id)
  then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_repair_request_id is null
    or p_clarification_id is null
    or p_expected_request_version < 1
    or char_length(answer_value) not between 1 and 4000
  then
    raise exception 'repair clarification answer is invalid'
      using errcode = '22023';
  end if;
  answer_hash := encode(extensions.digest(
    convert_to(answer_value, 'UTF8'), 'sha256'
  ), 'hex');

  select * into request_row
  from public.mvp_repair_requests
  where id = p_repair_request_id
    and workspace_id = p_workspace_id
  for update;
  if not found
    or request_row.state <> 'awaiting_clarification'
    or request_row.version <> p_expected_request_version
    or request_row.planner_lease_token is not null
    or request_row.planner_lease_expires_at is not null
  then
    raise exception 'repair clarification answer is stale'
      using errcode = '40001';
  end if;

  select * into job_row
  from public.mvp_production_jobs
  where production_run_id = request_row.production_run_id
  for update;
  if not found
    or job_row.workspace_id <> request_row.workspace_id
    or job_row.episode_id <> request_row.episode_id
    or job_row.state <> 'repair_planning'
    or job_row.active_repair_request_id <> request_row.id
    or job_row.attempt_number <> request_row.target_attempt_number
  then
    raise exception 'repair production job is not fenced for clarification'
      using errcode = '40001';
  end if;

  select question.* into question_row
  from public.mvp_repair_clarification_messages question
  where question.repair_request_id = request_row.id
    and question.message_kind = 'question'
    and not exists (
      select 1
      from public.mvp_repair_clarification_messages answer
      where answer.reply_to_message_id = question.id
        and answer.message_kind = 'answer'
    )
  order by question.round_number desc, question.created_at desc
  limit 1
  for update of question;
  if not found or question_row.id <> p_clarification_id then
    raise exception 'only the latest pending clarification can be answered'
      using errcode = '40001';
  end if;

  insert into public.mvp_repair_clarification_messages(
    id, workspace_id, episode_id, production_run_id, repair_request_id,
    round_number, message_kind, reply_to_message_id, content,
    content_sha256, actor_user_id, actor_role
  ) values(
    answer_id, request_row.workspace_id, request_row.episode_id,
    request_row.production_run_id, request_row.id, question_row.round_number,
    'answer', question_row.id, answer_value, answer_hash, actor_id,
    'authenticated'
  );

  update public.mvp_repair_requests
  set state = 'analyzing', version = version + 1
  where id = request_row.id
    and version = p_expected_request_version
    and state = 'awaiting_clarification'
    and planner_lease_token is null
    and planner_lease_expires_at is null
  returning * into request_row;
  if not found then
    raise exception 'repair clarification answer is stale'
      using errcode = '40001';
  end if;

  return jsonb_build_object(
    'repairRequestId', request_row.id,
    'state', request_row.state,
    'version', request_row.version,
    'clarificationId', question_row.id,
    'answerId', answer_id,
    'round', question_row.round_number
  );
end;
$$;

revoke all on function public.command_publish_mvp_repair_clarification(
  uuid,bigint,uuid,uuid,text
) from public, anon, authenticated;
grant execute on function public.command_publish_mvp_repair_clarification(
  uuid,bigint,uuid,uuid,text
) to service_role;

revoke all on function public.command_answer_mvp_repair_clarification(
  uuid,uuid,uuid,bigint,text
) from public, anon, service_role;
grant execute on function public.command_answer_mvp_repair_clarification(
  uuid,uuid,uuid,bigint,text
) to authenticated;

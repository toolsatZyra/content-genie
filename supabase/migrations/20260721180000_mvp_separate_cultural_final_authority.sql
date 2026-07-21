-- A final master release has two independent human authorities. A qualified
-- cultural decision is bound to the exact master and source-evidence set; a
-- separate AAL2 final decision is bound to that same immutable target. Legacy
-- boolean columns remain readable for compatibility but are no longer
-- authority inputs.

create table public.mvp_master_cultural_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  master_id uuid not null references public.mvp_episode_masters(id) on delete restrict,
  master_version bigint not null check (master_version > 0),
  production_run_id uuid not null references public.production_runs(id) on delete restrict,
  source_review_packet_id uuid not null,
  source_review_decision_id uuid not null,
  policy_version_id uuid not null,
  competency_version_id uuid not null,
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  source_set_hash text not null check (source_set_hash ~ '^[a-f0-9]{64}$'),
  evidence_set_hash text not null check (evidence_set_hash ~ '^[a-f0-9]{64}$'),
  decision text not null check (decision in ('approve','block')),
  rationale text not null check (char_length(rationale) between 2 and 4000),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check (actor_aal = 'aal2'),
  created_at timestamptz not null default statement_timestamp(),
  unique (master_id, master_version),
  unique (workspace_id, id),
  unique (id, workspace_id, episode_id, master_id, master_version),
  foreign key (workspace_id, master_id)
    references public.mvp_episode_masters(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_review_packet_id)
    references public.source_review_packets(workspace_id, id) on delete restrict,
  foreign key (workspace_id, source_review_decision_id)
    references public.source_review_decisions(workspace_id, id) on delete restrict,
  foreign key (workspace_id, competency_version_id)
    references public.reviewer_competency_versions(workspace_id, id) on delete restrict
);

create table public.mvp_master_final_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  master_id uuid not null references public.mvp_episode_masters(id) on delete restrict,
  master_version bigint not null check (master_version > 0),
  production_run_id uuid not null references public.production_runs(id) on delete restrict,
  master_review_id uuid not null,
  decision text not null check (decision = 'approve'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_aal text not null check (actor_aal = 'aal2'),
  created_at timestamptz not null default statement_timestamp(),
  unique (master_id, master_version),
  unique (workspace_id, id),
  unique (id, workspace_id, episode_id, master_id, master_version),
  foreign key (workspace_id, master_id)
    references public.mvp_episode_masters(workspace_id, id) on delete restrict,
  foreign key (
    master_review_id, workspace_id, episode_id, master_id, master_version
  ) references public.mvp_master_reviews(
    id, workspace_id, episode_id, master_id, master_version
  ) on delete restrict
);

create table public.mvp_master_release_authorities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  master_id uuid not null references public.mvp_episode_masters(id) on delete restrict,
  master_version bigint not null check (master_version > 0),
  production_run_id uuid not null references public.production_runs(id) on delete restrict,
  cultural_decision_id uuid not null,
  final_decision_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (master_id, master_version),
  unique (workspace_id, id),
  unique (id, workspace_id, episode_id, master_id, master_version),
  foreign key (
    cultural_decision_id, workspace_id, episode_id, master_id, master_version
  ) references public.mvp_master_cultural_decisions(
    id, workspace_id, episode_id, master_id, master_version
  ) on delete restrict,
  foreign key (
    final_decision_id, workspace_id, episode_id, master_id, master_version
  ) references public.mvp_master_final_decisions(
    id, workspace_id, episode_id, master_id, master_version
  ) on delete restrict
);

create trigger mvp_master_cultural_decisions_immutable
before update or delete on public.mvp_master_cultural_decisions
for each row execute function private.reject_mutation();
create trigger mvp_master_final_decisions_immutable
before update or delete on public.mvp_master_final_decisions
for each row execute function private.reject_mutation();
create trigger mvp_master_release_authorities_immutable
before update or delete on public.mvp_master_release_authorities
for each row execute function private.reject_mutation();

alter table public.mvp_master_cultural_decisions enable row level security;
alter table public.mvp_master_cultural_decisions force row level security;
alter table public.mvp_master_final_decisions enable row level security;
alter table public.mvp_master_final_decisions force row level security;
alter table public.mvp_master_release_authorities enable row level security;
alter table public.mvp_master_release_authorities force row level security;

create policy mvp_master_cultural_decisions_member_select
on public.mvp_master_cultural_decisions for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy mvp_master_final_decisions_member_select
on public.mvp_master_final_decisions for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));
create policy mvp_master_release_authorities_member_select
on public.mvp_master_release_authorities for select to authenticated
using (private.is_active_member(workspace_id, (select auth.uid())));

revoke all on public.mvp_master_cultural_decisions,
  public.mvp_master_final_decisions,
  public.mvp_master_release_authorities
from public, anon, authenticated;
grant select on public.mvp_master_cultural_decisions,
  public.mvp_master_final_decisions,
  public.mvp_master_release_authorities
to authenticated;
revoke insert, update, delete on public.mvp_master_cultural_decisions,
  public.mvp_master_final_decisions,
  public.mvp_master_release_authorities
from service_role;
grant select on public.mvp_master_cultural_decisions,
  public.mvp_master_final_decisions,
  public.mvp_master_release_authorities
to service_role;

alter table public.mvp_exports add column release_authority_id uuid;
alter table public.mvp_exports add column authority_master_version bigint;
alter table public.mvp_exports add column authority_enforced boolean;

update public.mvp_exports
set authority_enforced = false
where authority_enforced is null;

alter table public.mvp_exports
  alter column authority_enforced set default true;
alter table public.mvp_exports
  alter column authority_enforced set not null;
alter table public.mvp_exports
  add constraint mvp_exports_release_authority_shape_check
  check (
    (not authority_enforced
      and release_authority_id is null
      and authority_master_version is null)
    or
    (authority_enforced
      and release_authority_id is not null
      and authority_master_version > 0)
  );
alter table public.mvp_exports
  add constraint mvp_exports_release_authority_fk
  foreign key (
    release_authority_id, workspace_id, episode_id, master_id,
    authority_master_version
  ) references public.mvp_master_release_authorities(
    id, workspace_id, episode_id, master_id, master_version
  ) on delete restrict;

create index mvp_master_cultural_decisions_actor_idx
on public.mvp_master_cultural_decisions(actor_user_id, created_at desc);
create index mvp_master_final_decisions_actor_idx
on public.mvp_master_final_decisions(actor_user_id, created_at desc);
create index mvp_master_release_authorities_run_idx
on public.mvp_master_release_authorities(production_run_id);
create index mvp_exports_release_authority_idx
on public.mvp_exports(release_authority_id)
where release_authority_id is not null;

create or replace function private.guard_mvp_master_approval_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'approved' and old.state is distinct from 'approved'
    and not exists (
      select 1
      from public.mvp_master_release_authorities authority
      join public.mvp_master_cultural_decisions cultural
        on cultural.id = authority.cultural_decision_id
      join public.mvp_master_final_decisions final
        on final.id = authority.final_decision_id
      join public.source_review_statuses source_status
        on source_status.source_review_packet_id =
          cultural.source_review_packet_id
        and source_status.workspace_id = cultural.workspace_id
        and source_status.status = 'approved'
        and source_status.selected_decision_id =
          cultural.source_review_decision_id
      where authority.workspace_id = old.workspace_id
        and authority.episode_id = old.episode_id
        and authority.master_id = old.id
        and authority.master_version = old.version
        and authority.production_run_id = old.production_run_id
        and cultural.decision = 'approve'
        and final.decision = 'approve'
    )
  then
    raise exception 'separate current cultural and final authorities are required'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mvp_episode_master_approval_authority
before update of state on public.mvp_episode_masters
for each row execute function private.guard_mvp_master_approval_authority();

create or replace function private.guard_mvp_export_release_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.authority_enforced and not exists (
    select 1
    from public.mvp_master_release_authorities authority
    join public.mvp_master_cultural_decisions cultural
      on cultural.id = authority.cultural_decision_id
    join public.mvp_master_final_decisions final
      on final.id = authority.final_decision_id
    join public.source_review_statuses source_status
      on source_status.source_review_packet_id = cultural.source_review_packet_id
      and source_status.workspace_id = cultural.workspace_id
      and source_status.status = 'approved'
      and source_status.selected_decision_id = cultural.source_review_decision_id
    where authority.id = new.release_authority_id
      and authority.workspace_id = new.workspace_id
      and authority.episode_id = new.episode_id
      and authority.master_id = new.master_id
      and authority.master_version = new.authority_master_version
      and cultural.decision = 'approve'
      and final.decision = 'approve'
  ) then
    raise exception 'export requires exact separate cultural and final authorities'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mvp_exports_release_authority
before insert or update on public.mvp_exports
for each row execute function private.guard_mvp_export_release_authority();

create or replace function private.guard_mvp_job_release_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state in ('approved','export_ready')
    and old.state is distinct from new.state
    and not exists (
      select 1
      from public.mvp_episode_masters master
      join public.mvp_exports export on export.master_id = master.id
      join public.mvp_master_release_authorities authority
        on authority.id = export.release_authority_id
      join public.mvp_master_cultural_decisions cultural
        on cultural.id = authority.cultural_decision_id
      join public.source_review_statuses source_status
        on source_status.source_review_packet_id =
          cultural.source_review_packet_id
        and source_status.workspace_id = cultural.workspace_id
        and source_status.status = 'approved'
        and source_status.selected_decision_id =
          cultural.source_review_decision_id
      where master.production_run_id = new.production_run_id
        and master.workspace_id = new.workspace_id
        and master.episode_id = new.episode_id
        and master.state = 'approved'
        and export.authority_enforced
        and authority.master_id = master.id
        and authority.master_version = export.authority_master_version
    )
  then
    raise exception 'production release requires exact separate human authorities'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger mvp_production_job_release_authority
before update of state on public.mvp_production_jobs
for each row execute function private.guard_mvp_job_release_authority();

create or replace function private.guard_mvp_run_success_authority()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'succeeded' and old.state is distinct from 'succeeded'
    and not exists (
      select 1
      from public.mvp_production_jobs job
      join public.mvp_episode_masters master
        on master.production_run_id = job.production_run_id
      join public.mvp_exports export on export.master_id = master.id
      join public.mvp_master_release_authorities authority
        on authority.id = export.release_authority_id
      join public.mvp_master_cultural_decisions cultural
        on cultural.id = authority.cultural_decision_id
      join public.source_review_statuses source_status
        on source_status.source_review_packet_id =
          cultural.source_review_packet_id
        and source_status.workspace_id = cultural.workspace_id
        and source_status.status = 'approved'
        and source_status.selected_decision_id =
          cultural.source_review_decision_id
      where job.production_run_id = new.production_run_id
        and job.workspace_id = new.workspace_id
        and job.episode_id = new.episode_id
        and job.state = 'export_ready'
        and master.state = 'approved'
        and export.authority_enforced
        and authority.master_id = master.id
        and authority.master_version = export.authority_master_version
    )
  then
    raise exception 'successful run requires exact separate human authorities'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger production_run_success_release_authority
before update of state on public.production_run_statuses
for each row execute function private.guard_mvp_run_success_authority();

revoke all on function private.guard_mvp_master_approval_authority(),
  private.guard_mvp_export_release_authority(),
  private.guard_mvp_job_release_authority(),
  private.guard_mvp_run_success_authority()
from public, anon, authenticated;

create or replace function public.command_record_mvp_master_cultural_decision(
  p_workspace_id uuid,
  p_master_id uuid,
  p_expected_master_version bigint,
  p_decision text,
  p_rationale text
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
  packet_row public.source_review_packets%rowtype;
  status_row public.source_review_statuses%rowtype;
  source_decision public.source_review_decisions%rowtype;
  competency public.reviewer_competency_versions%rowtype;
  existing public.mvp_master_cultural_decisions%rowtype;
  decision_id uuid;
  episode_series_id uuid;
  configuration_id uuid;
begin
  perform private.assert_aal2();
  if actor_id is null or not private.is_active_member(p_workspace_id, actor_id) then
    raise exception 'active membership required' using errcode = '42501';
  end if;
  if p_decision not in ('approve','block')
    or char_length(btrim(p_rationale)) not between 2 and 4000
  then
    raise exception 'cultural master decision is invalid' using errcode = '22023';
  end if;

  select * into master_row
  from public.mvp_episode_masters
  where workspace_id = p_workspace_id and id = p_master_id
  for update;
  if not found or master_row.state <> 'pending_review'
    or master_row.version <> p_expected_master_version
  then
    raise exception 'cultural master target is stale' using errcode = '40001';
  end if;

  select * into existing
  from public.mvp_master_cultural_decisions
  where master_id = master_row.id and master_version = master_row.version;
  if found then
    if existing.decision = p_decision
    then
      return jsonb_build_object(
        'culturalDecisionId', existing.id,
        'decision', existing.decision,
        'masterId', existing.master_id,
        'masterVersion', existing.master_version,
        'replayed', true
      );
    end if;
    raise exception 'cultural master decision conflicts with current evidence'
      using errcode = '40001';
  end if;

  select job.* into job_row
  from public.mvp_production_jobs job
  where job.workspace_id = p_workspace_id
    and job.production_run_id = master_row.production_run_id
  for update;
  if not found or job_row.episode_id <> master_row.episode_id
    or job_row.state <> 'review_ready'
    or job_row.attempt_number <> master_row.attempt_number
  then
    raise exception 'cultural master lineage is stale' using errcode = '40001';
  end if;

  select packet.* into packet_row
  from public.preflight_plan_bundles bundle
  join public.source_review_packets packet
    on packet.workspace_id = bundle.workspace_id
    and packet.id = bundle.source_review_packet_id
  where bundle.workspace_id = p_workspace_id
    and bundle.id = job_row.plan_bundle_id;
  select bundle.configuration_candidate_id into configuration_id
  from public.preflight_plan_bundles bundle
  where bundle.workspace_id = p_workspace_id
    and bundle.id = job_row.plan_bundle_id;
  select * into status_row
  from public.source_review_statuses
  where workspace_id = p_workspace_id
    and source_review_packet_id = packet_row.id;
  select * into source_decision
  from public.source_review_decisions
  where workspace_id = p_workspace_id
    and id = status_row.selected_decision_id;
  select version.* into competency
  from public.reviewer_competency_versions version
  join public.reviewer_competency_statuses status
    on status.competency_version_id = version.id
    and status.workspace_id = version.workspace_id
    and status.status = 'active'
  where version.workspace_id = p_workspace_id
    and version.id = source_decision.competency_version_id
    and version.reviewer_user_id = actor_id
    and version.effective_at <= statement_timestamp()
    and version.expires_at > statement_timestamp();
  select episode.series_id into episode_series_id
  from public.episodes episode
  where episode.workspace_id = p_workspace_id
    and episode.id = master_row.episode_id;

  if packet_row.id is null
    or status_row.status <> 'approved'
    or status_row.selected_decision_id is null
    or source_decision.id <> status_row.selected_decision_id
    or source_decision.decision <> 'approve'
    or source_decision.reviewer_user_id <> actor_id
    or source_decision.policy_version_id <> packet_row.policy_version_id
    or source_decision.subject_hash <> packet_row.subject_hash
    or source_decision.source_set_hash <> packet_row.source_set_hash
    or source_decision.evidence_set_hash <> packet_row.evidence_set_hash
    or not source_decision.recusal_checked
    or competency.id is null
    or exists (
      select 1 from public.reviewer_recusals recusal
      where recusal.workspace_id = p_workspace_id
        and recusal.reviewer_user_id = actor_id
        and recusal.effective_at <= statement_timestamp()
        and (recusal.expires_at is null
          or recusal.expires_at > statement_timestamp())
        and (
          (recusal.subject_kind = 'series'
            and recusal.subject_id = episode_series_id)
          or (recusal.subject_kind = 'configuration_candidate'
            and recusal.subject_id = configuration_id)
        )
    )
  then
    raise exception 'qualified cultural master authority is unavailable'
      using errcode = '42501';
  end if;

  insert into public.mvp_master_cultural_decisions(
    workspace_id, episode_id, master_id, master_version, production_run_id,
    source_review_packet_id, source_review_decision_id, policy_version_id,
    competency_version_id, subject_hash, source_set_hash, evidence_set_hash,
    decision, rationale, actor_user_id, actor_aal
  ) values(
    p_workspace_id, master_row.episode_id, master_row.id, master_row.version,
    master_row.production_run_id, packet_row.id, source_decision.id,
    packet_row.policy_version_id, competency.id, packet_row.subject_hash,
    packet_row.source_set_hash, packet_row.evidence_set_hash, p_decision,
    btrim(p_rationale), actor_id, 'aal2'
  ) returning id into decision_id;

  return jsonb_build_object(
    'culturalDecisionId', decision_id,
    'decision', p_decision,
    'masterId', master_row.id,
    'masterVersion', master_row.version,
    'replayed', false
  );
end;
$$;

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
    if not p_final_review_confirmed then
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

revoke all on function public.command_record_mvp_master_cultural_decision(
  uuid,uuid,bigint,text,text
) from public, anon;
grant execute on function public.command_record_mvp_master_cultural_decision(
  uuid,uuid,bigint,text,text
) to authenticated;

-- Reassert the legacy review-command grant after replacing its body.
revoke all on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) from public, anon;
grant execute on function public.command_review_mvp_master(
  uuid,uuid,bigint,text,boolean,boolean,text
) to authenticated;

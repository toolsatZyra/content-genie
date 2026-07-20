-- Phase 2 / 0016: read-only, typed agent authority and immutable evaluator evidence.

create type private.agent_tool_name as enum (
  'source.extract',
  'cultural.triage',
  'world.prompt',
  'story.plan',
  'shot.plan',
  'edd.plan',
  'plan.evaluate'
);
create type private.evaluator_verdict as enum ('pass','block','indeterminate');

create table private.agent_tool_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  policy_version_id uuid not null,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  tool_name private.agent_tool_name not null,
  classification text not null check (classification = 'read_only'),
  trusted_scope_hash text not null check (trusted_scope_hash ~ '^[a-f0-9]{64}$'),
  arguments_hash text not null check (arguments_hash ~ '^[a-f0-9]{64}$'),
  result_hash text check (result_hash is null or result_hash ~ '^[a-f0-9]{64}$'),
  source_set_hash text not null check (source_set_hash ~ '^[a-f0-9]{64}$'),
  schema_version text not null check (schema_version = 'genie.restricted-tools.v1'),
  maximum_fan_out integer not null check (maximum_fan_out between 1 and 32),
  maximum_depth integer not null check (maximum_depth between 1 and 4),
  maximum_tokens integer not null check (maximum_tokens between 1 and 32768),
  maximum_duration_ms integer not null check (maximum_duration_ms between 1 and 30000),
  maximum_result_bytes integer not null check (
    maximum_result_bytes between 1 and 131072
  ),
  maximum_cost_minor bigint not null check (maximum_cost_minor = 0),
  model_family text not null check (
    model_family ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,100}$'
  ),
  model_version text not null check (char_length(model_version) between 1 and 160),
  prompt_hash text not null check (prompt_hash ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('authorized','succeeded','rejected')),
  safe_result_summary jsonb not null default '{}'::jsonb check (
    jsonb_typeof(safe_result_summary) = 'object'
    and pg_column_size(safe_result_summary) <= 16384
  ),
  created_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id, id)
    on delete restrict,
  foreign key (workspace_id, episode_id, script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict,
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict,
  check (
    (status = 'authorized' and completed_at is null and result_hash is null)
    or (status = 'succeeded' and completed_at is not null and result_hash is not null)
    or (status = 'rejected' and completed_at is not null)
  )
);

create index agent_tool_calls_attempt_idx
  on private.agent_tool_calls (stage_attempt_id, created_at);
create index agent_tool_calls_scope_idx
  on private.agent_tool_calls (
    workspace_id, episode_id, configuration_candidate_id, script_revision_id
  );

create table private.evaluator_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  evaluator_key text not null check (
    evaluator_key ~ '^[a-z][a-z0-9_.-]{2,100}$'
  ),
  evaluator_deployment_family text not null check (
    evaluator_deployment_family ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,100}$'
  ),
  schema_version text not null check (schema_version = 'genie.plan-evaluator.v1'),
  model_version text not null check (char_length(model_version) between 1 and 160),
  prompt_hash text not null check (prompt_hash ~ '^[a-f0-9]{64}$'),
  input_manifest_hash text not null check (input_manifest_hash ~ '^[a-f0-9]{64}$'),
  plan_hash text not null check (plan_hash ~ '^[a-f0-9]{64}$'),
  policy_hash text not null check (policy_hash ~ '^[a-f0-9]{64}$'),
  rubric_hash text not null check (rubric_hash ~ '^[a-f0-9]{64}$'),
  score integer not null check (score between 0 and 100),
  verdict private.evaluator_verdict not null,
  findings jsonb not null check (
    jsonb_typeof(findings) = 'array'
    and jsonb_array_length(findings) <= 64
    and pg_column_size(findings) <= 131072
  ),
  output_hash text not null check (output_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, id),
  unique (stage_attempt_id, evaluator_key, output_hash),
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict
);

create index evaluator_records_preflight_idx
  on private.evaluator_records (preflight_run_id, verdict, created_at);

create table private.agent_injection_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  source_class text not null check (source_class in (
    'script','upload_ocr','research_text','provider_output','provider_error','model_text'
  )),
  source_content_hash text not null check (source_content_hash ~ '^[a-f0-9]{64}$'),
  finding_code text not null check (finding_code ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  disposition text not null check (disposition in ('quoted_data','rejected','quarantined')),
  created_at timestamptz not null default statement_timestamp(),
  unique (stage_attempt_id, source_class, source_content_hash, finding_code),
  foreign key (workspace_id, preflight_run_id, stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id, preflight_run_id, id)
    on delete restrict
);

create trigger agent_tool_calls_immutable
before update or delete on private.agent_tool_calls
for each row execute function private.reject_mutation();
create trigger evaluator_records_immutable
before update or delete on private.evaluator_records
for each row execute function private.reject_mutation();
create trigger agent_injection_findings_immutable
before update or delete on private.agent_injection_findings
for each row execute function private.reject_mutation();

create or replace function public.command_record_agent_tool_call(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_configuration_candidate_id uuid,
  p_script_revision_id uuid,
  p_policy_version_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_tool_name text,
  p_trusted_scope_hash text,
  p_arguments_hash text,
  p_source_set_hash text,
  p_maximum_fan_out integer,
  p_maximum_depth integer,
  p_maximum_tokens integer,
  p_model_family text,
  p_model_version text,
  p_prompt_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  call_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_tool_name not in (
    'source.extract','cultural.triage','world.prompt','story.plan','shot.plan',
    'edd.plan','plan.evaluate'
  ) or p_trusted_scope_hash !~ '^[a-f0-9]{64}$'
    or p_arguments_hash !~ '^[a-f0-9]{64}$'
    or p_source_set_hash !~ '^[a-f0-9]{64}$'
    or p_prompt_hash !~ '^[a-f0-9]{64}$'
  then
    raise exception 'restricted tool envelope is invalid' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.preflight_stage_attempts a
    join public.preflight_runs r on r.id = a.preflight_run_id
    where a.workspace_id = p_workspace_id
      and a.preflight_run_id = p_preflight_run_id
      and a.id = p_stage_attempt_id
      and a.state in ('running','waiting_external','waiting_decision')
      and r.episode_id = p_episode_id
      and r.configuration_candidate_id = p_configuration_candidate_id
      and r.script_revision_id = p_script_revision_id
      and r.authority_epoch = a.authority_epoch
      and r.state in ('running','waiting_external','waiting_decision')
  ) then
    raise exception 'restricted tool scope is stale' using errcode = '40001';
  end if;
  insert into private.agent_tool_calls (
    workspace_id, episode_id, configuration_candidate_id, script_revision_id,
    policy_version_id, preflight_run_id, stage_attempt_id, tool_name,
    classification, trusted_scope_hash, arguments_hash, source_set_hash,
    schema_version, maximum_fan_out, maximum_depth, maximum_tokens,
    maximum_duration_ms, maximum_result_bytes, maximum_cost_minor,
    model_family, model_version, prompt_hash, status
  ) values (
    p_workspace_id, p_episode_id, p_configuration_candidate_id,
    p_script_revision_id, p_policy_version_id, p_preflight_run_id,
    p_stage_attempt_id, p_tool_name::private.agent_tool_name, 'read_only',
    p_trusted_scope_hash, p_arguments_hash, p_source_set_hash,
    'genie.restricted-tools.v1', p_maximum_fan_out, p_maximum_depth,
    p_maximum_tokens, 30000, 131072, 0, p_model_family, p_model_version,
    p_prompt_hash, 'authorized'
  ) returning id into call_id;
  return call_id;
end;
$$;

create or replace function public.command_complete_agent_tool_call(
  p_tool_call_id uuid,
  p_arguments_hash text,
  p_result_hash text,
  p_safe_result_summary jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior private.agent_tool_calls%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_result_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_safe_result_summary) <> 'object'
    or pg_column_size(p_safe_result_summary) > 16384
  then
    raise exception 'restricted tool result is invalid' using errcode = '22023';
  end if;
  select * into prior from private.agent_tool_calls
  where id = p_tool_call_id and status = 'authorized';
  if not found or prior.arguments_hash <> p_arguments_hash then
    raise exception 'restricted tool result is stale' using errcode = '40001';
  end if;
  -- Immutable call evidence is completed by inserting a successor record. The
  -- authorized row remains proof of exactly what authority existed.
  insert into private.agent_tool_calls (
    workspace_id, episode_id, configuration_candidate_id, script_revision_id,
    policy_version_id, preflight_run_id, stage_attempt_id, tool_name,
    classification, trusted_scope_hash, arguments_hash, result_hash,
    source_set_hash, schema_version, maximum_fan_out, maximum_depth,
    maximum_tokens, maximum_duration_ms, maximum_result_bytes,
    maximum_cost_minor, model_family, model_version, prompt_hash, status,
    safe_result_summary, completed_at
  ) select
    workspace_id, episode_id, configuration_candidate_id, script_revision_id,
    policy_version_id, preflight_run_id, stage_attempt_id, tool_name,
    classification, trusted_scope_hash, arguments_hash, p_result_hash,
    source_set_hash, schema_version, maximum_fan_out, maximum_depth,
    maximum_tokens, maximum_duration_ms, maximum_result_bytes,
    maximum_cost_minor, model_family, model_version, prompt_hash, 'succeeded',
    p_safe_result_summary, statement_timestamp()
  from private.agent_tool_calls where id = p_tool_call_id;
  return true;
end;
$$;

create or replace function public.command_record_evaluator_record(
  p_workspace_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_evaluator_key text,
  p_evaluator_deployment_family text,
  p_model_version text,
  p_prompt_hash text,
  p_input_manifest_hash text,
  p_plan_hash text,
  p_policy_hash text,
  p_rubric_hash text,
  p_score integer,
  p_verdict text,
  p_findings jsonb,
  p_output_hash text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_id uuid;
  has_blocker boolean;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_evaluator_key !~ '^[a-z][a-z0-9_.-]{2,100}$'
    or p_prompt_hash !~ '^[a-f0-9]{64}$'
    or p_input_manifest_hash !~ '^[a-f0-9]{64}$'
    or p_plan_hash !~ '^[a-f0-9]{64}$'
    or p_policy_hash !~ '^[a-f0-9]{64}$'
    or p_rubric_hash !~ '^[a-f0-9]{64}$'
    or p_output_hash !~ '^[a-f0-9]{64}$'
    or p_verdict not in ('pass','block','indeterminate')
    or p_score not between 0 and 100
    or jsonb_typeof(p_findings) <> 'array'
    or jsonb_array_length(p_findings) > 64
    or pg_column_size(p_findings) > 131072
  then
    raise exception 'evaluator record is invalid' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_findings) finding
    where jsonb_typeof(finding) <> 'object'
      or (finding - array['code','evidenceVersionId','reason','severity']::text[])
        <> '{}'::jsonb
      or not (finding ?& array['code','evidenceVersionId','reason','severity'])
      or finding ->> 'code' !~ '^[A-Z][A-Z0-9_]{2,63}$'
      or finding ->> 'evidenceVersionId' !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or char_length(btrim(finding ->> 'reason')) not between 1 and 2000
      or finding ->> 'severity' not in ('info','warning','blocker')
  ) then
    raise exception 'evaluator findings are invalid' using errcode = '22023';
  end if;
  select exists (
    select 1 from jsonb_array_elements(p_findings) finding
    where finding ->> 'severity' = 'blocker'
  ) into has_blocker;
  if (p_verdict = 'pass' and has_blocker)
    or (p_verdict = 'block' and not has_blocker)
  then
    raise exception 'evaluator verdict contradicts findings' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.preflight_stage_attempts a
    join public.preflight_stage_runs s on s.id = a.preflight_stage_run_id
    join public.preflight_runs r on r.id = a.preflight_run_id
    where a.workspace_id = p_workspace_id
      and a.preflight_run_id = p_preflight_run_id
      and a.id = p_stage_attempt_id
      and a.input_manifest_hash = p_input_manifest_hash
      and s.highest_fencing_token = a.fencing_token
      and r.authority_epoch = a.authority_epoch
      and r.state in ('running','waiting_external','waiting_decision')
  ) then
    raise exception 'evaluator authority is stale' using errcode = '40001';
  end if;
  insert into private.evaluator_records (
    workspace_id, preflight_run_id, stage_attempt_id, evaluator_key,
    evaluator_deployment_family, schema_version, model_version, prompt_hash,
    input_manifest_hash, plan_hash, policy_hash, rubric_hash, score, verdict,
    findings, output_hash
  ) values (
    p_workspace_id, p_preflight_run_id, p_stage_attempt_id, p_evaluator_key,
    p_evaluator_deployment_family, 'genie.plan-evaluator.v1', p_model_version,
    p_prompt_hash, p_input_manifest_hash, p_plan_hash, p_policy_hash,
    p_rubric_hash, p_score, p_verdict::private.evaluator_verdict,
    p_findings, p_output_hash
  ) returning id into record_id;
  return record_id;
end;
$$;

create or replace function public.command_record_agent_injection_finding(
  p_workspace_id uuid,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_source_class text,
  p_source_content_hash text,
  p_finding_code text,
  p_disposition text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare finding_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  insert into private.agent_injection_findings (
    workspace_id, preflight_run_id, stage_attempt_id, source_class,
    source_content_hash, finding_code, disposition
  ) values (
    p_workspace_id, p_preflight_run_id, p_stage_attempt_id, p_source_class,
    p_source_content_hash, p_finding_code, p_disposition
  ) returning id into finding_id;
  return finding_id;
end;
$$;

create or replace function private.guard_preflight_evaluator_success()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state = 'succeeded' and old.state is distinct from 'succeeded'
    and new.kind = 'plan_evaluation'
    and exists (
      select 1 from public.preflight_stage_runs s
      where s.preflight_run_id = new.id and s.required
        and not exists (
          select 1
          from public.preflight_stage_attempts a
          join private.evaluator_records e on e.stage_attempt_id = a.id
          where a.preflight_stage_run_id = s.id
            and a.state = 'succeeded'
            and e.verdict = 'pass'
            and not exists (
              select 1 from jsonb_array_elements(e.findings) f
              where f ->> 'severity' = 'blocker'
            )
        )
    )
  then
    raise exception 'passing evaluator evidence is incomplete' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger preflight_evaluator_success_guard
before update of state on public.preflight_runs
for each row execute function private.guard_preflight_evaluator_success();

revoke all on table private.agent_tool_calls, private.evaluator_records,
  private.agent_injection_findings from public, anon, authenticated;
revoke all on function public.command_record_agent_tool_call(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,
  text,text,text
), public.command_complete_agent_tool_call(uuid,text,text,jsonb),
  public.command_record_evaluator_record(
    uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,text,jsonb,text
  ), public.command_record_agent_injection_finding(uuid,uuid,uuid,text,text,text,text)
from public, anon, authenticated;
grant execute on function public.command_record_agent_tool_call(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,integer,integer,integer,
  text,text,text
), public.command_complete_agent_tool_call(uuid,text,text,jsonb),
  public.command_record_evaluator_record(
    uuid,uuid,uuid,text,text,text,text,text,text,text,text,integer,text,jsonb,text
  ), public.command_record_agent_injection_finding(uuid,uuid,uuid,text,text,text,text)
to service_role;
revoke all on function private.guard_preflight_evaluator_success()
from public, anon, authenticated;

-- Phase 2 script-rubric foundation: exact source binding, deterministic
-- advisory verdicts, and a planning precondition without script mutation.

create table public.script_rubric_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null,
  script_revision_id uuid not null,
  run_number integer not null check (run_number > 0),
  command_id uuid not null unique,
  schema_version text not null check (
    schema_version = 'genie.script-rubric-run.v1'
  ),
  applicability_profile text not null check (
    applicability_profile = 'genie.narration-hi.launch.v1'
  ),
  source_rubric_version text not null check (source_rubric_version = '1.0.0'),
  source_rubric_sha256 text not null check (
    source_rubric_sha256 =
      '714fef20f2151ee63bce3307267f531485f3f3c29215bb8a5fa552ee9dd165b4'
  ),
  script_sha256_before text not null check (script_sha256_before ~ '^[a-f0-9]{64}$'),
  script_sha256_after text not null check (script_sha256_after ~ '^[a-f0-9]{64}$'),
  context_json jsonb not null check (
    jsonb_typeof(context_json) = 'object'
    and pg_column_size(context_json) <= 16384
  ),
  evaluator_runs jsonb not null check (
    jsonb_typeof(evaluator_runs) = 'array'
    and jsonb_array_length(evaluator_runs) between 1 and 3
    and pg_column_size(evaluator_runs) <= 131072
  ),
  parameter_results jsonb not null check (
    jsonb_typeof(parameter_results) = 'array'
    and jsonb_array_length(parameter_results) = 12
    and pg_column_size(parameter_results) <= 262144
  ),
  composites jsonb not null check (
    jsonb_typeof(composites) = 'object'
    and pg_column_size(composites) <= 16384
  ),
  confidence integer not null check (confidence between 0 and 100),
  gates jsonb not null check (
    jsonb_typeof(gates) = 'array'
    and jsonb_array_length(gates) <= 6
    and pg_column_size(gates) <= 32768
  ),
  priority_items jsonb not null check (
    jsonb_typeof(priority_items) = 'array'
    and jsonb_array_length(priority_items) <= 12
    and pg_column_size(priority_items) <= 32768
  ),
  verdict jsonb not null check (
    jsonb_typeof(verdict) = 'object'
    and pg_column_size(verdict) <= 4096
  ),
  advisory_only boolean not null default true check (advisory_only),
  requires_compensating_plan boolean not null,
  result_hash text not null check (result_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id, episode_id, script_revision_id, id),
  unique (script_revision_id, run_number),
  unique (script_revision_id, source_rubric_sha256, result_hash),
  foreign key (workspace_id, episode_id)
    references public.episodes(workspace_id, id) on delete restrict,
  foreign key (workspace_id, episode_id, script_revision_id)
    references public.script_revisions(workspace_id, episode_id, id)
    on delete restrict,
  constraint script_rubric_runs_source_unchanged_ck check (
    script_sha256_before = script_sha256_after
  )
);

create index script_rubric_runs_workspace_episode_idx
  on public.script_rubric_runs (workspace_id, episode_id, created_at desc);

create trigger script_rubric_runs_immutable
before update or delete on public.script_rubric_runs
for each row execute function private.reject_mutation();

alter table public.script_rubric_runs enable row level security;
alter table public.script_rubric_runs force row level security;

create policy script_rubric_runs_read_active_workspace
on public.script_rubric_runs for select
to authenticated
using (private.is_current_session_allowed(workspace_id));

revoke all on table public.script_rubric_runs from public, anon, authenticated;
grant select on table public.script_rubric_runs to authenticated;

create or replace function private.validate_script_rubric_payload_v1(
  p_evaluator_runs jsonb,
  p_parameter_results jsonb,
  p_composites jsonb,
  p_gates jsonb,
  p_priority_items jsonb,
  p_verdict jsonb
)
returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  required_ids constant text[] := array[
    'opening_hook','protagonist_clarity','conflict_stakes','structure_pacing',
    'twist_reveal','cliffhanger_pull','dialogue_economy',
    'relationship_legibility','series_continuity','genre_freshness',
    'localization_fit','monetization_compliance'
  ];
begin
  if jsonb_typeof(p_evaluator_runs) <> 'array'
    or jsonb_array_length(p_evaluator_runs) not between 1 and 3
    or exists (
      select 1 from jsonb_array_elements(p_evaluator_runs) item
      where jsonb_typeof(item) <> 'object'
        or not item ?& array[
          'evaluatorConfigurationId','evaluatorRunId','modelFamily',
          'promptSha256','promptVersion'
        ]
        or (item - array[
          'evaluatorConfigurationId','evaluatorRunId','modelFamily',
          'promptSha256','promptVersion'
        ]::text[]) <> '{}'::jsonb
        or item ->> 'evaluatorRunId' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or item ->> 'evaluatorConfigurationId' !~
          '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
        or item ->> 'modelFamily' !~
          '^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$'
        or item ->> 'promptSha256' !~ '^[a-f0-9]{64}$'
        or item ->> 'promptVersion' !~
          '^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$'
    )
    or (
      select count(distinct concat(
        item ->> 'modelFamily', ':', item ->> 'evaluatorConfigurationId'
      ))
      from jsonb_array_elements(p_evaluator_runs) item
    ) <> jsonb_array_length(p_evaluator_runs)
  then
    raise exception 'script rubric evaluator runs are invalid'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_parameter_results) <> 'array'
    or jsonb_array_length(p_parameter_results) <> 12
    or (
      select count(distinct item ->> 'parameterId')
      from jsonb_array_elements(p_parameter_results) item
    ) <> 12
    or exists (
      select 1 from jsonb_array_elements(p_parameter_results) item
      where jsonb_typeof(item) <> 'object'
        or not item ?& array[
          'applicability','consensusScore','evidence',
          'notApplicableReason','parameterId','spread'
        ]
        or (item - array[
          'applicability','consensusScore','evidence',
          'notApplicableReason','parameterId','spread'
        ]::text[]) <> '{}'::jsonb
        or not (item ->> 'parameterId' = any(required_ids))
        or item ->> 'applicability' not in ('applicable','not_applicable')
        or jsonb_typeof(item -> 'evidence') <> 'array'
        or jsonb_typeof(item -> 'spread') <> 'number'
        or (item ->> 'spread')::integer not between 0 and 9
        or (
          item ->> 'applicability' = 'applicable'
          and (
            jsonb_typeof(item -> 'consensusScore') <> 'number'
            or (item ->> 'consensusScore')::integer not between 1 and 10
            or jsonb_array_length(item -> 'evidence') < 1
            or item -> 'notApplicableReason' <> 'null'::jsonb
          )
        )
        or (
          item ->> 'applicability' = 'not_applicable'
          and (
            item -> 'consensusScore' <> 'null'::jsonb
            or jsonb_array_length(item -> 'evidence') <> 0
            or jsonb_typeof(item -> 'notApplicableReason') <> 'string'
          )
        )
    )
  then
    raise exception 'script rubric parameter results are invalid'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_composites) <> 'object'
    or not p_composites ?& array[
      'commercialPull','commercialPullDisplay','commercialPullProjectedDenominator',
      'craftQuality','craftQualityDisplay','craftQualityProjectedDenominator',
      'overall','overallDisplay','risk','riskDisplay'
    ]
    or (p_composites - array[
      'commercialPull','commercialPullDisplay','commercialPullProjectedDenominator',
      'craftQuality','craftQualityDisplay','craftQualityProjectedDenominator',
      'overall','overallDisplay','risk','riskDisplay'
    ]::text[]) <> '{}'::jsonb
    or exists (
      select 1 from jsonb_each_text(p_composites) pair
      where pair.value !~ '^-?[0-9]+(\.[0-9]+)?$'
    )
    or jsonb_typeof(p_gates) <> 'array'
    or exists (
      select 1 from jsonb_array_elements(p_gates) gate
      where gate ->> 'effect' <> 'advisory'
    )
    or jsonb_typeof(p_priority_items) <> 'array'
    or jsonb_typeof(p_verdict) <> 'object'
    or not p_verdict ?& array['displayLabel','internalLabel']
    or (p_verdict - array['displayLabel','internalLabel']::text[]) <> '{}'::jsonb
    or p_verdict ->> 'internalLabel' not in (
      'greenlight','greenlight_minor_fixes','rewrite_lightly',
      'rewrite_heavily','rebreak','reject'
    )
  then
    raise exception 'script rubric deterministic result is invalid'
      using errcode = '22023';
  end if;
end;
$$;

create or replace function public.command_record_script_rubric_run(
  p_workspace_id uuid,
  p_episode_id uuid,
  p_script_revision_id uuid,
  p_command_id uuid,
  p_script_sha256 text,
  p_context_json jsonb,
  p_evaluator_runs jsonb,
  p_parameter_results jsonb,
  p_composites jsonb,
  p_confidence integer,
  p_gates jsonb,
  p_priority_items jsonb,
  p_verdict jsonb,
  p_requires_compensating_plan boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  revision public.script_revisions%rowtype;
  existing public.script_rubric_runs%rowtype;
  run_id uuid;
  next_run_number integer;
  computed_result_hash text;
  canonical jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;
  if p_script_sha256 !~ '^[a-f0-9]{64}$'
    or p_confidence not between 0 and 100
    or jsonb_typeof(p_context_json) <> 'object'
  then
    raise exception 'invalid script rubric command envelope' using errcode = '22023';
  end if;

  perform private.validate_script_rubric_payload_v1(
    p_evaluator_runs, p_parameter_results, p_composites, p_gates,
    p_priority_items, p_verdict
  );

  select * into revision
  from public.script_revisions
  where workspace_id = p_workspace_id
    and episode_id = p_episode_id
    and id = p_script_revision_id
  for share;
  if not found or revision.raw_utf8_sha256 <> p_script_sha256 then
    raise exception 'script rubric source binding is stale'
      using errcode = '40001';
  end if;

  canonical := jsonb_build_object(
    'schemaVersion','genie.script-rubric-run.v1',
    'profile','genie.narration-hi.launch.v1',
    'sourceConfigVersion','1.0.0',
    'sourceConfigSha256',
      '714fef20f2151ee63bce3307267f531485f3f3c29215bb8a5fa552ee9dd165b4',
    'scriptSha256',p_script_sha256,
    'context',p_context_json,
    'evaluatorRuns',p_evaluator_runs,
    'parameterResults',p_parameter_results,
    'composites',p_composites,
    'confidence',p_confidence,
    'gates',p_gates,
    'priority',p_priority_items,
    'verdict',p_verdict,
    'effect','advisory',
    'advisoryOnly',true,
    'requiresCompensatingPlan',p_requires_compensating_plan
  );
  computed_result_hash := encode(
    extensions.digest(convert_to(canonical::text, 'UTF8'), 'sha256'),
    'hex'
  );

  select * into existing from public.script_rubric_runs
  where command_id = p_command_id;
  if found then
    if existing.result_hash <> computed_result_hash then
      raise exception 'script rubric command identity was reused'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'ok',true,'scriptRubricRunId',existing.id,'runNumber',existing.run_number,
      'resultHash',existing.result_hash,'advisoryOnly',true
    );
  end if;

  select * into existing from public.script_rubric_runs r
  where r.script_revision_id = p_script_revision_id
    and r.source_rubric_sha256 =
      '714fef20f2151ee63bce3307267f531485f3f3c29215bb8a5fa552ee9dd165b4'
    and r.result_hash = computed_result_hash;
  if found then
    return jsonb_build_object(
      'ok',true,'scriptRubricRunId',existing.id,'runNumber',existing.run_number,
      'resultHash',existing.result_hash,'advisoryOnly',true
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('script-rubric:' || p_script_revision_id::text, 0)
  );
  select coalesce(max(r.run_number), 0) + 1 into next_run_number
  from public.script_rubric_runs r
  where r.script_revision_id = p_script_revision_id;

  insert into public.script_rubric_runs (
    workspace_id, episode_id, script_revision_id, run_number, command_id,
    schema_version, applicability_profile, source_rubric_version,
    source_rubric_sha256, script_sha256_before, script_sha256_after,
    context_json, evaluator_runs, parameter_results, composites, confidence,
    gates, priority_items, verdict, advisory_only,
    requires_compensating_plan, result_hash
  ) values (
    p_workspace_id, p_episode_id, p_script_revision_id, next_run_number, p_command_id,
    'genie.script-rubric-run.v1','genie.narration-hi.launch.v1','1.0.0',
    '714fef20f2151ee63bce3307267f531485f3f3c29215bb8a5fa552ee9dd165b4',
    p_script_sha256,p_script_sha256,p_context_json,p_evaluator_runs,
    p_parameter_results,p_composites,p_confidence,p_gates,p_priority_items,
    p_verdict,true,p_requires_compensating_plan,computed_result_hash
  ) returning id into run_id;

  return jsonb_build_object(
    'ok',true,'scriptRubricRunId',run_id,'runNumber',next_run_number,
    'resultHash',computed_result_hash,'advisoryOnly',true
  );
end;
$$;

alter table public.preflight_runs
  add column script_rubric_run_id uuid;

alter table public.preflight_runs
  add constraint preflight_runs_script_rubric_run_fk
  foreign key (workspace_id, episode_id, script_revision_id, script_rubric_run_id)
  references public.script_rubric_runs(
    workspace_id, episode_id, script_revision_id, id
  ) on delete restrict;

create index preflight_runs_script_rubric_run_idx
  on public.preflight_runs (script_rubric_run_id)
  where script_rubric_run_id is not null;

create or replace function private.bind_plan_script_rubric_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'plan_evaluation' then return new; end if;
  if new.script_rubric_run_id is null then
    select r.id into new.script_rubric_run_id
    from public.script_rubric_runs r
    where r.workspace_id = new.workspace_id
      and r.episode_id = new.episode_id
      and r.script_revision_id = new.script_revision_id
      and r.advisory_only
    order by r.run_number desc
    limit 1;
  end if;
  if new.script_rubric_run_id is null then
    raise exception 'completed advisory script rubric is required before planning'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger preflight_runs_bind_script_rubric
before insert on public.preflight_runs
for each row execute function private.bind_plan_script_rubric_v1();

revoke all on function private.validate_script_rubric_payload_v1(
  jsonb,jsonb,jsonb,jsonb,jsonb,jsonb
), private.bind_plan_script_rubric_v1() from public, anon, authenticated;

revoke all on function public.command_record_script_rubric_run(
  uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb,jsonb,boolean
) from public, anon, authenticated;
grant execute on function public.command_record_script_rubric_run(
  uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,integer,jsonb,jsonb,jsonb,boolean
) to service_role;

-- Phase 2: replay-protected Trigger -> Vercel control-broker authority.
-- Trigger remains credential-free with respect to Supabase and all providers.

create table private.preflight_control_assertion_jtis (
  id uuid primary key,
  broker_client_id uuid not null references private.broker_clients(id) on delete restrict,
  broker_key_version_id uuid not null references private.broker_client_key_versions(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid,
  operation text not null check (operation in ('dispatch','execute','finalize','fail')),
  jti_hash text not null unique check (jti_hash ~ '^[a-f0-9]{64}$'),
  assertion_subject text not null check (char_length(assertion_subject) between 8 and 600),
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  foreign key (preflight_run_id) references public.preflight_runs(id) on delete restrict,
  foreign key (stage_attempt_id) references public.preflight_stage_attempts(id) on delete restrict,
  check (expires_at > issued_at and consumed_at <= expires_at + interval '5 seconds'),
  check ((operation in ('execute','fail')) = (stage_attempt_id is not null))
);

create table private.preflight_input_manifests (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  schema_version text not null check (schema_version = 'genie.preflight-input.v1'),
  manifest_json jsonb not null check (
    jsonb_typeof(manifest_json) = 'object' and pg_column_size(manifest_json) <= 131072
  ),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (preflight_run_id, manifest_hash),
  foreign key (workspace_id, preflight_run_id)
    references public.preflight_runs(workspace_id,id) on delete restrict
);

create table private.preflight_output_manifests (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  preflight_run_id uuid not null,
  stage_attempt_id uuid not null,
  schema_version text not null check (schema_version = 'genie.preflight-output.v1'),
  manifest_json jsonb not null check (
    jsonb_typeof(manifest_json) = 'object' and pg_column_size(manifest_json) <= 131072
  ),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (stage_attempt_id, manifest_hash),
  foreign key (workspace_id,preflight_run_id,stage_attempt_id)
    references public.preflight_stage_attempts(workspace_id,preflight_run_id,id)
    on delete restrict
);

create trigger preflight_control_assertions_immutable
before update or delete on private.preflight_control_assertion_jtis
for each row execute function private.reject_mutation();
create trigger preflight_input_manifests_immutable
before update or delete on private.preflight_input_manifests
for each row execute function private.reject_mutation();
create trigger preflight_output_manifests_immutable
before update or delete on private.preflight_output_manifests
for each row execute function private.reject_mutation();

create or replace function public.command_consume_preflight_control_assertion(
  p_assertion_jti uuid,
  p_assertion_subject text,
  p_assertion_issued_at timestamptz,
  p_assertion_expires_at timestamptz,
  p_client_id text,
  p_kid text,
  p_environment text,
  p_trigger_project text,
  p_preflight_run_id uuid,
  p_stage_attempt_id uuid,
  p_operation text
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  client private.broker_clients%rowtype;
  key private.broker_client_key_versions%rowtype;
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  if p_operation not in ('dispatch','execute','finalize','fail')
    or p_assertion_issued_at < statement_timestamp() - interval '65 seconds'
    or p_assertion_issued_at > statement_timestamp() + interval '5 seconds'
    or p_assertion_expires_at <= statement_timestamp() - interval '5 seconds'
    or p_assertion_expires_at > p_assertion_issued_at + interval '60 seconds'
    or char_length(p_assertion_subject) not between 8 and 600
  then raise exception 'control assertion envelope is invalid' using errcode='22023'; end if;

  select * into client from private.broker_clients
  where client_id=p_client_id and environment=p_environment
    and trigger_project=p_trigger_project and state='active'
  for share;
  if client.id is null then
    raise exception 'control broker client unavailable' using errcode='42501';
  end if;
  select * into key from private.broker_client_key_versions
  where broker_client_id=client.id and kid=p_kid and state='active'
    and statement_timestamp() between valid_from and valid_until
  for share;
  if key.id is null then
    raise exception 'control broker key unavailable' using errcode='42501';
  end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for share;
  if run.id is null or run.state in ('failed','canceled','superseded') then
    raise exception 'preflight control authority is stale' using errcode='40001';
  end if;

  if p_operation in ('execute','fail') then
    select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and preflight_run_id=run.id for share;
    if attempt.id is null
      or attempt.state not in ('claimed','running','waiting_external','waiting_decision')
      or attempt.authority_epoch<>run.authority_epoch
      or not exists (
        select 1 from public.preflight_stage_runs stage
        where stage.id=attempt.preflight_stage_run_id
          and stage.highest_fencing_token=attempt.fencing_token
      )
    then raise exception 'preflight stage authority is stale' using errcode='40001'; end if;
  elsif p_stage_attempt_id is not null then
    raise exception 'run control cannot carry stage authority' using errcode='22023';
  end if;

  insert into private.preflight_control_assertion_jtis(
    id,broker_client_id,broker_key_version_id,preflight_run_id,stage_attempt_id,
    operation,jti_hash,assertion_subject,issued_at,expires_at
  ) values(
    p_assertion_jti,client.id,key.id,run.id,p_stage_attempt_id,p_operation,
    encode(extensions.digest(convert_to(p_assertion_jti::text,'UTF8'),'sha256'),'hex'),
    p_assertion_subject,p_assertion_issued_at,p_assertion_expires_at
  );
  return true;
exception when unique_violation then
  raise exception 'control assertion replayed' using errcode='40001';
end;
$$;

create or replace function public.command_dispatch_preflight_control(
  p_preflight_run_id uuid,
  p_trigger_run_id text,
  p_lease_owner text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  run public.preflight_runs%rowtype;
  stage public.preflight_stage_runs%rowtype;
  input_id uuid:=gen_random_uuid();
  attempt_id uuid:=gen_random_uuid();
  lease_id uuid:=gen_random_uuid();
  manifest jsonb;
  manifest_hash text;
  fence bigint;
  attempt_number integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  if p_trigger_run_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
    or p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{2,199}$'
    or p_lease_seconds not between 30 and 900
  then raise exception 'invalid preflight dispatcher identity' using errcode='22023'; end if;

  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  if run.id is null then raise exception 'preflight run not found' using errcode='P0002'; end if;
  if run.state='running' and run.trigger_run_id=p_trigger_run_id then
    select * into stage from public.preflight_stage_runs
    where preflight_run_id=run.id and state in ('claimed','running')
    order by created_at limit 1;
    if stage.id is not null then
      select attempt.id into attempt_id from public.preflight_stage_attempts attempt
      where attempt.preflight_stage_run_id=stage.id
        and attempt.fencing_token=stage.highest_fencing_token;
      select lease.id into lease_id from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt_id and lease.state='active';
      return jsonb_build_object(
        'ok',true,'replayed',true,'workspaceId',run.workspace_id,
        'preflightRunId',run.id,'stageRunId',stage.id,'stageAttemptId',attempt_id,
        'leaseId',lease_id,'authorityEpoch',run.authority_epoch,
        'fencingToken',stage.highest_fencing_token,'inputManifestId',stage.input_manifest_id,
        'inputManifestSha256',stage.input_manifest_hash,'kind',run.kind
      );
    end if;
  end if;
  if run.state<>'queued' then
    raise exception 'preflight run is not queued' using errcode='40001';
  end if;
  select * into stage from public.preflight_stage_runs
    where preflight_run_id=run.id and required order by created_at limit 1 for update;
  if stage.id is null or stage.state<>'created' then
    raise exception 'preflight root stage is not dispatchable' using errcode='40001';
  end if;
  manifest:=jsonb_build_object(
    'schemaVersion','genie.preflight-input.v1','workspaceId',run.workspace_id,
    'episodeId',run.episode_id,'configurationCandidateId',run.configuration_candidate_id,
    'scriptRevisionId',run.script_revision_id,'preflightRunId',run.id,
    'kind',run.kind,'authorityEpoch',run.authority_epoch
  );
  manifest_hash:=encode(extensions.digest(convert_to(manifest::text,'UTF8'),'sha256'),'hex');
  insert into private.preflight_input_manifests(
    id,workspace_id,preflight_run_id,schema_version,manifest_json,manifest_hash
  ) values(input_id,run.workspace_id,run.id,'genie.preflight-input.v1',manifest,manifest_hash);

  update public.preflight_runs set state='running',trigger_run_id=p_trigger_run_id,
    aggregate_version=aggregate_version+1,started_at=statement_timestamp()
    where id=run.id returning * into run;
  fence:=stage.highest_fencing_token+1;
  attempt_number:=stage.next_attempt_no;
  insert into public.preflight_stage_attempts(
    id,workspace_id,preflight_run_id,preflight_stage_run_id,attempt_no,
    authority_epoch,fencing_token,input_manifest_id,input_manifest_hash,state
  ) values(attempt_id,run.workspace_id,run.id,stage.id,attempt_number,
    run.authority_epoch,fence,input_id,manifest_hash,'claimed');
  insert into public.preflight_stage_leases(
    id,workspace_id,preflight_run_id,stage_attempt_id,lease_owner,fencing_token,expires_at
  ) values(lease_id,run.workspace_id,run.id,attempt_id,p_lease_owner,fence,
    statement_timestamp()+make_interval(secs=>p_lease_seconds));
  update public.preflight_stage_runs set state='claimed',input_manifest_id=input_id,
    input_manifest_hash=manifest_hash,next_attempt_no=next_attempt_no+1,
    highest_fencing_token=fence,aggregate_version=aggregate_version+2
    where id=stage.id returning * into stage;
  return jsonb_build_object(
    'ok',true,'replayed',false,'workspaceId',run.workspace_id,
    'preflightRunId',run.id,'stageRunId',stage.id,'stageAttemptId',attempt_id,
    'leaseId',lease_id,'authorityEpoch',run.authority_epoch,'fencingToken',fence,
    'inputManifestId',input_id,'inputManifestSha256',manifest_hash,'kind',run.kind
  );
end;
$$;

create or replace function public.command_record_preflight_control_output(
  p_stage_attempt_id uuid,
  p_fencing_token bigint,
  p_authority_epoch bigint,
  p_input_manifest_hash text,
  p_trigger_task_id text,
  p_trigger_run_id text,
  p_output_manifest_id uuid,
  p_output_manifest jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  computed_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  computed_hash:=encode(extensions.digest(convert_to(p_output_manifest::text,'UTF8'),'sha256'),'hex');
  if p_output_manifest is null or jsonb_typeof(p_output_manifest)<>'object'
    or pg_column_size(p_output_manifest)>131072
  then raise exception 'preflight output manifest is invalid' using errcode='22023'; end if;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id for update;
  select * into stage from public.preflight_stage_runs
    where id=attempt.preflight_stage_run_id for update;
  if attempt.id is null or stage.id is null or attempt.state<>'claimed'
    or attempt.fencing_token<>p_fencing_token or stage.highest_fencing_token<>p_fencing_token
    or attempt.authority_epoch<>p_authority_epoch
    or attempt.input_manifest_hash<>p_input_manifest_hash
    or not exists(select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=p_fencing_token and lease.expires_at>statement_timestamp())
  then raise exception 'preflight output lost authority' using errcode='40001'; end if;
  update public.preflight_stage_attempts set state='running',trigger_task_id=p_trigger_task_id,
    trigger_run_id=p_trigger_run_id,started_at=statement_timestamp()
    where id=attempt.id;
  insert into private.preflight_output_manifests(
    id,workspace_id,preflight_run_id,stage_attempt_id,schema_version,manifest_json,manifest_hash
  ) values(p_output_manifest_id,attempt.workspace_id,attempt.preflight_run_id,attempt.id,
    'genie.preflight-output.v1',p_output_manifest,computed_hash);
  update public.preflight_stage_attempts set state='succeeded',output_manifest_id=p_output_manifest_id,
    output_manifest_hash=computed_hash,completed_at=statement_timestamp()
    where id=attempt.id;
  update public.preflight_stage_leases set state='consumed',closed_at=statement_timestamp()
    where stage_attempt_id=attempt.id and state='active';
  update public.preflight_stage_runs set state='succeeded',output_manifest_id=p_output_manifest_id,
    output_manifest_hash=computed_hash,aggregate_version=aggregate_version+2,
    completed_at=statement_timestamp() where id=stage.id;
  return jsonb_build_object('ok',true,'stageAttemptId',attempt.id,
    'stageRunId',stage.id,'state','succeeded');
end;
$$;

create or replace function public.command_finalize_preflight_control(
  p_preflight_run_id uuid,
  p_trigger_run_id text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare run public.preflight_runs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  if run.state='succeeded' and run.trigger_run_id=p_trigger_run_id then
    return jsonb_build_object('ok',true,'replayed',true,'state',run.state,
      'preflightRunId',run.id,'aggregateVersion',run.aggregate_version);
  end if;
  if run.id is null or run.state<>'running' or run.trigger_run_id<>p_trigger_run_id
    or exists(select 1 from public.preflight_stage_runs stage
      where stage.preflight_run_id=run.id and stage.required and stage.state<>'succeeded')
  then raise exception 'preflight run cannot be finalized' using errcode='40001'; end if;
  update public.preflight_runs set state='succeeded',aggregate_version=aggregate_version+1,
    completed_at=statement_timestamp(),reconciliation_due_at=null
    where id=run.id returning * into run;
  return jsonb_build_object('ok',true,'replayed',false,'state',run.state,
    'preflightRunId',run.id,'aggregateVersion',run.aggregate_version);
end;
$$;

revoke all on table private.preflight_control_assertion_jtis,
  private.preflight_input_manifests,private.preflight_output_manifests
  from public,anon,authenticated;
revoke all on function public.command_consume_preflight_control_assertion(
  uuid,text,timestamptz,timestamptz,text,text,text,text,uuid,uuid,text
), public.command_dispatch_preflight_control(uuid,text,text,integer),
  public.command_record_preflight_control_output(uuid,bigint,bigint,text,text,text,uuid,jsonb),
  public.command_finalize_preflight_control(uuid,text)
  from public,anon,authenticated;
grant execute on function public.command_consume_preflight_control_assertion(
  uuid,text,timestamptz,timestamptz,text,text,text,text,uuid,uuid,text
), public.command_dispatch_preflight_control(uuid,text,text,integer),
  public.command_record_preflight_control_output(uuid,bigint,bigint,text,text,text,uuid,jsonb),
  public.command_finalize_preflight_control(uuid,text)
  to service_role;

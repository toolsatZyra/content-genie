-- Developer-MVP World progress, significant prop anchors, and bounded AAL1
-- authority for the exact USD 5.00 pre-lock pass: USD 3.84 World anchors plus
-- USD 1.16 narration/ASR/judge. World Lock and every higher-consequence
-- authority remain AAL2-only.

alter table private.world_build_spend_intents
  drop constraint if exists world_build_spend_intents_aal_check;
alter table private.world_build_spend_intents
  add constraint world_build_spend_intents_aal_check
  check (aal in ('aal1','aal2'));

alter table private.micro_authorizations
  drop constraint if exists micro_authorizations_aal_check;
alter table private.micro_authorizations
  add constraint micro_authorizations_aal_check
  check (aal in ('aal1','aal2'));

create or replace function public.command_authorize_world_build_intent(
  p_workspace_id uuid,p_episode_id uuid,p_configuration_candidate_id uuid,
  p_expected_configuration_version bigint,p_hard_ceiling_minor bigint,
  p_command_id uuid,p_idempotency_key text,p_request_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor_id uuid:=auth.uid(); actor_epoch bigint;
  actor_aal text:=coalesce(auth.jwt()->>'aal','aal1');
  candidate public.episode_configuration_candidates%rowtype;
  intent private.world_build_spend_intents%rowtype;
begin
  if actor_id is null then
    raise exception 'authentication required' using errcode='42501';
  end if;
  perform private.assert_active_session(p_workspace_id);
  if actor_aal not in ('aal1','aal2') then actor_aal:='aal1'; end if;
  select authority_epoch into actor_epoch from public.memberships
    where workspace_id=p_workspace_id and user_id=actor_id and status='active';
  if actor_epoch is null then
    raise exception 'active membership required' using errcode='42501';
  end if;
  if p_hard_ceiling_minor<>500 or p_request_hash !~ '^[a-f0-9]{64}$'
    or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
  then
    raise exception 'world build intent envelope is invalid' using errcode='22023';
  end if;
  select * into intent from private.world_build_spend_intents
    where workspace_id=p_workspace_id and authorized_by=actor_id
      and idempotency_key=p_idempotency_key;
  if found then
    if intent.request_hash<>p_request_hash then
      raise exception 'world build intent idempotency conflict' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,'intentId',intent.id,
      'hardCeilingMinor',intent.hard_ceiling_minor,
      'worldCeilingMinor',intent.world_ceiling_minor,
      'narrationCeilingMinor',intent.narration_ceiling_minor,
      'expiresAt',intent.expires_at);
  end if;
  select * into candidate from public.episode_configuration_candidates
    where id=p_configuration_candidate_id and workspace_id=p_workspace_id
      and episode_id=p_episode_id for update;
  if candidate.id is null
    or candidate.aggregate_version<>p_expected_configuration_version
    or candidate.state<>'world_design'
    or candidate.voice_confirmed_at is null
    or candidate.look_confirmed_at is null
  then
    raise exception 'world build configuration is stale' using errcode='40001';
  end if;
  update private.world_build_spend_intents set state='expired'
    where configuration_candidate_id=candidate.id and state='active'
      and expires_at<=statement_timestamp();
  insert into private.world_build_spend_intents(
    workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    look_version_id,authorized_by,actor_authority_epoch,aal,hard_ceiling_minor,
    world_ceiling_minor,narration_ceiling_minor,command_id,idempotency_key,
    request_hash,expires_at
  ) values(
    p_workspace_id,p_episode_id,candidate.id,candidate.script_revision_id,
    candidate.look_version_id,actor_id,actor_epoch,actor_aal,500,384,116,
    p_command_id,p_idempotency_key,p_request_hash,
    statement_timestamp()+interval '24 hours'
  ) returning * into intent;
  return jsonb_build_object('ok',true,'replayed',false,'intentId',intent.id,
    'hardCeilingMinor',intent.hard_ceiling_minor,
    'worldCeilingMinor',intent.world_ceiling_minor,
    'narrationCeilingMinor',intent.narration_ceiling_minor,
    'expiresAt',intent.expires_at);
end;
$$;

create or replace function private.bind_world_preparation_authorization_aal()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update private.micro_authorizations authz
  set aal=intent.aal
  from private.world_build_spend_intents intent
  where authz.id=new.micro_authorization_id
    and intent.id=new.spend_intent_id
    and authz.workspace_id=new.workspace_id
    and authz.configuration_candidate_id=intent.configuration_candidate_id
    and authz.script_revision_id=intent.script_revision_id
    and authz.authorized_by=intent.authorized_by
    and authz.actor_authority_epoch=intent.actor_authority_epoch;
  if not found then
    raise exception 'world authorization intent binding is invalid' using errcode='40001';
  end if;
  return new;
end;
$$;

drop trigger if exists bind_world_micro_authorization_aal
  on private.micro_authorizations;
drop trigger if exists bind_world_preparation_authorization_aal
  on private.world_anchor_preparations;
create trigger bind_world_preparation_authorization_aal
after insert on private.world_anchor_preparations
for each row execute function private.bind_world_preparation_authorization_aal();

create or replace function private.bind_narration_preparation_authorization_aal()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  update private.micro_authorizations authz
  set aal=intent.aal
  from private.micro_quote_lines line
  join private.micro_quotes quote on quote.id=line.micro_quote_id
  join private.world_build_spend_intents intent on intent.id=new.spend_intent_id
  where line.id=new.micro_quote_line_id
    and authz.micro_quote_id=quote.id
    and authz.workspace_id=new.workspace_id
    and authz.configuration_candidate_id=intent.configuration_candidate_id
    and authz.script_revision_id=intent.script_revision_id
    and authz.authorized_by=intent.authorized_by
    and authz.actor_authority_epoch=intent.actor_authority_epoch;
  if not found then
    raise exception 'narration authorization intent binding is invalid' using errcode='40001';
  end if;
  return new;
end;
$$;

drop trigger if exists bind_narration_preparation_authorization_aal
  on private.narration_generation_jobs;
create trigger bind_narration_preparation_authorization_aal
after insert on private.narration_generation_jobs
for each row execute function private.bind_narration_preparation_authorization_aal();

alter table private.world_extraction_results
  drop constraint if exists world_extraction_results_schema_version_check;
alter table private.world_extraction_results
  add constraint world_extraction_results_schema_version_check
  check (schema_version in ('genie.world-extraction.v1','genie.world-extraction.v2'));
alter table private.world_extraction_results
  drop constraint if exists world_extraction_results_extraction_json_check;
alter table private.world_extraction_results
  add constraint world_extraction_results_extraction_json_check check (
    jsonb_typeof(extraction_json)='object'
    and pg_column_size(extraction_json)<=131072
    and extraction_json->>'schemaVersion' in (
      'genie.world-extraction.v1','genie.world-extraction.v2'
    )
    and jsonb_typeof(extraction_json->'characters')='array'
    and jsonb_array_length(extraction_json->'characters') between 1 and 16
    and jsonb_typeof(extraction_json->'locations')='array'
    and jsonb_array_length(extraction_json->'locations') between 1 and 12
    and (
      extraction_json->>'schemaVersion'='genie.world-extraction.v1'
      or (
        jsonb_typeof(extraction_json->'props')='array'
        and jsonb_array_length(extraction_json->'props') between 0 and 12
      )
    )
  );

create or replace function public.command_record_world_extraction_result(
  p_result_id uuid,
  p_stage_attempt_id uuid,
  p_authority_epoch bigint,
  p_fencing_token bigint,
  p_input_manifest_hash text,
  p_script_sha256 text,
  p_look_version_id uuid,
  p_extraction_json jsonb,
  p_model_request_hash text,
  p_provider_response_id_hash text,
  p_provider_request_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  attempt public.preflight_stage_attempts%rowtype;
  stage public.preflight_stage_runs%rowtype;
  run public.preflight_runs%rowtype;
  config public.episode_configuration_candidates%rowtype;
  script public.script_revisions%rowtype;
  prior private.world_extraction_results%rowtype;
  computed_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  if p_script_sha256 !~ '^[a-f0-9]{64}$'
    or p_model_request_hash !~ '^[a-f0-9]{64}$'
    or p_provider_response_id_hash !~ '^[a-f0-9]{64}$'
    or (p_provider_request_id_hash is not null
      and p_provider_request_id_hash !~ '^[a-f0-9]{64}$')
    or p_extraction_json is null
    or jsonb_typeof(p_extraction_json)<>'object'
    or pg_column_size(p_extraction_json)>131072
    or p_extraction_json->>'schemaVersion'<>'genie.world-extraction.v2'
    or jsonb_typeof(p_extraction_json->'characters')<>'array'
    or jsonb_array_length(p_extraction_json->'characters') not between 1 and 16
    or jsonb_typeof(p_extraction_json->'locations')<>'array'
    or jsonb_array_length(p_extraction_json->'locations') not between 1 and 12
    or jsonb_typeof(p_extraction_json->'props')<>'array'
    or jsonb_array_length(p_extraction_json->'props') not between 0 and 12
  then
    raise exception 'world extraction envelope is invalid' using errcode='22023';
  end if;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id for update;
  select * into stage from public.preflight_stage_runs
    where id=attempt.preflight_stage_run_id for update;
  select * into run from public.preflight_runs
    where id=attempt.preflight_run_id for share;
  select * into config from public.episode_configuration_candidates
    where id=run.configuration_candidate_id for share;
  select * into script from public.script_revisions
    where id=run.script_revision_id for share;
  if attempt.id is null or stage.id is null or run.id is null
    or run.kind<>'world_anchor' or run.state<>'running'
    or attempt.state not in ('claimed','running')
    or attempt.authority_epoch<>p_authority_epoch
    or run.authority_epoch<>p_authority_epoch
    or attempt.fencing_token<>p_fencing_token
    or stage.highest_fencing_token<>p_fencing_token
    or attempt.input_manifest_hash<>p_input_manifest_hash
    or script.raw_utf8_sha256<>p_script_sha256
    or config.look_version_id<>p_look_version_id
    or not exists(
      select 1 from public.preflight_stage_leases lease
      where lease.stage_attempt_id=attempt.id and lease.state='active'
        and lease.fencing_token=p_fencing_token
        and lease.expires_at>statement_timestamp()
    )
  then
    raise exception 'preflight execution authority is stale' using errcode='40001';
  end if;
  computed_hash:=encode(
    extensions.digest(convert_to(p_extraction_json::text,'UTF8'),'sha256'),'hex'
  );
  select * into prior from private.world_extraction_results
    where preflight_run_id=run.id;
  if prior.id is not null then
    if prior.extraction_hash<>computed_hash
      or prior.model_request_hash<>p_model_request_hash
      or prior.script_sha256<>p_script_sha256
      or prior.look_version_id<>p_look_version_id
    then
      raise exception 'world extraction replay differs' using errcode='40001';
    end if;
    return jsonb_build_object('ok',true,'replayed',true,
      'resultId',prior.id,'extractionHash',prior.extraction_hash);
  end if;
  insert into private.world_extraction_results(
    id,workspace_id,preflight_run_id,stage_attempt_id,
    configuration_candidate_id,script_revision_id,script_sha256,look_version_id,
    schema_version,extraction_json,extraction_hash,model_key,model_request_hash,
    provider_response_id_hash,provider_request_id_hash
  ) values(
    p_result_id,run.workspace_id,run.id,attempt.id,run.configuration_candidate_id,
    run.script_revision_id,p_script_sha256,p_look_version_id,
    'genie.world-extraction.v2',p_extraction_json,computed_hash,'gpt-5.6',
    p_model_request_hash,p_provider_response_id_hash,p_provider_request_id_hash
  );
  return jsonb_build_object('ok',true,'replayed',false,
    'resultId',p_result_id,'extractionHash',computed_hash);
end;
$$;

alter table public.locations
  add column world_object_kind text generated always as (
    case when canonical_key like 'prop.%' then 'prop' else 'location' end
  ) stored;
alter table public.locations
  add constraint locations_world_object_kind_check
  check (world_object_kind in ('location','prop'));

create table public.world_build_progress_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  configuration_candidate_id uuid not null,
  preflight_run_id uuid not null,
  item_key text not null check (item_key ~ '^[a-z][a-z0-9_.:-]{2,140}$'),
  item_kind text not null check (item_kind in ('system','character','location','prop')),
  world_entity_id uuid,
  display_name text not null check (char_length(display_name) between 1 and 240),
  state text not null check (state in (
    'extracting','identified','researching','prompted','dispatched',
    'generating','secure_ingest','review_ready','failed'
  )),
  prompt_text text check (prompt_text is null or char_length(prompt_text) between 1 and 16000),
  provider_model text check (provider_model is null or char_length(provider_model) between 3 and 160),
  provider_request_id uuid,
  source_count integer not null default 0 check (source_count between 0 and 12),
  sort_order integer not null check (sort_order between 0 and 1000),
  safe_detail text not null default '' check (char_length(safe_detail)<=500),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (configuration_candidate_id,item_key),
  unique (workspace_id,id),
  foreign key (workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete cascade,
  foreign key (workspace_id,preflight_run_id)
    references public.preflight_runs(workspace_id,id) on delete cascade
);

create index world_build_progress_configuration_idx
  on public.world_build_progress_items(configuration_candidate_id,sort_order);
alter table public.world_build_progress_items enable row level security;
alter table public.world_build_progress_items force row level security;
create policy world_build_progress_member_select
on public.world_build_progress_items for select to authenticated
using (private.is_active_member(workspace_id,auth.uid()));
revoke all on table public.world_build_progress_items from public,anon,authenticated;
grant select on table public.world_build_progress_items to authenticated;
alter table public.world_build_progress_items replica identity full;

do $publication$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(
      select 1 from pg_publication_tables
      where pubname='supabase_realtime'
        and schemaname='public'
        and tablename='world_build_progress_items'
    )
  then
    alter publication supabase_realtime add table public.world_build_progress_items;
  end if;
end;
$publication$;

create or replace function private.project_world_anchor_job_progress()
returns trigger language plpgsql security definer set search_path=''
as $$
declare run_configuration_id uuid; projected_kind text; projected_state text;
  projected_id uuid; projected_name text;
begin
  select run.configuration_candidate_id into run_configuration_id
  from public.preflight_runs run where run.id=new.preflight_run_id;
  projected_kind:=case
    when new.entity_kind='character' then 'character'
    when new.location_key like 'prop.%' then 'prop'
    else 'location'
  end;
  projected_id:=case
    when new.entity_kind='character' then new.character_form_id
    else new.location_id
  end;
  projected_name:=case
    when new.entity_kind='character' then new.form_name
    else new.location_name
  end;
  projected_state:=case new.state::text
    when 'reserved' then 'prompted'
    when 'dispatching' then 'dispatched'
    when 'waiting_output' then 'generating'
    when 'promoted' then 'review_ready'
    else 'failed'
  end;
  insert into public.world_build_progress_items(
    workspace_id,configuration_candidate_id,preflight_run_id,item_key,item_kind,
    world_entity_id,display_name,state,prompt_text,provider_model,
    provider_request_id,sort_order,safe_detail
  ) values(
    new.workspace_id,run_configuration_id,new.preflight_run_id,new.slot_key,
    projected_kind,projected_id,projected_name,projected_state,new.prompt_text,
    'fal-ai/nano-banana-2',new.provider_request_id,
    case projected_kind when 'character' then 100 when 'location' then 300 else 500 end,
    case projected_state
      when 'prompted' then 'Prompt ready for Nano Banana'
      when 'dispatched' then 'Provider request authorized and dispatched'
      when 'generating' then 'Nano Banana is generating this anchor'
      when 'review_ready' then 'Secure image is ready for your review'
      else coalesce(new.safe_failure_class,'Generation stopped safely')
    end
  )
  on conflict (configuration_candidate_id,item_key) do update set
    world_entity_id=excluded.world_entity_id,
    state=excluded.state,
    prompt_text=excluded.prompt_text,
    provider_model=excluded.provider_model,
    provider_request_id=excluded.provider_request_id,
    safe_detail=excluded.safe_detail,
    updated_at=statement_timestamp();
  return new;
end;
$$;

create trigger project_world_anchor_job_progress
after insert or update of state,provider_request_id,prompt_text
on private.world_anchor_jobs
for each row execute function private.project_world_anchor_job_progress();

revoke all on function public.command_authorize_world_build_intent(
  uuid,uuid,uuid,bigint,bigint,uuid,text,text
) from public,anon;
grant execute on function public.command_authorize_world_build_intent(
  uuid,uuid,uuid,bigint,bigint,uuid,text,text
) to authenticated,service_role;
revoke all on function private.bind_world_preparation_authorization_aal(),
  private.bind_narration_preparation_authorization_aal(),
  private.project_world_anchor_job_progress() from public,anon,authenticated;

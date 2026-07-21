-- Materialize one exact sound-design decision per production shot. Generated
-- effects are claimed before synchronous provider spend; deliberate silence is
-- a terminal evidence row with no provider request or media object.

alter table public.mvp_production_jobs
  add column total_sfx integer not null default 0,
  add column completed_sfx integer not null default 0;

alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_sfx_progress_check
  check (
    total_sfx between 0 and 80
    and completed_sfx between 0 and total_sfx
  );

alter table public.mvp_production_jobs
  drop constraint if exists mvp_production_jobs_state_check;

alter table public.mvp_production_jobs
  add constraint mvp_production_jobs_state_check
  check (state in (
    'queued','repair_planning','generating','sound_designing','rendering','review_ready',
    'needs_repair','approved','export_ready','failed','canceled'
  ));

create table private.mvp_production_sfx (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  episode_id uuid not null references public.episodes(id) on delete restrict,
  production_run_id uuid not null,
  plan_bundle_id uuid not null references public.preflight_plan_bundles(id)
    on delete restrict,
  attempt_number integer not null check (attempt_number between 1 and 20),
  shot_number integer not null check (shot_number between 1 and 80),
  source_sfx_id uuid references private.mvp_production_sfx(id) on delete restrict,
  shot_start_ms integer not null check (shot_start_ms >= 0),
  shot_end_ms integer not null check (shot_end_ms > shot_start_ms),
  cue_kind text not null check (cue_kind in (
    'deliberate_silence','generated_effect'
  )),
  cue_text text not null check (char_length(cue_text) between 1 and 1200),
  cue_sha256 text not null check (cue_sha256 ~ '^[a-f0-9]{64}$'),
  prompt_text text check (
    prompt_text is null or char_length(prompt_text) between 1 and 450
  ),
  prompt_sha256 text check (
    prompt_sha256 is null or prompt_sha256 ~ '^[a-f0-9]{64}$'
  ),
  provider_payload jsonb check (
    provider_payload is null or (
      jsonb_typeof(provider_payload) = 'object'
      and octet_length(provider_payload::text) between 2 and 32768
    )
  ),
  payload_sha256 text check (
    payload_sha256 is null or payload_sha256 ~ '^[a-f0-9]{64}$'
  ),
  model_contract jsonb check (
    model_contract is null or (
      jsonb_typeof(model_contract) = 'object'
      and octet_length(model_contract::text) between 2 and 8192
    )
  ),
  model_contract_sha256 text check (
    model_contract_sha256 is null
    or model_contract_sha256 ~ '^[a-f0-9]{64}$'
  ),
  model_id text check (
    model_id is null or model_id = 'eleven_text_to_sound_v2'
  ),
  output_format text check (
    output_format is null or output_format = 'mp3_44100_128'
  ),
  requested_duration_ms integer check (
    requested_duration_ms is null
    or requested_duration_ms between 500 and 5000
  ),
  start_offset_ms integer not null check (start_offset_ms >= 0),
  trim_duration_ms integer not null check (trim_duration_ms >= 0),
  gain_db numeric(5,2) not null check (gain_db between -30 and -9),
  fade_in_ms integer not null check (fade_in_ms >= 0),
  fade_out_ms integer not null check (fade_out_ms >= 0),
  state text not null check (state in ('prepared','claimed','complete','failed')),
  version bigint not null default 1 check (version > 0),
  provider_state text not null check (provider_state in (
    'not_applicable','ready','in_flight','succeeded','reused','failed'
  )),
  lease_token uuid,
  lease_expires_at timestamptz,
  claimed_at timestamptz,
  provider_completed_at timestamptz,
  provider_response_sha256 text check (
    provider_response_sha256 is null
    or provider_response_sha256 ~ '^[a-f0-9]{64}$'
  ),
  provider_usage_count integer check (
    provider_usage_count is null
    or provider_usage_count between 0 and 9999999
  ),
  object_name text,
  content_sha256 text check (
    content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  byte_length bigint check (
    byte_length is null or byte_length between 64 and 4194304
  ),
  media_mime text check (
    media_mime is null or media_mime = 'audio/mpeg'
  ),
  generated_duration_ms integer check (
    generated_duration_ms is null
    or generated_duration_ms between 500 and 5100
  ),
  qc_state text not null check (qc_state in (
    'not_required','not_run','passed','failed'
  )),
  qc_evidence jsonb check (
    qc_evidence is null or (
      jsonb_typeof(qc_evidence) = 'object'
      and octet_length(qc_evidence::text) between 2 and 65536
    )
  ),
  qc_evidence_sha256 text check (
    qc_evidence_sha256 is null or qc_evidence_sha256 ~ '^[a-f0-9]{64}$'
  ),
  failure_stage text check (
    failure_stage is null or failure_stage in (
      'provider','media_validation','qc'
    )
  ),
  last_error_code text check (
    last_error_code is null or last_error_code ~ '^[A-Z][A-Z0-9_]{2,63}$'
  ),
  last_error_summary text check (
    last_error_summary is null
    or char_length(last_error_summary) between 1 and 500
  ),
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  completed_at timestamptz,
  unique (production_run_id, attempt_number, shot_number),
  foreign key (workspace_id, production_run_id, episode_id, plan_bundle_id)
    references public.mvp_production_jobs(
      workspace_id, production_run_id, episode_id, plan_bundle_id
    ) on delete restrict,
  foreign key (plan_bundle_id, shot_number)
    references public.preflight_shots(plan_bundle_id, shot_number)
    on delete restrict,
  check (
    start_offset_ms + trim_duration_ms <= shot_end_ms - shot_start_ms
  ),
  check (fade_in_ms + fade_out_ms <= trim_duration_ms),
  check (
    requested_duration_ms is null
    or trim_duration_ms <= requested_duration_ms
  ),
  check (
    cue_kind = 'deliberate_silence' or trim_duration_ms >= 500
  ),
  check (
    generated_duration_ms is null
    or trim_duration_ms <= generated_duration_ms
  ),
  check (
    object_name is null or object_name =
      workspace_id::text || '/mvp-sfx/' || production_run_id::text || '/' ||
      attempt_number::text || '/' || shot_number::text || '.mp3'
  ),
  check (
    (lease_token is null and lease_expires_at is null)
    or (lease_token is not null and lease_expires_at is not null)
  ),
  check (
    completed_at is null or completed_at >= created_at
  ),
  check (
    (cue_kind = 'deliberate_silence'
      and state = 'complete'
      and provider_state = 'not_applicable'
      and source_sfx_id is null
      and num_nonnulls(
        prompt_text, prompt_sha256, provider_payload, payload_sha256,
        model_contract, model_contract_sha256, model_id, output_format,
        requested_duration_ms, lease_token, lease_expires_at, claimed_at,
        provider_completed_at, provider_response_sha256,
        provider_usage_count, object_name, content_sha256, byte_length,
        media_mime, generated_duration_ms, qc_evidence,
        qc_evidence_sha256, failure_stage, last_error_code,
        last_error_summary
      ) = 0
      and qc_state = 'not_required'
      and completed_at is not null)
    or cue_kind = 'generated_effect'
  ),
  check (
    cue_kind <> 'generated_effect' or (
      prompt_text is not null
      and prompt_sha256 is not null
      and provider_payload is not null
      and payload_sha256 is not null
      and model_contract is not null
      and model_contract_sha256 is not null
      and model_id = 'eleven_text_to_sound_v2'
      and output_format = 'mp3_44100_128'
      and requested_duration_ms is not null
    )
  ),
  check (
    cue_kind <> 'generated_effect' or (
      (state = 'prepared'
        and provider_state = 'ready'
        and source_sfx_id is null
        and lease_token is null and lease_expires_at is null
        and claimed_at is null and provider_completed_at is null
        and provider_response_sha256 is null
        and provider_usage_count is null
        and object_name is null and content_sha256 is null
        and byte_length is null and media_mime is null
        and generated_duration_ms is null and qc_state = 'not_run'
        and qc_evidence is null and qc_evidence_sha256 is null
        and failure_stage is null and last_error_code is null
        and last_error_summary is null and completed_at is null)
      or
      (state = 'claimed'
        and provider_state = 'in_flight'
        and source_sfx_id is null
        and lease_token is not null and lease_expires_at is not null
        and claimed_at is not null and provider_completed_at is null
        and provider_response_sha256 is null
        and provider_usage_count is null
        and object_name is null and content_sha256 is null
        and byte_length is null and media_mime is null
        and generated_duration_ms is null and qc_state = 'not_run'
        and qc_evidence is null and qc_evidence_sha256 is null
        and failure_stage is null and last_error_code is null
        and last_error_summary is null and completed_at is null)
      or
      (state = 'complete'
        and provider_state = 'succeeded'
        and source_sfx_id is null
        and lease_token is null and lease_expires_at is null
        and claimed_at is not null and provider_completed_at is not null
        and provider_response_sha256 is not null
        and object_name is not null and content_sha256 is not null
        and byte_length is not null and media_mime = 'audio/mpeg'
        and generated_duration_ms is not null and qc_state = 'passed'
        and qc_evidence is not null and qc_evidence_sha256 is not null
        and failure_stage is null and last_error_code is null
        and last_error_summary is null and completed_at is not null)
      or
      (state = 'complete'
        and provider_state = 'reused'
        and source_sfx_id is not null
        and lease_token is null and lease_expires_at is null
        and claimed_at is null and provider_completed_at is null
        and provider_response_sha256 is null
        and provider_usage_count is null
        and object_name is not null and content_sha256 is not null
        and byte_length is not null and media_mime = 'audio/mpeg'
        and generated_duration_ms is not null and qc_state = 'passed'
        and qc_evidence is not null and qc_evidence_sha256 is not null
        and failure_stage is null and last_error_code is null
        and last_error_summary is null and completed_at is not null)
      or
      (state = 'failed'
        and provider_state in ('succeeded','failed')
        and source_sfx_id is null
        and lease_token is null and lease_expires_at is null
        and claimed_at is not null and provider_completed_at is not null
        and object_name is null and content_sha256 is null
        and byte_length is null and media_mime is null
        and generated_duration_ms is null
        and qc_state in ('not_run','failed')
        and failure_stage is not null and last_error_code is not null
        and last_error_summary is not null and completed_at is not null)
    )
  )
);

comment on table private.mvp_production_sfx is
  'One immutable terminal or claimable SFX decision per production shot and attempt. Provider payloads contain no credentials.';

comment on column private.mvp_production_sfx.start_offset_ms is
  'Offset from the shot start at which the trimmed SFX begins in the final edit.';

create trigger mvp_production_sfx_updated_at
before update on private.mvp_production_sfx
for each row execute function private.set_updated_at();

create or replace function private.guard_completed_mvp_sfx()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.state = 'complete' then
    raise exception 'completed MVP SFX evidence is immutable'
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger mvp_production_sfx_completed_immutable
before update or delete on private.mvp_production_sfx
for each row execute function private.guard_completed_mvp_sfx();

alter table private.mvp_production_sfx enable row level security;
alter table private.mvp_production_sfx force row level security;

revoke all on private.mvp_production_sfx
from public, anon, authenticated, service_role;
grant select on private.mvp_production_sfx to service_role;

create index mvp_production_sfx_claim_idx
on private.mvp_production_sfx(created_at, id)
where state = 'prepared';

create index mvp_production_sfx_plan_shot_idx
on private.mvp_production_sfx(plan_bundle_id, shot_number);

create index mvp_production_sfx_episode_idx
on private.mvp_production_sfx(workspace_id, episode_id, created_at desc);

create or replace view public.mvp_production_sfx_worker
with (security_invoker = true)
as
select
  id,workspace_id,episode_id,production_run_id,plan_bundle_id,attempt_number,
  shot_number,source_sfx_id,shot_start_ms,shot_end_ms,cue_kind,cue_text,cue_sha256,
  prompt_text,prompt_sha256,provider_payload,payload_sha256,model_contract,
  model_contract_sha256,model_id,output_format,requested_duration_ms,
  start_offset_ms,trim_duration_ms,gain_db,fade_in_ms,fade_out_ms,state,
  version,provider_state,lease_token,lease_expires_at,claimed_at,
  provider_completed_at,provider_response_sha256,provider_usage_count,
  object_name,content_sha256,byte_length,media_mime,generated_duration_ms,
  qc_state,qc_evidence,qc_evidence_sha256,failure_stage,last_error_code,
  last_error_summary,created_at,updated_at,completed_at
from private.mvp_production_sfx;

revoke all on public.mvp_production_sfx_worker
from public, anon, authenticated, service_role;
grant select on public.mvp_production_sfx_worker to service_role;

create or replace function public.command_materialize_mvp_sfx_cue(
  p_workspace_id uuid,
  p_production_run_id uuid,
  p_attempt_number integer,
  p_total_sfx integer,
  p_shot_number integer,
  p_source_sfx_id uuid,
  p_cue_kind text,
  p_cue_text text,
  p_cue_sha256 text,
  p_prompt_text text,
  p_prompt_sha256 text,
  p_provider_payload jsonb,
  p_payload_sha256 text,
  p_model_contract jsonb,
  p_model_contract_sha256 text,
  p_requested_duration_ms integer,
  p_start_offset_ms integer,
  p_trim_duration_ms integer,
  p_gain_db numeric,
  p_fade_in_ms integer,
  p_fade_out_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.mvp_production_jobs%rowtype;
  shot_row public.preflight_shots%rowtype;
  sfx_row private.mvp_production_sfx%rowtype;
  source_sfx private.mvp_production_sfx%rowtype;
  ledger_count integer;
  complete_count integer;
  cue_hash text;
  prompt_hash text;
  payload_hash text;
  model_hash text;
  locked_shot_count integer;
  edd_payload jsonb;
  edd_shot jsonb;
  safety_suffix constant text :=
    'Clean cinematic one-shot Foley/SFX only. No speech, dialogue, narration, chant, mantra, lyrics, singing, vocals, or music.';
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_attempt_number is null or p_attempt_number not between 1 and 20
    or p_total_sfx is null or p_total_sfx not between 1 and 80
    or p_shot_number is null or p_shot_number not between 1 and 80
    or p_cue_kind is null
    or p_cue_kind not in ('deliberate_silence','generated_effect')
    or p_cue_text is null or p_cue_text <> btrim(p_cue_text)
    or char_length(p_cue_text) not between 1 and 1200
    or p_start_offset_ms is null or p_start_offset_ms < 0
    or p_trim_duration_ms is null or p_trim_duration_ms < 0
    or p_gain_db is null or p_gain_db not between -30 and -9
    or p_fade_in_ms is null or p_fade_in_ms < 0
    or p_fade_out_ms is null or p_fade_out_ms < 0
    or p_fade_in_ms + p_fade_out_ms > p_trim_duration_ms
  then
    raise exception 'MVP SFX cue input is invalid' using errcode = '22023';
  end if;

  cue_hash := encode(extensions.digest(
    convert_to(p_cue_text, 'UTF8'), 'sha256'
  ), 'hex');
  if p_cue_sha256 is distinct from cue_hash then
    raise exception 'MVP SFX cue hash is invalid' using errcode = '22023';
  end if;

  select * into job_row
  from public.mvp_production_jobs
  where workspace_id = p_workspace_id
    and production_run_id = p_production_run_id
  for update;
  if not found
    or job_row.attempt_number <> p_attempt_number
    or job_row.state not in ('generating','sound_designing')
    or job_row.total_sfx not in (0, p_total_sfx)
  then
    raise exception 'MVP SFX production job is stale' using errcode = '40001';
  end if;

  select count(*)::integer into locked_shot_count
  from public.preflight_shots
  where workspace_id = p_workspace_id
    and plan_bundle_id = job_row.plan_bundle_id;
  if locked_shot_count <> p_total_sfx then
    raise exception 'MVP SFX coverage does not match the locked shot set'
      using errcode = '23514';
  end if;
  if job_row.total_clips <> locked_shot_count
    or job_row.completed_clips <> locked_shot_count
  then
    raise exception 'MVP SFX cannot begin before every selected clip is complete'
      using errcode = '40001';
  end if;

  select * into shot_row
  from public.preflight_shots
  where plan_bundle_id = job_row.plan_bundle_id
    and shot_number = p_shot_number;
  if not found
    or p_start_offset_ms + p_trim_duration_ms > shot_row.end_ms - shot_row.start_ms
  then
    raise exception 'MVP SFX shot timing is invalid' using errcode = '22023';
  end if;

  if p_attempt_number > 1 then
    select plan.repaired_edd_payload into edd_payload
    from public.mvp_repair_requests request
    join private.mvp_repair_plan_versions plan
      on plan.id = request.active_plan_version_id
      and plan.workspace_id = request.workspace_id
      and plan.production_run_id = request.production_run_id
      and plan.repair_request_id = request.id
      and plan.target_attempt_number = request.target_attempt_number
    where request.id = job_row.active_repair_request_id
      and request.workspace_id = p_workspace_id
      and request.production_run_id = p_production_run_id
      and request.target_attempt_number = p_attempt_number
      and request.state in ('planned','executing','complete');
  else
    select component.payload into edd_payload
    from public.preflight_plan_bundles bundle
    join public.preflight_plan_component_versions component
      on component.workspace_id = bundle.workspace_id
      and component.id = bundle.edd_version_id
    where bundle.workspace_id = p_workspace_id
      and bundle.id = job_row.plan_bundle_id;
  end if;
  if edd_payload is null or jsonb_typeof(edd_payload->'shots') <> 'array' then
    raise exception 'The locked MVP SFX EDD is unavailable'
      using errcode = '23514';
  end if;
  select value into edd_shot
  from jsonb_array_elements(edd_payload->'shots')
  where (value->>'shotNumber')::integer = p_shot_number;
  if edd_shot is null
    or edd_shot->>'sfxCue' is distinct from p_cue_text
    or (edd_shot->>'sfxDurationMs')::integer is distinct from (
      case when p_cue_kind = 'deliberate_silence' then 0
        else p_trim_duration_ms end
    )
    or (edd_shot->>'sfxStartOffsetMs')::integer is distinct from p_start_offset_ms
    or (edd_shot->>'sfxGainDb')::numeric is distinct from p_gain_db
  then
    raise exception 'MVP SFX cue differs from the locked EDD'
      using errcode = '23514';
  end if;

  if p_cue_kind = 'deliberate_silence' then
    if num_nonnulls(
      p_prompt_text,p_prompt_sha256,p_provider_payload,p_payload_sha256,
      p_model_contract,p_model_contract_sha256,p_requested_duration_ms
    ) <> 0
      or p_source_sfx_id is not null
      or p_start_offset_ms <> 0
      or p_trim_duration_ms <> 0
      or p_fade_in_ms <> 0
      or p_fade_out_ms <> 0
    then
      raise exception 'Deliberate silence cannot spend' using errcode = '22023';
    end if;
  else
    if p_prompt_text is null or p_prompt_text <> btrim(p_prompt_text)
      or char_length(p_prompt_text) not between 1 and 450
      or position(chr(10) in p_prompt_text) > 0
      or right(p_prompt_text, char_length(safety_suffix)) <> safety_suffix
      or p_requested_duration_ms not between 500 and 5000
      or p_trim_duration_ms < 500
      or p_trim_duration_ms > p_requested_duration_ms
      or p_provider_payload is null
      or jsonb_typeof(p_provider_payload) <> 'object'
      or not (p_provider_payload ?& array[
        'duration_seconds','loop','model_id','prompt_influence','text'
      ])
      or (p_provider_payload - array[
        'duration_seconds','loop','model_id','prompt_influence','text'
      ]::text[]) <> '{}'::jsonb
      or jsonb_typeof(p_provider_payload->'duration_seconds') <> 'number'
      or (p_provider_payload->>'duration_seconds')::numeric
        <> p_requested_duration_ms::numeric / 1000
      or p_provider_payload->'loop' <> 'false'::jsonb
      or p_provider_payload->>'model_id' <> 'eleven_text_to_sound_v2'
      or p_provider_payload->'prompt_influence' <> '0.3'::jsonb
      or p_provider_payload->>'text' <> p_prompt_text
      or p_model_contract is null
      or jsonb_typeof(p_model_contract) <> 'object'
      or not (p_model_contract ?& array[
        'endpoint','loop','modelId','outputFormat','promptInfluence',
        'schemaVersion'
      ])
      or (p_model_contract - array[
        'endpoint','loop','modelId','outputFormat','promptInfluence',
        'schemaVersion'
      ]::text[]) <> '{}'::jsonb
      or p_model_contract->>'endpoint' <>
        'https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128'
      or p_model_contract->'loop' <> 'false'::jsonb
      or p_model_contract->>'modelId' <> 'eleven_text_to_sound_v2'
      or p_model_contract->>'outputFormat' <> 'mp3_44100_128'
      or p_model_contract->'promptInfluence' <> '0.3'::jsonb
      or p_model_contract->>'schemaVersion' <> 'genie.elevenlabs-sfx.v1'
    then
      raise exception 'Generated MVP SFX provider contract is invalid'
        using errcode = '22023';
    end if;

    prompt_hash := encode(extensions.digest(
      convert_to(p_prompt_text, 'UTF8'), 'sha256'
    ), 'hex');
    payload_hash := encode(extensions.digest(
      convert_to(p_provider_payload::text, 'UTF8'), 'sha256'
    ), 'hex');
    model_hash := encode(extensions.digest(
      convert_to(p_model_contract::text, 'UTF8'), 'sha256'
    ), 'hex');
    if p_prompt_sha256 is distinct from prompt_hash
      or p_payload_sha256 is distinct from payload_hash
      or p_model_contract_sha256 is distinct from model_hash
    then
      raise exception 'Generated MVP SFX evidence hash is invalid'
        using errcode = '22023';
    end if;
  end if;

  if p_source_sfx_id is not null then
    select * into source_sfx
    from private.mvp_production_sfx
    where id = p_source_sfx_id
      and workspace_id = p_workspace_id
      and production_run_id = p_production_run_id
      and attempt_number < p_attempt_number
      and shot_number = p_shot_number
      and cue_kind = 'generated_effect'
      and state = 'complete';
    if not found
      or source_sfx.cue_text <> p_cue_text
      or source_sfx.cue_sha256 <> p_cue_sha256
      or source_sfx.prompt_text <> p_prompt_text
      or source_sfx.prompt_sha256 <> p_prompt_sha256
      or source_sfx.provider_payload <> p_provider_payload
      or source_sfx.payload_sha256 <> p_payload_sha256
      or source_sfx.model_contract <> p_model_contract
      or source_sfx.model_contract_sha256 <> p_model_contract_sha256
      or source_sfx.requested_duration_ms <> p_requested_duration_ms
      or source_sfx.start_offset_ms <> p_start_offset_ms
      or source_sfx.trim_duration_ms <> p_trim_duration_ms
      or source_sfx.gain_db <> p_gain_db
      or source_sfx.fade_in_ms <> p_fade_in_ms
      or source_sfx.fade_out_ms <> p_fade_out_ms
      or source_sfx.object_name is null
      or source_sfx.content_sha256 is null
      or source_sfx.byte_length is null
      or source_sfx.generated_duration_ms is null
      or source_sfx.qc_state <> 'passed'
    then
      raise exception 'MVP SFX reuse source differs from the locked cue'
        using errcode = '23514';
    end if;
  end if;

  select * into sfx_row
  from private.mvp_production_sfx
  where production_run_id = p_production_run_id
    and attempt_number = p_attempt_number
    and shot_number = p_shot_number
  for update;
  if found then
    if sfx_row.cue_kind is distinct from p_cue_kind
      or sfx_row.cue_text is distinct from p_cue_text
      or sfx_row.cue_sha256 is distinct from p_cue_sha256
      or sfx_row.prompt_text is distinct from p_prompt_text
      or sfx_row.prompt_sha256 is distinct from p_prompt_sha256
      or sfx_row.provider_payload is distinct from p_provider_payload
      or sfx_row.payload_sha256 is distinct from p_payload_sha256
      or sfx_row.model_contract is distinct from p_model_contract
      or sfx_row.model_contract_sha256 is distinct from p_model_contract_sha256
      or sfx_row.requested_duration_ms is distinct from p_requested_duration_ms
      or sfx_row.start_offset_ms <> p_start_offset_ms
      or sfx_row.trim_duration_ms <> p_trim_duration_ms
      or sfx_row.gain_db <> p_gain_db
      or sfx_row.fade_in_ms <> p_fade_in_ms
      or sfx_row.fade_out_ms <> p_fade_out_ms
      or sfx_row.source_sfx_id is distinct from p_source_sfx_id
    then
      raise exception 'MVP SFX materialization conflicts with existing evidence'
        using errcode = '40001';
    end if;
    return to_jsonb(sfx_row) || jsonb_build_object('replayed', true);
  end if;

  insert into private.mvp_production_sfx(
    workspace_id,episode_id,production_run_id,plan_bundle_id,attempt_number,
    shot_number,source_sfx_id,shot_start_ms,shot_end_ms,cue_kind,cue_text,cue_sha256,
    prompt_text,prompt_sha256,provider_payload,payload_sha256,model_contract,
    model_contract_sha256,model_id,output_format,requested_duration_ms,
    start_offset_ms,trim_duration_ms,gain_db,fade_in_ms,fade_out_ms,state,
    provider_state,object_name,content_sha256,byte_length,media_mime,
    generated_duration_ms,qc_state,qc_evidence,qc_evidence_sha256,completed_at
  ) values(
    p_workspace_id,job_row.episode_id,p_production_run_id,job_row.plan_bundle_id,
    p_attempt_number,p_shot_number,p_source_sfx_id,shot_row.start_ms,
    shot_row.end_ms,p_cue_kind,
    p_cue_text,p_cue_sha256,p_prompt_text,p_prompt_sha256,p_provider_payload,
    p_payload_sha256,p_model_contract,p_model_contract_sha256,
    case when p_cue_kind = 'generated_effect'
      then 'eleven_text_to_sound_v2' end,
    case when p_cue_kind = 'generated_effect' then 'mp3_44100_128' end,
    p_requested_duration_ms,p_start_offset_ms,p_trim_duration_ms,p_gain_db,
    p_fade_in_ms,p_fade_out_ms,
    case when p_cue_kind = 'deliberate_silence' or p_source_sfx_id is not null
      then 'complete' else 'prepared' end,
    case when p_cue_kind = 'deliberate_silence' then 'not_applicable'
      when p_source_sfx_id is not null then 'reused' else 'ready' end,
    case when p_source_sfx_id is not null then
      p_workspace_id::text || '/mvp-sfx/' || p_production_run_id::text || '/' ||
      p_attempt_number::text || '/' || p_shot_number::text || '.mp3' end,
    case when p_source_sfx_id is not null then source_sfx.content_sha256 end,
    case when p_source_sfx_id is not null then source_sfx.byte_length end,
    case when p_source_sfx_id is not null then 'audio/mpeg' end,
    case when p_source_sfx_id is not null then source_sfx.generated_duration_ms end,
    case when p_cue_kind = 'deliberate_silence' then 'not_required'
      when p_source_sfx_id is not null then 'passed' else 'not_run' end,
    case when p_source_sfx_id is not null then source_sfx.qc_evidence end,
    case when p_source_sfx_id is not null then source_sfx.qc_evidence_sha256 end,
    case when p_cue_kind = 'deliberate_silence' or p_source_sfx_id is not null
      then statement_timestamp() end
  ) returning * into sfx_row;

  select count(*)::integer,
    count(*) filter(where state = 'complete')::integer
  into ledger_count, complete_count
  from private.mvp_production_sfx
  where production_run_id = p_production_run_id
    and attempt_number = p_attempt_number;
  if ledger_count > p_total_sfx then
    raise exception 'MVP SFX materialization exceeds its declared total'
      using errcode = '23514';
  end if;

  update public.mvp_production_jobs
  set total_sfx = p_total_sfx,
      completed_sfx = complete_count,
      state = case
        when ledger_count = p_total_sfx and complete_count = p_total_sfx
          then 'rendering'
        when ledger_count = p_total_sfx then 'sound_designing'
        else state
      end,
      version = version + 1,
      started_at = coalesce(started_at, statement_timestamp())
  where production_run_id = p_production_run_id;

  return to_jsonb(sfx_row) || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.command_claim_next_mvp_sfx(
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sfx_row private.mvp_production_sfx%rowtype;
  new_lease uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 60 and 900 then
    raise exception 'MVP SFX lease duration is invalid' using errcode = '22023';
  end if;

  select sfx.* into sfx_row
  from private.mvp_production_sfx sfx
  join public.mvp_production_jobs job
    on job.production_run_id = sfx.production_run_id
  where sfx.state = 'claimed'
    and sfx.lease_expires_at <= statement_timestamp()
    and job.state = 'sound_designing'
    and job.attempt_number = sfx.attempt_number
  order by sfx.lease_expires_at, sfx.id
  for update of sfx skip locked
  limit 1;
  if found then
    update private.mvp_production_sfx
    set state = 'failed', provider_state = 'failed', version = version + 1,
        lease_token = null, lease_expires_at = null,
        provider_completed_at = statement_timestamp(),
        failure_stage = 'provider',
        last_error_code = 'SFX_PROVIDER_RESULT_AMBIGUOUS',
        last_error_summary =
          'The synchronous SFX provider result became ambiguous after its lease expired; Genie will not spend twice automatically.',
        completed_at = statement_timestamp()
    where id = sfx_row.id and state = 'claimed'
      and version = sfx_row.version
      and lease_expires_at <= statement_timestamp();
    update public.mvp_production_jobs
    set state = 'failed', version = version + 1,
        last_error_code = 'SFX_PROVIDER_RESULT_AMBIGUOUS',
        last_error_summary =
          'An SFX provider result became ambiguous. Completed work is preserved and no duplicate request was issued.'
    where production_run_id = sfx_row.production_run_id
      and attempt_number = sfx_row.attempt_number
      and state = 'sound_designing';
  end if;

  select sfx.* into sfx_row
  from private.mvp_production_sfx sfx
  join public.mvp_production_jobs job
    on job.production_run_id = sfx.production_run_id
  where sfx.state = 'prepared'
    and job.state = 'sound_designing'
    and job.attempt_number = sfx.attempt_number
    and job.total_sfx = (
      select count(*)::integer
      from private.mvp_production_sfx declared
      where declared.production_run_id = sfx.production_run_id
        and declared.attempt_number = sfx.attempt_number
    )
  order by sfx.created_at, sfx.id
  for update of sfx skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update private.mvp_production_sfx
  set state = 'claimed', provider_state = 'in_flight',
      lease_token = new_lease,
      lease_expires_at = statement_timestamp()
        + make_interval(secs => p_lease_seconds),
      claimed_at = statement_timestamp(), version = version + 1
  where id = sfx_row.id and state = 'prepared' and version = sfx_row.version
  returning * into sfx_row;
  if not found then
    raise exception 'MVP SFX claim lost its optimistic race'
      using errcode = '40001';
  end if;

  return to_jsonb(sfx_row);
end;
$$;

create or replace function public.command_complete_mvp_sfx(
  p_sfx_id uuid,
  p_lease_token uuid,
  p_expected_version bigint,
  p_provider_response_sha256 text,
  p_provider_usage_count integer,
  p_object_name text,
  p_content_sha256 text,
  p_byte_length bigint,
  p_generated_duration_ms integer,
  p_qc_evidence jsonb,
  p_qc_evidence_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sfx_row private.mvp_production_sfx%rowtype;
  qc_hash text;
  complete_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_sfx_id is null or p_lease_token is null or p_expected_version is null
    or p_provider_response_sha256 is null
    or p_provider_response_sha256 !~ '^[a-f0-9]{64}$'
    or p_content_sha256 is null
    or p_content_sha256 !~ '^[a-f0-9]{64}$'
    or (p_provider_usage_count is not null
      and p_provider_usage_count not between 0 and 9999999)
    or p_object_name is null
    or p_byte_length is null or p_byte_length not between 64 and 4194304
    or p_generated_duration_ms is null
    or p_generated_duration_ms not between 500 and 5100
    or p_qc_evidence is null or jsonb_typeof(p_qc_evidence) <> 'object'
    or p_qc_evidence->>'schemaVersion' <> 'genie.mvp-sfx-qc.v1'
    or p_qc_evidence->>'passed' <> 'true'
  then
    raise exception 'MVP SFX completion evidence is invalid'
      using errcode = '22023';
  end if;
  qc_hash := encode(extensions.digest(
    convert_to(p_qc_evidence::text, 'UTF8'), 'sha256'
  ), 'hex');
  if p_qc_evidence_sha256 is distinct from qc_hash then
    raise exception 'MVP SFX QC hash is invalid' using errcode = '22023';
  end if;

  update private.mvp_production_sfx
  set state = 'complete', provider_state = 'succeeded', version = version + 1,
      lease_token = null, lease_expires_at = null,
      provider_completed_at = statement_timestamp(),
      provider_response_sha256 = p_provider_response_sha256,
      provider_usage_count = p_provider_usage_count,
      object_name = p_object_name, content_sha256 = p_content_sha256,
      byte_length = p_byte_length, media_mime = 'audio/mpeg',
      generated_duration_ms = p_generated_duration_ms,
      qc_state = 'passed', qc_evidence = p_qc_evidence,
      qc_evidence_sha256 = p_qc_evidence_sha256,
      completed_at = statement_timestamp()
  where id = p_sfx_id and state = 'claimed'
    and version = p_expected_version and lease_token = p_lease_token
    and lease_expires_at > statement_timestamp()
    and trim_duration_ms <= p_generated_duration_ms
  returning * into sfx_row;
  if not found then
    raise exception 'MVP SFX completion lease is stale'
      using errcode = '40001';
  end if;

  select count(*) filter(where state = 'complete')::integer
  into complete_count
  from private.mvp_production_sfx
  where production_run_id = sfx_row.production_run_id
    and attempt_number = sfx_row.attempt_number;

  update public.mvp_production_jobs
  set completed_sfx = complete_count,
      state = case when complete_count = total_sfx
        then 'rendering' else state end,
      version = version + 1
  where production_run_id = sfx_row.production_run_id
    and attempt_number = sfx_row.attempt_number
    and state = 'sound_designing';

  return to_jsonb(sfx_row);
end;
$$;

create or replace function public.command_fail_mvp_sfx(
  p_sfx_id uuid,
  p_lease_token uuid,
  p_expected_version bigint,
  p_failure_stage text,
  p_provider_response_sha256 text,
  p_provider_usage_count integer,
  p_qc_evidence jsonb,
  p_qc_evidence_sha256 text,
  p_error_code text,
  p_error_summary text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sfx_row private.mvp_production_sfx%rowtype;
  qc_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_sfx_id is null or p_lease_token is null or p_expected_version is null
    or p_failure_stage is null
    or p_failure_stage not in ('provider','media_validation','qc')
    or p_error_code is null
    or p_error_code !~ '^[A-Z][A-Z0-9_]{2,63}$'
    or p_error_summary is null
    or char_length(p_error_summary) not between 1 and 500
    or (p_provider_response_sha256 is not null
      and p_provider_response_sha256 !~ '^[a-f0-9]{64}$')
    or (p_provider_usage_count is not null
      and p_provider_usage_count not between 0 and 9999999)
  then
    raise exception 'MVP SFX failure evidence is invalid'
      using errcode = '22023';
  end if;
  if p_failure_stage in ('media_validation','qc')
    and p_provider_response_sha256 is null
  then
    raise exception 'Post-provider SFX failure requires a response hash'
      using errcode = '22023';
  end if;
  if p_failure_stage = 'qc' then
    if p_provider_response_sha256 is null
      or p_qc_evidence is null or jsonb_typeof(p_qc_evidence) <> 'object'
      or p_qc_evidence->>'schemaVersion' <> 'genie.mvp-sfx-qc.v1'
      or p_qc_evidence->>'passed' <> 'false'
    then
      raise exception 'MVP SFX failed QC evidence is invalid'
        using errcode = '22023';
    end if;
    qc_hash := encode(extensions.digest(
      convert_to(p_qc_evidence::text, 'UTF8'), 'sha256'
    ), 'hex');
    if p_qc_evidence_sha256 is distinct from qc_hash then
      raise exception 'MVP SFX failed QC hash is invalid'
        using errcode = '22023';
    end if;
  elsif p_qc_evidence is not null or p_qc_evidence_sha256 is not null then
    raise exception 'MVP SFX non-QC failure has unexpected QC evidence'
      using errcode = '22023';
  end if;

  update private.mvp_production_sfx
  set state = 'failed',
      provider_state = case when p_failure_stage = 'provider'
        then 'failed' else 'succeeded' end,
      version = version + 1, lease_token = null, lease_expires_at = null,
      provider_completed_at = statement_timestamp(),
      provider_response_sha256 = p_provider_response_sha256,
      provider_usage_count = p_provider_usage_count,
      qc_state = case when p_failure_stage = 'qc'
        then 'failed' else 'not_run' end,
      qc_evidence = p_qc_evidence,
      qc_evidence_sha256 = p_qc_evidence_sha256,
      failure_stage = p_failure_stage,
      last_error_code = p_error_code,
      last_error_summary = p_error_summary,
      completed_at = statement_timestamp()
  where id = p_sfx_id and state = 'claimed'
    and version = p_expected_version and lease_token = p_lease_token
    and lease_expires_at > statement_timestamp()
  returning * into sfx_row;
  if not found then
    raise exception 'MVP SFX failure lease is stale'
      using errcode = '40001';
  end if;

  update public.mvp_production_jobs
  set state = 'failed', version = version + 1,
      last_error_code = p_error_code,
      last_error_summary = p_error_summary
  where production_run_id = sfx_row.production_run_id
    and attempt_number = sfx_row.attempt_number
    and state = 'sound_designing';

  return to_jsonb(sfx_row);
end;
$$;

revoke all on function public.command_materialize_mvp_sfx_cue(
  uuid,uuid,integer,integer,integer,uuid,text,text,text,text,text,jsonb,text,jsonb,
  text,integer,integer,integer,numeric,integer,integer
) from public, anon, authenticated;
revoke all on function public.command_claim_next_mvp_sfx(integer)
from public, anon, authenticated;
revoke all on function public.command_complete_mvp_sfx(
  uuid,uuid,bigint,text,integer,text,text,bigint,integer,jsonb,text
) from public, anon, authenticated;
revoke all on function public.command_fail_mvp_sfx(
  uuid,uuid,bigint,text,text,integer,jsonb,text,text,text
) from public, anon, authenticated;

grant execute on function public.command_materialize_mvp_sfx_cue(
  uuid,uuid,integer,integer,integer,uuid,text,text,text,text,text,jsonb,text,jsonb,
  text,integer,integer,integer,numeric,integer,integer
) to service_role;
grant execute on function public.command_claim_next_mvp_sfx(integer)
to service_role;
grant execute on function public.command_complete_mvp_sfx(
  uuid,uuid,bigint,text,integer,text,text,bigint,integer,jsonb,text
) to service_role;
grant execute on function public.command_fail_mvp_sfx(
  uuid,uuid,bigint,text,text,integer,jsonb,text,text,text
) to service_role;

revoke all on function private.guard_completed_mvp_sfx()
from public, anon, authenticated;

-- A new owner-authorized repair attempt owns a fresh SFX ledger. Historical
-- rows remain immutable and the member-visible aggregate starts from zero.
do $migration$
declare
  definition text;
  revised text;
begin
  definition := pg_get_functiondef(
    'public.command_retry_mvp_production(uuid,uuid,bigint)'::regprocedure
  );
  revised := regexp_replace(
    definition,
    'total_storyboards = 0,\s*completed_storyboards = 0,\s*total_clips = 0,\s*completed_clips = 0,',
    'total_storyboards = 0, completed_storyboards = 0, total_sfx = 0, completed_sfx = 0, total_clips = 0, completed_clips = 0,'
  );
  if revised = definition then
    raise exception 'MVP retry SFX-progress patch target was not found';
  end if;
  execute revised;
end;
$migration$;

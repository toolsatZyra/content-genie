-- Narration provider output is quarantined evidence, not promoted media.
-- Keep its provider request active until the shared secure-ingest promotion
-- command verifies the scanner attestation and final storage object.

create or replace function public.command_record_narration_provider_output(
  p_provider_request_id uuid,p_quarantine_asset_version_id uuid,
  p_provider_response_hash text,p_source_audio_sha256 text,p_alignment jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare job private.narration_generation_jobs%rowtype; request private.provider_requests%rowtype;
  computed_alignment_hash text; character_count integer; start_count integer; end_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.narration_generation_jobs
    where provider_request_id=p_provider_request_id for update;
  select * into request from private.provider_requests where id=p_provider_request_id for update;
  if job.id is null or p_provider_response_hash!~'^[a-f0-9]{64}$'
    or p_source_audio_sha256!~'^[a-f0-9]{64}$' or p_alignment is null
    or jsonb_typeof(p_alignment)<>'object'
    or (p_alignment-array['characters','characterStartTimesSeconds','characterEndTimesSeconds']::text[])<>'{}'::jsonb
    or not(p_alignment?&array['characters','characterStartTimesSeconds','characterEndTimesSeconds'])
    or jsonb_typeof(p_alignment->'characters')<>'array'
    or jsonb_typeof(p_alignment->'characterStartTimesSeconds')<>'array'
    or jsonb_typeof(p_alignment->'characterEndTimesSeconds')<>'array'
  then raise exception 'narration provider output envelope is invalid' using errcode='22023'; end if;
  character_count:=jsonb_array_length(p_alignment->'characters');
  start_count:=jsonb_array_length(p_alignment->'characterStartTimesSeconds');
  end_count:=jsonb_array_length(p_alignment->'characterEndTimesSeconds');
  if character_count not between 1 and 20000 or start_count<>character_count or end_count<>character_count
    or request.operation<>'gen_speech' or request.state not in ('submitted','accepted','polling','succeeded')
    or not exists(select 1 from private.quarantine_assets quarantine
      where quarantine.id=p_quarantine_asset_version_id and quarantine.workspace_id=job.workspace_id
        and quarantine.provider_request_id=p_provider_request_id
        and quarantine.source_sha256=p_source_audio_sha256
        and quarantine.declared_mime='audio/mpeg' and quarantine.state='quarantined')
  then raise exception 'narration provider output is stale' using errcode='40001'; end if;
  computed_alignment_hash:=encode(
    extensions.digest(convert_to(p_alignment::text,'UTF8'),'sha256'),
    'hex'
  );
  if job.state='quarantined' then
    if job.quarantine_asset_version_id<>p_quarantine_asset_version_id
      or job.provider_response_hash<>p_provider_response_hash
      or job.alignment_hash<>computed_alignment_hash
    then raise exception 'narration output replay conflicts' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'replayed',true,'jobId',job.id,'state',job.state);
  end if;
  if job.state<>'dispatching' then
    raise exception 'narration output arrived outside active authority' using errcode='40001'; end if;
  if request.state<>'succeeded' then
    update private.provider_requests set safe_response_hash=p_provider_response_hash,
      billable_state='estimated',aggregate_version=aggregate_version+1
      where id=request.id;
  end if;
  update private.narration_generation_jobs set
    quarantine_asset_version_id=p_quarantine_asset_version_id,
    provider_response_hash=p_provider_response_hash,source_audio_sha256=p_source_audio_sha256,
    alignment=p_alignment,alignment_hash=computed_alignment_hash,state='quarantined'
  where id=job.id;
  return jsonb_build_object('ok',true,'replayed',false,'jobId',job.id,'state','quarantined');
end;
$$;

revoke all on function public.command_record_narration_provider_output(uuid,uuid,text,text,jsonb)
from public,anon,authenticated;
grant execute on function public.command_record_narration_provider_output(uuid,uuid,text,text,jsonb)
to service_role;

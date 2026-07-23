-- Align regeneration binding with completion and terminal reconciliation:
-- world anchor job -> regeneration request. This prevents a dispatch replay
-- from deadlocking a concurrent terminal provider-output reconciliation.

create or replace function public.command_bind_world_regeneration_job(
  p_regeneration_request_id uuid,
  p_world_anchor_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request private.world_regeneration_requests%rowtype;
  job private.world_anchor_jobs%rowtype;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception 'service authority required' using errcode = '42501';
  end if;

  select * into job
  from private.world_anchor_jobs
  where id = p_world_anchor_job_id
  for update;
  select * into request
  from private.world_regeneration_requests
  where id = p_regeneration_request_id
  for update;

  if request.id is null or request.state <> 'queued'
    or job.id is null
    or job.preflight_run_id <> request.preflight_run_id
    or job.workspace_id <> request.workspace_id
    or job.entity_kind <> request.entity_kind
    or coalesce(job.character_form_id, job.location_id) <> request.entity_id
  then
    raise exception 'world regeneration job binding is stale'
      using errcode = '40001';
  end if;
  if request.world_anchor_job_id is not null
    and request.world_anchor_job_id <> job.id
  then
    raise exception 'world regeneration job replay conflicts'
      using errcode = '40001';
  end if;

  update private.world_regeneration_requests
  set world_anchor_job_id = job.id
  where id = request.id;
  update private.world_anchor_jobs
  set regeneration_request_id = request.id
  where id = job.id;

  return jsonb_build_object(
    'jobId', job.id,
    'ok', true,
    'regenerationRequestId', request.id
  );
end;
$$;

revoke all on function public.command_bind_world_regeneration_job(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.command_bind_world_regeneration_job(uuid, uuid)
to service_role;

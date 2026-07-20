create or replace function public.get_world_anchor_ingest_context(
  p_provider_request_id uuid
)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare job private.world_anchor_jobs%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into job from private.world_anchor_jobs
    where provider_request_id=p_provider_request_id;
  if job.id is null or job.state not in ('waiting_output','promoted') then
    raise exception 'world anchor ingest context is stale' using errcode='40001'; end if;
  return jsonb_build_object('jobId',job.id,'workspaceId',job.workspace_id,
    'providerRequestId',job.provider_request_id,'targetAssetId',job.target_asset_id,
    'entityKind',job.entity_kind,'assetKind',case job.entity_kind
      when 'character' then 'character_anchor' else 'location_anchor' end);
end;
$$;

revoke all on function public.get_world_anchor_ingest_context(uuid)
from public,anon,authenticated;
grant execute on function public.get_world_anchor_ingest_context(uuid)
to service_role;

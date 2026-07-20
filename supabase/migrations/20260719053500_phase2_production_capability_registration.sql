-- Forward completion of the production capability registry: every video route
-- pins both official-schema evidence and an authenticated provider canary.

alter table private.production_provider_capability_versions
  add column canary_evidence_snapshot_id uuid not null
    references private.provider_evidence_snapshots(id) on delete restrict;

create index production_capability_canary_idx
  on private.production_provider_capability_versions(canary_evidence_snapshot_id);

create or replace function public.command_record_production_provider_capability(
  p_capability_version_id uuid,p_provider_account_id uuid,p_capability_key text,
  p_provider_family text,p_model_key text,p_model_version text,p_endpoint_key text,
  p_motion_class text,p_duration_min_ms integer,p_duration_max_ms integer,
  p_duration_quantum_ms integer,p_maximum_reference_count integer,
  p_maximum_width integer,p_maximum_height integer,p_schema_evidence_snapshot_id uuid,
  p_canary_evidence_snapshot_id uuid,p_schema_hash text,p_verified_at timestamptz,
  p_expires_at timestamptz
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare account private.provider_accounts%rowtype;
  schema_evidence private.provider_evidence_snapshots%rowtype;
  canary_evidence private.provider_evidence_snapshots%rowtype;
  computed_hash text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501';
  end if;
  select * into account from private.provider_accounts where id=p_provider_account_id;
  select * into schema_evidence from private.provider_evidence_snapshots
    where id=p_schema_evidence_snapshot_id;
  select * into canary_evidence from private.provider_evidence_snapshots
    where id=p_canary_evidence_snapshot_id;
  computed_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'providerAccountId',p_provider_account_id,'capabilityKey',p_capability_key,
    'providerFamily',p_provider_family,'modelKey',p_model_key,'modelVersion',p_model_version,
    'endpointKey',p_endpoint_key,'motionClass',p_motion_class,
    'durationMinMs',p_duration_min_ms,'durationMaxMs',p_duration_max_ms,
    'durationQuantumMs',p_duration_quantum_ms,'maximumReferenceCount',p_maximum_reference_count,
    'maximumWidth',p_maximum_width,'maximumHeight',p_maximum_height,
    'schemaEvidenceHash',schema_evidence.canonical_hash,
    'canaryEvidenceHash',canary_evidence.canonical_hash)::text,'UTF8'),'sha256'),'hex');
  if account.id is null or account.state<>'active' or account.provider<>p_provider_family
    or schema_evidence.id is null or schema_evidence.provider_account_id<>account.id
    or schema_evidence.evidence_kind<>'official_schema' or schema_evidence.verification_state<>'verified'
    or canary_evidence.id is null or canary_evidence.provider_account_id<>account.id
    or canary_evidence.evidence_kind<>'canary' or canary_evidence.verification_state<>'verified'
    or schema_evidence.expires_at<p_expires_at or canary_evidence.expires_at<p_expires_at
    or p_verified_at<greatest(schema_evidence.retrieved_at,canary_evidence.retrieved_at)
    or p_expires_at<=p_verified_at or p_schema_hash is distinct from computed_hash
  then raise exception 'production capability evidence is invalid' using errcode='40001'; end if;
  insert into private.production_provider_capability_versions(
    id,provider_account_id,capability_key,provider_family,model_key,model_version,
    endpoint_key,motion_class,duration_min_ms,duration_max_ms,duration_quantum_ms,
    maximum_reference_count,maximum_width,maximum_height,evidence_snapshot_id,
    canary_evidence_snapshot_id,schema_hash,verified_at,expires_at,state
  ) values(p_capability_version_id,account.id,p_capability_key,p_provider_family,p_model_key,
    p_model_version,p_endpoint_key,p_motion_class,p_duration_min_ms,p_duration_max_ms,
    p_duration_quantum_ms,p_maximum_reference_count,p_maximum_width,p_maximum_height,
    schema_evidence.id,canary_evidence.id,p_schema_hash,p_verified_at,p_expires_at,'verified');
  return p_capability_version_id;
end;
$$;

revoke all on function public.command_record_production_provider_capability(
  uuid,uuid,text,text,text,text,text,text,integer,integer,integer,integer,integer,
  integer,uuid,uuid,text,timestamptz,timestamptz
) from public,anon,authenticated;
grant execute on function public.command_record_production_provider_capability(
  uuid,uuid,text,text,text,text,text,text,integer,integer,integer,integer,integer,
  integer,uuid,uuid,text,timestamptz,timestamptz
) to service_role;

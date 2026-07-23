-- Real-world temple, festival, and ritual anchors use Nano Banana edit with
-- researched references. Keep the edit capability under the same two-evidence
-- contract as text-to-image: official schema plus a verified account canary.

create or replace function public.command_ensure_fal_world_edit_capability(
  p_workspace_id uuid,p_environment text,p_schema_raw_sha256 text,
  p_schema_canonical_hash text,p_canary_raw_sha256 text,p_canary_canonical_hash text,
  p_retrieved_at timestamptz,p_expires_at timestamptz
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  account private.provider_accounts%rowtype;
  schema_evidence private.provider_evidence_snapshots%rowtype;
  canary_evidence private.provider_evidence_snapshots%rowtype;
  capability private.provider_capabilities%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_environment not in ('development','preview','production','test')
    or p_schema_raw_sha256 !~ '^[a-f0-9]{64}$'
    or p_schema_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_canary_raw_sha256 !~ '^[a-f0-9]{64}$'
    or p_canary_canonical_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at<=p_retrieved_at
    or p_expires_at>p_retrieved_at+interval '90 days'
  then raise exception 'fal world edit capability evidence is invalid' using errcode='22023'; end if;
  insert into private.provider_accounts(
    workspace_id,environment,provider,account_key,credential_secret_ref,region,state
  ) values(
    p_workspace_id,p_environment,'fal','fal-world-images','FAL_KEY','global','active'
  ) on conflict(workspace_id,environment,account_key) do update
    set state='active',aggregate_version=private.provider_accounts.aggregate_version+1
  returning * into account;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(
    account.id,'official_schema',
    encode(extensions.digest(convert_to('https://fal.ai/models/fal-ai/nano-banana-2/edit','UTF8'),'sha256'),'hex'),
    p_schema_raw_sha256,p_schema_canonical_hash,
    'provider-evidence/fal/nano-banana-2-edit/schema-'||p_schema_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at
  ) on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into schema_evidence from private.provider_evidence_snapshots
  where provider_account_id=account.id and evidence_kind='official_schema'
    and canonical_hash=p_schema_canonical_hash;
  insert into private.provider_evidence_snapshots(
    provider_account_id,evidence_kind,source_url_hash,raw_object_sha256,
    canonical_hash,storage_object_name,verification_state,retrieved_at,expires_at
  ) values(
    account.id,'canary',
    encode(extensions.digest(convert_to('fal-account-edit-canary:2026-07-19','UTF8'),'sha256'),'hex'),
    p_canary_raw_sha256,p_canary_canonical_hash,
    'provider-evidence/fal/nano-banana-2-edit/canary-'||p_canary_canonical_hash||'.json',
    'verified',p_retrieved_at,p_expires_at
  ) on conflict(provider_account_id,evidence_kind,canonical_hash) do nothing;
  select * into canary_evidence from private.provider_evidence_snapshots
  where provider_account_id=account.id and evidence_kind='canary'
    and canonical_hash=p_canary_canonical_hash;
  select registered.* into capability
  from private.provider_capabilities registered
  where registered.provider_account_id=account.id
    and registered.capability='edit_image'
    and registered.model_key='fal-ai/nano-banana-2/edit'
    and registered.schema_version='genie.fal-nano-banana-2-edit.v1';
  if capability.id is null then
    insert into private.provider_capabilities(
      provider_account_id,capability,model_key,model_version,endpoint_key,
      schema_version,evidence_snapshot_id,canary_evidence_snapshot_id,
      currency,unit_name,unit_price_minor,maximum_request_minor,retention_class,
      verified_at,expires_at,status
    ) values(
      account.id,'edit_image','fal-ai/nano-banana-2/edit','2026-07-19',
      'nano-banana-2-edit','genie.fal-nano-banana-2-edit.v1',
      schema_evidence.id,canary_evidence.id,'USD','image',12,12,
      'account_opt_out',greatest(p_retrieved_at,canary_evidence.retrieved_at),
      least(p_expires_at,schema_evidence.expires_at,canary_evidence.expires_at),
      'verified'
    ) returning * into capability;
  end if;
  if capability.status<>'verified' or capability.expires_at<=statement_timestamp()
    or capability.unit_price_minor<>12 or capability.maximum_request_minor<>12
    or capability.evidence_snapshot_id<>schema_evidence.id
    or capability.canary_evidence_snapshot_id<>canary_evidence.id
  then raise exception 'fal world edit capability is not current' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'providerAccountId',account.id,
    'capabilityId',capability.id,'schemaEvidenceId',schema_evidence.id,
    'canaryEvidenceId',canary_evidence.id,'unitPriceMinor',capability.unit_price_minor,
    'expiresAt',capability.expires_at);
end;
$$;

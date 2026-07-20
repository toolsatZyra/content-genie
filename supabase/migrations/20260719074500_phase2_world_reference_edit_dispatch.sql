-- Reference-conditioned named-temple anchors use the verified Nano Banana edit
-- endpoint. A preparation may mix text-to-image and edit-image jobs while each
-- quote line, request, grant, and retry remains bound to its exact capability.

alter table private.world_anchor_jobs
  add column provider_capability_id uuid references private.provider_capabilities(id) on delete restrict;

update private.world_anchor_jobs job
set provider_capability_id=preparation.provider_capability_id
from private.world_anchor_preparations preparation
where preparation.id=job.preparation_id;

alter table private.world_anchor_jobs
  alter column provider_capability_id set not null;

create index world_anchor_jobs_capability_idx
on private.world_anchor_jobs(provider_capability_id);

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
  select * into capability from private.provider_capabilities
  where provider_account_id=account.id and capability='edit_image'
    and model_key='fal-ai/nano-banana-2/edit'
    and schema_version='genie.fal-nano-banana-2-edit.v1';
  if capability.id is null then
    insert into private.provider_capabilities(
      provider_account_id,capability,model_key,model_version,endpoint_key,
      schema_version,evidence_snapshot_id,currency,unit_name,unit_price_minor,
      maximum_request_minor,retention_class,verified_at,expires_at,status
    ) values(
      account.id,'edit_image','fal-ai/nano-banana-2/edit','2026-07-19',
      'nano-banana-2-edit','genie.fal-nano-banana-2-edit.v1',schema_evidence.id,
      'USD','image',12,12,'account_opt_out',
      greatest(p_retrieved_at,canary_evidence.retrieved_at),
      least(p_expires_at,schema_evidence.expires_at,canary_evidence.expires_at),'verified'
    ) returning * into capability;
  end if;
  if capability.status<>'verified' or capability.expires_at<=statement_timestamp()
    or capability.unit_price_minor<>12 or capability.maximum_request_minor<>12
  then raise exception 'fal world edit capability is not current' using errcode='40001'; end if;
  return jsonb_build_object('ok',true,'providerAccountId',account.id,
    'capabilityId',capability.id,'schemaEvidenceId',schema_evidence.id,
    'canaryEvidenceId',canary_evidence.id,'unitPriceMinor',capability.unit_price_minor,
    'expiresAt',capability.expires_at);
end;
$$;

create or replace function public.command_prepare_world_anchor_jobs(
  p_preflight_run_id uuid,p_stage_attempt_id uuid,p_world_extraction_result_id uuid,
  p_provider_capability_id uuid,p_jobs jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  run public.preflight_runs%rowtype;
  attempt public.preflight_stage_attempts%rowtype;
  extraction private.world_extraction_results%rowtype;
  intent private.world_build_spend_intents%rowtype;
  default_capability private.provider_capabilities%rowtype;
  job_capability private.provider_capabilities%rowtype;
  preparation private.world_anchor_preparations%rowtype;
  quote_id uuid:=gen_random_uuid(); authorization_id uuid:=gen_random_uuid();
  reservation_id uuid:=gen_random_uuid(); prep_id uuid:=gen_random_uuid();
  job jsonb; line_id uuid; manifest_id uuid; manifest_hash text; prompt_hash text;
  manifest_hash_world text; quote_hash text; rate_hash text; job_count integer;
  line_no integer:=0; total_minor bigint; preparation_hash text;
  response_jobs jsonb:='[]'::jsonb; rate_set jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if jsonb_typeof(p_jobs)<>'array' or jsonb_array_length(p_jobs) not between 1 and 32
    or pg_column_size(p_jobs)>524288
  then raise exception 'world anchor jobs envelope is invalid' using errcode='22023'; end if;
  select * into preparation from private.world_anchor_preparations
  where preflight_run_id=p_preflight_run_id;
  if found then
    if preparation.world_extraction_result_id<>p_world_extraction_result_id
      or preparation.stage_attempt_id<>p_stage_attempt_id
    then raise exception 'world anchor preparation replay conflicts' using errcode='40001'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
      'jobId',j.id,'slotKey',j.slot_key,'state',j.state,
      'providerRequestId',j.provider_request_id,
      'capabilityGrantId',j.capability_grant_id,'capabilityJti',j.capability_jti,
      'inputManifestId',j.input_manifest_id,'inputManifestHash',j.input_manifest_hash,
      'quoteLineId',j.micro_quote_line_id,'targetAssetId',j.target_asset_id,
      'operation',capability.capability
    ) order by j.slot_key),'[]'::jsonb) into response_jobs
    from private.world_anchor_jobs j
    join private.provider_capabilities capability on capability.id=j.provider_capability_id
    where j.preparation_id=preparation.id;
    return jsonb_build_object('ok',true,'replayed',true,'preparationId',preparation.id,
      'jobs',response_jobs,'totalMinor',(
        select total_minor from private.micro_quotes where id=preparation.micro_quote_id));
  end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and preflight_run_id=run.id for update;
  select * into extraction from private.world_extraction_results
    where id=p_world_extraction_result_id and preflight_run_id=run.id;
  select * into default_capability from private.provider_capabilities
    where id=p_provider_capability_id and capability='gen_image'
      and model_key='fal-ai/nano-banana-2'
      and schema_version='genie.fal-nano-banana-2.v1'
      and status='verified' and expires_at>statement_timestamp();
  select * into intent from private.world_build_spend_intents
    where configuration_candidate_id=run.configuration_candidate_id and state='active'
      and expires_at>statement_timestamp() for update;
  if run.id is null or run.kind<>'world_anchor' or run.state<>'running'
    or attempt.id is null or attempt.state<>'claimed'
    or attempt.authority_epoch<>run.authority_epoch
    or extraction.id is null or extraction.script_revision_id<>run.script_revision_id
    or intent.id is null or extraction.look_version_id<>intent.look_version_id
    or intent.workspace_id<>run.workspace_id or intent.episode_id<>run.episode_id
    or intent.script_revision_id<>run.script_revision_id
    or default_capability.id is null or default_capability.unit_price_minor<>12
  then raise exception 'world anchor preparation authority is stale' using errcode='40001'; end if;
  for job in select value from jsonb_array_elements(p_jobs)
  loop
    if jsonb_typeof(job)<>'object' or (job-array[
      'jobId','slotKey','entityKind','characterId','characterFormId','characterKey','characterName',
      'formKey','formName','locationId','locationKey','locationName','namedTemple','realPlaceName',
      'promptText','negativePromptText','worldManifest','worldManifestHash','templeEvidenceSetHash',
      'targetAssetId','capabilityJti','providerCapabilityId','operation','providerPayload'
    ]::text[])<>'{}'::jsonb or not(job?&array[
      'jobId','slotKey','entityKind','characterId','characterFormId','characterKey','characterName',
      'formKey','formName','locationId','locationKey','locationName','namedTemple','realPlaceName',
      'promptText','negativePromptText','worldManifest','worldManifestHash','templeEvidenceSetHash',
      'targetAssetId','capabilityJti','providerCapabilityId','operation','providerPayload'
    ]) or job->>'slotKey' !~ '^[a-z][a-z0-9_.:-]{2,140}$'
      or job->>'entityKind' not in ('character','location')
      or job->>'operation' not in ('gen_image','edit_image')
      or char_length(job->>'promptText') not between 1 and 16000
      or jsonb_typeof(job->'providerPayload')<>'object'
      or jsonb_typeof(job->'worldManifest')<>'object'
    then raise exception 'world anchor job is not exact' using errcode='22023'; end if;
    select * into job_capability from private.provider_capabilities
    where id=(job->>'providerCapabilityId')::uuid
      and capability=job->>'operation' and status='verified'
      and expires_at>statement_timestamp() and unit_price_minor=12
      and maximum_request_minor=12
      and provider_account_id=default_capability.provider_account_id;
    if job_capability.id is null
      or ((job->>'namedTemple')::boolean and (
        job->>'operation'<>'edit_image'
        or job->>'templeEvidenceSetHash' !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(job->'providerPayload'->'imageUrls')<>'array'
        or jsonb_array_length(job->'providerPayload'->'imageUrls') not between 2 and 4
      ))
      or (not (job->>'namedTemple')::boolean and (
        job->>'operation'<>'gen_image' or job->>'templeEvidenceSetHash' is not null
      ))
    then raise exception 'world anchor capability or temple evidence is invalid' using errcode='40001'; end if;
  end loop;
  job_count:=jsonb_array_length(p_jobs); total_minor:=job_count*12;
  if total_minor>384 or total_minor>intent.hard_ceiling_minor then
    raise exception 'world anchor jobs exceed human ceiling' using errcode='54000'; end if;
  select jsonb_agg(jsonb_build_object(
    'capabilityId',capability.id,'operation',capability.capability,
    'modelKey',capability.model_key,'schemaVersion',capability.schema_version,
    'unitPriceMinor',capability.unit_price_minor,'expiresAt',capability.expires_at
  ) order by capability.capability) into rate_set
  from private.provider_capabilities capability
  where capability.id in(
    select distinct(value->>'providerCapabilityId')::uuid
    from jsonb_array_elements(p_jobs)
  );
  quote_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'configurationCandidateId',run.configuration_candidate_id,
    'extractionHash',extraction.extraction_hash,'rates',rate_set,
    'jobs',p_jobs,'totalMinor',total_minor
  )::text,'UTF8'),'sha256'),'hex');
  rate_hash:=encode(extensions.digest(convert_to(rate_set::text,'UTF8'),'sha256'),'hex');
  insert into private.micro_quotes(
    id,workspace_id,episode_id,configuration_candidate_id,script_revision_id,
    preflight_kind,quote_number,quote_hash,rate_snapshot_hash,currency,total_minor,
    state,expires_at,confirmed_at
  ) values(
    quote_id,run.workspace_id,run.episode_id,run.configuration_candidate_id,
    run.script_revision_id,'world_anchor',coalesce((
      select max(q.quote_number)+1 from private.micro_quotes q
      where q.configuration_candidate_id=run.configuration_candidate_id
        and q.preflight_kind='world_anchor'),1),quote_hash,rate_hash,'USD',total_minor,
    'confirmed',least(intent.expires_at,statement_timestamp()+interval '24 hours'),
    statement_timestamp()
  );
  insert into private.micro_authorizations(
    id,workspace_id,micro_quote_id,configuration_candidate_id,script_revision_id,
    authorized_by,actor_authority_epoch,aal,quote_hash,hard_ceiling_minor,state,expires_at
  ) values(
    authorization_id,run.workspace_id,quote_id,run.configuration_candidate_id,
    run.script_revision_id,intent.authorized_by,intent.actor_authority_epoch,'aal2',
    quote_hash,total_minor,'active',
    least(intent.expires_at,statement_timestamp()+interval '24 hours')
  );
  insert into private.micro_reservations(
    id,workspace_id,micro_quote_id,micro_authorization_id,amount_minor,state,expires_at
  ) values(
    reservation_id,run.workspace_id,quote_id,authorization_id,total_minor,'held',
    least(intent.expires_at,statement_timestamp()+interval '24 hours')
  );
  update public.preflight_runs set requires_micro_authority=true,micro_quote_id=quote_id,
    micro_authorization_id=authorization_id,micro_reservation_id=reservation_id,
    aggregate_version=aggregate_version+1 where id=run.id returning * into run;
  preparation_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'runId',run.id,'attemptId',attempt.id,'extractionId',extraction.id,
    'quoteHash',quote_hash,'jobs',p_jobs
  )::text,'UTF8'),'sha256'),'hex');
  insert into private.world_anchor_preparations(
    id,workspace_id,preflight_run_id,stage_attempt_id,world_extraction_result_id,
    spend_intent_id,provider_capability_id,micro_quote_id,micro_authorization_id,
    micro_reservation_id,job_count,preparation_hash
  ) values(
    prep_id,run.workspace_id,run.id,attempt.id,extraction.id,intent.id,
    default_capability.id,quote_id,authorization_id,reservation_id,job_count,
    preparation_hash
  ) returning * into preparation;
  for job in select value from jsonb_array_elements(p_jobs)
  loop
    line_no:=line_no+1;
    select * into job_capability from private.provider_capabilities
    where id=(job->>'providerCapabilityId')::uuid;
    prompt_hash:=encode(extensions.digest(convert_to(job->>'promptText','UTF8'),'sha256'),'hex');
    manifest_hash_world:=encode(extensions.digest(convert_to((job->'worldManifest')::text,'UTF8'),'sha256'),'hex');
    if job->>'worldManifestHash'<>manifest_hash_world then
      raise exception 'world anchor manifest hash is invalid' using errcode='22023'; end if;
    manifest_id:=gen_random_uuid(); line_id:=gen_random_uuid();
    manifest_hash:=encode(extensions.digest(convert_to((job->'providerPayload')::text,'UTF8'),'sha256'),'hex');
    insert into private.micro_quote_lines(
      id,micro_quote_id,line_number,slot_key,capability_id,operation,quantity,
      unit_price_minor,amount_minor,request_schema_hash
    ) values(
      line_id,quote_id,line_no,job->>'slotKey',job_capability.id,
      job_capability.capability,1,12,12,
      encode(extensions.digest(convert_to(job_capability.schema_version,'UTF8'),'sha256'),'hex')
    );
    insert into private.provider_input_manifests(
      id,workspace_id,operation,payload_schema_version,payload_json,content_hash
    ) values(
      manifest_id,run.workspace_id,job_capability.capability,
      job_capability.schema_version,job->'providerPayload',manifest_hash
    );
    insert into private.world_anchor_jobs(
      id,workspace_id,preparation_id,preflight_run_id,stage_attempt_id,slot_key,
      entity_kind,character_id,character_form_id,character_key,character_name,
      form_key,form_name,location_id,location_key,location_name,named_temple,
      real_place_name,prompt_text,prompt_sha256,negative_prompt_text,world_manifest,
      world_manifest_hash,temple_evidence_set_hash,target_asset_id,micro_quote_line_id,
      input_manifest_id,input_manifest_hash,capability_jti,provider_capability_id
    ) values(
      (job->>'jobId')::uuid,run.workspace_id,prep_id,run.id,attempt.id,
      job->>'slotKey',job->>'entityKind',(job->>'characterId')::uuid,
      (job->>'characterFormId')::uuid,job->>'characterKey',job->>'characterName',
      job->>'formKey',job->>'formName',(job->>'locationId')::uuid,
      job->>'locationKey',job->>'locationName',(job->>'namedTemple')::boolean,
      job->>'realPlaceName',job->>'promptText',prompt_hash,job->>'negativePromptText',
      job->'worldManifest',manifest_hash_world,job->>'templeEvidenceSetHash',
      (job->>'targetAssetId')::uuid,line_id,manifest_id,manifest_hash,
      (job->>'capabilityJti')::uuid,job_capability.id
    );
    response_jobs:=response_jobs||jsonb_build_array(jsonb_build_object(
      'jobId',job->>'jobId','slotKey',job->>'slotKey','state','reserved',
      'providerRequestId',null,'capabilityGrantId',null,
      'capabilityJti',job->>'capabilityJti','inputManifestId',manifest_id,
      'inputManifestHash',manifest_hash,'quoteLineId',line_id,
      'targetAssetId',job->>'targetAssetId','operation',job_capability.capability
    ));
  end loop;
  update private.world_build_spend_intents set state='consumed',consumed_at=statement_timestamp()
  where id=intent.id;
  return jsonb_build_object('ok',true,'replayed',false,'preparationId',preparation.id,
    'jobs',response_jobs,'totalMinor',total_minor);
end;
$$;

create or replace function public.command_ensure_world_anchor_retry_pool(
  p_preflight_run_id uuid,p_stage_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  preparation private.world_anchor_preparations%rowtype;
  pool_row private.world_anchor_retry_pools%rowtype;
  quote_row private.micro_quotes%rowtype; auth_row private.micro_authorizations%rowtype;
  reservation_row private.micro_reservations%rowtype;
  retry_job private.world_anchor_jobs%rowtype;
  capability private.provider_capabilities%rowtype;
  pooled_hash text; line_number integer; retry_index integer;
  retry_slots integer; allocation jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  select * into run from public.preflight_runs where id=p_preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts
    where id=p_stage_attempt_id and preflight_run_id=run.id for update;
  select * into preparation from private.world_anchor_preparations
    where preflight_run_id=run.id for update;
  select * into pool_row from private.world_anchor_retry_pools
    where preparation_id=preparation.id;
  if found then return jsonb_build_object(
    'ok',true,'replayed',true,'preparationId',preparation.id,
    'primarySlotCount',pool_row.primary_slot_count,
    'retrySlotCount',pool_row.retry_slot_count,
    'hardCeilingMinor',pool_row.hard_ceiling_minor,
    'pooledQuoteHash',pool_row.pooled_quote_hash); end if;
  select * into quote_row from private.micro_quotes where id=preparation.micro_quote_id for update;
  select * into auth_row from private.micro_authorizations where id=preparation.micro_authorization_id for update;
  select * into reservation_row from private.micro_reservations where id=preparation.micro_reservation_id for update;
  if run.id is null or run.kind<>'world_anchor' or run.state<>'running'
    or attempt.id is null or attempt.state<>'claimed'
    or preparation.id is null or preparation.stage_attempt_id<>attempt.id
    or quote_row.id is null or quote_row.state<>'confirmed'
    or auth_row.id is null or auth_row.state<>'active'
    or reservation_row.id is null or reservation_row.state<>'held'
    or auth_row.hard_ceiling_minor<>preparation.job_count*12
    or reservation_row.amount_minor<>preparation.job_count*12
    or quote_row.total_minor<>preparation.job_count*12
    or quote_row.expires_at<=statement_timestamp()
    or auth_row.expires_at<=statement_timestamp()
    or reservation_row.expires_at<=statement_timestamp()
    or exists(
      select 1 from private.world_anchor_jobs job
      join private.provider_capabilities registered on registered.id=job.provider_capability_id
      where job.preparation_id=preparation.id and(
        registered.status<>'verified' or registered.expires_at<=statement_timestamp()
        or registered.unit_price_minor<>12 or registered.maximum_request_minor<>12
        or registered.capability not in('gen_image','edit_image')
      )
    )
  then raise exception 'world anchor retry pool authority is stale' using errcode='40001'; end if;
  retry_slots:=32-preparation.job_count;
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId',job.id,'capabilityId',job.provider_capability_id,
    'operation',registered.capability
  ) order by job.slot_key),'[]'::jsonb) into allocation
  from private.world_anchor_jobs job
  join private.provider_capabilities registered on registered.id=job.provider_capability_id
  where job.preparation_id=preparation.id;
  pooled_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'schemaVersion','genie.world-anchor-retry-pool.v2',
    'preparationId',preparation.id,'originalQuoteHash',quote_row.quote_hash,
    'primarySlotCount',preparation.job_count,'retrySlotCount',retry_slots,
    'allocation',allocation,'unitPriceMinor',12,'hardCeilingMinor',384
  )::text,'UTF8'),'sha256'),'hex');
  retry_index:=0;
  if retry_slots>0 then
    for line_number in (preparation.job_count+1)..32 loop
      select * into retry_job from private.world_anchor_jobs job
      where job.preparation_id=preparation.id order by job.slot_key
      offset retry_index%preparation.job_count limit 1;
      select * into capability from private.provider_capabilities
      where id=retry_job.provider_capability_id;
      insert into private.micro_quote_lines(
        micro_quote_id,line_number,slot_key,capability_id,operation,quantity,
        unit_price_minor,amount_minor,request_schema_hash
      ) values(
        quote_row.id,line_number,
        'retry.pool.'||lpad((retry_index+1)::text,2,'0')||'.'||replace(left(retry_job.id::text,8),'-',''),
        capability.id,capability.capability,1,12,12,
        encode(extensions.digest(convert_to(capability.schema_version,'UTF8'),'sha256'),'hex')
      );
      retry_index:=retry_index+1;
    end loop;
  end if;
  update private.micro_quotes set quote_hash=pooled_hash,total_minor=384 where id=quote_row.id;
  update private.micro_authorizations set quote_hash=pooled_hash,hard_ceiling_minor=384,
    aggregate_version=aggregate_version+1 where id=auth_row.id;
  update private.micro_reservations set amount_minor=384,
    aggregate_version=aggregate_version+1 where id=reservation_row.id;
  insert into private.world_anchor_retry_pools(
    preparation_id,workspace_id,micro_quote_id,original_quote_hash,
    pooled_quote_hash,primary_slot_count,retry_slot_count,hard_ceiling_minor
  ) values(
    preparation.id,preparation.workspace_id,quote_row.id,quote_row.quote_hash,
    pooled_hash,preparation.job_count,retry_slots,384
  ) returning * into pool_row;
  return jsonb_build_object(
    'ok',true,'replayed',false,'preparationId',preparation.id,
    'primarySlotCount',pool_row.primary_slot_count,
    'retrySlotCount',pool_row.retry_slot_count,
    'hardCeilingMinor',pool_row.hard_ceiling_minor,
    'pooledQuoteHash',pool_row.pooled_quote_hash);
end;
$$;

create or replace function public.command_claim_world_anchor_provider_job(
  p_job_id uuid,p_idempotency_key text,p_correlation_id uuid
)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  job private.world_anchor_jobs%rowtype;
  preparation private.world_anchor_preparations%rowtype;
  run public.preflight_runs%rowtype; attempt public.preflight_stage_attempts%rowtype;
  capability private.provider_capabilities%rowtype;
  request private.provider_requests%rowtype; predecessor private.provider_requests%rowtype;
  grant_id uuid; scope_hash text; selected_line_id uuid; request_attempt integer;
  effective_idempotency text; effective_correlation uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if char_length(p_idempotency_key) not between 8 and 160 then
    raise exception 'world anchor provider idempotency key is invalid' using errcode='22023'; end if;
  select * into job from private.world_anchor_jobs where id=p_job_id for update;
  if job.id is null then raise exception 'world anchor provider job not found' using errcode='P0002'; end if;
  select * into preparation from private.world_anchor_preparations where id=job.preparation_id;
  select * into capability from private.provider_capabilities where id=job.provider_capability_id;
  if job.provider_request_id is not null then
    select * into request from private.provider_requests where id=job.provider_request_id;
    if request.state<>'failed_retryable' then
      return jsonb_build_object(
        'ok',true,'replayed',true,'jobId',job.id,'providerRequestId',request.id,
        'providerRequestState',request.state,'capabilityGrantId',job.capability_grant_id,
        'capabilityJti',job.capability_jti,'workspaceId',job.workspace_id,
        'preflightRunId',job.preflight_run_id,'stageAttemptId',job.stage_attempt_id,
        'stageRunId',(select preflight_stage_run_id from public.preflight_stage_attempts where id=job.stage_attempt_id),
        'authorityEpoch',(select authority_epoch from public.preflight_stage_attempts where id=job.stage_attempt_id),
        'fencingToken',(select fencing_token from public.preflight_stage_attempts where id=job.stage_attempt_id),
        'inputManifestId',job.input_manifest_id,'inputManifestHash',job.input_manifest_hash,
        'quoteLineId',job.micro_quote_line_id,'operation',request.operation);
    end if;
    predecessor:=request;
    select line.id into selected_line_id from private.micro_quote_lines line
    left join private.provider_request_quote_claims claim on claim.micro_quote_line_id=line.id
    where line.micro_quote_id=preparation.micro_quote_id
      and line.slot_key like 'retry.pool.%'
      and line.capability_id=job.provider_capability_id
      and line.operation=capability.capability and claim.id is null
    order by line.line_number for update of line skip locked limit 1;
    if selected_line_id is null then
      raise exception 'world anchor compatible retry budget exhausted' using errcode='54000'; end if;
    select coalesce(max(history.attempt_no),0)+1 into request_attempt
    from private.world_anchor_job_requests history where history.job_id=job.id;
    effective_idempotency:=p_idempotency_key||':retry:'||request_attempt::text;
    effective_correlation:=gen_random_uuid();
    update private.world_anchor_jobs set micro_quote_line_id=selected_line_id,
      capability_jti=gen_random_uuid(),provider_request_id=null,
      capability_grant_id=null,state='reserved'
    where id=job.id returning * into job;
  else
    request_attempt:=1; effective_idempotency:=p_idempotency_key;
    effective_correlation:=p_correlation_id;
  end if;
  select * into run from public.preflight_runs where id=job.preflight_run_id for update;
  select * into attempt from public.preflight_stage_attempts where id=job.stage_attempt_id for update;
  if job.state<>'reserved' or run.state<>'running' or not run.requires_micro_authority
    or attempt.state<>'claimed' or attempt.authority_epoch<>run.authority_epoch
    or attempt.fencing_token<>(select highest_fencing_token from public.preflight_stage_runs where id=attempt.preflight_stage_run_id)
    or capability.status<>'verified' or capability.expires_at<=statement_timestamp()
    or capability.capability not in('gen_image','edit_image')
    or not exists(select 1 from private.world_anchor_retry_pools pool
      where pool.preparation_id=preparation.id and pool.micro_quote_id=run.micro_quote_id
        and pool.hard_ceiling_minor=384)
    or not exists(select 1 from private.micro_quote_lines line
      where line.id=job.micro_quote_line_id and line.micro_quote_id=run.micro_quote_id
        and line.capability_id=capability.id and line.operation=capability.capability
        and not exists(select 1 from private.provider_request_quote_claims claim
          where claim.micro_quote_line_id=line.id))
  then raise exception 'world anchor provider job authority is stale' using errcode='40001'; end if;
  insert into private.provider_requests(
    workspace_id,preflight_run_id,stage_attempt_id,provider_account_id,
    provider_capability_id,operation,request_schema_version,input_manifest_id,
    input_manifest_hash,idempotency_key,correlation_id,retry_of_id,
    expected_cost_minor,maximum_cost_minor
  ) values(
    job.workspace_id,run.id,attempt.id,capability.provider_account_id,capability.id,
    capability.capability,capability.schema_version,job.input_manifest_id,
    job.input_manifest_hash,effective_idempotency,effective_correlation,
    predecessor.id,12,12
  ) returning * into request;
  insert into private.provider_request_quote_claims(
    workspace_id,provider_request_id,preflight_run_id,micro_quote_line_id,
    micro_authorization_id,micro_reservation_id,authority_epoch,fencing_token
  ) values(
    job.workspace_id,request.id,run.id,job.micro_quote_line_id,
    run.micro_authorization_id,run.micro_reservation_id,run.authority_epoch,
    attempt.fencing_token
  );
  scope_hash:=encode(extensions.digest(convert_to(jsonb_build_object(
    'jobId',job.id,'targetAssetId',job.target_asset_id,
    'inputManifestHash',job.input_manifest_hash,'providerRequestId',request.id
  )::text,'UTF8'),'sha256'),'hex');
  insert into private.worker_capability_grants(
    workspace_id,preflight_run_id,stage_attempt_id,provider_request_id,
    micro_quote_line_id,capability,authority_epoch,fencing_token,input_manifest_hash,
    token_jti_hash,allowed_rpc,allowed_object_scope_hash,expires_at
  ) values(
    job.workspace_id,run.id,attempt.id,request.id,job.micro_quote_line_id,
    capability.capability,run.authority_epoch,attempt.fencing_token,
    job.input_manifest_hash,
    encode(extensions.digest(convert_to(job.capability_jti::text,'UTF8'),'sha256'),'hex'),
    'provider.submit_exact_request',scope_hash,statement_timestamp()+interval '5 minutes'
  ) returning id into grant_id;
  update private.world_anchor_jobs set provider_request_id=request.id,
    capability_grant_id=grant_id,state='dispatching'
  where id=job.id returning * into job;
  insert into private.world_anchor_job_requests(
    job_id,attempt_no,workspace_id,micro_quote_line_id,provider_request_id,
    capability_grant_id,predecessor_request_id
  ) values(
    job.id,request_attempt,job.workspace_id,job.micro_quote_line_id,request.id,
    grant_id,predecessor.id
  );
  return jsonb_build_object(
    'ok',true,'replayed',false,'jobId',job.id,'providerRequestId',request.id,
    'providerRequestState',request.state,'capabilityGrantId',grant_id,
    'capabilityJti',job.capability_jti,'workspaceId',job.workspace_id,
    'preflightRunId',job.preflight_run_id,'stageAttemptId',job.stage_attempt_id,
    'stageRunId',attempt.preflight_stage_run_id,'authorityEpoch',attempt.authority_epoch,
    'fencingToken',attempt.fencing_token,'inputManifestId',job.input_manifest_id,
    'inputManifestHash',job.input_manifest_hash,'quoteLineId',job.micro_quote_line_id,
    'operation',capability.capability);
end;
$$;

revoke all on function public.command_ensure_fal_world_edit_capability(
  uuid,text,text,text,text,text,timestamptz,timestamptz
) from public,anon,authenticated;
grant execute on function public.command_ensure_fal_world_edit_capability(
  uuid,text,text,text,text,text,timestamptz,timestamptz
) to service_role;

-- Qualified source and cultural readiness. Machine findings are evidence, not
-- authority; approval requires an active, in-scope, non-recused competency.

create table public.cultural_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null check (policy_key ~ '^[a-z][a-z0-9_.-]{2,100}$'),
  version_number integer not null check (version_number > 0),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object' and pg_column_size(manifest) <= 131072),
  manifest_hash text not null check (manifest_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('active','withdrawn')),
  created_at timestamptz not null default statement_timestamp(),
  unique (policy_key, version_number),
  unique (policy_key, manifest_hash)
);

create unique index cultural_policy_one_active_uq
  on public.cultural_policy_versions(policy_key) where state = 'active';

create table public.cultural_policy_rules (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.cultural_policy_versions(id) on delete restrict,
  rule_code text not null check (rule_code ~ '^GCP-[A-Z0-9-]{3,80}$'),
  content_class text not null check (content_class in (
    'deity_form','temple','ritual','shloka','violence','romance','caste_social','religious_conflict','rights','general'
  )),
  default_verdict text not null check (default_verdict in (
    'pass','advisory','repair_required','qualified_review_required','production_blocked','release_blocked'
  )),
  non_overridable boolean not null,
  rule_text text not null check (char_length(rule_text) between 10 and 2000),
  unique (policy_version_id, id),
  unique (policy_version_id, rule_code)
);

with input as (
  select jsonb_build_object(
    'language','Hindi','market','India','religiousConflict','prohibited',
    'nudity','prohibited','deityDignity','required',
    'namedTempleEvidenceMinimum',2,'shlokaEvidence','required',
    'vedicAndBijaSynthesis','human_recording_only'
  ) as manifest
), policy as (
  insert into public.cultural_policy_versions (
    policy_key, version_number, manifest, manifest_hash, state
  ) select 'genie-launch-hindu-devotional', 1, input.manifest,
    encode(extensions.digest(convert_to(input.manifest::text,'UTF8'),'sha256'),'hex'),
    'active' from input
  returning id
)
insert into public.cultural_policy_rules (
  policy_version_id, rule_code, content_class, default_verdict,
  non_overridable, rule_text
)
select policy.id, rule_code, content_class, default_verdict, true, rule_text
from policy cross join (values
  ('GCP-NUDITY-001','general','production_blocked','Nudity or sexualized treatment of a deity or minor is prohibited.'),
  ('GCP-CONFLICT-001','religious_conflict','production_blocked','Religious conflict, ridicule, conversion, incitement, or antagonistic comparison is prohibited.'),
  ('GCP-CASTE-001','caste_social','production_blocked','Degrading, hateful, biologically essentialist, or caricatured caste depiction is prohibited.'),
  ('GCP-ATTR-001','deity_form','production_blocked','Identity-defining deity attributes must match the declared form and evidence.'),
  ('GCP-MISATTR-001','general','release_blocked','Deliberate scriptural misattribution is prohibited.'),
  ('GCP-RIGHTS-001','rights','production_blocked','A required upload or reference without an eligible rights basis is prohibited.')
) as rules(rule_code,content_class,default_verdict,rule_text);

create table public.source_records (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  series_id uuid not null,
  stable_key text not null check (stable_key ~ '^[a-z0-9][a-z0-9_.-]{2,119}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  unique (workspace_id,series_id,stable_key),
  foreign key (workspace_id,series_id) references public.series(workspace_id,id) on delete restrict
);

create table public.source_record_versions (
  id uuid primary key,
  workspace_id uuid not null,
  source_record_id uuid not null,
  version_number integer not null check (version_number > 0),
  source_class text not null check (source_class in (
    'primary_text','traditional_commentary','temple_institutional','reputable_scholarship',
    'rights_cleared_photography','regional_retelling','popular_retelling','model_lead'
  )),
  title text not null check (char_length(title) between 1 and 500),
  language text not null check (char_length(language) between 2 and 80),
  edition_citation text not null default '' check (char_length(edition_citation) <= 2000),
  stable_url text check (stable_url is null or (stable_url ~ '^https://' and char_length(stable_url) <= 2048)),
  archive_handle text check (archive_handle is null or char_length(archive_handle) between 8 and 500),
  bounded_proposition text not null check (char_length(bounded_proposition) between 1 and 8000),
  rights_basis text not null check (char_length(rights_basis) between 2 and 2000),
  rights_status text not null check (rights_status in (
    'public_domain','licensed','internal_authorized','factual_reference_only','uncertain','prohibited'
  )),
  verification_state text not null check (verification_state in ('lead_only','verified','withdrawn')),
  contradiction_state text not null check (contradiction_state in ('none','disclosed_nonmaterial','material_unresolved','resolved')),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_hash text not null check (canonical_hash ~ '^[a-f0-9]{64}$'),
  creator_principal text not null check (char_length(creator_principal) between 3 and 200),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  unique (source_record_id,version_number),
  unique (source_record_id,canonical_hash),
  foreign key (workspace_id,source_record_id)
    references public.source_records(workspace_id,id) on delete restrict,
  check (source_class = 'model_lead' or verification_state <> 'lead_only'),
  check (source_class <> 'model_lead' or verification_state = 'lead_only')
);

create table public.reviewer_competency_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  traditions text[] not null check (cardinality(traditions) between 1 and 50),
  regions text[] not null check (cardinality(regions) between 1 and 50),
  languages text[] not null check (cardinality(languages) between 1 and 50),
  content_classes text[] not null check (cardinality(content_classes) between 1 and 50),
  appointment_issuer text not null check (char_length(appointment_issuer) between 2 and 300),
  appointment_evidence_hash text not null check (appointment_evidence_hash ~ '^[a-f0-9]{64}$'),
  effective_at timestamptz not null,
  expires_at timestamptz not null,
  appointed_by uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null unique,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  unique (workspace_id,reviewer_user_id,version_number),
  unique (workspace_id,appointed_by,idempotency_key),
  check (array_to_string(traditions,',') ~ '^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*$'),
  check (array_to_string(regions,',') ~ '^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*$'),
  check (array_to_string(languages,',') ~ '^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*$'),
  check (array_to_string(content_classes,',') ~ '^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*$'),
  check (expires_at > effective_at)
);

create table public.reviewer_competency_statuses (
  competency_version_id uuid primary key references public.reviewer_competency_versions(id) on delete restrict,
  workspace_id uuid not null,
  reviewer_user_id uuid not null,
  status text not null check (status in ('active','suspended','expired','revoked')),
  version bigint not null default 1 check (version > 0),
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default statement_timestamp(),
  reason text not null check (char_length(reason) between 2 and 1000),
  unique (workspace_id,competency_version_id),
  foreign key (workspace_id,competency_version_id)
    references public.reviewer_competency_versions(workspace_id,id) on delete restrict
);

create table public.reviewer_recusals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  subject_kind text not null check (subject_kind in ('series','configuration_candidate','source_record')),
  subject_id uuid not null,
  reason text not null check (char_length(reason) between 2 and 1000),
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  check (expires_at is null or expires_at > effective_at)
);

create table public.source_review_packets (
  id uuid primary key,
  workspace_id uuid not null,
  series_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  policy_version_id uuid not null references public.cultural_policy_versions(id) on delete restrict,
  packet_version integer not null check (packet_version > 0),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  source_set_hash text not null check (source_set_hash ~ '^[a-f0-9]{64}$'),
  evidence_set_hash text not null check (evidence_set_hash ~ '^[a-f0-9]{64}$'),
  tradition text not null check (char_length(tradition) between 2 and 100),
  region text not null check (char_length(region) between 2 and 100),
  language text not null check (char_length(language) between 2 and 100),
  content_classes text[] not null check (cardinality(content_classes) between 1 and 50),
  interpretation_labels text[] not null check (cardinality(interpretation_labels) between 1 and 20),
  machine_verdict text not null check (machine_verdict in ('eligible','qualified_review_required','blocked')),
  machine_evidence_hash text not null check (machine_evidence_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  unique (configuration_candidate_id,packet_version),
  unique (configuration_candidate_id,subject_hash,source_set_hash,evidence_set_hash),
  foreign key (workspace_id,series_id) references public.series(workspace_id,id) on delete restrict,
  foreign key (workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict
);

create table public.source_review_packet_sources (
  workspace_id uuid not null,
  source_review_packet_id uuid not null,
  source_record_version_id uuid not null,
  claim_class text not null check (claim_class in (
    'narrative','relationship','deity_form','ritual','temple','costume_social','sanskrit','sensitive_depiction','rights'
  )),
  primary key (source_review_packet_id,source_record_version_id,claim_class),
  foreign key (workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict,
  foreign key (workspace_id,source_record_version_id)
    references public.source_record_versions(workspace_id,id) on delete restrict
);

create table public.temple_evidence_links (
  workspace_id uuid not null,
  location_version_id uuid not null,
  source_record_version_id uuid not null,
  evidence_role text not null check (evidence_role in ('geometry','architecture','sacred_restriction','historical_period','rights')),
  primary key (location_version_id,source_record_version_id,evidence_role),
  foreign key (workspace_id,location_version_id)
    references public.location_versions(workspace_id,id) on delete restrict,
  foreign key (workspace_id,source_record_version_id)
    references public.source_record_versions(workspace_id,id) on delete restrict
);

create table public.deity_form_source_links (
  workspace_id uuid not null,
  character_version_id uuid not null,
  source_record_version_id uuid not null,
  evidence_role text not null check (evidence_role in ('form','attribute','mudra','weapon','ornament','vahana','dignity')),
  primary key (character_version_id,source_record_version_id,evidence_role),
  foreign key (workspace_id,character_version_id)
    references public.character_versions(workspace_id,id) on delete restrict,
  foreign key (workspace_id,source_record_version_id)
    references public.source_record_versions(workspace_id,id) on delete restrict
);

create table public.cultural_readiness_findings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_review_packet_id uuid not null,
  policy_version_id uuid not null,
  policy_rule_id uuid not null,
  subject_kind text not null check (subject_kind in ('script_span','character_version','location_version','source_record','world','general')),
  subject_id uuid,
  verdict text not null check (verdict in (
    'pass','advisory','repair_required','qualified_review_required','production_blocked','release_blocked'
  )),
  confidence numeric(5,4) not null check (confidence between 0 and 1),
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  safe_summary text not null check (char_length(safe_summary) between 2 and 2000),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  unique (source_review_packet_id,policy_rule_id,subject_kind,subject_id,evidence_hash),
  foreign key (workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict,
  foreign key (policy_version_id,policy_rule_id)
    references public.cultural_policy_rules(policy_version_id,id) on delete restrict
);

create table public.source_review_statuses (
  source_review_packet_id uuid primary key references public.source_review_packets(id) on delete restrict,
  workspace_id uuid not null,
  status text not null check (status in ('pending_qualified_review','approved','blocked','stale','withdrawn')),
  version bigint not null default 1 check (version > 0),
  selected_decision_id uuid,
  changed_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,source_review_packet_id),
  foreign key (workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict
);

create table public.source_review_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_review_packet_id uuid not null,
  policy_version_id uuid not null,
  competency_version_id uuid not null,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approve','block')),
  subject_hash text not null check (subject_hash ~ '^[a-f0-9]{64}$'),
  source_set_hash text not null check (source_set_hash ~ '^[a-f0-9]{64}$'),
  evidence_set_hash text not null check (evidence_set_hash ~ '^[a-f0-9]{64}$'),
  competency_scope_hash text not null check (competency_scope_hash ~ '^[a-f0-9]{64}$'),
  recusal_checked boolean not null check (recusal_checked),
  actor_aal text not null check (actor_aal = 'aal2'),
  rationale text not null check (char_length(rationale) between 2 and 4000),
  command_id uuid not null unique,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 200),
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique (workspace_id,id),
  unique (workspace_id,reviewer_user_id,idempotency_key),
  foreign key (workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict,
  foreign key (workspace_id,competency_version_id)
    references public.reviewer_competency_versions(workspace_id,id) on delete restrict
);

alter table public.source_review_statuses add constraint source_review_selected_decision_fk
foreign key (workspace_id,selected_decision_id)
references public.source_review_decisions(workspace_id,id) on delete restrict;

create trigger source_versions_immutable before update or delete on public.source_record_versions
for each row execute function private.reject_mutation();
create trigger competency_versions_immutable before update or delete on public.reviewer_competency_versions
for each row execute function private.reject_mutation();
create trigger cultural_policy_rules_immutable before update or delete on public.cultural_policy_rules
for each row execute function private.reject_mutation();
create trigger source_packets_immutable before update or delete on public.source_review_packets
for each row execute function private.reject_mutation();
create trigger cultural_findings_immutable before update or delete on public.cultural_readiness_findings
for each row execute function private.reject_mutation();
create trigger source_decisions_immutable before update or delete on public.source_review_decisions
for each row execute function private.reject_mutation();

create or replace function public.command_appoint_cultural_reviewer(
  p_workspace_id uuid, p_reviewer_user_id uuid,
  p_traditions text[], p_regions text[], p_languages text[], p_content_classes text[],
  p_appointment_issuer text, p_appointment_evidence_hash text,
  p_effective_at timestamptz, p_expires_at timestamptz,
  p_command_id uuid, p_idempotency_key text, p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := auth.uid();
  next_version integer;
  competency_id uuid;
  existing public.reviewer_competency_versions%rowtype;
begin
  if actor_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_aal2();
  if not private.has_workspace_role(p_workspace_id,actor_id,array['admin']::public.membership_role[])
    or not private.is_active_member(p_workspace_id,p_reviewer_user_id)
  then raise exception 'competency management permission required' using errcode = '42501'; end if;
  select * into existing from public.reviewer_competency_versions
  where workspace_id=p_workspace_id and appointed_by=actor_id
    and idempotency_key=p_idempotency_key;
  if found then
    if existing.request_hash<>p_request_hash then
      raise exception 'competency idempotency conflict' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'competencyVersionId',existing.id,
      'versionNumber',existing.version_number,'status','active');
  end if;
  if p_appointment_evidence_hash !~ '^[a-f0-9]{64}$' or p_expires_at <= p_effective_at
  then raise exception 'competency appointment evidence is invalid' using errcode = '22023'; end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.reviewer_competency_versions
  where workspace_id=p_workspace_id and reviewer_user_id=p_reviewer_user_id;
  insert into public.reviewer_competency_versions (
    workspace_id,reviewer_user_id,version_number,traditions,regions,languages,
    content_classes,appointment_issuer,appointment_evidence_hash,effective_at,
    expires_at,appointed_by,command_id,idempotency_key,request_hash
  ) values (
    p_workspace_id,p_reviewer_user_id,next_version,p_traditions,p_regions,p_languages,
    p_content_classes,p_appointment_issuer,p_appointment_evidence_hash,p_effective_at,
    p_expires_at,actor_id,p_command_id,p_idempotency_key,p_request_hash
  ) returning id into competency_id;
  insert into public.reviewer_competency_statuses (
    competency_version_id,workspace_id,reviewer_user_id,status,changed_by,reason
  ) values (competency_id,p_workspace_id,p_reviewer_user_id,'active',actor_id,'appointment activated');
  perform private.insert_audit_event(
    p_workspace_id,'cultural.competency.activate','reviewer_competency',competency_id,
    1,p_command_id,p_idempotency_key,p_correlation_id,'allow','accepted',null,
    jsonb_build_object('reviewerUserId',p_reviewer_user_id,'version',next_version)
  );
  return jsonb_build_object('ok',true,'competencyVersionId',competency_id,
    'versionNumber',next_version,'status','active');
end;
$$;

create or replace function public.command_record_source_review_packet(
  p_packet_id uuid, p_workspace_id uuid, p_series_id uuid,
  p_configuration_candidate_id uuid, p_policy_version_id uuid,
  p_subject_hash text, p_source_set_hash text, p_evidence_set_hash text,
  p_tradition text, p_region text, p_language text,
  p_content_classes text[], p_interpretation_labels text[],
  p_machine_verdict text, p_machine_evidence_hash text,
  p_source_links jsonb, p_findings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  next_version integer;
  link jsonb;
  finding jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode = '42501'; end if;
  select * into config from public.episode_configuration_candidates
  where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into episode from public.episodes where id=config.episode_id;
  if config.id is null or episode.series_id<>p_series_id
    or p_machine_verdict not in ('eligible','qualified_review_required','blocked')
    or jsonb_typeof(p_source_links)<>'array' or jsonb_array_length(p_source_links)<1
    or jsonb_typeof(p_findings)<>'array' or jsonb_array_length(p_findings)>200
  then raise exception 'source review packet envelope is invalid' using errcode='22023'; end if;
  select coalesce(max(packet_version),0)+1 into next_version
  from public.source_review_packets where configuration_candidate_id=config.id;
  insert into public.source_review_packets (
    id,workspace_id,series_id,configuration_candidate_id,script_revision_id,
    policy_version_id,packet_version,subject_hash,source_set_hash,evidence_set_hash,
    tradition,region,language,content_classes,interpretation_labels,
    machine_verdict,machine_evidence_hash
  ) values (
    p_packet_id,p_workspace_id,p_series_id,config.id,config.script_revision_id,
    p_policy_version_id,next_version,p_subject_hash,p_source_set_hash,p_evidence_set_hash,
    p_tradition,p_region,p_language,p_content_classes,p_interpretation_labels,
    p_machine_verdict,p_machine_evidence_hash
  );
  for link in select value from jsonb_array_elements(p_source_links) loop
    if jsonb_typeof(link)<>'object'
      or (link-array['sourceRecordVersionId','claimClass','subjectKind','subjectId','evidenceRole']::text[])<>'{}'::jsonb
      or not (link?&array['sourceRecordVersionId','claimClass','subjectKind','subjectId','evidenceRole'])
      or link->>'subjectKind' not in ('none','location_version','character_version')
    then raise exception 'source link is not exact' using errcode='22023'; end if;
    insert into public.source_review_packet_sources (
      workspace_id,source_review_packet_id,source_record_version_id,claim_class
    ) values (p_workspace_id,p_packet_id,(link->>'sourceRecordVersionId')::uuid,link->>'claimClass');
    if link->>'subjectKind'='location_version' then
      insert into public.temple_evidence_links (
        workspace_id,location_version_id,source_record_version_id,evidence_role
      ) values (
        p_workspace_id,(link->>'subjectId')::uuid,
        (link->>'sourceRecordVersionId')::uuid,link->>'evidenceRole'
      );
    elsif link->>'subjectKind'='character_version' then
      insert into public.deity_form_source_links (
        workspace_id,character_version_id,source_record_version_id,evidence_role
      ) values (
        p_workspace_id,(link->>'subjectId')::uuid,
        (link->>'sourceRecordVersionId')::uuid,link->>'evidenceRole'
      );
    end if;
  end loop;
  for finding in select value from jsonb_array_elements(p_findings) loop
    if jsonb_typeof(finding)<>'object'
      or (finding-array['policyRuleId','subjectKind','subjectId','verdict','confidence','evidenceHash','safeSummary']::text[])<>'{}'::jsonb
      or not (finding?&array['policyRuleId','subjectKind','subjectId','verdict','confidence','evidenceHash','safeSummary'])
    then raise exception 'cultural finding is not exact' using errcode='22023'; end if;
    insert into public.cultural_readiness_findings (
      workspace_id,source_review_packet_id,policy_version_id,policy_rule_id,
      subject_kind,subject_id,verdict,confidence,evidence_hash,safe_summary
    ) values (
      p_workspace_id,p_packet_id,p_policy_version_id,(finding->>'policyRuleId')::uuid,
      finding->>'subjectKind',nullif(finding->>'subjectId','')::uuid,
      finding->>'verdict',(finding->>'confidence')::numeric,
      finding->>'evidenceHash',finding->>'safeSummary'
    );
  end loop;
  insert into public.source_review_statuses (
    source_review_packet_id,workspace_id,status
  ) values (p_packet_id,p_workspace_id,'pending_qualified_review');
  return p_packet_id;
end;
$$;

create or replace function public.command_record_source_version(
  p_source_record_id uuid, p_source_version_id uuid,
  p_workspace_id uuid, p_series_id uuid, p_stable_key text,
  p_source_class text, p_title text, p_language text,
  p_edition_citation text, p_stable_url text, p_archive_handle text,
  p_bounded_proposition text, p_rights_basis text, p_rights_status text,
  p_verification_state text, p_contradiction_state text,
  p_evidence_sha256 text, p_canonical_hash text, p_creator_principal text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare next_version integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service authority required' using errcode='42501'; end if;
  if p_source_class='model_lead' and p_verification_state<>'lead_only'
    or p_source_class<>'model_lead' and p_verification_state='lead_only'
    or p_evidence_sha256 !~ '^[a-f0-9]{64}$'
    or p_canonical_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'source version envelope is invalid' using errcode='22023'; end if;
  insert into public.source_records (
    id,workspace_id,series_id,stable_key
  ) values (p_source_record_id,p_workspace_id,p_series_id,p_stable_key)
  on conflict (id) do nothing;
  if not exists (select 1 from public.source_records source
    where source.id=p_source_record_id and source.workspace_id=p_workspace_id
      and source.series_id=p_series_id and source.stable_key=p_stable_key)
  then raise exception 'source identity conflicts with registry' using errcode='40001'; end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.source_record_versions where source_record_id=p_source_record_id;
  insert into public.source_record_versions (
    id,workspace_id,source_record_id,version_number,source_class,title,language,
    edition_citation,stable_url,archive_handle,bounded_proposition,rights_basis,
    rights_status,verification_state,contradiction_state,evidence_sha256,
    canonical_hash,creator_principal
  ) values (
    p_source_version_id,p_workspace_id,p_source_record_id,next_version,p_source_class,
    p_title,p_language,p_edition_citation,p_stable_url,p_archive_handle,
    p_bounded_proposition,p_rights_basis,p_rights_status,p_verification_state,
    p_contradiction_state,p_evidence_sha256,p_canonical_hash,p_creator_principal
  );
  return p_source_version_id;
end;
$$;

create or replace function public.command_submit_source_review(
  p_workspace_id uuid, p_source_review_packet_id uuid,
  p_competency_version_id uuid, p_expected_status_version bigint,
  p_decision text, p_rationale text,
  p_competency_scope_hash text,
  p_command_id uuid, p_idempotency_key text, p_request_hash text,
  p_correlation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid:=auth.uid();
  packet public.source_review_packets%rowtype;
  status_row public.source_review_statuses%rowtype;
  competency public.reviewer_competency_versions%rowtype;
  decision_id uuid;
  next_status text;
  existing_decision public.source_review_decisions%rowtype;
  actual_scope_hash text;
begin
  if actor_id is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform private.assert_active_session(p_workspace_id);
  perform private.assert_aal2();
  if p_decision not in ('approve','block') then raise exception 'source review decision is invalid' using errcode='22023'; end if;
  select * into existing_decision from public.source_review_decisions
  where workspace_id=p_workspace_id and reviewer_user_id=actor_id
    and idempotency_key=p_idempotency_key;
  if found then
    if existing_decision.request_hash<>p_request_hash then
      raise exception 'source review idempotency conflict' using errcode='40001'; end if;
    return jsonb_build_object('ok',true,'decisionId',existing_decision.id,
      'sourceReviewPacketId',existing_decision.source_review_packet_id,
      'status',case when existing_decision.decision='approve' then 'approved' else 'blocked' end);
  end if;
  select * into packet from public.source_review_packets
  where id=p_source_review_packet_id and workspace_id=p_workspace_id;
  select * into status_row from public.source_review_statuses
  where source_review_packet_id=packet.id for update;
  select competency_version.* into competency
  from public.reviewer_competency_versions competency_version
  join public.reviewer_competency_statuses competency_status
    on competency_status.competency_version_id=competency_version.id
   and competency_status.status='active'
  where competency_version.id=p_competency_version_id
    and competency_version.workspace_id=p_workspace_id
    and competency_version.reviewer_user_id=actor_id
    and competency_version.effective_at<=statement_timestamp()
    and competency_version.expires_at>statement_timestamp();
  actual_scope_hash:=encode(extensions.digest(convert_to(
    array_to_string(competency.traditions,',')||':'||
    array_to_string(competency.regions,',')||':'||
    array_to_string(competency.languages,',')||':'||
    array_to_string(competency.content_classes,',')||':'||
    competency.appointment_evidence_hash,'UTF8'),'sha256'),'hex');
  if packet.id is null or status_row.status<>'pending_qualified_review'
    or status_row.version<>p_expected_status_version or competency.id is null
    or not (packet.tradition=any(competency.traditions) or 'all'=any(competency.traditions))
    or not (packet.region=any(competency.regions) or 'all'=any(competency.regions))
    or not (packet.language=any(competency.languages) or 'all'=any(competency.languages))
    or not (packet.content_classes<@competency.content_classes or 'all'=any(competency.content_classes))
    or p_competency_scope_hash<>actual_scope_hash
  then raise exception 'qualified source review authority is unavailable' using errcode='42501'; end if;
  if exists (select 1 from public.reviewer_recusals recusal
    where recusal.workspace_id=p_workspace_id and recusal.reviewer_user_id=actor_id
      and recusal.effective_at<=statement_timestamp()
      and (recusal.expires_at is null or recusal.expires_at>statement_timestamp())
      and ((recusal.subject_kind='series' and recusal.subject_id=packet.series_id)
        or (recusal.subject_kind='configuration_candidate' and recusal.subject_id=packet.configuration_candidate_id)))
  then raise exception 'reviewer recusal applies to this subject' using errcode='42501'; end if;
  if p_decision='approve' and (
    packet.machine_verdict='blocked'
    or exists (select 1 from public.source_review_packet_sources link
      join public.source_record_versions source on source.id=link.source_record_version_id
      where link.source_review_packet_id=packet.id and (
        source.verification_state<>'verified'
        or source.rights_status in ('uncertain','prohibited')
        or source.contradiction_state='material_unresolved'))
    or exists (select 1 from public.cultural_readiness_findings finding
      join public.cultural_policy_rules rule on rule.id=finding.policy_rule_id
      where finding.source_review_packet_id=packet.id and rule.non_overridable
        and finding.verdict in ('repair_required','production_blocked','release_blocked'))
    or exists (select 1 from public.location_selections selection
      join public.locations location on location.id=selection.location_id and location.named_temple
      join public.location_versions version on version.id=selection.selected_version_id
      where selection.configuration_candidate_id=packet.configuration_candidate_id
        and selection.state='accepted' and (
          select count(distinct link.source_record_version_id)
          from public.temple_evidence_links link
          join public.source_review_packet_sources packet_link
            on packet_link.source_review_packet_id=packet.id
           and packet_link.source_record_version_id=link.source_record_version_id
          where link.location_version_id=version.id
        )<2)
    or exists (select 1 from public.character_selections selection
      join public.character_versions version on version.id=selection.selected_version_id
      where selection.configuration_candidate_id=packet.configuration_candidate_id
        and selection.state='accepted' and version.identity_manifest->>'isDeity'='true'
        and not exists (select 1 from public.deity_form_source_links link
          join public.source_review_packet_sources packet_link
            on packet_link.source_review_packet_id=packet.id
           and packet_link.source_record_version_id=link.source_record_version_id
          where link.character_version_id=version.id))
  ) then raise exception 'source review prerequisites are incomplete' using errcode='40001'; end if;
  next_status:=case when p_decision='approve' then 'approved' else 'blocked' end;
  insert into public.source_review_decisions (
    workspace_id,source_review_packet_id,policy_version_id,competency_version_id,
    reviewer_user_id,decision,subject_hash,source_set_hash,evidence_set_hash,
    competency_scope_hash,recusal_checked,actor_aal,rationale,
    command_id,idempotency_key,request_hash
  ) values (
    p_workspace_id,packet.id,packet.policy_version_id,competency.id,actor_id,
    p_decision,packet.subject_hash,packet.source_set_hash,packet.evidence_set_hash,
    p_competency_scope_hash,true,'aal2',p_rationale,p_command_id,p_idempotency_key,p_request_hash
  ) returning id into decision_id;
  update public.source_review_statuses
  set status=next_status,version=version+1,selected_decision_id=decision_id,
      changed_at=statement_timestamp()
  where source_review_packet_id=packet.id;
  perform private.insert_audit_event(
    p_workspace_id,'source.review.'||p_decision,'source_review_packet',packet.id,
    status_row.version+1,p_command_id,p_idempotency_key,p_correlation_id,
    'allow','accepted',p_rationale,
    jsonb_build_object('competencyVersionId',competency.id,'decisionId',decision_id)
  );
  return jsonb_build_object('ok',true,'decisionId',decision_id,
    'sourceReviewPacketId',packet.id,'status',next_status,
    'statusVersion',status_row.version+1);
end;
$$;

alter table public.cultural_policy_versions enable row level security;
alter table public.cultural_policy_rules enable row level security;
alter table public.cultural_policy_versions force row level security;
alter table public.cultural_policy_rules force row level security;
create policy cultural_policy_versions_authenticated_select
on public.cultural_policy_versions for select to authenticated using (true);
create policy cultural_policy_rules_authenticated_select
on public.cultural_policy_rules for select to authenticated using (true);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'source_records','source_record_versions','reviewer_competency_versions',
    'reviewer_competency_statuses','reviewer_recusals','source_review_packets',
    'source_review_packet_sources','temple_evidence_links','deity_form_source_links',
    'cultural_readiness_findings','source_review_statuses','source_review_decisions'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id,(select auth.uid())))',
      table_name||'_member_select',table_name
    );
  end loop;
end;
$$;

revoke all on table public.cultural_policy_versions,public.cultural_policy_rules,
  public.source_records,public.source_record_versions,
  public.reviewer_competency_versions,public.reviewer_competency_statuses,
  public.reviewer_recusals,public.source_review_packets,
  public.source_review_packet_sources,public.temple_evidence_links,
  public.deity_form_source_links,public.cultural_readiness_findings,
  public.source_review_statuses,public.source_review_decisions
from public,anon,authenticated;
grant select on table public.cultural_policy_versions,public.cultural_policy_rules,
  public.source_records,public.source_record_versions,
  public.reviewer_competency_versions,public.reviewer_competency_statuses,
  public.reviewer_recusals,public.source_review_packets,
  public.source_review_packet_sources,public.temple_evidence_links,
  public.deity_form_source_links,public.cultural_readiness_findings,
  public.source_review_statuses,public.source_review_decisions
to authenticated;

revoke all on function
  public.command_appoint_cultural_reviewer(uuid,uuid,text[],text[],text[],text[],text,text,timestamptz,timestamptz,uuid,text,text,uuid),
  public.command_record_source_version(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text),
  public.command_record_source_review_packet(uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text[],text[],text,text,jsonb,jsonb),
  public.command_submit_source_review(uuid,uuid,uuid,bigint,text,text,text,uuid,text,text,uuid)
from public,anon,authenticated;
grant execute on function
  public.command_appoint_cultural_reviewer(uuid,uuid,text[],text[],text[],text[],text,text,timestamptz,timestamptz,uuid,text,text,uuid),
  public.command_submit_source_review(uuid,uuid,uuid,bigint,text,text,text,uuid,text,text,uuid)
to authenticated;
grant execute on function public.command_record_source_review_packet(
  uuid,uuid,uuid,uuid,uuid,text,text,text,text,text,text,text[],text[],text,text,jsonb,jsonb
), public.command_record_source_version(
  uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text
) to service_role;

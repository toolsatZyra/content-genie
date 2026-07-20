-- Versioned pronunciation, score, ambience, and SFX identities. Sacred text
-- restrictions are structural: Vedic samhita and bija lanes cannot carry a
-- synthetic provider markup and must pin an approved human recording.

create table public.pronunciation_lexicons (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  series_id uuid not null,
  lexicon_key text not null check (lexicon_key ~ '^[a-z0-9][a-z0-9_.-]{2,99}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(workspace_id,series_id,lexicon_key),
  foreign key(workspace_id,series_id) references public.series(workspace_id,id) on delete restrict
);

create table public.pronunciation_lexicon_versions (
  id uuid primary key,
  workspace_id uuid not null,
  pronunciation_lexicon_id uuid not null,
  configuration_candidate_id uuid not null,
  script_revision_id uuid not null,
  voice_version_id uuid not null references public.voice_versions(id) on delete restrict,
  source_review_packet_id uuid not null,
  version_number integer not null check(version_number>0),
  manifest_hash text not null check(manifest_hash~'^[a-f0-9]{64}$'),
  state text not null check(state in ('verified','rejected','stale')),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(pronunciation_lexicon_id,version_number),
  unique(configuration_candidate_id,manifest_hash),
  foreign key(workspace_id,pronunciation_lexicon_id)
    references public.pronunciation_lexicons(workspace_id,id) on delete restrict,
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,source_review_packet_id)
    references public.source_review_packets(workspace_id,id) on delete restrict
);

create table public.pronunciation_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lexicon_version_id uuid not null,
  entry_number integer not null check(entry_number>0),
  entry_kind text not null check(entry_kind in ('name','sanskrit_term','shloka','vedic_samhita','bija_mantra')),
  processing_start_scalar integer not null check(processing_start_scalar>=0),
  processing_end_scalar integer not null check(processing_end_scalar>processing_start_scalar),
  exact_text text not null check(char_length(exact_text) between 1 and 4000),
  devanagari text not null check(char_length(devanagari) between 1 and 4000),
  transliteration_scheme text not null check(transliteration_scheme in ('IAST','ISO-15919','Hindi-respelling')),
  transliteration text not null check(char_length(transliteration) between 1 and 8000),
  provider_markup text check(provider_markup is null or char_length(provider_markup) between 1 and 8000),
  synthesis_policy text not null check(synthesis_policy in ('synthetic_allowed','human_recording_only')),
  source_record_version_id uuid not null,
  human_recording_asset_version_id uuid,
  pronunciation_evidence_hash text not null check(pronunciation_evidence_hash~'^[a-f0-9]{64}$'),
  verification_status text not null check(verification_status in ('verified','rejected')),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(lexicon_version_id,entry_number),
  unique(lexicon_version_id,processing_start_scalar,processing_end_scalar,entry_kind),
  foreign key(workspace_id,lexicon_version_id)
    references public.pronunciation_lexicon_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,source_record_version_id)
    references public.source_record_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,human_recording_asset_version_id)
    references public.asset_versions(workspace_id,id) on delete restrict,
  check(
    (entry_kind in ('vedic_samhita','bija_mantra')
      and synthesis_policy='human_recording_only'
      and provider_markup is null
      and human_recording_asset_version_id is not null)
    or (entry_kind not in ('vedic_samhita','bija_mantra')
      and synthesis_policy='synthetic_allowed')
  )
);

create table public.score_identities (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  series_id uuid not null,
  identity_key text not null check(identity_key~'^[a-z0-9][a-z0-9_.-]{2,99}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(workspace_id,series_id,identity_key),
  foreign key(workspace_id,series_id) references public.series(workspace_id,id) on delete restrict
);

create table public.score_identity_versions (
  id uuid primary key,
  workspace_id uuid not null,
  score_identity_id uuid not null,
  configuration_candidate_id uuid not null,
  version_number integer not null check(version_number>0),
  motif_manifest jsonb not null check(jsonb_typeof(motif_manifest)='object' and pg_column_size(motif_manifest)<=65536),
  motif_manifest_hash text not null check(motif_manifest_hash~'^[a-f0-9]{64}$'),
  tempo_min_bpm integer not null check(tempo_min_bpm between 20 and 240),
  tempo_max_bpm integer not null check(tempo_max_bpm between tempo_min_bpm and 300),
  instrument_rules text[] not null check(cardinality(instrument_rules) between 1 and 100),
  prohibited_rules text[] not null check(cardinality(prohibited_rules) between 1 and 100),
  source_kind text not null check(source_kind in ('curated_library','licensed_generation')),
  license_status text not null check(license_status in ('licensed','public_domain','internal_authorized')),
  license_evidence_hash text not null check(license_evidence_hash~'^[a-f0-9]{64}$'),
  state text not null check(state in ('verified','rejected','stale')),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(score_identity_id,version_number),
  foreign key(workspace_id,score_identity_id)
    references public.score_identities(workspace_id,id) on delete restrict,
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict
);

create table public.sound_identities (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  series_id uuid not null,
  identity_key text not null check(identity_key~'^[a-z0-9][a-z0-9_.-]{2,99}$'),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(workspace_id,series_id,identity_key),
  foreign key(workspace_id,series_id) references public.series(workspace_id,id) on delete restrict
);

create table public.sound_identity_versions (
  id uuid primary key,
  workspace_id uuid not null,
  sound_identity_id uuid not null,
  configuration_candidate_id uuid not null,
  version_number integer not null check(version_number>0),
  ambience_manifest jsonb not null check(jsonb_typeof(ambience_manifest)='object' and pg_column_size(ambience_manifest)<=65536),
  sfx_manifest jsonb not null check(jsonb_typeof(sfx_manifest)='object' and pg_column_size(sfx_manifest)<=65536),
  dignity_rules text[] not null check(cardinality(dignity_rules) between 1 and 100),
  manifest_hash text not null check(manifest_hash~'^[a-f0-9]{64}$'),
  license_status text not null check(license_status in ('licensed','public_domain','internal_authorized')),
  license_evidence_hash text not null check(license_evidence_hash~'^[a-f0-9]{64}$'),
  state text not null check(state in ('verified','rejected','stale')),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(sound_identity_id,version_number),
  foreign key(workspace_id,sound_identity_id)
    references public.sound_identities(workspace_id,id) on delete restrict,
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict
);

create table public.preflight_audio_identity_selections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  configuration_candidate_id uuid not null,
  voice_version_id uuid not null references public.voice_versions(id) on delete restrict,
  pronunciation_lexicon_version_id uuid not null,
  score_identity_version_id uuid not null,
  sound_identity_version_id uuid not null,
  selection_hash text not null check(selection_hash~'^[a-f0-9]{64}$'),
  state text not null check(state in ('verified','stale')),
  created_at timestamptz not null default statement_timestamp(),
  unique(workspace_id,id),
  unique(configuration_candidate_id,selection_hash),
  foreign key(workspace_id,configuration_candidate_id)
    references public.episode_configuration_candidates(workspace_id,id) on delete restrict,
  foreign key(workspace_id,pronunciation_lexicon_version_id)
    references public.pronunciation_lexicon_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,score_identity_version_id)
    references public.score_identity_versions(workspace_id,id) on delete restrict,
  foreign key(workspace_id,sound_identity_version_id)
    references public.sound_identity_versions(workspace_id,id) on delete restrict
);

create trigger pronunciation_versions_immutable before update or delete on public.pronunciation_lexicon_versions
for each row execute function private.reject_mutation();
create trigger pronunciation_entries_immutable before update or delete on public.pronunciation_entries
for each row execute function private.reject_mutation();
create trigger score_versions_immutable before update or delete on public.score_identity_versions
for each row execute function private.reject_mutation();
create trigger sound_versions_immutable before update or delete on public.sound_identity_versions
for each row execute function private.reject_mutation();
create trigger audio_identity_selections_immutable before update or delete on public.preflight_audio_identity_selections
for each row execute function private.reject_mutation();

create or replace function public.command_record_pronunciation_lexicon(
  p_lexicon_id uuid,p_lexicon_version_id uuid,p_workspace_id uuid,
  p_configuration_candidate_id uuid,p_lexicon_key text,
  p_source_review_packet_id uuid,p_manifest_hash text,p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype;
  script public.script_revisions%rowtype;
  next_version integer;
  entry jsonb;
  entry_number integer:=0;
  source_version_id uuid;
  human_asset_id uuid;
  start_scalar integer;
  end_scalar integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into config from public.episode_configuration_candidates
  where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into episode from public.episodes where id=config.episode_id;
  select * into script from public.script_revisions where id=config.script_revision_id;
  if config.id is null or p_entries is null or p_manifest_hash is null
    or p_manifest_hash !~ '^[a-f0-9]{64}$'
    or p_manifest_hash is distinct from encode(extensions.digest(convert_to(p_entries::text,'UTF8'),'sha256'),'hex')
    or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 500
    or not exists(select 1 from public.source_review_statuses status
      join public.source_review_packets packet on packet.id=status.source_review_packet_id
      where status.source_review_packet_id=p_source_review_packet_id
        and status.workspace_id=p_workspace_id and status.status='approved'
        and packet.workspace_id=p_workspace_id
        and packet.configuration_candidate_id=config.id
        and packet.script_revision_id=config.script_revision_id)
  then raise exception 'pronunciation lexicon envelope is invalid' using errcode='22023'; end if;
  insert into public.pronunciation_lexicons(id,workspace_id,series_id,lexicon_key)
  values(p_lexicon_id,p_workspace_id,episode.series_id,p_lexicon_key)
  on conflict(id) do nothing;
  if not exists(select 1 from public.pronunciation_lexicons lexicon
    where lexicon.id=p_lexicon_id and lexicon.workspace_id=p_workspace_id
      and lexicon.series_id=episode.series_id and lexicon.lexicon_key=p_lexicon_key)
  then raise exception 'pronunciation lexicon identity conflicts' using errcode='40001'; end if;
  select coalesce(max(version_number),0)+1 into next_version
  from public.pronunciation_lexicon_versions where pronunciation_lexicon_id=p_lexicon_id;
  insert into public.pronunciation_lexicon_versions(
    id,workspace_id,pronunciation_lexicon_id,configuration_candidate_id,
    script_revision_id,voice_version_id,source_review_packet_id,version_number,
    manifest_hash,state
  ) values(
    p_lexicon_version_id,p_workspace_id,p_lexicon_id,config.id,config.script_revision_id,
    config.voice_version_id,p_source_review_packet_id,next_version,p_manifest_hash,'verified'
  );
  for entry in select value from jsonb_array_elements(p_entries) loop
    entry_number:=entry_number+1;
    if jsonb_typeof(entry)<>'object'
      or (entry-array['entryKind','startScalar','endScalar','exactText','devanagari',
        'transliterationScheme','transliteration','providerMarkup','synthesisPolicy',
        'sourceRecordVersionId','humanRecordingAssetVersionId','evidenceHash',
        'verificationStatus']::text[])<>'{}'::jsonb
      or not(entry?&array['entryKind','startScalar','endScalar','exactText','devanagari',
        'transliterationScheme','transliteration','providerMarkup','synthesisPolicy',
        'sourceRecordVersionId','humanRecordingAssetVersionId','evidenceHash',
        'verificationStatus'])
    then raise exception 'pronunciation entry is not exact' using errcode='22023'; end if;
    start_scalar:=(entry->>'startScalar')::integer;
    end_scalar:=(entry->>'endScalar')::integer;
    source_version_id:=(entry->>'sourceRecordVersionId')::uuid;
    human_asset_id:=nullif(entry->>'humanRecordingAssetVersionId','')::uuid;
    if substring(script.processing_text from start_scalar+1 for end_scalar-start_scalar)<>entry->>'exactText'
      or entry->>'verificationStatus'<>'verified'
      or not exists(select 1 from public.source_review_packet_sources link
        join public.source_record_versions source on source.id=link.source_record_version_id
        where link.source_review_packet_id=p_source_review_packet_id
          and link.source_record_version_id=source_version_id
          and source.verification_state='verified')
    then raise exception 'pronunciation entry is not bound to locked text and sources' using errcode='40001'; end if;
    insert into public.pronunciation_entries(
      workspace_id,lexicon_version_id,entry_number,entry_kind,
      processing_start_scalar,processing_end_scalar,exact_text,devanagari,
      transliteration_scheme,transliteration,provider_markup,synthesis_policy,
      source_record_version_id,human_recording_asset_version_id,
      pronunciation_evidence_hash,verification_status
    ) values(
      p_workspace_id,p_lexicon_version_id,entry_number,entry->>'entryKind',
      start_scalar,end_scalar,entry->>'exactText',entry->>'devanagari',
      entry->>'transliterationScheme',entry->>'transliteration',
      nullif(entry->>'providerMarkup',''),entry->>'synthesisPolicy',source_version_id,
      human_asset_id,entry->>'evidenceHash',entry->>'verificationStatus'
    );
  end loop;
  return p_lexicon_version_id;
end;
$$;

create or replace function public.command_record_score_identity(
  p_identity_id uuid,p_version_id uuid,p_workspace_id uuid,
  p_configuration_candidate_id uuid,p_identity_key text,p_motif_manifest jsonb,
  p_motif_manifest_hash text,p_tempo_min_bpm integer,p_tempo_max_bpm integer,
  p_instrument_rules text[],p_prohibited_rules text[],p_source_kind text,
  p_license_status text,p_license_evidence_hash text,p_state text
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype; next_version integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into config from public.episode_configuration_candidates where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into episode from public.episodes where id=config.episode_id;
  if config.id is null or p_state is distinct from 'verified'
    or p_motif_manifest is null or jsonb_typeof(p_motif_manifest)<>'object'
    or p_instrument_rules is null or p_prohibited_rules is null
  then raise exception 'score identity is not releasable' using errcode='40001'; end if;
  insert into public.score_identities(id,workspace_id,series_id,identity_key)
  values(p_identity_id,p_workspace_id,episode.series_id,p_identity_key) on conflict(id) do nothing;
  if not exists(select 1 from public.score_identities identity
    where identity.id=p_identity_id and identity.workspace_id=p_workspace_id
      and identity.series_id=episode.series_id and identity.identity_key=p_identity_key)
  then raise exception 'score identity conflicts with existing Series' using errcode='40001'; end if;
  if p_motif_manifest_hash is distinct from encode(extensions.digest(convert_to(p_motif_manifest::text,'UTF8'),'sha256'),'hex')
    or p_license_evidence_hash is null or p_license_evidence_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'score identity evidence is invalid' using errcode='22023'; end if;
  select coalesce(max(version_number),0)+1 into next_version from public.score_identity_versions where score_identity_id=p_identity_id;
  insert into public.score_identity_versions(
    id,workspace_id,score_identity_id,configuration_candidate_id,version_number,
    motif_manifest,motif_manifest_hash,tempo_min_bpm,tempo_max_bpm,
    instrument_rules,prohibited_rules,source_kind,license_status,
    license_evidence_hash,state
  ) values(p_version_id,p_workspace_id,p_identity_id,config.id,next_version,
    p_motif_manifest,p_motif_manifest_hash,p_tempo_min_bpm,p_tempo_max_bpm,
    p_instrument_rules,p_prohibited_rules,p_source_kind,p_license_status,
    p_license_evidence_hash,p_state);
  return p_version_id;
end;
$$;

create or replace function public.command_record_sound_identity(
  p_identity_id uuid,p_version_id uuid,p_workspace_id uuid,
  p_configuration_candidate_id uuid,p_identity_key text,p_ambience_manifest jsonb,
  p_sfx_manifest jsonb,p_dignity_rules text[],p_manifest_hash text,
  p_license_status text,p_license_evidence_hash text,p_state text
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare config public.episode_configuration_candidates%rowtype;
  episode public.episodes%rowtype; next_version integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into config from public.episode_configuration_candidates where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  select * into episode from public.episodes where id=config.episode_id;
  if config.id is null or p_state is distinct from 'verified'
    or p_ambience_manifest is null or jsonb_typeof(p_ambience_manifest)<>'object'
    or p_sfx_manifest is null or jsonb_typeof(p_sfx_manifest)<>'object'
    or p_dignity_rules is null
    or not exists(select 1 from unnest(p_dignity_rules) as rule_text
      where lower(rule_text) like '%mantra%not%texture%')
  then raise exception 'sound identity is not releasable' using errcode='40001'; end if;
  insert into public.sound_identities(id,workspace_id,series_id,identity_key)
  values(p_identity_id,p_workspace_id,episode.series_id,p_identity_key) on conflict(id) do nothing;
  if not exists(select 1 from public.sound_identities identity
    where identity.id=p_identity_id and identity.workspace_id=p_workspace_id
      and identity.series_id=episode.series_id and identity.identity_key=p_identity_key)
  then raise exception 'sound identity conflicts with existing Series' using errcode='40001'; end if;
  if p_manifest_hash is distinct from encode(extensions.digest(convert_to(
      jsonb_build_object('ambience',p_ambience_manifest,'sfx',p_sfx_manifest,
        'dignityRules',to_jsonb(p_dignity_rules))::text,'UTF8'),'sha256'),'hex')
    or p_license_evidence_hash is null or p_license_evidence_hash !~ '^[a-f0-9]{64}$'
  then raise exception 'sound identity evidence is invalid' using errcode='22023'; end if;
  select coalesce(max(version_number),0)+1 into next_version from public.sound_identity_versions where sound_identity_id=p_identity_id;
  insert into public.sound_identity_versions(
    id,workspace_id,sound_identity_id,configuration_candidate_id,version_number,
    ambience_manifest,sfx_manifest,dignity_rules,manifest_hash,license_status,
    license_evidence_hash,state
  ) values(p_version_id,p_workspace_id,p_identity_id,config.id,next_version,
    p_ambience_manifest,p_sfx_manifest,p_dignity_rules,p_manifest_hash,
    p_license_status,p_license_evidence_hash,p_state);
  return p_version_id;
end;
$$;

create or replace function public.command_pin_preflight_audio_identities(
  p_selection_id uuid,p_workspace_id uuid,p_configuration_candidate_id uuid,
  p_lexicon_version_id uuid,p_score_version_id uuid,p_sound_version_id uuid,
  p_selection_hash text
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare config public.episode_configuration_candidates%rowtype;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service authority required' using errcode='42501'; end if;
  select * into config from public.episode_configuration_candidates where id=p_configuration_candidate_id and workspace_id=p_workspace_id;
  if config.id is null
    or not exists(select 1 from public.pronunciation_lexicon_versions version
      where version.id=p_lexicon_version_id and version.workspace_id=p_workspace_id
        and version.configuration_candidate_id=config.id and version.voice_version_id=config.voice_version_id
        and version.state='verified'
        and not exists(select 1 from public.pronunciation_entries entry
          where entry.lexicon_version_id=version.id and entry.verification_status<>'verified'))
    or not exists(select 1 from public.score_identity_versions version
      where version.id=p_score_version_id and version.workspace_id=p_workspace_id
        and version.configuration_candidate_id=config.id and version.state='verified')
    or not exists(select 1 from public.sound_identity_versions version
      where version.id=p_sound_version_id and version.workspace_id=p_workspace_id
        and version.configuration_candidate_id=config.id and version.state='verified')
    or p_selection_hash is distinct from encode(extensions.digest(convert_to(
      config.voice_version_id::text||':'||p_lexicon_version_id::text||':'||
      p_score_version_id::text||':'||p_sound_version_id::text,'UTF8'),'sha256'),'hex')
  then raise exception 'preflight audio identities are incomplete' using errcode='40001'; end if;
  insert into public.preflight_audio_identity_selections(
    id,workspace_id,configuration_candidate_id,voice_version_id,
    pronunciation_lexicon_version_id,score_identity_version_id,
    sound_identity_version_id,selection_hash,state
  ) values(p_selection_id,p_workspace_id,config.id,config.voice_version_id,
    p_lexicon_version_id,p_score_version_id,p_sound_version_id,p_selection_hash,'verified');
  return p_selection_id;
end;
$$;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'pronunciation_lexicons','pronunciation_lexicon_versions','pronunciation_entries',
    'score_identities','score_identity_versions','sound_identities',
    'sound_identity_versions','preflight_audio_identity_selections'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('alter table public.%I force row level security',table_name);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_active_member(workspace_id,(select auth.uid())))',table_name||'_member_select',table_name);
  end loop;
end $$;

revoke all on table public.pronunciation_lexicons,public.pronunciation_lexicon_versions,
 public.pronunciation_entries,public.score_identities,public.score_identity_versions,
 public.sound_identities,public.sound_identity_versions,
 public.preflight_audio_identity_selections from public,anon,authenticated;
grant select on table public.pronunciation_lexicons,public.pronunciation_lexicon_versions,
 public.pronunciation_entries,public.score_identities,public.score_identity_versions,
 public.sound_identities,public.sound_identity_versions,
 public.preflight_audio_identity_selections to authenticated;

revoke all on function
 public.command_record_pronunciation_lexicon(uuid,uuid,uuid,uuid,text,uuid,text,jsonb),
 public.command_record_score_identity(uuid,uuid,uuid,uuid,text,jsonb,text,integer,integer,text[],text[],text,text,text,text),
 public.command_record_sound_identity(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text[],text,text,text,text),
 public.command_pin_preflight_audio_identities(uuid,uuid,uuid,uuid,uuid,uuid,text)
from public,anon,authenticated;
grant execute on function
 public.command_record_pronunciation_lexicon(uuid,uuid,uuid,uuid,text,uuid,text,jsonb),
 public.command_record_score_identity(uuid,uuid,uuid,uuid,text,jsonb,text,integer,integer,text[],text[],text,text,text,text),
 public.command_record_sound_identity(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text[],text,text,text,text),
 public.command_pin_preflight_audio_identities(uuid,uuid,uuid,uuid,uuid,uuid,text)
to service_role;

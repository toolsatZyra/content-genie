-- Preserve the historical v1 estimator exactly while activating the
-- Unicode-correct v2 estimator for every new script revision. Existing
-- immutable rows retain both their stored estimate and their v1 identity.

create or replace function private.estimate_hindi_narration_duration_v1(
  p_processing_text text
)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  clause_marks integer;
  line_breaks integer;
  normalized_text text := normalize(
    pg_catalog.replace(
      pg_catalog.replace(p_processing_text, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    NFC
  );
  performance_breaths integer;
  sentence_marks integer;
  word_count integer;
begin
  select count(*)::integer into word_count
  from pg_catalog.regexp_split_to_table(
    pg_catalog.btrim(normalized_text),
    E'\\s+'
  ) as token
  where token <> '';

  -- These byte-decoded glyphs are the exact historical production semantics.
  sentence_marks := pg_catalog.char_length(
    pg_catalog.regexp_replace(normalized_text, '[^.!?à¥¤à¥¥]', '', 'g')
  );
  clause_marks := pg_catalog.char_length(
    pg_catalog.regexp_replace(normalized_text, '[^,;:â€”â€“]', '', 'g')
  );
  line_breaks := pg_catalog.char_length(normalized_text) -
    pg_catalog.char_length(pg_catalog.replace(normalized_text, E'\n', ''));
  performance_breaths := greatest(
    pg_catalog.ceil(word_count::numeric / 18)::integer - 1,
    0
  );

  return pg_catalog.round(
    greatest(word_count, 1)::numeric * 60 / 125 +
      sentence_marks::numeric * 0.42 +
      clause_marks::numeric * 0.18 +
      line_breaks::numeric * 0.25 +
      performance_breaths::numeric * 0.32,
    3
  );
end;
$$;

create or replace function private.estimate_hindi_narration_duration_v2(
  p_processing_text text
)
returns numeric
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  clause_marks integer;
  line_breaks integer;
  normalized_text text := normalize(
    pg_catalog.replace(
      pg_catalog.replace(p_processing_text, E'\r\n', E'\n'),
      E'\r',
      E'\n'
    ),
    NFC
  );
  performance_breaths integer;
  sentence_marks integer;
  word_count integer;
begin
  select count(*)::integer into word_count
  from pg_catalog.regexp_split_to_table(
    pg_catalog.btrim(normalized_text),
    E'\\s+'
  ) as token
  where token <> '';

  sentence_marks := pg_catalog.char_length(
    pg_catalog.regexp_replace(normalized_text, '[^.!?।॥]', '', 'g')
  );
  clause_marks := pg_catalog.char_length(
    pg_catalog.regexp_replace(normalized_text, '[^,;:—–]', '', 'g')
  );
  line_breaks := pg_catalog.char_length(normalized_text) -
    pg_catalog.char_length(pg_catalog.replace(normalized_text, E'\n', ''));
  performance_breaths := greatest(
    pg_catalog.ceil(word_count::numeric / 18)::integer - 1,
    0
  );

  return pg_catalog.round(
    greatest(word_count, 1)::numeric * 60 / 125 +
      sentence_marks::numeric * 0.42 +
      clause_marks::numeric * 0.18 +
      line_breaks::numeric * 0.25 +
      performance_breaths::numeric * 0.32,
    3
  );
end;
$$;

revoke all on function private.estimate_hindi_narration_duration_v1(text),
  private.estimate_hindi_narration_duration_v2(text)
from public, anon, authenticated;

alter table public.script_revisions
  alter column duration_estimation_profile set default
    'genie-hindi-conversational-expressive-duration.v2',
  drop constraint if exists script_revisions_duration_estimation_profile_check,
  drop constraint if exists script_revisions_duration_profile_v1_check,
  drop constraint if exists script_revisions_duration_profile_v2_check,
  add constraint script_revisions_duration_profile_v2_check check (
    duration_estimation_profile in (
      'genie-hindi-conversational-expressive-duration.v1',
      'genie-hindi-conversational-expressive-duration.v2'
    )
  );

-- The two current script-revision writers are long, independently gated
-- SECURITY DEFINER commands. Replace their single estimator dependency in
-- place and fail closed if their reviewed shape has drifted.
do $$
declare
  definition text;
  signature regprocedure;
begin
  foreach signature in array array[
    'public.command_lock_episode_script(uuid,uuid,bigint,text,bytea,text,text,text,text,jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,uuid,uuid,text,text,uuid)'::regprocedure,
    'public.command_confirm_episode_narration_upload(uuid,uuid,uuid,uuid,bigint,bigint,uuid,text,bytea,text,text,text,text,jsonb,jsonb,integer,integer,integer,integer,integer,integer,boolean,uuid,text,text,uuid)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(signature);
    if (
      select count(*)
      from pg_catalog.regexp_matches(
        definition,
        'private\.estimate_hindi_narration_duration_v1\(',
        'g'
      )
    ) <> 1 then
      raise exception 'duration estimator writer shape drifted: %', signature
        using errcode = '55000';
    end if;
    execute pg_catalog.replace(
      definition,
      'private.estimate_hindi_narration_duration_v1(',
      'private.estimate_hindi_narration_duration_v2('
    );
  end loop;
end;
$$;

comment on function private.estimate_hindi_narration_duration_v1(text) is
  'Historical immutable profile for v1 script revisions; do not change.';
comment on function private.estimate_hindi_narration_duration_v2(text) is
  'Unicode-correct Hindi narration duration profile for new revisions.';

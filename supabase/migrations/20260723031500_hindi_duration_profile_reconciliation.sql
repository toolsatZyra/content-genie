-- Re-pin the tested Hindi narration duration profile for environments that
-- applied an earlier revision under the same historical migration name.

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

revoke all on function private.estimate_hindi_narration_duration_v1(text)
from public, anon, authenticated;

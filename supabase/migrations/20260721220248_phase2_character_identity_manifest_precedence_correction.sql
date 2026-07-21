-- Preserve the recorded P2-08 migration and correct its two arm-position
-- concatenations. PostgreSQL groups generic operators left-to-right, so each
-- jsonb text extraction must be parenthesized before text concatenation.

do $correction$
declare
  current_source text;
  corrected_source text;
  expected_fragment constant text :=
    '(item->>''side'' || '':'' || item->>''ordinal'')';
  corrected_fragment constant text :=
    '((item->>''side'') || '':'' || (item->>''ordinal''))';
  occurrence_count integer;
begin
  select procedure.prosrc
  into current_source
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'private'
    and procedure.proname = 'character_identity_manifest_error'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) =
      'p_manifest jsonb';

  if current_source is null then
    raise exception 'character identity manifest validator is unavailable'
      using errcode = '55000';
  end if;
  occurrence_count := (
    pg_catalog.char_length(current_source)
    - pg_catalog.char_length(pg_catalog.replace(
      current_source, expected_fragment, ''
    ))
  ) / pg_catalog.char_length(expected_fragment);
  if occurrence_count <> 2 then
    raise exception 'character identity manifest validator source is unexpected'
      using errcode = '55000';
  end if;

  corrected_source := pg_catalog.replace(
    current_source, expected_fragment, corrected_fragment
  );
  execute pg_catalog.format(
    'create or replace function private.character_identity_manifest_error(p_manifest jsonb) '
    'returns text language plpgsql immutable strict set search_path = '''' as %L',
    corrected_source
  );
end;
$correction$;

comment on function private.character_identity_manifest_error(jsonb) is
'Validates the closed Genie v2 character identity manifest used for episode world review; arm-position JSON extraction precedence corrected.';

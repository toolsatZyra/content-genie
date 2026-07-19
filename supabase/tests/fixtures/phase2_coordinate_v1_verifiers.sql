-- Test-only frozen read-only pg_get_functiondef snapshot from long-lived preview
-- iuzijmzcimtwyowhwinu after 20260717121606 and before terminal migration
-- 20260717121607, captured 2026-07-18. The reviewed byte digest is pinned by
-- scripts/phase2-coordinate-upgrade-drill.mjs; this fixture must not be regenerated.
CREATE OR REPLACE FUNCTION private.verify_text_coordinate_index(p_index jsonb, p_text text, p_utf16_code_units integer, p_scalar_count integer, p_grapheme_count integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
declare
  actual_utf16 integer;
  actual_utf8 integer;
  expected_utf16 integer := 0;
  expected_utf8 integer := 0;
  scalar_position integer;
  scalar_text text;
begin
  if jsonb_typeof(p_index) <> 'object'
    or (select count(*) from pg_catalog.jsonb_object_keys(p_index)) <> 3
    or jsonb_typeof(p_index -> 'graphemes') <> 'array'
    or jsonb_typeof(p_index -> 'scalarToUtf16') <> 'array'
    or jsonb_typeof(p_index -> 'scalarToUtf8') <> 'array'
    or jsonb_array_length(p_index -> 'graphemes') <> p_grapheme_count
    or jsonb_array_length(p_index -> 'scalarToUtf16') <> p_scalar_count + 1
    or jsonb_array_length(p_index -> 'scalarToUtf8') <> p_scalar_count + 1
  then
    return false;
  end if;

  for scalar_position in 0..p_scalar_count loop
    if jsonb_typeof(p_index -> 'scalarToUtf16' -> scalar_position) <> 'number'
      or jsonb_typeof(p_index -> 'scalarToUtf8' -> scalar_position) <> 'number'
    then
      return false;
    end if;
    actual_utf16 := (p_index -> 'scalarToUtf16' ->> scalar_position)::integer;
    actual_utf8 := (p_index -> 'scalarToUtf8' ->> scalar_position)::integer;
    if actual_utf16 <> expected_utf16 or actual_utf8 <> expected_utf8 then
      return false;
    end if;
    if scalar_position < p_scalar_count then
      scalar_text := pg_catalog.substring(p_text, scalar_position + 1, 1);
      expected_utf16 := expected_utf16
        + case when pg_catalog.ascii(scalar_text) > 65535 then 2 else 1 end;
      expected_utf8 := expected_utf8
        + octet_length(convert_to(scalar_text, 'UTF8'));
    end if;
  end loop;
  if expected_utf16 <> p_utf16_code_units
    or expected_utf8 <> octet_length(convert_to(p_text, 'UTF8'))
  then
    return false;
  end if;

  if exists (
    select 1
    from (
      select
        ordinal,
        item,
        (item ->> 'byteStart')::integer as byte_start,
        (item ->> 'byteEnd')::integer as byte_end,
        (item ->> 'scalarStart')::integer as scalar_start,
        (item ->> 'scalarEnd')::integer as scalar_end,
        (item ->> 'utf16Start')::integer as utf16_start,
        (item ->> 'utf16End')::integer as utf16_end,
        (item ->> 'graphemeStart')::integer as grapheme_start,
        (item ->> 'graphemeEnd')::integer as grapheme_end,
        item ->> 'text' as text_value,
        pg_catalog.lag((item ->> 'scalarEnd')::integer)
          over (order by ordinal) as previous_scalar_end
      from pg_catalog.jsonb_array_elements(p_index -> 'graphemes')
        with ordinality as grapheme(item, ordinal)
    ) indexed
    where (select count(*) from pg_catalog.jsonb_object_keys(indexed.item)) <> 9
      or jsonb_typeof(indexed.item -> 'text') <> 'string'
      or exists (
        select 1
        from pg_catalog.unnest(array[
          'byteStart','byteEnd','scalarStart','scalarEnd',
          'utf16Start','utf16End','graphemeStart','graphemeEnd'
        ]) as required_key
        where jsonb_typeof(indexed.item -> required_key) <> 'number'
      )
      or scalar_start <> coalesce(previous_scalar_end, 0)
      or scalar_end <= scalar_start
      or scalar_end > p_scalar_count
      or grapheme_start <> ordinal - 1
      or grapheme_end <> ordinal
      or byte_start <>
        (p_index #>> array['scalarToUtf8', scalar_start::text])::integer
      or byte_end <>
        (p_index #>> array['scalarToUtf8', scalar_end::text])::integer
      or utf16_start <>
        (p_index #>> array['scalarToUtf16', scalar_start::text])::integer
      or utf16_end <>
        (p_index #>> array['scalarToUtf16', scalar_end::text])::integer
      or text_value <> pg_catalog.substring(
        p_text,
        scalar_start + 1,
        scalar_end - scalar_start
      )
      or (
        ordinal = p_grapheme_count
        and scalar_end <> p_scalar_count
      )
  ) then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$function$;


CREATE OR REPLACE FUNCTION private.verify_script_coordinate_map_envelope(p_coordinate_map jsonb, p_raw_text text, p_processing_text text, p_raw_utf16_code_units integer, p_raw_scalar_count integer, p_raw_grapheme_count integer, p_processing_utf16_code_units integer, p_processing_scalar_count integer, p_processing_grapheme_count integer)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE STRICT
 SET search_path TO ''
AS $function$
declare
  processing_joined text;
  raw_joined text;
begin
  if jsonb_typeof(p_coordinate_map) <> 'object'
    or p_coordinate_map ->> 'rangeConvention' <> 'zero-based-half-open'
    or jsonb_typeof(p_coordinate_map -> 'raw') <> 'object'
    or jsonb_typeof(p_coordinate_map -> 'processing') <> 'object'
    or jsonb_typeof(p_coordinate_map -> 'segments') <> 'array'
    or jsonb_typeof(p_coordinate_map #> '{raw,graphemes}') <> 'array'
    or jsonb_typeof(p_coordinate_map #> '{raw,scalarToUtf16}') <> 'array'
    or jsonb_typeof(p_coordinate_map #> '{raw,scalarToUtf8}') <> 'array'
    or jsonb_typeof(p_coordinate_map #> '{processing,graphemes}') <> 'array'
    or jsonb_typeof(p_coordinate_map #> '{processing,scalarToUtf16}') <> 'array'
    or jsonb_typeof(p_coordinate_map #> '{processing,scalarToUtf8}') <> 'array'
    or jsonb_array_length(p_coordinate_map #> '{raw,graphemes}')
      <> p_raw_grapheme_count
    or jsonb_array_length(p_coordinate_map #> '{processing,graphemes}')
      <> p_processing_grapheme_count
    or jsonb_array_length(p_coordinate_map #> '{raw,scalarToUtf16}')
      <> p_raw_scalar_count + 1
    or jsonb_array_length(p_coordinate_map #> '{raw,scalarToUtf8}')
      <> p_raw_scalar_count + 1
    or jsonb_array_length(p_coordinate_map #> '{processing,scalarToUtf16}')
      <> p_processing_scalar_count + 1
    or jsonb_array_length(p_coordinate_map #> '{processing,scalarToUtf8}')
      <> p_processing_scalar_count + 1
    or jsonb_array_length(p_coordinate_map -> 'segments') < 1
    or (select count(*) from pg_catalog.jsonb_object_keys(p_coordinate_map)) <> 4
    or not private.verify_text_coordinate_index(
      p_coordinate_map -> 'raw',
      p_raw_text,
      p_raw_utf16_code_units,
      p_raw_scalar_count,
      p_raw_grapheme_count
    )
    or not private.verify_text_coordinate_index(
      p_coordinate_map -> 'processing',
      p_processing_text,
      p_processing_utf16_code_units,
      p_processing_scalar_count,
      p_processing_grapheme_count
    )
  then
    return false;
  end if;

  if (p_coordinate_map #>> '{raw,scalarToUtf16,0}')::integer <> 0
    or (p_coordinate_map #>> '{raw,scalarToUtf16,-1}')::integer
      <> p_raw_utf16_code_units
    or (p_coordinate_map #>> '{raw,scalarToUtf8,0}')::integer <> 0
    or (p_coordinate_map #>> '{raw,scalarToUtf8,-1}')::integer
      <> octet_length(convert_to(p_raw_text, 'UTF8'))
    or (p_coordinate_map #>> '{processing,scalarToUtf16,0}')::integer <> 0
    or (p_coordinate_map #>> '{processing,scalarToUtf16,-1}')::integer
      <> p_processing_utf16_code_units
    or (p_coordinate_map #>> '{processing,scalarToUtf8,0}')::integer <> 0
    or (p_coordinate_map #>> '{processing,scalarToUtf8,-1}')::integer
      <> octet_length(convert_to(p_processing_text, 'UTF8'))
  then
    return false;
  end if;

  select pg_catalog.string_agg(item ->> 'text', '' order by ordinal)
    into raw_joined
  from pg_catalog.jsonb_array_elements(
    p_coordinate_map #> '{raw,graphemes}'
  ) with ordinality as grapheme(item, ordinal);
  select pg_catalog.string_agg(item ->> 'text', '' order by ordinal)
    into processing_joined
  from pg_catalog.jsonb_array_elements(
    p_coordinate_map #> '{processing,graphemes}'
  ) with ordinality as grapheme(item, ordinal);
  if raw_joined is distinct from p_raw_text
    or processing_joined is distinct from p_processing_text
  then
    return false;
  end if;

  if exists (
    select 1
    from (
      select
        ordinal,
        (item ->> 'byteStart')::integer as byte_start,
        (item ->> 'byteEnd')::integer as byte_end,
        (item ->> 'scalarStart')::integer as scalar_start,
        (item ->> 'scalarEnd')::integer as scalar_end,
        (item ->> 'utf16Start')::integer as utf16_start,
        (item ->> 'utf16End')::integer as utf16_end,
        (item ->> 'graphemeStart')::integer as grapheme_start,
        (item ->> 'graphemeEnd')::integer as grapheme_end,
        item ->> 'text' as text_value,
        pg_catalog.lag((item ->> 'byteEnd')::integer)
          over (order by ordinal) as previous_byte_end,
        pg_catalog.lag((item ->> 'scalarEnd')::integer)
          over (order by ordinal) as previous_scalar_end,
        pg_catalog.lag((item ->> 'utf16End')::integer)
          over (order by ordinal) as previous_utf16_end
      from pg_catalog.jsonb_array_elements(
        p_coordinate_map #> '{raw,graphemes}'
      ) with ordinality as grapheme(item, ordinal)
    ) indexed
    where grapheme_start <> ordinal - 1
      or grapheme_end <> ordinal
      or byte_start <> coalesce(previous_byte_end, 0)
      or scalar_start <> coalesce(previous_scalar_end, 0)
      or utf16_start <> coalesce(previous_utf16_end, 0)
      or byte_end - byte_start
        <> octet_length(convert_to(text_value, 'UTF8'))
      or scalar_end - scalar_start <> char_length(text_value)
      or byte_end <= byte_start
      or scalar_end <= scalar_start
      or utf16_end <= utf16_start
  ) or exists (
    select 1
    from (
      select
        ordinal,
        (item ->> 'byteStart')::integer as byte_start,
        (item ->> 'byteEnd')::integer as byte_end,
        (item ->> 'scalarStart')::integer as scalar_start,
        (item ->> 'scalarEnd')::integer as scalar_end,
        (item ->> 'utf16Start')::integer as utf16_start,
        (item ->> 'utf16End')::integer as utf16_end,
        (item ->> 'graphemeStart')::integer as grapheme_start,
        (item ->> 'graphemeEnd')::integer as grapheme_end,
        item ->> 'text' as text_value,
        pg_catalog.lag((item ->> 'byteEnd')::integer)
          over (order by ordinal) as previous_byte_end,
        pg_catalog.lag((item ->> 'scalarEnd')::integer)
          over (order by ordinal) as previous_scalar_end,
        pg_catalog.lag((item ->> 'utf16End')::integer)
          over (order by ordinal) as previous_utf16_end
      from pg_catalog.jsonb_array_elements(
        p_coordinate_map #> '{processing,graphemes}'
      ) with ordinality as grapheme(item, ordinal)
    ) indexed
    where grapheme_start <> ordinal - 1
      or grapheme_end <> ordinal
      or byte_start <> coalesce(previous_byte_end, 0)
      or scalar_start <> coalesce(previous_scalar_end, 0)
      or utf16_start <> coalesce(previous_utf16_end, 0)
      or byte_end - byte_start
        <> octet_length(convert_to(text_value, 'UTF8'))
      or scalar_end - scalar_start <> char_length(text_value)
      or byte_end <= byte_start
      or scalar_end <= scalar_start
      or utf16_end <= utf16_start
  ) then
    return false;
  end if;

  if exists (
    with segment_rows as (
      select
        ordinal::integer as ordinal,
        item,
        item ->> 'reason' as reason,
        (item #>> '{raw,byteStart}')::integer as raw_byte_start,
        (item #>> '{raw,byteEnd}')::integer as raw_byte_end,
        (item #>> '{raw,scalarStart}')::integer as raw_scalar_start,
        (item #>> '{raw,scalarEnd}')::integer as raw_scalar_end,
        (item #>> '{raw,utf16Start}')::integer as raw_utf16_start,
        (item #>> '{raw,utf16End}')::integer as raw_utf16_end,
        (item #>> '{raw,graphemeStart}')::integer as raw_grapheme_start,
        (item #>> '{raw,graphemeEnd}')::integer as raw_grapheme_end,
        (item #>> '{processing,byteStart}')::integer as processing_byte_start,
        (item #>> '{processing,byteEnd}')::integer as processing_byte_end,
        (item #>> '{processing,scalarStart}')::integer as processing_scalar_start,
        (item #>> '{processing,scalarEnd}')::integer as processing_scalar_end,
        (item #>> '{processing,utf16Start}')::integer as processing_utf16_start,
        (item #>> '{processing,utf16End}')::integer as processing_utf16_end,
        (item #>> '{processing,graphemeStart}')::integer
          as processing_grapheme_start,
        (item #>> '{processing,graphemeEnd}')::integer
          as processing_grapheme_end,
        pg_catalog.lag((item #>> '{raw,scalarEnd}')::integer)
          over (order by ordinal) as previous_raw_scalar_end,
        pg_catalog.lag((item #>> '{processing,scalarEnd}')::integer)
          over (order by ordinal) as previous_processing_scalar_end
      from pg_catalog.jsonb_array_elements(p_coordinate_map -> 'segments')
        with ordinality as segment(item, ordinal)
    ),
    pieces as (
      select
        segment_rows.*,
        pg_catalog.substring(
          p_raw_text,
          raw_scalar_start + 1,
          raw_scalar_end - raw_scalar_start
        ) as raw_piece,
        pg_catalog.substring(
          p_processing_text,
          processing_scalar_start + 1,
          processing_scalar_end - processing_scalar_start
        ) as processing_piece
      from segment_rows
    ),
    evaluated as (
      select
        pieces.*,
        pg_catalog.replace(
          pg_catalog.replace(raw_piece, E'\r\n', E'\n'),
          E'\r',
          E'\n'
        ) as line_normalized_piece
      from pieces
    )
    select 1
    from evaluated
    where (select count(*) from pg_catalog.jsonb_object_keys(item)) <> 3
      or jsonb_typeof(item -> 'reason') <> 'string'
      or jsonb_typeof(item -> 'raw') <> 'object'
      or jsonb_typeof(item -> 'processing') <> 'object'
      or (select count(*) from pg_catalog.jsonb_object_keys(item -> 'raw')) <> 8
      or (
        select count(*) from pg_catalog.jsonb_object_keys(item -> 'processing')
      ) <> 8
      or exists (
        select 1
        from pg_catalog.unnest(array[
          'byteStart','byteEnd','scalarStart','scalarEnd',
          'utf16Start','utf16End','graphemeStart','graphemeEnd'
        ]) as required_key
        where jsonb_typeof(item -> 'raw' -> required_key) <> 'number'
          or jsonb_typeof(item -> 'processing' -> required_key) <> 'number'
      )
      or reason not in (
        'identity',
        'line-ending',
        'nfc',
        'line-ending+nfc',
        'global-normalization'
      )
      or raw_scalar_start <> coalesce(previous_raw_scalar_end, 0)
      or processing_scalar_start <> coalesce(previous_processing_scalar_end, 0)
      or raw_scalar_end <= raw_scalar_start
      or processing_scalar_end <= processing_scalar_start
      or raw_scalar_end > p_raw_scalar_count
      or processing_scalar_end > p_processing_scalar_count
      or raw_byte_start <> (
        p_coordinate_map #>> array[
          'raw','scalarToUtf8',raw_scalar_start::text
        ]
      )::integer
      or raw_byte_end <> (
        p_coordinate_map #>> array[
          'raw','scalarToUtf8',raw_scalar_end::text
        ]
      )::integer
      or raw_utf16_start <> (
        p_coordinate_map #>> array[
          'raw','scalarToUtf16',raw_scalar_start::text
        ]
      )::integer
      or raw_utf16_end <> (
        p_coordinate_map #>> array[
          'raw','scalarToUtf16',raw_scalar_end::text
        ]
      )::integer
      or processing_byte_start <> (
        p_coordinate_map #>> array[
          'processing','scalarToUtf8',processing_scalar_start::text
        ]
      )::integer
      or processing_byte_end <> (
        p_coordinate_map #>> array[
          'processing','scalarToUtf8',processing_scalar_end::text
        ]
      )::integer
      or processing_utf16_start <> (
        p_coordinate_map #>> array[
          'processing','scalarToUtf16',processing_scalar_start::text
        ]
      )::integer
      or processing_utf16_end <> (
        p_coordinate_map #>> array[
          'processing','scalarToUtf16',processing_scalar_end::text
        ]
      )::integer
      or raw_grapheme_start < 0
      or raw_grapheme_end > p_raw_grapheme_count
      or raw_grapheme_end <= raw_grapheme_start
      or processing_grapheme_start < 0
      or processing_grapheme_end > p_processing_grapheme_count
      or processing_grapheme_end <= processing_grapheme_start
      or (
        raw_grapheme_start < p_raw_grapheme_count
        and raw_scalar_start <> (
          p_coordinate_map #>> array[
            'raw','graphemes',raw_grapheme_start::text,'scalarStart'
          ]
        )::integer
      )
      or raw_scalar_end <> (
        p_coordinate_map #>> array[
          'raw','graphemes',(raw_grapheme_end - 1)::text,'scalarEnd'
        ]
      )::integer
      or (
        processing_grapheme_start < p_processing_grapheme_count
        and processing_scalar_start <> (
          p_coordinate_map #>> array[
            'processing','graphemes',processing_grapheme_start::text,'scalarStart'
          ]
        )::integer
      )
      or processing_scalar_end <> (
        p_coordinate_map #>> array[
          'processing','graphemes',(processing_grapheme_end - 1)::text,'scalarEnd'
        ]
      )::integer
      or processing_piece <> normalize(line_normalized_piece, NFC)
      or (
        reason <> 'global-normalization'
        and reason <> case
          when raw_piece <> line_normalized_piece
            and line_normalized_piece <> normalize(line_normalized_piece, NFC)
            then 'line-ending+nfc'
          when raw_piece <> line_normalized_piece then 'line-ending'
          when line_normalized_piece <> normalize(line_normalized_piece, NFC)
            then 'nfc'
          else 'identity'
        end
      )
      or (
        reason = 'global-normalization'
        and (
          jsonb_array_length(p_coordinate_map -> 'segments') <> 1
          or raw_scalar_start <> 0
          or raw_scalar_end <> p_raw_scalar_count
          or processing_scalar_start <> 0
          or processing_scalar_end <> p_processing_scalar_count
        )
      )
      or (
        ordinal = jsonb_array_length(p_coordinate_map -> 'segments')
        and (
          raw_scalar_end <> p_raw_scalar_count
          or processing_scalar_end <> p_processing_scalar_count
        )
      )
  ) then
    return false;
  end if;

  return true;
exception
  when others then
    return false;
end;
$function$;

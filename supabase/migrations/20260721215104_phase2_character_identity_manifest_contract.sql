-- P2-08 / GQC-WORLD-002 / GQC-WORLD-003
--
-- Existing character versions remain readable exactly as recorded. Every new
-- immutable character version must use the measurable v2 identity manifest and
-- bind its stored SHA-256 to PostgreSQL's canonical jsonb text representation.

create or replace function private.character_manifest_text_array_is_valid(
  p_value jsonb,
  p_allow_empty boolean
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  item jsonb;
  normalized text;
  seen text[] := array[]::text[];
begin
  if pg_catalog.jsonb_typeof(p_value) <> 'array'
    or (not p_allow_empty and pg_catalog.jsonb_array_length(p_value) = 0)
  then
    return false;
  end if;

  for item in select value from pg_catalog.jsonb_array_elements(p_value)
  loop
    if pg_catalog.jsonb_typeof(item) <> 'string' then
      return false;
    end if;
    normalized := pg_catalog.btrim(item #>> '{}');
    if pg_catalog.char_length(normalized) not between 1 and 1000
      or normalized = any(seen)
    then
      return false;
    end if;
    seen := seen || normalized;
  end loop;
  return true;
end;
$$;

create or replace function private.character_identity_manifest_error(
  p_manifest jsonb
)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  identity_value jsonb;
  form_value jsonb;
  topology_value jsonb;
  rules_value jsonb;
  wardrobe_value jsonb;
  skin_value jsonb;
  dignity_value jsonb;
  deity_value jsonb;
  vahana_value jsonb;
  item jsonb;
  head_count integer;
  arm_count integer;
  hand_count integer;
  leg_count integer;
  arm_id text;
  hand_id text;
  object_key text;
  weapon_key text;
  seen_ornaments text[] := array[]::text[];
  seen_arm_ids text[] := array[]::text[];
  seen_hand_ids text[] := array[]::text[];
  seen_arm_positions text[] := array[]::text[];
  assigned_hand_ids text[] := array[]::text[];
  weapon_keys text[] := array[]::text[];
  required_weapon_keys text[] := array[]::text[];
  held_weapon_keys text[] := array[]::text[];
begin
  if pg_catalog.jsonb_typeof(p_manifest) <> 'object' then
    return 'manifest must be an object';
  end if;
  if not (p_manifest ?& array[
      'schemaVersion','isDeity','identity','form','wardrobe','skin','ornaments',
      'dignity','allowedTransitions','deity'
    ]::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_manifest)) <> 10
  then
    return 'top-level keys must be exact for schema v2';
  end if;
  if pg_catalog.jsonb_typeof(p_manifest->'schemaVersion') <> 'string'
    or p_manifest->>'schemaVersion' <> 'genie-character-identity-manifest.v2'
  then
    return 'schemaVersion must be genie-character-identity-manifest.v2';
  end if;
  if pg_catalog.jsonb_typeof(p_manifest->'isDeity') <> 'boolean' then
    return 'isDeity must be boolean';
  end if;

  identity_value := p_manifest->'identity';
  if pg_catalog.jsonb_typeof(identity_value) <> 'object'
    or not (identity_value ?& array[
      'characterKey','canonicalName','formKey','formName','essentialAttributes'
    ]::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(identity_value)) <> 5
  then
    return 'identity keys must be exact';
  end if;
  if pg_catalog.jsonb_typeof(identity_value->'characterKey') <> 'string'
    or pg_catalog.jsonb_typeof(identity_value->'canonicalName') <> 'string'
    or pg_catalog.jsonb_typeof(identity_value->'formKey') <> 'string'
    or pg_catalog.jsonb_typeof(identity_value->'formName') <> 'string'
    or identity_value->>'characterKey' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
    or identity_value->>'formKey' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
    or pg_catalog.char_length(pg_catalog.btrim(identity_value->>'canonicalName')) not between 1 and 200
    or pg_catalog.char_length(pg_catalog.btrim(identity_value->>'formName')) not between 1 and 200
  then
    return 'identity names and keys must be measurable';
  end if;
  if private.character_manifest_text_array_is_valid(
      identity_value->'essentialAttributes', false
    ) is not true
  then
    return 'essentialAttributes must be a non-empty unique text array';
  end if;

  form_value := p_manifest->'form';
  if pg_catalog.jsonb_typeof(form_value) <> 'object'
    or not (form_value ?& array['topology','rules']::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(form_value)) <> 2
  then
    return 'form keys must be exact';
  end if;
  topology_value := form_value->'topology';
  if pg_catalog.jsonb_typeof(topology_value) <> 'object'
    or not (topology_value ?& array[
      'headCount','armCount','handCount','legCount'
    ]::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(topology_value)) <> 4
  then
    return 'topology keys must be exact';
  end if;
  if pg_catalog.jsonb_typeof(topology_value->'headCount') <> 'number'
    or pg_catalog.jsonb_typeof(topology_value->'armCount') <> 'number'
    or pg_catalog.jsonb_typeof(topology_value->'handCount') <> 'number'
    or pg_catalog.jsonb_typeof(topology_value->'legCount') <> 'number'
    or topology_value->>'headCount' !~ '^[0-9]{1,4}$'
    or topology_value->>'armCount' !~ '^[0-9]{1,4}$'
    or topology_value->>'handCount' !~ '^[0-9]{1,4}$'
    or topology_value->>'legCount' !~ '^[0-9]{1,4}$'
  then
    return 'topology counts must be explicit non-negative integers';
  end if;
  head_count := (topology_value->>'headCount')::integer;
  arm_count := (topology_value->>'armCount')::integer;
  hand_count := (topology_value->>'handCount')::integer;
  leg_count := (topology_value->>'legCount')::integer;
  if head_count < 1 or hand_count <> arm_count or leg_count < 0 then
    return 'topology must have at least one head and one hand per arm';
  end if;

  rules_value := form_value->'rules';
  if pg_catalog.jsonb_typeof(rules_value) <> 'object'
    or not (rules_value ?& array['required','prohibited']::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(rules_value)) <> 2
    or private.character_manifest_text_array_is_valid(rules_value->'required', false) is not true
    or private.character_manifest_text_array_is_valid(rules_value->'prohibited', true) is not true
  then
    return 'form rules must contain explicit required and prohibited arrays';
  end if;

  wardrobe_value := p_manifest->'wardrobe';
  if pg_catalog.jsonb_typeof(wardrobe_value) <> 'object'
    or not (wardrobe_value ?& array['required','prohibited']::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(wardrobe_value)) <> 2
    or private.character_manifest_text_array_is_valid(wardrobe_value->'required', false) is not true
    or private.character_manifest_text_array_is_valid(wardrobe_value->'prohibited', true) is not true
  then
    return 'wardrobe rules must contain explicit required and prohibited arrays';
  end if;

  skin_value := p_manifest->'skin';
  if pg_catalog.jsonb_typeof(skin_value) <> 'object'
    or not (skin_value ?& array['toneRules','formRules']::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(skin_value)) <> 2
    or private.character_manifest_text_array_is_valid(skin_value->'toneRules', false) is not true
    or private.character_manifest_text_array_is_valid(skin_value->'formRules', false) is not true
  then
    return 'skin must contain explicit toneRules and formRules arrays';
  end if;

  if pg_catalog.jsonb_typeof(p_manifest->'ornaments') <> 'array' then
    return 'ornaments must be an explicit array';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_manifest->'ornaments')
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ?& array['key','placement','required']::text[])
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 3
      or pg_catalog.jsonb_typeof(item->'key') <> 'string'
      or pg_catalog.jsonb_typeof(item->'placement') <> 'string'
      or item->>'key' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
      or pg_catalog.char_length(pg_catalog.btrim(item->>'placement')) not between 1 and 200
      or pg_catalog.jsonb_typeof(item->'required') <> 'boolean'
      or item->>'key' = any(seen_ornaments)
    then
      return 'ornament entries must be exact and unique';
    end if;
    seen_ornaments := seen_ornaments || (item->>'key');
  end loop;

  dignity_value := p_manifest->'dignity';
  if pg_catalog.jsonb_typeof(dignity_value) <> 'object'
    or not (dignity_value ?& array['required','prohibited']::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(dignity_value)) <> 2
    or private.character_manifest_text_array_is_valid(dignity_value->'required', false) is not true
    or private.character_manifest_text_array_is_valid(dignity_value->'prohibited', true) is not true
  then
    return 'dignity rules must contain explicit required and prohibited arrays';
  end if;

  if pg_catalog.jsonb_typeof(p_manifest->'allowedTransitions') <> 'array' then
    return 'allowedTransitions must be an explicit array';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(p_manifest->'allowedTransitions')
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ?& array['fromFormKey','toFormKey','conditions']::text[])
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 3
      or pg_catalog.jsonb_typeof(item->'fromFormKey') <> 'string'
      or pg_catalog.jsonb_typeof(item->'toFormKey') <> 'string'
      or item->>'fromFormKey' <> identity_value->>'formKey'
      or item->>'toFormKey' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
      or item->>'toFormKey' = item->>'fromFormKey'
      or private.character_manifest_text_array_is_valid(item->'conditions', false) is not true
    then
      return 'allowed transition entries must be exact and originate at this form';
    end if;
  end loop;

  if (p_manifest->>'isDeity')::boolean is false then
    if pg_catalog.jsonb_typeof(p_manifest->'deity') <> 'null' then
      return 'non-deity manifests must set deity to null';
    end if;
    return null;
  end if;

  deity_value := p_manifest->'deity';
  if pg_catalog.jsonb_typeof(deity_value) <> 'object'
    or not (deity_value ?& array[
      'arms','handObjectAssignments','vahana','weapons'
    ]::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(deity_value)) <> 4
  then
    return 'deity keys must be exact';
  end if;
  if pg_catalog.jsonb_typeof(deity_value->'arms') <> 'array'
    or pg_catalog.jsonb_array_length(deity_value->'arms') <> arm_count
  then
    return 'deity arms must enumerate the topology arm count';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(deity_value->'arms')
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ?& array['armId','side','ordinal','handId']::text[])
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 4
      or pg_catalog.jsonb_typeof(item->'armId') <> 'string'
      or pg_catalog.jsonb_typeof(item->'side') <> 'string'
      or pg_catalog.jsonb_typeof(item->'handId') <> 'string'
      or item->>'armId' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
      or item->>'handId' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
      or item->>'side' not in ('left','right','center')
      or pg_catalog.jsonb_typeof(item->'ordinal') <> 'number'
      or item->>'ordinal' !~ '^[1-9][0-9]{0,3}$'
    then
      return 'deity arm entries must be explicit';
    end if;
    arm_id := item->>'armId';
    hand_id := item->>'handId';
    if arm_id = any(seen_arm_ids)
      or hand_id = any(seen_hand_ids)
      or (item->>'side' || ':' || item->>'ordinal') = any(seen_arm_positions)
    then
      return 'deity arm and hand identities must be unique';
    end if;
    seen_arm_ids := seen_arm_ids || arm_id;
    seen_hand_ids := seen_hand_ids || hand_id;
    seen_arm_positions := seen_arm_positions || (item->>'side' || ':' || item->>'ordinal');
  end loop;

  if pg_catalog.jsonb_typeof(deity_value->'handObjectAssignments') <> 'array'
    or pg_catalog.jsonb_array_length(deity_value->'handObjectAssignments') <> hand_count
  then
    return 'handObjectAssignments must enumerate the topology hand count';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(deity_value->'handObjectAssignments')
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ?& array['handId','assignmentKind','objectKey']::text[])
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 3
      or pg_catalog.jsonb_typeof(item->'handId') <> 'string'
      or pg_catalog.jsonb_typeof(item->'assignmentKind') <> 'string'
      or item->>'handId' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
      or item->>'assignmentKind' not in ('weapon','attribute','mudra','empty')
      or item->>'handId' = any(assigned_hand_ids)
      or not (item->>'handId' = any(seen_hand_ids))
    then
      return 'hand-object assignments must map each declared hand exactly once';
    end if;
    if item->>'assignmentKind' = 'empty' then
      if pg_catalog.jsonb_typeof(item->'objectKey') <> 'null' then
        return 'empty hands must use a null objectKey';
      end if;
    elsif pg_catalog.jsonb_typeof(item->'objectKey') <> 'string'
      or item->>'objectKey' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
    then
      return 'non-empty hands must name their assigned object or mudra';
    end if;
    assigned_hand_ids := assigned_hand_ids || (item->>'handId');
    if item->>'assignmentKind' = 'weapon' then
      held_weapon_keys := held_weapon_keys || (item->>'objectKey');
    end if;
  end loop;

  vahana_value := deity_value->'vahana';
  if pg_catalog.jsonb_typeof(vahana_value) <> 'object'
    or not (vahana_value ?& array['status','key']::text[])
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(vahana_value)) <> 2
    or pg_catalog.jsonb_typeof(vahana_value->'status') <> 'string'
    or vahana_value->>'status' not in ('specified','none')
  then
    return 'vahana must explicitly specify a key or none';
  end if;
  if vahana_value->>'status' = 'specified' then
    if pg_catalog.jsonb_typeof(vahana_value->'key') <> 'string'
      or vahana_value->>'key' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
    then
      return 'a specified vahana must have a measurable key';
    end if;
  elsif pg_catalog.jsonb_typeof(vahana_value->'key') <> 'null' then
    return 'a deity form with no vahana must use a null key';
  end if;

  if pg_catalog.jsonb_typeof(deity_value->'weapons') <> 'array' then
    return 'weapons must be an explicit array';
  end if;
  for item in select value from pg_catalog.jsonb_array_elements(deity_value->'weapons')
  loop
    if pg_catalog.jsonb_typeof(item) <> 'object'
      or not (item ?& array['key','required']::text[])
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(item)) <> 2
      or pg_catalog.jsonb_typeof(item->'key') <> 'string'
      or item->>'key' !~ '^[a-z0-9][a-z0-9._-]{0,127}$'
      or pg_catalog.jsonb_typeof(item->'required') <> 'boolean'
      or item->>'key' = any(weapon_keys)
    then
      return 'weapon entries must be exact and unique';
    end if;
    weapon_key := item->>'key';
    weapon_keys := weapon_keys || weapon_key;
    if (item->>'required')::boolean then
      required_weapon_keys := required_weapon_keys || weapon_key;
    end if;
  end loop;
  foreach object_key in array held_weapon_keys
  loop
    if not (object_key = any(weapon_keys)) then
      return 'held deity weapons must appear in weapons';
    end if;
  end loop;
  foreach weapon_key in array required_weapon_keys
  loop
    if not (weapon_key = any(held_weapon_keys)) then
      return 'required deity weapons must have a hand assignment';
    end if;
  end loop;

  return null;
end;
$$;

create or replace function private.character_identity_manifest_sha256(
  p_manifest jsonb
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(p_manifest::text, 'UTF8'), 'sha256'),
    'hex'
  )
$$;

create or replace function private.enforce_character_identity_manifest_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  validation_error text;
  character_record public.characters%rowtype;
  form_record public.character_forms%rowtype;
begin
  validation_error := private.character_identity_manifest_error(new.identity_manifest);
  if validation_error is not null then
    raise exception 'character identity manifest is invalid: %', validation_error
      using errcode = '22023';
  end if;
  if new.identity_manifest_hash is distinct from
    private.character_identity_manifest_sha256(new.identity_manifest)
  then
    raise exception 'character identity manifest hash does not match canonical content'
      using errcode = '22023';
  end if;

  select * into character_record
  from public.characters
  where id = new.character_id and workspace_id = new.workspace_id;
  select * into form_record
  from public.character_forms
  where id = new.character_form_id and workspace_id = new.workspace_id
    and character_id = new.character_id;
  if character_record.id is null or form_record.id is null
    or new.identity_manifest#>>'{identity,characterKey}' <> character_record.canonical_key
    or new.identity_manifest#>>'{identity,canonicalName}' <> character_record.display_name
    or new.identity_manifest#>>'{identity,formKey}' <> form_record.form_key
    or new.identity_manifest#>>'{identity,formName}' <> form_record.display_name
  then
    raise exception 'character identity manifest does not match its character form'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.character_manifest_text_array_is_valid(jsonb,boolean)
from public, anon, authenticated, service_role;
revoke all on function private.character_identity_manifest_error(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.character_identity_manifest_sha256(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.enforce_character_identity_manifest_contract()
from public, anon, authenticated, service_role;

create trigger character_identity_manifest_contract_insert
before insert on public.character_versions
for each row execute function private.enforce_character_identity_manifest_contract();

comment on function private.character_identity_manifest_error(jsonb) is
'Validates the closed Genie v2 character identity manifest used for episode world review.';
comment on trigger character_identity_manifest_contract_insert on public.character_versions is
'Requires canonical manifest content, row identity binding, and exact SHA-256 on new immutable character versions.';

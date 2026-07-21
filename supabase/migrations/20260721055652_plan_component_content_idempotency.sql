-- A component version is an immutable member of one generated plan bundle.
-- Separate attempts may legitimately produce the same structural component
-- (most commonly the server-owned beat timeline) while the creative story,
-- routing, or evidence changes. Content equality is therefore not an identity
-- conflict. The per-kind version number and immutable primary key remain the
-- authoritative identities.

alter table public.preflight_plan_component_versions
  drop constraint if exists
    preflight_plan_component_vers_configuration_candidate_id_c_key1;

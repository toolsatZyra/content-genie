-- Phase 2 / 0011 forward correction: reconcile persisted look-pack provenance
-- with the immutable source manifest. Safe as a no-op on fresh databases.
-- Migration-owner trigger suspension is transaction-scoped by the migration runner.

alter table public.look_packs disable trigger look_packs_immutable;

update public.look_packs
set source_repository = 'https://github.com/toolsatZyra/doctor-z',
    source_commit = '3d57ccf4cebd30019cc862c692c83a8049169d3a',
    source_catalog_sha256 = '6b12dac1e8c7beec096ee1fcff755a814ecab58bb921bf8ad4901167334e0033',
    internal_rights_basis = 'owner-authorized same-company internal use',
    creative_review = 'genie-deterministic-tail-v1',
    reviewed_at = '2026-07-17'::date
where id = 'ai-director-curated-looks'
  and pack_version = 1;

alter table public.look_packs enable trigger look_packs_immutable;

do $provenance$
begin
  if not exists (
    select 1
    from public.look_packs
    where id = 'ai-director-curated-looks'
      and pack_version = 1
      and source_repository = 'https://github.com/toolsatZyra/doctor-z'
      and source_commit = '3d57ccf4cebd30019cc862c692c83a8049169d3a'
      and source_catalog_sha256 = '6b12dac1e8c7beec096ee1fcff755a814ecab58bb921bf8ad4901167334e0033'
  ) then
    raise exception 'look-pack provenance correction failed';
  end if;
end
$provenance$;

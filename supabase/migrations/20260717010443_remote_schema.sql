-- Production migration-history compatibility marker.
--
-- Supabase recorded this remote_schema version during the initial Phase 1
-- reconciliation. The surrounding Phase 1 migrations contain the authoritative
-- schema changes; this no-op keeps clean local and disposable-branch histories
-- aligned with production.

select 1;

-- The plan ledger validates and atomically records the complete cinematic plan.
-- Supabase's service_role inherits the authenticator role's eight-second REST
-- statement timeout unless a function has a narrower explicit exemption.
-- Keep the exemption local to this bounded RPC rather than relaxing the role.

alter function public.command_record_preflight_plan(
  uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text,
  numeric,numeric,numeric,numeric,numeric,jsonb,jsonb
) set statement_timeout='30s';

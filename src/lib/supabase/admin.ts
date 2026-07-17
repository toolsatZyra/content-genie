import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getServerEnvironment } from "@/config/server-env";

export function createAdminSupabaseClient(): SupabaseClient {
  const environment = getServerEnvironment();
  if (!environment.public.supabaseUrl || !environment.supabaseServiceRoleKey) {
    throw new Error("Supabase administrative configuration is unavailable.");
  }
  return createClient(
    environment.public.supabaseUrl,
    environment.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
}

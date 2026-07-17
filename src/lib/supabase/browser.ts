"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPublicEnvironment } from "@/config/public-env";

let browserClient: SupabaseClient | undefined;

export function getBrowserSupabaseClient(): SupabaseClient {
  const environment = getPublicEnvironment();
  if (!environment.supabaseUrl || !environment.supabaseAnonKey) {
    throw new Error("Supabase browser configuration is unavailable.");
  }
  browserClient ??= createBrowserClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
  );
  return browserClient;
}

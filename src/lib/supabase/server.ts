import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getServerEnvironment } from "@/config/server-env";

export function hasConfiguredSupabase(): boolean {
  const environment = getServerEnvironment();
  const hostname = environment.public.supabaseUrl
    ? new URL(environment.public.supabaseUrl).hostname
    : "";
  return Boolean(
    environment.environment !== "test" &&
    !hostname.endsWith(".invalid") &&
    environment.public.supabaseUrl &&
    environment.public.supabaseAnonKey,
  );
}

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const environment = getServerEnvironment();
  if (!environment.public.supabaseUrl || !environment.public.supabaseAnonKey) {
    throw new Error("Supabase server configuration is unavailable.");
  }
  const cookieStore = await cookies();
  return createServerClient(
    environment.public.supabaseUrl,
    environment.public.supabaseAnonKey,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, options, value } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // A Server Component cannot set cookies. The proxy refresh path owns
            // persistence; commands and Route Handlers can still set them.
          }
        },
      },
    },
  );
}

import { parsePublicEnvironment, type PublicEnvironment } from "@/config/env-core";

let cached: PublicEnvironment | undefined;

export function getPublicEnvironment(): PublicEnvironment {
  cached ??= parsePublicEnvironment({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  return cached;
}

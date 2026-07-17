import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { PublicEnvironment } from "@/config/env-core";

export async function refreshSupabaseSession(
  request: NextRequest,
  requestHeaders: Headers,
  publicEnvironment: PublicEnvironment,
): Promise<NextResponse> {
  if (!publicEnvironment.supabaseUrl || !publicEnvironment.supabaseAnonKey) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const client = createServerClient(
    publicEnvironment.supabaseUrl,
    publicEnvironment.supabaseAnonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, options, value } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser performs a server-validated Auth request. Nothing may be inserted
  // between client creation and this call because cookie refresh can otherwise
  // become intermittent.
  await client.auth.getUser();
  return response;
}

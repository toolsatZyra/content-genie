import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  hasActiveWorkspaceMembership,
  searchAuthorizedStudio,
} from "@/server/studio-search";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function offset(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const workspaceId = url.searchParams.get("workspace") ?? "";
  if (query.length < 2 || query.length > 200 || !uuidPattern.test(workspaceId)) {
    return NextResponse.json(
      { code: "INVALID_SEARCH", ok: false },
      { headers: { "cache-control": "no-store" }, status: 400 },
    );
  }

  try {
    const client = await createServerSupabaseClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { code: "AUTHENTICATION_REQUIRED", ok: false },
        { headers: { "cache-control": "no-store" }, status: 401 },
      );
    }
    if (!(await hasActiveWorkspaceMembership(client, workspaceId, user.id))) {
      return NextResponse.json(
        { code: "WORKSPACE_FORBIDDEN", ok: false },
        { headers: { "cache-control": "no-store" }, status: 403 },
      );
    }

    const page = await searchAuthorizedStudio(client, workspaceId, query, {
      episodeOffset: offset(url.searchParams.get("episodeOffset")),
      seriesOffset: offset(url.searchParams.get("seriesOffset")),
    });
    return NextResponse.json(page, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      { code: "SEARCH_UNAVAILABLE", ok: false },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}

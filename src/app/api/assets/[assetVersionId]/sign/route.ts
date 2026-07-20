import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

const SIGNED_PREVIEW_SECONDS = 90;
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: Record<string, unknown>, status: number, requestId: string) {
  const response = NextResponse.json({ ...body, requestId }, { status });
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-request-id", requestId);
  return response;
}

export async function POST(
  _request: Request,
  context: Readonly<{ params: Promise<{ assetVersionId: string }> }>,
): Promise<NextResponse> {
  const requestId = crypto.randomUUID();
  const { assetVersionId } = await context.params;
  if (!uuid.test(assetVersionId)) {
    return reply({ code: "INVALID_ASSET_VERSION", ok: false }, 400, requestId);
  }

  try {
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser();
    if (userError || !user) {
      return reply({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401, requestId);
    }

    // RLS proves active workspace membership. The client supplies only an opaque
    // version ID; bucket and object path always come from the authoritative row.
    const { data: asset, error: assetError } = await client
      .from("asset_versions")
      .select("bucket_id,media_mime,object_name")
      .eq("id", assetVersionId)
      .maybeSingle();
    if (assetError || !asset || asset.bucket_id !== "workspace-media") {
      return reply({ code: "ASSET_NOT_FOUND", ok: false }, 404, requestId);
    }
    if (!asset.media_mime.startsWith("image/")) {
      return reply({ code: "ASSET_PREVIEW_UNSUPPORTED", ok: false }, 415, requestId);
    }

    const { data, error } = await client.storage
      .from("workspace-media")
      .createSignedUrl(asset.object_name, SIGNED_PREVIEW_SECONDS);
    if (error || !data.signedUrl) {
      return reply({ code: "ASSET_SIGNING_UNAVAILABLE", ok: false }, 503, requestId);
    }
    return reply(
      {
        expiresIn: SIGNED_PREVIEW_SECONDS,
        ok: true,
        signedUrl: data.signedUrl,
      },
      200,
      requestId,
    );
  } catch {
    return reply({ code: "ASSET_SIGNING_UNAVAILABLE", ok: false }, 503, requestId);
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  parseSignedStorageRequest,
  StoragePathValidationError,
} from "@/security/storage-path";

const MAX_STORAGE_SIGN_BYTES = 2_048;

function response(
  body: Readonly<Record<string, boolean | string>>,
  status: number,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const environment = getServerEnvironment();
  if (
    !isTrustedMutationOrigin(
      request.headers.get("origin"),
      request.nextUrl.origin,
      environment.public.appUrl,
    )
  ) {
    return response({ code: "ORIGIN_DENIED", ok: false }, 403);
  }
  if (
    !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")
  ) {
    return response({ code: "JSON_REQUIRED", ok: false }, 415);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_STORAGE_SIGN_BYTES) {
    return response({ code: "REQUEST_TOO_LARGE", ok: false }, 413);
  }

  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_STORAGE_SIGN_BYTES) {
      return response({ code: "REQUEST_TOO_LARGE", ok: false }, 413);
    }
    const input = parseSignedStorageRequest(JSON.parse(raw) as unknown);
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: authenticationError,
    } = await client.auth.getUser();
    if (authenticationError || !user) {
      return response({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401);
    }
    const { data, error } = await client.storage
      .from(input.bucket)
      .createSignedUrl(input.path, input.expiresIn);
    if (error || !data?.signedUrl) {
      return response({ code: "STORAGE_ACCESS_DENIED", ok: false }, 403);
    }
    return NextResponse.json(
      { expiresIn: input.expiresIn, ok: true, signedUrl: data.signedUrl },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof StoragePathValidationError) {
      return response({ code: "INVALID_STORAGE_REQUEST", ok: false }, 400);
    }
    return response({ code: "STORAGE_SIGNING_UNAVAILABLE", ok: false }, 503);
  }
}

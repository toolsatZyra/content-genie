import { NextResponse, type NextRequest } from "next/server";

import { getServerEnvironment } from "@/config/server-env";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isTrustedMutationOrigin } from "@/security/origin";
import {
  parseSignedStorageRequest,
  StoragePathValidationError,
} from "@/security/storage-path";
import {
  BoundedRequestBodyError,
  declaredRequestBodyBytes,
  readBoundedUtf8RequestBody,
} from "@/server/bounded-request-body";

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
  try {
    const declaredLength = declaredRequestBodyBytes(
      request.headers,
      MAX_STORAGE_SIGN_BYTES,
    );
    const client = await createServerSupabaseClient();
    const {
      data: { user },
      error: authenticationError,
    } = await client.auth.getUser();
    if (authenticationError || !user) {
      return response({ code: "AUTHENTICATION_REQUIRED", ok: false }, 401);
    }
    const raw = await readBoundedUtf8RequestBody(
      request,
      MAX_STORAGE_SIGN_BYTES,
      declaredLength,
    );
    const input = parseSignedStorageRequest(JSON.parse(raw) as unknown);
    const { data: authorized, error: authorizationError } = await client.rpc(
      "authorize_storage_sign",
      {
        p_bucket: input.bucket,
        p_path: input.path,
      },
    );
    if (authorizationError || authorized !== true) {
      return response({ code: "STORAGE_ACCESS_DENIED", ok: false }, 403);
    }

    // Authenticated Storage policies deliberately deny direct sign operations.
    // Only this broker can mint a bearer URL, after fresh session authorization,
    // and parseSignedStorageRequest enforces the 30–120 second TTL.
    const signer = createAdminSupabaseClient();
    const { data, error } = await signer.storage
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
    if (error instanceof BoundedRequestBodyError && error.failure === "too-large") {
      return response({ code: "REQUEST_TOO_LARGE", ok: false }, 413);
    }
    if (error instanceof BoundedRequestBodyError) {
      return response({ code: "INVALID_STORAGE_REQUEST", ok: false }, 400);
    }
    if (error instanceof SyntaxError || error instanceof StoragePathValidationError) {
      return response({ code: "INVALID_STORAGE_REQUEST", ok: false }, 400);
    }
    return response({ code: "STORAGE_SIGNING_UNAVAILABLE", ok: false }, 503);
  }
}

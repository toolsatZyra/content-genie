export const MAX_SIGNED_URL_SECONDS = 120;
export const MIN_SIGNED_URL_SECONDS = 30;

export class StoragePathValidationError extends Error {
  override readonly name = "StoragePathValidationError";
}

export interface SignedStorageRequest {
  readonly bucket: "workspace-private";
  readonly expiresIn: number;
  readonly path: string;
  readonly workspaceId: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSignedStorageRequest(value: unknown): SignedStorageRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StoragePathValidationError("Storage request must be an object.");
  }
  const body = value as Record<string, unknown>;
  if (body.bucket !== "workspace-private") {
    throw new StoragePathValidationError("Storage bucket is not signable.");
  }
  if (
    typeof body.expiresIn !== "number" ||
    !Number.isSafeInteger(body.expiresIn) ||
    body.expiresIn < MIN_SIGNED_URL_SECONDS ||
    body.expiresIn > MAX_SIGNED_URL_SECONDS
  ) {
    throw new StoragePathValidationError("Signed URL lifetime is invalid.");
  }
  if (
    typeof body.path !== "string" ||
    body.path.length === 0 ||
    body.path.length > 1024 ||
    body.path.startsWith("/") ||
    body.path.endsWith("/") ||
    body.path.includes("//") ||
    body.path.includes("\\") ||
    body.path.includes("%") ||
    /[\u0000-\u001f\u007f]/.test(body.path) ||
    /(^|\/)\.{1,2}(\/|$)/.test(body.path)
  ) {
    throw new StoragePathValidationError("Storage path is invalid.");
  }
  const workspaceId = body.path.split("/", 1)[0] ?? "";
  if (!uuidPattern.test(workspaceId)) {
    throw new StoragePathValidationError(
      "Storage path must start with a workspace UUID.",
    );
  }
  return {
    bucket: body.bucket,
    expiresIn: body.expiresIn,
    path: body.path,
    workspaceId,
  };
}

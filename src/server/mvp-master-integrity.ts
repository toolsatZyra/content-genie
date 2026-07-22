export type RenderedMasterIdentity = Readonly<{
  byteLength: number;
  contentSha256: string;
  durationMs: number;
  height: number;
  objectName: string;
  width: number;
}>;

export type PersistedMasterIdentity = Readonly<{
  byte_length: number | string | null;
  content_sha256: string | null;
  duration_ms: number | string | null;
  height: number | string | null;
  object_name: string | null;
  width: number | string | null;
}>;

export function persistedMasterObjectMatches(
  actual: Readonly<{ byteLength: number; contentSha256: string }>,
  expected: Pick<RenderedMasterIdentity, "byteLength" | "contentSha256">,
): boolean {
  return (
    actual.byteLength === expected.byteLength &&
    actual.contentSha256 === expected.contentSha256
  );
}

export function persistedMasterRecordMatches(
  actual: PersistedMasterIdentity,
  expected: RenderedMasterIdentity,
): boolean {
  return (
    actual.object_name === expected.objectName &&
    actual.content_sha256 === expected.contentSha256 &&
    Number(actual.byte_length) === expected.byteLength &&
    Number(actual.duration_ms) === expected.durationMs &&
    Number(actual.width) === expected.width &&
    Number(actual.height) === expected.height
  );
}

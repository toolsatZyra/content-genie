export function isTrustedMutationOrigin(
  origin: string | null,
  requestOrigin: string,
  configuredAppUrl: string | null,
): boolean {
  if (!origin) return false;
  const allowed = new Set([requestOrigin]);
  if (configuredAppUrl) allowed.add(new URL(configuredAppUrl).origin);
  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

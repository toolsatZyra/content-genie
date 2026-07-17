export type CorrelationKind = "command" | "provider" | "request" | "run" | "stage";

export type CorrelationIds = Partial<Record<`${CorrelationKind}Id`, string>>;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;

export function createCorrelationId(kind: CorrelationKind): string {
  return `${kind}_${crypto.randomUUID()}`;
}

export function isCorrelationId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

export function readCorrelationId(
  headers: Headers,
  name = "x-request-id",
): string | null {
  const candidate = headers.get(name);
  return isCorrelationId(candidate) ? candidate : null;
}

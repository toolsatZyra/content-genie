export interface RetainedIdempotencyAttempt {
  readonly fingerprint: string;
  readonly key: string;
}

export function retainIdempotencyAttempt(
  current: RetainedIdempotencyAttempt | null,
  fingerprint: string,
  createKey: () => string = () => crypto.randomUUID(),
): RetainedIdempotencyAttempt {
  if (current?.fingerprint === fingerprint) return current;
  return { fingerprint, key: createKey() };
}

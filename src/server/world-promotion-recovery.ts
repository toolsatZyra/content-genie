export type WorldPromotionRecoveryOptions<T> = Readonly<{
  attemptPromotion: () => Promise<T>;
  isCommitted: () => Promise<boolean>;
  retryDelaysMs?: readonly number[];
  shouldRetry: (error: unknown) => boolean;
  wait?: (milliseconds: number) => Promise<void>;
}>;

const DEFAULT_RETRY_DELAYS_MS = [300, 900] as const;

function defaultWait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * A World promotion may commit after its HTTP caller receives an upstream
 * timeout. Reconcile the exact immutable receipt first; only when it is absent
 * may the same authority-bound promotion be replayed with the same identifiers.
 */
export async function settleWorldPromotion<T>(
  options: WorldPromotionRecoveryOptions<T>,
): Promise<T | null> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const wait = options.wait ?? defaultWait;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await options.attemptPromotion();
    } catch (error) {
      lastError = error;
    }

    if (await options.isCommitted()) return null;
    if (attempt >= retryDelaysMs.length || !options.shouldRetry(lastError)) {
      throw lastError;
    }
    await wait(retryDelaysMs[attempt] ?? 0);
  }

  throw lastError;
}

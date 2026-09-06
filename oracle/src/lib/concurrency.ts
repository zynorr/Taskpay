// Runs `mapFn` over `items` with at most `limit` concurrent promises.
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapFn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapFn(items[index]!, index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Race `promise` against a timer; rejects with `label` after `ms`. A hung RPC
 * (public endpoints can stall indefinitely) must never wedge a guarded loop
 * forever: the loops that own `busy`/`scanning` flags run this so a stuck call
 * can only skip a tick, not kill the daemon. The losing promise is left to
 * settle in the background — every caller re-reads on-chain state before
 * acting, so a late resolution can never be applied twice.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

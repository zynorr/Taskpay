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

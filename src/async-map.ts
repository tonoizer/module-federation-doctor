const MAP_CONCURRENCY = 8;

/** Map inputs with a fixed worker limit while keeping input order. */
export async function mapBounded<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => R | PromiseLike<R>,
): Promise<R[]> {
  const results = Array.from<R>({ length: items.length });
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index] as T, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(MAP_CONCURRENCY, items.length) }, () => worker()),
  );
  return results;
}

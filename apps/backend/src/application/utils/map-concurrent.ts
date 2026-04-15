// Bounded worker-pool over an async mapping. Spawns up to `limit` workers that
// pull items from a shared cursor, preserving input order in the result. The
// first failure aborts: pending in-flight workers settle but no new items are
// claimed, and the rejection propagates to the caller.

export const mapConcurrent = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  if (limit < 1) {
    throw new RangeError(`mapConcurrent: limit must be >= 1, got ${limit}`);
  }
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let cursor = 0;
  let aborted = false;
  let firstError: unknown = null;

  const worker = async (): Promise<void> => {
    while (!aborted) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (err) {
        if (!aborted) {
          aborted = true;
          firstError = err;
        }
        return;
      }
    }
  };

  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  if (firstError !== null) {
    throw firstError;
  }
  return results;
};

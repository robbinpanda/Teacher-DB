export const DEFAULT_UPLOAD_CONCURRENCY = 2;
export const MAX_UPLOAD_CONCURRENCY = 100;

export function normalizeUploadConcurrency(value: unknown, fallback = DEFAULT_UPLOAD_CONCURRENCY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_UPLOAD_CONCURRENCY, Math.max(1, Math.trunc(parsed)));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(normalizeUploadConcurrency(concurrency), items.length);
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

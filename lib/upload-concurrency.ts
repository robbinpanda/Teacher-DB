export const DEFAULT_UPLOAD_CONCURRENCY = 2;
export const MAX_UPLOAD_CONCURRENCY = 100;

export function normalizeUploadConcurrency(value: unknown, fallback = DEFAULT_UPLOAD_CONCURRENCY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_UPLOAD_CONCURRENCY, Math.max(1, Math.trunc(parsed)));
}

export function availableQueueCapacity(limit: unknown, active: unknown) {
  const normalizedLimit = normalizeUploadConcurrency(limit);
  const normalizedActive = Math.max(0, Math.trunc(Number(active) || 0));
  return Math.max(0, normalizedLimit - normalizedActive);
}

export type DynamicConcurrencyController<R> = {
  promise: Promise<R[]>;
  setConcurrency: (value: unknown) => void;
};

export function createDynamicConcurrencyController<T, R>(
  items: T[],
  initialConcurrency: number,
  operation: (item: T, index: number) => Promise<R>,
): DynamicConcurrencyController<R> {
  const results = new Array<R>(items.length);
  let concurrency = normalizeUploadConcurrency(initialConcurrency);
  let cursor = 0;
  let active = 0;
  let settled = false;
  let resolvePromise!: (value: R[]) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<R[]>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  function completeWhenIdle() {
    if (!settled && cursor >= items.length && active === 0) {
      settled = true;
      resolvePromise(results);
    }
  }

  function launch() {
    if (settled) return;
    while (active < concurrency && cursor < items.length) {
      const index = cursor++;
      active += 1;
      Promise.resolve(operation(items[index], index))
        .then((result) => { results[index] = result; })
        .catch((error) => {
          if (!settled) {
            settled = true;
            rejectPromise(error);
          }
        })
        .finally(() => {
          active -= 1;
          launch();
          completeWhenIdle();
        });
    }
    completeWhenIdle();
  }

  launch();
  return {
    promise,
    setConcurrency(value) {
      concurrency = normalizeUploadConcurrency(value, concurrency);
      launch();
    },
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T, index: number) => Promise<R>,
) {
  return createDynamicConcurrencyController(items, concurrency, operation).promise;
}

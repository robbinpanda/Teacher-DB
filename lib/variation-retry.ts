/** Retry only explicitly classified transport failures, never quality or parsing failures. */
export async function withVariationRetry<T>(operation: () => Promise<T>, options: {
  onRetry?: () => void;
  wait?: (milliseconds: number) => Promise<void>;
} = {}): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof Error) || !("retryable" in error) || error.retryable !== true) throw error;
    const retryAfter = "retryAfterMs" in error && typeof error.retryAfterMs === "number" ? error.retryAfterMs : 1000;
    // Respect a long Retry-After by returning control instead of retrying too early.
    if (!Number.isFinite(retryAfter) || retryAfter > 30_000) throw error;
    options.onRetry?.();
    await (options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))))(Math.max(1000, retryAfter));
    try {
      return await operation();
    } catch (retryError) {
      throw new Error(`已自动重试 1 次，仍未完成：${retryError instanceof Error ? retryError.message : "模型请求失败"}`, { cause: retryError });
    }
  }
}

/** Keep ordinary calls unchanged; the caller can give long generation a bounded floor. */
export function textModelTimeout(profileTimeout: number, requestedTimeout?: number, minimumTimeout?: number) {
  const base = Math.min(profileTimeout, requestedTimeout ?? profileTimeout);
  return Math.max(base, Math.min(300_000, Math.max(0, minimumTimeout ?? 0)));
}

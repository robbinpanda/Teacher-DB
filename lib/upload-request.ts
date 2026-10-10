type RetryOptions = {
  attempts?: number;
  request?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function uploadRetryDelay(response: Response | undefined, attempt: number) {
  const backoff = Math.min(8000, 500 * 2 ** (attempt - 1));
  const header = response?.headers.get("retry-after");
  if (!header?.trim()) return backoff;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : backoff;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : backoff;
}

// Upload endpoints are idempotent (document checksum, page checksum, queue retry).
// Read the body here so temporary plain-text/HTML responses also get a retry.
export async function fetchUploadJson<T extends object>(url: string, init: RequestInit, options: RetryOptions = {}): Promise<T> {
  const { attempts = 5, request = fetch, sleep = (milliseconds) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)) } = options;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    try {
      response = await request(url, init);
    } catch (error) {
      if (attempt === attempts || init.signal?.aborted) throw error;
      await sleep(uploadRetryDelay(undefined, attempt));
      continue;
    }
    const body: unknown = await response.json().catch(() => null);
    const validBody = body !== null && typeof body === "object" && !Array.isArray(body);
    if (response.ok && validBody) return body as T;
    const actionNotFound = response.status === 404 && response.headers.get("x-nextjs-action-not-found") === "1";
    const transient = actionNotFound || [408, 425, 429, 500, 502, 503, 504].includes(response.status) || (response.ok && !validBody);
    if (!transient || attempt === attempts) {
      const error = validBody && "error" in body && typeof body.error === "string" ? body.error : null;
      throw new Error(error ?? `上传接口暂时不可用（HTTP ${response.status}），请稍后重试。`);
    }
    await sleep(uploadRetryDelay(response, attempt));
  }
  throw new Error("上传请求重试次数无效");
}

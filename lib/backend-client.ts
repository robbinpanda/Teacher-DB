import "server-only";

export function backendUrl(path: string) {
  const base = process.env.JIANTI_API_URL ?? "http://127.0.0.1:3051";
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("JIANTI_API_URL 必须是 HTTP 或 HTTPS 地址");
  return new URL(path, url.origin);
}

export async function proxyBackendRequest(request: Request): Promise<Response> {
  const source = new URL(request.url);
  const headers = new Headers(request.headers);
  for (const header of ["host", "connection", "content-length", "transfer-encoding"]) headers.delete(header);
  try {
    const init: RequestInit & { duplex?: "half" } = {
      method: request.method, headers, cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20 * 60 * 1000)]),
    };
    if (!["GET", "HEAD"].includes(request.method) && request.body) {
      init.body = request.body;
      init.duplex = "half";
    }
    const response = await fetch(backendUrl(source.pathname + source.search), init);
    const responseHeaders = new Headers(response.headers);
    for (const header of ["content-encoding", "content-length", "transfer-encoding", "connection"]) responseHeaders.delete(header);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    const requestId = crypto.randomUUID();
    return Response.json({ error: "后端服务暂时不可用，请稍后重试", code: "backend_unavailable", retryable: true, requestId }, { status: 503, headers: { "x-request-id": requestId } });
  }
}

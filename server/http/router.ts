import { routes } from "./routes";
import { result, toResponse } from "../core/result";
import { readModel } from "./read-models";
import { z } from "zod";

type Params = Record<string, string | string[]>;
type Handler = (request: Request, context: { params: Promise<Params> }) => Promise<Response>;

export function matchPath(pattern: string, path: string): Params | null {
  const expected = pattern.split("/").filter(Boolean);
  const actual = path.split("/").filter(Boolean);
  const params: Params = {};
  for (let index = 0; index < expected.length; index++) {
    const segment = expected[index];
    if (segment.startsWith("[...")) {
      if (actual.length <= index) return null;
      params[segment.slice(4, -1)] = actual.slice(index).map(decodeURIComponent);
      return params;
    }
    if (actual[index] === undefined) return null;
    if (segment.startsWith("[")) params[segment.slice(1, -1)] = decodeURIComponent(actual[index]);
    else if (segment !== actual[index]) return null;
  }
  return expected.length === actual.length ? params : null;
}

const sortedRoutes = [...routes].sort((left, right) => {
  const dynamic = (path: string) => (path.match(/\[/g) ?? []).length;
  return dynamic(left.path) - dynamic(right.path) || right.path.length - left.path.length;
});

async function dispatch(request: Request): Promise<Response> {
  try {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/view" && request.method === "POST") return await readModel(request);
    for (const route of sortedRoutes) {
      const params = matchPath(route.path, pathname);
      if (!params) continue;
      if (!route.methods.includes(request.method)) {
        return toResponse(result({ error: "请求方法不支持", code: "method_not_allowed" }, { status: 405 }));
      }
      const handlerModule = await route.load();
      const handler = (handlerModule as unknown as Record<string, Handler>)[request.method];
      return await handler(request, { params: Promise.resolve(params) });
    }
    return toResponse(result({ error: "接口不存在" }, { status: 404 }));
  } catch (error) {
    if (error instanceof URIError) return toResponse(result({ error: "接口路径编码无效" }, { status: 400 }));
    console.error("[api] request failed", error);
    return toResponse(result({ error: "服务内部错误，请查看服务日志", code: "internal_error" }, { status: 500 }));
  }
}

export async function dispatchRequest(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  let response: Response;
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("content-type")?.includes("application/json")) {
    const payload = await request.clone().json().catch(() => null);
    if (!z.record(z.string(), z.unknown()).safeParse(payload).success) {
      response = toResponse(result({ error: "请求内容必须是有效的 JSON 对象", requestId }, { status: 400 }));
      response.headers.set("x-request-id", requestId);
      return response;
    }
  }
  response = await dispatch(request);
  if (response.status >= 400) {
    const body = response.headers.get("content-type")?.includes("application/json") ? await response.json().catch(() => null) : null;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      response = toResponse(result({ ...body, requestId }, { status: response.status }));
    } else response = toResponse(result({ error: response.status === 404 ? "资源不存在" : "请求处理失败", requestId }, { status: response.status }));
  }
  response.headers.set("x-request-id", requestId);
  return response;
}

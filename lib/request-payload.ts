export type ParsedPayload<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

function badRequest(message: string): ParsedPayload<never> {
  return { ok: false, response: Response.json({ error: message, code: "invalid_request", retryable: false }, { status: 400 }) };
}

export async function readJsonPayload<T extends object>(request: Request): Promise<ParsedPayload<T>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return badRequest("请求内容不是有效的 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return badRequest("请求内容必须是 JSON 对象");
  }
  return { ok: true, value: value as T };
}

export async function readFormDataPayload(request: Request): Promise<ParsedPayload<FormData>> {
  try {
    return { ok: true, value: await request.formData() };
  } catch {
    return badRequest("请求内容不是有效的表单数据");
  }
}

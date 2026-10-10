export type ServiceResult<T extends object = Record<string, unknown>> = {
  status: number;
  body: T;
};

const errorCodes: Record<number, string> = {
  400: "invalid_request", 401: "unauthenticated", 403: "forbidden", 404: "not_found",
  409: "state_conflict", 413: "payload_too_large", 415: "unsupported_media_type",
  422: "invalid_content", 429: "rate_limited", 500: "internal_error", 502: "provider_unavailable", 503: "service_unavailable",
};

export function result<T extends object>(body: T, options: { status?: number } = {}): ServiceResult<T> {
  const status = options.status ?? 200;
  if (status >= 400 && "error" in body) {
    return { status, body: { code: errorCodes[status] ?? "request_failed", retryable: status >= 500 || status === 429, ...body } };
  }
  return { status, body };
}

export function toResponse(outcome: ServiceResult): Response {
  return Response.json(outcome.body, { status: outcome.status });
}

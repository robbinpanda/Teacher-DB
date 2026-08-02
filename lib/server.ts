import { env } from "cloudflare:workers";

export function runtimeEnv() {
  return env as unknown as {
    DB?: D1Database;
    FILES?: R2Bucket;
    VISION_API_KEY?: string;
    VISION_API_BASE_URL?: string;
    VISION_MODEL?: string;
  };
}

export function requestOwner(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-demo";
}

export function now() {
  return new Date().toISOString();
}


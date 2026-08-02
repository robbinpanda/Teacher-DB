export type RuntimeBindings = {
  DB?: D1Database;
  FILES?: R2Bucket;
  VISION_API_KEY?: string;
  VISION_API_BASE_URL?: string;
  VISION_MODEL?: string;
};

declare global {
  var __SHITI_RUNTIME_ENV__: RuntimeBindings | undefined;
}

export function setRuntimeEnv(bindings: RuntimeBindings) {
  globalThis.__SHITI_RUNTIME_ENV__ = bindings;
}

export function runtimeEnv(): RuntimeBindings {
  if (globalThis.__SHITI_RUNTIME_ENV__) return globalThis.__SHITI_RUNTIME_ENV__;
  if (typeof process !== "undefined") {
    return {
      VISION_API_KEY: process.env.VISION_API_KEY,
      VISION_API_BASE_URL: process.env.VISION_API_BASE_URL,
      VISION_MODEL: process.env.VISION_MODEL,
    };
  }
  return {};
}

export function requestOwner(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-demo";
}

export function now() {
  return new Date().toISOString();
}

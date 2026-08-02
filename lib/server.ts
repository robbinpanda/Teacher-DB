import "server-only";

export type RuntimeConfig = {
  MODEL_KEY_ENCRYPTION_SECRET?: string;
};

export function runtimeEnv(): RuntimeConfig {
  return {
    MODEL_KEY_ENCRYPTION_SECRET: process.env.MODEL_KEY_ENCRYPTION_SECRET,
  };
}

export function requestOwner(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-demo";
}

export function now() {
  return new Date().toISOString();
}

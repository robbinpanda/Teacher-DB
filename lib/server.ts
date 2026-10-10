import "server-only";
import { tenantContext } from "../server/core/tenant";

export type RuntimeConfig = {
  MODEL_KEY_ENCRYPTION_SECRET?: string;
};

export function runtimeEnv(): RuntimeConfig {
  return {
    MODEL_KEY_ENCRYPTION_SECRET: process.env.MODEL_KEY_ENCRYPTION_SECRET,
  };
}

export function requestOwner(request: Request) {
  const tenant = tenantContext.getStore();
  if (tenant) return tenant.ownerId;
  if (process.env.JIANTI_DEPLOYMENT_MODE === "remote") throw new Error("远端请求缺少已验证的租户上下文");
  return request.headers.get("oai-authenticated-user-id") ?? "local-demo";
}

export function now() {
  return new Date().toISOString();
}

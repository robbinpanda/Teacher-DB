import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type Tenant = { ownerId: string; authentication: "local" | "jwt" };
export class AuthenticationError extends Error { readonly status = 401; readonly code = "unauthenticated"; }
export const tenantContext = new AsyncLocalStorage<Tenant>();

const claimsSchema = z.object({
  sub: z.string().min(1).max(100), exp: z.number().int().positive(),
  iss: z.string(), aud: z.union([z.string(), z.array(z.string())]),
  nbf: z.number().int().optional(),
});

export function assertAuthenticationConfiguration() {
  if (process.env.JIANTI_DEPLOYMENT_MODE !== "remote") return;
  if ((process.env.JIANTI_AUTH_SECRET?.length ?? 0) < 32) throw new Error("远端模式必须配置至少 32 字符的 JIANTI_AUTH_SECRET");
  if (!process.env.JIANTI_AUTH_ISSUER || !process.env.JIANTI_AUTH_AUDIENCE) throw new Error("远端模式必须配置 JIANTI_AUTH_ISSUER 和 JIANTI_AUTH_AUDIENCE");
}

export function authenticate(headers: Headers): Tenant {
  if (process.env.JIANTI_DEPLOYMENT_MODE !== "remote") {
    return { ownerId: headers.get("oai-authenticated-user-id")?.trim() || "local-demo", authentication: "local" };
  }
  assertAuthenticationConfiguration();
  const authorization = headers.get("authorization");
  const cookie = headers.get("cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith("jianti-session="))?.slice("jianti-session=".length);
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : cookie;
  if (!token || token.length > 8000) throw new AuthenticationError("请先登录");
  const [head, payload, signature, extra] = token.split(".");
  if (!head || !payload || !signature || extra) throw new AuthenticationError("登录凭据无效");
  const expected = createHmac("sha256", process.env.JIANTI_AUTH_SECRET!).update(`${head}.${payload}`).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new AuthenticationError("登录凭据无效");
  try {
    const header = JSON.parse(Buffer.from(head, "base64url").toString());
    if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("unsupported token");
    const claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now) || claims.iss !== process.env.JIANTI_AUTH_ISSUER || !audiences.includes(process.env.JIANTI_AUTH_AUDIENCE!)) throw new Error("invalid claims");
    return { ownerId: claims.sub, authentication: "jwt" };
  } catch { throw new AuthenticationError("登录凭据无效或已过期"); }
}

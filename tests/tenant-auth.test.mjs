import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { authenticate, assertAuthenticationConfiguration, tenantContext } from "../server/core/tenant.ts";

function remoteEnvironment(t) {
  const values = { JIANTI_DEPLOYMENT_MODE: "remote", JIANTI_AUTH_SECRET: "test-secret-at-least-thirty-two-characters", JIANTI_AUTH_ISSUER: "test-issuer", JIANTI_AUTH_AUDIENCE: "teacher-db" };
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
function token(overrides = {}) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "teacher-a", exp: Math.floor(Date.now() / 1000) + 60, iss: "test-issuer", aud: "teacher-db", ...overrides })).toString("base64url");
  const signature = createHmac("sha256", process.env.JIANTI_AUTH_SECRET).update(`${head}.${payload}`).digest("base64url");
  return `${head}.${payload}.${signature}`;
}

test("远端身份来自签名凭据，忽略可伪造的 owner header", t => {
  remoteEnvironment(t);
  const tenant = authenticate(new Headers({ authorization: `Bearer ${token()}`, "oai-authenticated-user-id": "teacher-b" }));
  assert.equal(tenant.ownerId, "teacher-a");
  assert.equal(authenticate(new Headers({ cookie: `jianti-session=${token()}` })).ownerId, "teacher-a");
  assert.throws(() => authenticate(new Headers({ "oai-authenticated-user-id": "teacher-a" })), /登录/);
});

test("错误签名、过期、提前生效及错误签发者/受众均被拒绝", t => {
  remoteEnvironment(t);
  for (const invalid of [token({ exp: 1 }), token({ nbf: Math.floor(Date.now() / 1000) + 60 }), token({ iss: "other" }), token({ aud: "other" }), token() + ".extra"]) {
    assert.throws(() => authenticate(new Headers({ authorization: `Bearer ${invalid}` })), /凭据/);
  }
  const valid = token();
  assert.throws(() => authenticate(new Headers({ authorization: `Bearer ${valid.slice(0, -3)}xxx` })), /凭据/);
  delete process.env.JIANTI_AUTH_SECRET;
  assert.throws(assertAuthenticationConfiguration, /32/);
});

test("并发请求的租户上下文彼此隔离", async () => {
  const owners = await Promise.all(["teacher-a", "teacher-b"].map(ownerId => tenantContext.run({ ownerId, authentication: "jwt" }, async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return tenantContext.getStore().ownerId;
  })));
  assert.deepEqual(owners, ["teacher-a", "teacher-b"]);
  assert.equal(tenantContext.getStore(), undefined);
});

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { stopIsolatedProcess } from "./test-runtime.mjs";

const tmpRoot = path.resolve("tmp");
const dataDir = path.join(tmpRoot, `remote-verify-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const secret = crypto.randomUUID() + crypto.randomUUID();
const exportSecret = crypto.randomUUID();
const base = "http://127.0.0.1:3188";
const env = { ...process.env, JIANTI_DATA_DIR: dataDir, JIANTI_API_PORT: "3188", JIANTI_DEPLOYMENT_MODE: "remote", JIANTI_AUTH_SECRET: secret,
  JIANTI_AUTH_ISSUER: "test-issuer", JIANTI_AUTH_AUDIENCE: "jianti", MODEL_KEY_ENCRYPTION_SECRET: exportSecret };
const child = spawn(process.execPath, ["--import", "./server/register.mjs", "--import", "tsx", "server/main.ts"], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let logs = ""; child.stdout.on("data", chunk => { logs += chunk; }); child.stderr.on("data", chunk => { logs += chunk; });
function encode(value) { return Buffer.from(JSON.stringify(value)).toString("base64url"); }
function session(ownerId) {
  const payload = encode({ sub: ownerId, exp: Math.floor(Date.now() / 1000) + 120, iss: "test-issuer", aud: "jianti" });
  const message = encode({ alg: "HS256", typ: "JWT" }) + "." + payload;
  return message + "." + createHmac("sha256", secret).update(message).digest("base64url");
}
function printToken(paperId, ownerId) {
  const payload = encode({ paperId, ownerId, expiresAt: Math.floor(Date.now() / 1000) + 120 });
  return payload + "." + createHmac("sha256", exportSecret).update(payload).digest("base64url");
}
async function call(url, ownerId, init = {}) {
  const response = await fetch(base + url, { ...init, headers: { ...(ownerId ? { authorization: `Bearer ${session(ownerId)}` } : {}), ...init.headers }, signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
let db;
try {
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.equal(child.exitCode, null, logs);
    try { if ((await call("/api/ready")).status === 200) break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const anonymous = await call("/api/documents", null, { headers: { "oai-authenticated-user-id": "teacher-a" } });
  assert.equal(anonymous.status, 401); assert.equal(anonymous.body.code, "unauthenticated"); assert.ok(anonymous.body.requestId);
  const form = new FormData(); form.set("file", new File(["%PDF-1.4\n%remote fixture\n%%EOF"], "fixture.pdf", { type: "application/pdf" })); form.set("pageCount", "1");
  const upload = await call("/api/documents", "teacher-a", { method: "POST", body: form, headers: { "oai-authenticated-user-id": "teacher-b" } });
  assert.equal(upload.status, 201, JSON.stringify(upload));
  db = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  assert.equal(db.prepare("SELECT owner_id FROM documents WHERE id=?").get(upload.body.id).owner_id, "teacher-a");
  assert.equal((await call(`/api/documents/${upload.body.id}/progress`, "teacher-b", { headers: { "oai-authenticated-user-id": "teacher-a" } })).status, 404);
  const views = await Promise.all(["teacher-a", "teacher-b"].map(owner => call("/api/view", owner, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resource: "documents" }) })));
  assert.equal(views[0].body.data.length, 1); assert.equal(views[1].body.data.length, 0);
  const foreignFile = await fetch(`${base}/api/files/${upload.body.originalKey}`, { headers: { authorization: `Bearer ${session("teacher-b")}` } });
  assert.equal(foreignFile.status, 404);
  const paperId = crypto.randomUUID(); const timestamp = new Date().toISOString();
  db.prepare("INSERT INTO papers(id,owner_id,title,created_at,updated_at) VALUES (?,?,?,?,?)").run(paperId, "teacher-a", "Authorized print", timestamp, timestamp);
  const token = printToken(paperId, "teacher-a");
  const query = { resource: "paper-print", id: paperId, token };
  const print = await call("/api/view", null, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(query) });
  assert.equal(print.status, 200); assert.equal(print.body.data.title, "Authorized print");
  assert.equal((await call("/api/view", null, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...query, resource: "documents" }) })).status, 401);
  assert.equal((await call("/api/view", null, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...query, id: "another-paper" }) })).status, 401);
  console.log("remote: ok (signed JWT, spoofed headers ignored, concurrent tenant read models, foreign resources/files denied, single-paper print capability)");
} finally {
  db?.close(); await stopIsolatedProcess(child);
  assert.ok(dataDir.startsWith(tmpRoot + path.sep)); rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

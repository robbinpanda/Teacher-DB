import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const temporaryRoot = path.resolve("tmp");
const dataDir = path.join(temporaryRoot, `backend-verify-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const base = "http://127.0.0.1:3186";
const children = [];
let logs = "";
function start(entry) {
  const child = spawn(process.execPath, ["--import", "./server/register.mjs", "--import", "tsx", entry], {
    env: { ...process.env, JIANTI_DATA_DIR: dataDir, JIANTI_API_PORT: "3186" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", chunk => { logs += chunk; });
  child.stderr.on("data", chunk => { logs += chunk; });
  children.push(child);
  return child;
}
async function call(url, init = {}) {
  const response = await fetch(base + url, { ...init, signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
let db;
try {
  start("server/main.ts");
  start("server/worker.ts");
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.ok(children.every(child => child.exitCode === null), logs);
    try { if ((await call("/api/ready")).status === 200 && logs.includes("[worker] ready")) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, logs);
  const results = await Promise.all(["/api/documents", "/api/extraction-queue", "/api/model-profiles", "/api/health"].map(url => call(url)));
  for (const response of results) assert.equal(response.status, 200, logs);
  db = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  assert.deepEqual(db.prepare("SELECT version FROM schema_migrations ORDER BY version").pluck().all(), [1, 2, 3]);
  assert.deepEqual(db.prepare("SELECT role FROM runtime_processes ORDER BY role").pluck().all(), ["api", "worker"]);
  const form = new FormData();
  form.set("file", new File(["%PDF-1.4\n%isolated upload\n%%EOF"], "fixture.pdf", { type: "application/pdf" }));
  form.set("pageCount", "1");
  const uploaded = await call("/api/documents", { method: "POST", body: form, headers: { "oai-authenticated-user-id": "teacher-a" } });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded));
  const anotherOwner = await call(`/api/documents/${uploaded.body.id}/progress`, { headers: { "oai-authenticated-user-id": "teacher-b" } });
  assert.equal(anotherOwner.status, 404);
  const invalid = await call("/api/extract", { method: "POST", headers: { "content-type": "application/json" }, body: "null" });
  assert.equal(invalid.status, 400);
  const wrongMethod = await call("/api/documents", { method: "PUT" });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.body.code, "method_not_allowed");
  console.log("backend: ok (NestJS routes, concurrent API/worker migrations, independent heartbeat, binary upload, owner isolation, malformed request)");
} finally {
  db?.close();
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }));
  assert.ok(dataDir.startsWith(temporaryRoot + path.sep));
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

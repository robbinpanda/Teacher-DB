import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import { stopIsolatedProcess } from "./test-runtime.mjs";

const tmpRoot = path.resolve("tmp");
const dataDir = path.join(tmpRoot, `local-verify-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const env = { ...process.env, JIANTI_DATA_DIR: dataDir, JIANTI_DEPLOYMENT_MODE: "local" };
const args = ["scripts/run-local.mjs", "--build", "--with-python", "--web-port=3193", "--api-port=3293", "--processor-port=3393"];
let logs = "";
function startLocal() {
  const instance = spawn(process.execPath, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  instance.stdout.on("data", chunk => { logs += chunk; }); instance.stderr.on("data", chunk => { logs += chunk; });
  return instance;
}
let child = startLocal();
const statePath = path.resolve(".runtime/local-3193.json");
async function until(fn, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(`Timed out\n${logs}`);
}
try {
  await until(async () => { assert.equal(child.exitCode, null, logs); return logs.includes("[local] ready"); });
  const ready = await (await fetch("http://127.0.0.1:3193/api/ready?dependencies=1")).json();
  assert.equal(ready.workerReady, true); assert.equal(ready.schemaVersion, 3);
  assert.equal((await fetch("http://127.0.0.1:3393/ready")).status, 200);
  assert.equal((await fetch("http://127.0.0.1:3193/")).status, 200);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  assert.equal(state.supervisorPid, child.pid); assert.equal(state.instanceId, ready.instanceId);
  const duplicate = spawn(process.execPath, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let duplicateLog = ""; duplicate.stdout.on("data", chunk => { duplicateLog += chunk; });
  assert.equal((await once(duplicate, "exit"))[0], 0); assert.match(duplicateLog, /already running/);
  const checker = spawn(process.execPath, ["scripts/stop-local.mjs", "--web-port=3193", "--check"], { env, windowsHide: true, stdio: "ignore" });
  assert.equal((await once(checker, "exit"))[0], 0);
  const stopper = spawn(process.execPath, ["scripts/stop-local.mjs", "--web-port=3193"], { env, windowsHide: true, stdio: "ignore" });
  assert.equal((await once(stopper, "exit"))[0], 0);
  await until(async () => {
    const result = await Promise.all([3193, 3293, 3393].map(port => fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(1000) }).then(() => false, () => true)));
    return result.every(Boolean);
  }, 10000);
  logs = "";
  child = startLocal();
  await until(async () => { assert.equal(child.exitCode, null, logs); return logs.includes("[local] ready"); });
  assert.match(logs, /using existing frontend build/);
  await stopIsolatedProcess(child);
  console.log("local: ok (production build reuse, Next + Nest + worker + FastAPI readiness, homepage, duplicate start, verified stop, all managed ports closed)");
} finally {
  await stopIsolatedProcess(child);
  try { const state = JSON.parse(readFileSync(statePath, "utf8")); if (state.supervisorPid === child.pid) unlinkSync(statePath); } catch {}
  assert.ok(dataDir.startsWith(tmpRoot + path.sep)); rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

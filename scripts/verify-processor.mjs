import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { preparePython } from "./python-runtime.mjs";
import { stopIsolatedProcess } from "./test-runtime.mjs";

const root = process.cwd();
const tmpRoot = path.resolve("tmp");
const dataDir = path.join(tmpRoot, `processor-verify-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const children = [];
const token = crypto.randomUUID() + crypto.randomUUID();
const env = { ...process.env, JIANTI_DATA_DIR: dataDir, JIANTI_DEPLOYMENT_MODE: "local", JIANTI_API_PORT: "3187",
  JIANTI_DOCUMENT_PROCESSOR_URL: "http://127.0.0.1:3287", JIANTI_PROCESSOR_TOKEN: token, JIANTI_PREPARATION_LEASE_MS: "3000" };
let logs = "";
let db;
function start(command, args) {
  const child = spawn(command, args, { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", bytes => { logs += bytes; }); child.stderr.on("data", bytes => { logs += bytes; });
  children.push(child); return child;
}
function node(entry) { return start(process.execPath, ["--import", "./server/register.mjs", "--import", "tsx", entry]); }
async function until(fn, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn().catch(() => false)) return; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error(`Timed out\n${logs}`);
}
async function stop(child) { if (child.exitCode !== null || child.signalCode !== null) return; await stopIsolatedProcess(child); }
try {
  const python = await preparePython(root);
  const fixture = path.join(dataDir, "fixture.pdf");
  const generator = start(python, ["-c", "import pymupdf,sys; doc=pymupdf.open(); [(lambda p: p.insert_text((72,72),'Question 1: verify recovery'))(doc.new_page()) for _ in range(80)]; doc.save(sys.argv[1]); doc.close()", fixture]);
  assert.equal((await once(generator, "exit"))[0], 0, logs);
  start(python, ["-m", "uvicorn", "processor.main:app", "--host", "127.0.0.1", "--port", "3287"]);
  node("server/main.ts");
  await until(async () => (await fetch("http://127.0.0.1:3287/ready")).ok && (await fetch("http://127.0.0.1:3187/api/ready")).ok);
  const processor = "http://127.0.0.1:3287/v1/pdf/pages";
  assert.equal((await fetch(processor, { method: "POST", headers: { "content-type": "application/pdf" }, body: "%PDF-invalid" })).status, 401);
  assert.equal((await fetch(processor, { method: "POST", headers: { "content-type": "application/pdf", "x-processor-token": token }, body: "%PDF-invalid" })).status, 422);
  const form = new FormData(); form.set("file", new File([readFileSync(fixture)], "fixture.pdf", { type: "application/pdf" })); form.set("pageCount", "0");
  const uploaded = await fetch("http://127.0.0.1:3187/api/documents", { method: "POST", body: form });
  assert.equal(uploaded.status, 201); const document = await uploaded.json(); assert.equal(document.preparationQueued, true);
  db = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  const worker = node("server/worker.ts");
  await until(async () => db.prepare("SELECT completed_pages FROM document_preparations WHERE document_id=?").get(document.id)?.completed_pages >= 1);
  await stop(worker); // Only the process created by this test is terminated.
  const interrupted = db.prepare("SELECT * FROM document_preparations WHERE document_id=?").get(document.id);
  assert.equal(interrupted.status, "processing");
  assert.ok(interrupted.completed_pages < 80, "Fixture must interrupt before all pages are persisted");
  node("server/worker.ts");
  await until(async () => db.prepare("SELECT status FROM document_preparations WHERE document_id=?").get(document.id)?.status === "complete", 90000);
  const recovered = db.prepare("SELECT * FROM document_preparations WHERE document_id=?").get(document.id);
  assert.equal(recovered.attempt, 2); assert.equal(recovered.completed_pages, 80);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM pages WHERE document_id=?").get(document.id).n, 80);
  assert.equal(db.prepare("SELECT status FROM documents WHERE id=?").get(document.id).status, "awaiting_model");
  const foreign = await fetch(`http://127.0.0.1:3187/api/documents/${document.id}/prepare`, { method: "POST", headers: { "content-type": "application/json", "oai-authenticated-user-id": "other-owner" }, body: "{}" });
  assert.equal(foreign.status, 404);
  console.log("processor: ok (real FastAPI/PyMuPDF, PDF validation, durable upload, worker interrupted after a page, lease recovery, 80 unique pages, owner isolation)");
} finally {
  db?.close(); await Promise.all(children.map(stop));
  assert.ok(dataDir.startsWith(tmpRoot + path.sep)); rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

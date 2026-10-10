import { stopIsolatedProcess } from "./test-runtime.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Run after npm run build. Use an isolated database; never alter the teacher's data.
const temporaryRoot = path.resolve("tmp");
const dataDir = path.join(temporaryRoot, `review-startup-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
const base = "http://127.0.0.1:3183";
const child = spawn(process.execPath, ["scripts/run-local.mjs", "--web-port=3183", "--api-port=3283"], {
  env: { ...process.env, JIANTI_DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
});
let logs = "";
child.stdout.on("data", chunk => { logs += chunk; });
child.stderr.on("data", chunk => { logs += chunk; });
let database;

async function page(url, expectedText) {
  const response = await fetch(base + url, { signal: AbortSignal.timeout(15000) });
  const html = await response.text();
  assert.equal(response.status, 200, `${url}: ${logs}`);
  assert.ok(html.includes(expectedText), `${url}: expected ${expectedText}`);
  assert.ok(!html.includes("审核页暂时无法加载"), `${url}: error boundary shown`);
  assert.ok(!html.includes("Cannot read properties of undefined"), `${url}: render failed`);
}

try {
  // Wait for the listener, without warming up database-backed routes.
  for (let attempt = 0; attempt < 100 && !logs.includes("[local] ready"); attempt++) {
    assert.equal(child.exitCode, null, logs);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(logs.includes("[local] ready"), `server did not start: ${logs}`);
  await Promise.all([
    page("/", "拣题"),
    page("/settings/models", "模型"),
    ...["/api/documents", "/api/extraction-queue"].map(async url => {
      const response = await fetch(base + url, { signal: AbortSignal.timeout(15000) });
      assert.equal(response.status, 200, `${url}: ${logs}`);
      await response.json();
    }),
  ]);
  const health = await fetch(base + "/api/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);

  database = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  const timestamp = new Date().toISOString();
  database.prepare(`INSERT INTO documents
    (id, owner_id, name, mime_type, status, page_count, created_at, updated_at)
    VALUES ('startup-review', 'local-demo', 'Startup review fixture', 'application/pdf', 'uploading', 1, ?, ?)`)
    .run(timestamp, timestamp);
  await page("/review/startup-review", "原卷正在上传并生成分页图");
  database.prepare("UPDATE documents SET page_count = 0 WHERE id = 'startup-review'").run();
  await page("/review/startup-review", "等待原卷页面");
  database.prepare("UPDATE documents SET page_count = 1 WHERE id = 'startup-review'").run();

  database.prepare("UPDATE documents SET status = 'failed', error = '上传中断' WHERE id = 'startup-review'").run();
  await page("/review/startup-review", "原卷分页图尚未保存");
  database.prepare(`INSERT INTO questions
    (id, document_id, number, type, stem, page_number, bbox_json, created_at, updated_at)
    VALUES ('startup-question', 'startup-review', '1', 'fill', '1+1=?', 1, '{"x":1,"y":1,"width":20,"height":20}', ?, ?)`)
    .run(timestamp, timestamp);
  await page("/review/startup-review", "原卷分页图尚未保存");

  database.prepare(`INSERT INTO pages (id, document_id, page_number, storage_key, width, height, created_at)
    VALUES ('startup-page', 'startup-review', 1, 'startup/page.png', 800, 1100, ?)`)
    .run(timestamp);
  database.prepare(`INSERT INTO extraction_runs
    (id, document_id, page_id, page_number, provider, model, status, created_at)
    VALUES ('startup-run', 'startup-review', 'startup-page', 1, 'openai-compatible', 'fixture-model', 'complete', ?)`)
    .run(timestamp);
  database.prepare("UPDATE documents SET status = 'reviewing', error = NULL WHERE id = 'startup-review'").run();
  await page("/review/startup-review", "fixture-model");
  const progress = await fetch(base + "/api/documents/startup-review/progress");
  assert.equal(progress.status, 200);
  const progressData = await progress.json();
  assert.equal(progressData.pages[0].modelDisplayName, "fixture-model");
  assert.equal(progressData.pages[0].modelName, "fixture-model");
  assert.equal(progressData.pages[0].modelProvider, "openai-compatible");
  assert.ok(!/TypeError|Unhandled|unhandled/.test(logs), logs);
  console.log("review startup: ok (fresh database, concurrent first requests, empty pages, interrupted upload, saved questions without pages, ready review, model progress)");
} finally {
  database?.close();
  const exited = child.exitCode === null ? new Promise(resolve => child.once("exit", resolve)) : Promise.resolve();
  await stopIsolatedProcess(child);
  await exited;
  assert.ok(dataDir.startsWith(temporaryRoot + path.sep), "cleanup must stay inside tmp");
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

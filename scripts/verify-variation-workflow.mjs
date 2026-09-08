import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const appPort = 3180;
const modelPort = 3181;
const baseUrl = `http://127.0.0.1:${appPort}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "jianti-variation-e2e-"));
const serveOnly = process.argv.includes("--serve");
let modelCalls = 0;

const generatorVariations = [
  { stem: "若 x=2，则 x+2 等于多少？", type: "single", options: [{ key: "A", content: "3" }, { key: "B", content: "4" }], answer: "B", analysis: "代入得 2+2=4。", tags: ["函数"], changeNote: "改变数值" },
  { stem: "若 x=3，则 2x 等于多少？", type: "single", options: [{ key: "A", content: "5" }, { key: "B", content: "6" }], answer: "B", analysis: "2×3=6。", tags: ["函数"], changeNote: "改变运算" },
  { stem: "若 x+1=5，则 x 等于多少？", type: "single", options: [{ key: "A", content: "3" }, { key: "B", content: "4" }], answer: "B", analysis: "等式两边减 1，x=4。", tags: ["函数"], changeNote: "改为逆向设问" },
];

const modelServer = createServer((request, response) => {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => { body += chunk; });
  request.on("end", () => {
    modelCalls += 1;
    const payload = JSON.parse(body);
    const userText = JSON.stringify(payload.messages ?? payload.input ?? "");
    const content = userText.includes("独立审校与修订 Agent")
      ? JSON.stringify({ reviews: generatorVariations.slice(0, 2).map((variation, index) => ({ index: index + 1, verdict: index === 1 ? "revise" : "pass", score: 92 - index, issues: index === 1 ? ["已复算答案并规范解析"] : [], finalVariation: variation })) })
      : JSON.stringify({ variations: generatorVariations });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 80 } }));
  });
});

function waitForServer(url, timeoutMs = 20_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const response = await fetch(url);
        if (response.ok) return resolve();
      } catch {}
      if (Date.now() - started > timeoutMs) return reject(new Error(`等待服务超时：${url}`));
      setTimeout(poll, 200);
    };
    void poll();
  });
}

async function jsonRequest(url, init) {
  const response = await fetch(baseUrl + url, init);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

await new Promise((resolve) => modelServer.listen(modelPort, "127.0.0.1", resolve));
const nextProcess = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(appPort)], {
  cwd: process.cwd(),
  env: { ...process.env, JIANTI_DATA_DIR: dataDir, MODEL_KEY_ENCRYPTION_SECRET: "variation-e2e-secret-2026" },
  stdio: ["ignore", "pipe", "pipe"],
});

try {
  await waitForServer(`${baseUrl}/api/health`);
  const sqlite = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  const timestamp = new Date().toISOString();
  sqlite.prepare(`INSERT INTO documents
    (id, owner_id, name, mime_type, status, page_count, subject, grade, source_region, source_textbook, created_at, updated_at)
    VALUES ('source-doc', 'local-demo', '函数基础练习.pdf', 'application/pdf', 'complete', 0, '数学', '高一', '上海', '人教A版', ?, ?)`)
    .run(timestamp, timestamp);
  sqlite.prepare(`INSERT INTO questions
    (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json, status,
     needs_human_review, confidence, score, created_at, updated_at)
    VALUES ('source-question', 'source-doc', '1', 'single', '若 x=1，则 x+1 等于多少？',
      '[{"key":"A","content":"1"},{"key":"B","content":"2"}]', 'B', '代入计算。', 1,
      '{"x":0,"y":0,"width":100,"height":100}', 'approved', 0, 1, 0, ?, ?)`)
    .run(timestamp, timestamp);
  sqlite.close();

  await jsonRequest("/api/model-profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "本地审校模型", provider: "openai-chat-completions", baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: "fake", apiKey: "fake-key-123", select: true }),
  });

  if (serveOnly) {
    console.log(`variation workflow fixture ready: ${baseUrl}/bank`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } else {

    const idempotencyKey = crypto.randomUUID();
    const generated = await jsonRequest("/api/questions/source-question/variations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: 2, difficulty: "similar", qualityMode: "reviewed", idempotencyKey }),
  });
  assert.equal(generated.status, "awaiting_teacher");
  assert.equal(generated.candidates.length, 2);
  assert.equal(modelCalls, 2);

  const beforeAcceptance = await jsonRequest("/api/questions?pageSize=20");
  assert.equal(beforeAcceptance.pagination.total, 1, "候选题不得提前进入正式题库");
  const replay = await jsonRequest("/api/questions/source-question/variations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: 2, difficulty: "similar", qualityMode: "reviewed", idempotencyKey }),
  });
  assert.equal(replay.cached, true);
  assert.equal(modelCalls, 2, "幂等重放不得再次调用模型");

  const accepted = await jsonRequest(`/api/variation-runs/${generated.runId}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidateIds: [generated.candidates[0].id] }),
  });
  assert.equal(accepted.accepted, 1);
  assert.equal(accepted.questions[0].needsHumanReview, false);
  assert.equal(accepted.questions[0].parentQuestionId, "source-question");
  assert.equal(accepted.questions[0].variationReview.mode, "multi_agent");
  const afterAcceptance = await jsonRequest("/api/questions?pageSize=20");
  assert.equal(afterAcceptance.pagination.total, 2);
    console.log("variation workflow e2e: ok");
  }
} finally {
  const exited = nextProcess.exitCode === null
    ? new Promise((resolve) => nextProcess.once("exit", resolve))
    : Promise.resolve();
  nextProcess.kill();
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  await new Promise((resolve) => modelServer.close(resolve));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { rmSync(dataDir, { recursive: true, force: true }); break; }
    catch (error) {
      if (attempt === 4 || error?.code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
}

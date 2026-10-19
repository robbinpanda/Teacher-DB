import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { stopIsolatedProcess } from "./test-runtime.mjs";

const appPort = 3180;
const modelPort = 3181;
const baseUrl = `http://127.0.0.1:${appPort}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "jianti-variation-e2e-"));
const serveOnly = process.argv.includes("--serve");
let modelCalls = 0;
let scenario = "pass";
let generationAttempts = 0;
const usedModels = [];

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
    usedModels.push(payload.model);
    const isGeneration = userText.includes("请生成 3 道候选变式题");
    if (isGeneration) {
      generationAttempts++;
      if ((scenario === "retry" && generationAttempts === 1) || scenario === "unavailable" || scenario === "unauthorized") {
        response.writeHead(scenario === "unauthorized" ? 401 : 503, { "content-type": "application/json", "retry-after": "0" });
        response.end(JSON.stringify({ error: "simulated provider failure" }));
        return;
      }
    }
    const content = userText.includes('逐题核查可解性')
      ? JSON.stringify({ checks: [1, 2].map(index => ({ index, score: scenario === "low-score" ? 74 : scenario === "missing-score" ? undefined : 92 - index, solvable: true, answerCorrect: scenario !== "wrong-answer", objectiveAligned: true, difficultyAligned: true, explanation: "代入验证正确" })) })
      : userText.includes('规划 3 道变式')
      ? JSON.stringify({ objective: "代入求值", prerequisites: "整数运算", difficultyRationale: "一步代入", misconception: "运算次序", changes: ["改变数值", "改变运算", "逆向"] })
      : userText.includes("独立审校与修订 Agent")
      ? JSON.stringify({ reviews: generatorVariations.slice(0, 2).map((variation, index) => ({ index: index + 1, verdict: index === 1 ? "revise" : "pass", score: 0, issues: index === 1 ? ["已复算答案并规范解析"] : [], finalVariation: variation })) })
      : JSON.stringify({ variations: generatorVariations.map((q, i) => i === 0 ? { ...q, answer: "A" } : q) });
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
const nextProcess = spawn(process.execPath, ["scripts/run-local.mjs", `--web-port=${appPort}`, `--api-port=${appPort + 100}`], {
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

  const reviewer = await jsonRequest("/api/model-profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "本地审校模型", provider: "openai-chat-completions", baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: "fake-reviewer", apiKey: "fake-key-123", select: true }),
  });

  const generator = await jsonRequest("/api/model-profiles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName: "本地生成模型", provider: "openai-chat-completions", baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: "fake-generator", apiKey: "fake-key-123", select: false }),
  });
  const modelSelection = { profileId: generator.profile.id, reviewerProfileId: reviewer.profile.id };

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
    body: JSON.stringify({ count: 2, difficulty: "similar", qualityMode: "reviewed", ...modelSelection, idempotencyKey }),
  });
  assert.equal(generated.status, "awaiting_teacher");
  assert.equal(generated.candidates.length, 2);
  assert.equal(modelCalls, 4);
  assert.deepEqual(usedModels, ["fake-generator", "fake-generator", "fake-reviewer", "fake-reviewer"]);
  assert.equal(generated.candidates[0].question.answer, "B", "审校必须修正生成稿中的错误答案");
  assert.equal(generated.candidates[0].review.score, 91, "仅采用独立最终评分，不能沿用修订轮 0 分");
  assert.equal((await jsonRequest("/api/model-profiles")).selectedProfileId, reviewer.profile.id, "单次选择不得修改全局默认模型");

  const beforeAcceptance = await jsonRequest("/api/questions?pageSize=20&subject=数学&stage=high");
  assert.equal(beforeAcceptance.pagination.total, 1, "候选题不得提前进入正式题库");
  const replay = await jsonRequest("/api/questions/source-question/variations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: 2, difficulty: "similar", qualityMode: "reviewed", ...modelSelection, idempotencyKey }),
  });
  assert.equal(replay.cached, true);
  assert.equal(modelCalls, 4, "幂等重放不得再次调用模型");

  const accepted = await jsonRequest(`/api/variation-runs/${generated.runId}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ candidateIds: [generated.candidates[0].id] }),
  });
  assert.equal(accepted.accepted, 1);
  assert.equal(accepted.questions[0].needsHumanReview, false);
  assert.equal(accepted.questions[0].parentQuestionId, "source-question");
  assert.equal(accepted.questions[0].variationReview.mode, "multi_agent");
  const afterAcceptance = await jsonRequest("/api/questions?pageSize=20&subject=数学&stage=high");
  assert.equal(afterAcceptance.pagination.total, 2);

  const db = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  const generate = () => fetch(baseUrl + "/api/questions/source-question/variations", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: 2, difficulty: "similar", qualityMode: "reviewed", ...modelSelection, idempotencyKey: crypto.randomUUID() }),
  });
  for (const failure of ["low-score", "missing-score", "wrong-answer", "unavailable", "unauthorized"]) {
    scenario = failure; generationAttempts = 0;
    const before = modelCalls;
    const response = await generate();
    const result = await response.json();
    assert.equal(response.ok, false, failure);
    assert.equal(result.status, "failed", failure);
    assert.equal(db.prepare("SELECT count(*) AS n FROM variation_candidates WHERE run_id=?").get(result.runId).n, 0, "失败不能保存候选题");
    assert.equal(modelCalls - before, failure === "unavailable" ? 3 : failure === "unauthorized" ? 2 : 4, "只重试暂时传输失败");
    if (failure === "unavailable") assert.match(result.error, /候选生成失败.*已自动重试 1 次/);
    if (failure === "low-score") assert.match(result.error, /75/);
  }
  scenario = "retry"; generationAttempts = 0;
  const beforeRetry = modelCalls;
  const retryResponse = await generate();
  const recovered = await retryResponse.json();
  assert.equal(retryResponse.status, 201, JSON.stringify(recovered));
  assert.equal(modelCalls - beforeRetry, 5);
  assert.equal(generationAttempts, 2);
  assert.equal(recovered.candidates[0].review.score, 91);
  // Recheck the quality boundary when promoting, including persisted record corruption.
  const candidate = recovered.candidates[0];
  db.prepare("UPDATE variation_candidates SET review_json=? WHERE id=?").run(JSON.stringify({ ...candidate.review, score: 74 }), candidate.id);
  const promote = () => fetch(baseUrl + `/api/variation-runs/${recovered.runId}/accept`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ candidateIds: [candidate.id] }),
  });
  assert.equal((await promote()).ok, false, "入库时仍拒绝低分");
  db.prepare("UPDATE variation_candidates SET review_json=? WHERE id=?").run(JSON.stringify(candidate.review), candidate.id);
  const summary = JSON.parse(db.prepare("SELECT result_json FROM variation_runs WHERE id=?").get(recovered.runId).result_json);
  summary.verification[0].answerCorrect = false;
  db.prepare("UPDATE variation_runs SET result_json=? WHERE id=?").run(JSON.stringify(summary), recovered.runId);
  assert.equal((await promote()).ok, false, "高分也不能绕过答案检查");
  assert.equal((await jsonRequest("/api/questions?pageSize=20&subject=数学&stage=high")).pagination.total, 2, "所有失败都不改变正式题库");
  const beforeInvalid = modelCalls;
  for (const profileId of ["missing-profile", 123, ""]) {
    const response = await fetch(baseUrl + "/api/questions/source-question/variations", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 2, qualityMode: "reviewed", profileId, idempotencyKey: crypto.randomUUID() }),
    });
    assert.equal(response.ok, false);
  }
  assert.equal(modelCalls, beforeInvalid, "无效模型不能偷偷回退到默认模型");
  db.close();
  console.log("variation workflow e2e: scoring, quality gates, transient retries, explicit models, admission and idempotency: ok");

  }
} finally {
  await stopIsolatedProcess(nextProcess);
  await new Promise((resolve) => modelServer.close(resolve));
  console.log(`Isolated test data: ${dataDir}`);
}

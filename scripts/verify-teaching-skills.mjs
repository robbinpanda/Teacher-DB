import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const dataDir = mkdtempSync(path.join(tmpdir(), "jianti-skills-e2e-"));
const port = 3184;
const modelPort = 3185;
const baseUrl = `http://127.0.0.1:${port}`;
const skillText = "---\nname: sample-math\ndescription: 样例数学试卷识读规则\n---\n\n识读样例规则 MARKER_SKILL：保留印刷题号、运算符和单位；不可见答案留空，图表不明确时请求人工复核。";
let seenExtractionSystem = "";
let failReview = false;
const recognition = { questions: [{ number: "1", stem: "2+2=?", options: [], answer: "", analysis: "", evidence: "第一行左侧", needsHumanReview: false }], warnings: [] };
const model = createServer((request, response) => {
  let raw = "";
  request.on("data", chunk => { raw += chunk; });
  request.on("end", () => {
    const payload = JSON.parse(raw);
    const system = payload.messages[0].content;
    let content;
    if (payload.stream) {
      seenExtractionSystem = system;
      const records = [{ event: "meta", questionCount: 1, documentMeta: { subject: "数学", grade: "九年级" } }, { event: "question", question: { number: "1", stem: "2+2=?", type: "fill", options: [], answer: "", analysis: "", firstLinePage: 1, sourcePages: [1], assets: [], expectedImageCount: 0, missingImages: [], unlocatedImages: false, needsHumanReview: true, tags: [], confidence: 0.9 } }, { event: "done" }];
      response.writeHead(200, { "content-type": "text/event-stream" });
      for (const record of records) response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(record) + "\n" } }] })}\n\n`);
      response.end("data: [DONE]\n\n"); return;
    }
    if (system.includes("你编写试卷识读 Skill")) content = skillText;
    else if (system.includes("强制试识别协议")) content = JSON.stringify(recognition);
    else content = JSON.stringify({ accurate: failReview ? "true" : true, reasonable: true, summary: "原图与试识别一致。", issues: [] });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 30 } }));
  });
});
await new Promise(resolve => model.listen(modelPort, "127.0.0.1", resolve));
const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: { ...process.env, JIANTI_DATA_DIR: dataDir, MODEL_KEY_ENCRYPTION_SECRET: "skill-isolated-test-secret" }, stdio: ["ignore", "pipe", "pipe"] });
let appLog = "";
app.stdout.on("data", chunk => { appLog += chunk; }); app.stderr.on("data", chunk => { appLog += chunk; });
let db;
async function api(url, body, method = "POST", status = 200, owner) {
  const response = await fetch(baseUrl + url, { method, headers: { ...(body instanceof FormData ? {} : { "content-type": "application/json" }), ...(owner ? { "oai-authenticated-user-id": owner } : {}) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result)); return result;
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(baseUrl + "/api/health")).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, appLog);
  await api("/api/model-profiles", { displayName: "Skill 测试模型", provider: "openai-chat-completions", baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: "fixture", apiKey: "fixture-key", select: true }, "POST", 201);
  const catalog = await api("/api/teaching-skills?subject=数学&grade=九年级", undefined, "GET");
  assert.ok(catalog.base.includes("九年级")); assert.ok(catalog.protocol.includes("逐字转录"));
  const sample = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="white"/><text x="80" y="120" font-size="30">1. 2+2=?</text></svg>')).jpeg().toBuffer();
  const form = new FormData(); form.append("subject", "数学"); form.append("grade", "九年级"); form.append("file", new Blob([sample], { type: "image/jpeg" }), "sample.jpg");
  const { skill } = await api("/api/teaching-skills", form, "POST", 201);
  const url = `/api/teaching-skills/${skill.id}`;
  await api(url, undefined, "GET", 404, "other-teacher");
  assert.equal((await fetch(`${baseUrl}/api/files/${skill.sampleKey}`, { headers: { "oai-authenticated-user-id": "other-teacher" } })).status, 404);
  await api(url, { action: "activate", revision: 1 }, "PATCH", 400);
  const { trial } = await api(url, { action: "trial", revision: 1 }, "PATCH");
  assert.equal(trial.recognition.questions.length, 1);
  await api(url, { action: "review", revision: 1, trialId: trial.id, verdict: "approved", confirmed: true, notes: "已对照样例逐题核查" }, "PATCH");
  await api(url, { action: "activate", revision: 1 }, "PATCH");
  db = new Database(path.join(dataDir, "teacher-question-bank.sqlite3"));
  const timestamp = new Date().toISOString();
  const storageKey = "documents/test-doc/page.jpg";
  mkdirSync(path.join(dataDir, "files", "documents", "test-doc"), { recursive: true });
  writeFileSync(path.join(dataDir, "files", storageKey), sample);
  db.prepare("INSERT INTO documents(id, owner_id, name, mime_type, status, page_count, subject, grade, created_at, updated_at) VALUES ('test-doc','local-demo','sample','application/pdf','reviewing',1,'数学','九年级',?,?)").run(timestamp, timestamp);
  db.prepare("INSERT INTO pages(id, document_id, page_number, storage_key, width, height, created_at) VALUES ('test-page','test-doc',1,?,800,500,?)").run(storageKey, timestamp);
  await api("/api/extract", { documentId: "test-doc" });
  assert.ok(seenExtractionSystem.includes("MARKER_SKILL"), "正式识题必须使用已启用的个人规则");
  const usage = db.prepare("SELECT * FROM teaching_skill_usages WHERE document_id='test-doc'").get();
  assert.equal(usage.skill_id, skill.id); assert.equal(usage.revision, 1); assert.ok(usage.content_snapshot.includes("MARKER_SKILL"));
  await api(url, { action: "save", revision: 1, content: skillText + "\n新增核对负号。", name: "新版" }, "PATCH");
  assert.equal((await api(url, undefined, "GET")).skill.active, 0);
  await api(url, { action: "save", revision: 1, content: skillText, name: "过期编辑" }, "PATCH", 409);
  await api(url, { action: "activate", revision: 2 }, "PATCH", 400);
  failReview = true;
  await api(url, { action: "trial", revision: 2 }, "PATCH", 400);
  assert.equal((await api(url, undefined, "GET")).trials.length, 1, "无效模型审校不得保存成功试识别");
  failReview = false;
  await api(url, { action: "trial", revision: 2 }, "PATCH");
  await api(url, { action: "refine", revision: 2, feedback: "请强化负号识别检查" }, "PATCH");
  const improved = await api(url, undefined, "GET");
  assert.equal(improved.skill.revision, 3); assert.equal(improved.skill.active, 0);
  await api(url, { action: "activate", revision: 3 }, "PATCH", 400);
  console.log("teaching skills e2e: upload → generate → recognize → review → approve → activate → real extraction snapshot → stale/failure guards: ok");
  if (process.argv.includes("--serve")) {
    console.log(`UI fixture ready: ${baseUrl}/settings/skills`);
    await new Promise(resolve => { process.once("SIGINT", resolve); process.once("SIGTERM", resolve); });
  }
} catch (error) { console.error(appLog); throw error; }
finally {
  db?.close();
  const exited = app.exitCode === null ? new Promise(resolve => app.once("exit", resolve)) : Promise.resolve();
  app.kill(); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  await new Promise(resolve => model.close(resolve));
  console.log(`Isolated test data preserved: ${dataDir}`);
}

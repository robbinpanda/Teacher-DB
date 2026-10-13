// Local fake provider and disposable database only. No real model credits.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

process.env.JIANTI_DATA_DIR = path.resolve("tmp", `question-ai-review-${crypto.randomUUID()}`);
mkdirSync(process.env.JIANTI_DATA_DIR, { recursive: true });
const { ensureDatabase } = await import("../db/bootstrap.ts");
const { getSqlite } = await import("../db/index.ts");
const { putFile } = await import("../lib/file-storage.ts");
const { encryptSecret } = await import("../lib/secret-box.ts");
const { extractDocument } = await import("../server/services/extraction.ts");
const { finalizeDocument } = await import("../server/services/document-finalize.ts");
const { saveQuestion } = await import("../server/services/question-review.ts");
const { loadQuestionForAiReview, reviewExtractedQuestion } = await import("../server/services/question-ai-review.ts");
const { POST: retryReview } = await import("../server/http/handlers/questions/[questionId]/ai-review/route.ts");
const { QUESTION_REVIEW_PROMPT } = await import("../lib/question-ai-review.ts");
const { getDocuments } = await import("../lib/question-repository.ts");
const { automaticAiReviewEnabled, setAutomaticAiReviewEnabled } = await import("../lib/ai-review-settings.ts");
let checkConcurrentProgress = false;
let extractionCalls = 0, concurrent = 0, peak = 0;
let concurrentProgress;
const reviewRequests = [];
let override, pause;
const rawQuestion = number => ({ number: String(number), type: "fill", stem: `唯一题干_${number}`, options: [], answer: "2", analysis: "原卷解析",
  sourcePages: [1], answerPages: [3], firstLinePage: 1, assets: [], uniqueImageCount: 0, selectedImageCount: 0,
  answerSource: "answer", uncertainties: [], missingImages: [], unlocatedImages: false, needsHumanReview: false, tags: [] });
const server = createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  if (request.max_tokens === 64) {
    concurrent++; peak = Math.max(peak, concurrent); reviewRequests.push(request);
    const user = request.messages.find(message => message.role === "user");
    const data = JSON.parse(user.content.find(item => item.type === "text").text);
    if (pause) await pause();
    await new Promise(resolve => setTimeout(resolve, 15));
    concurrent--;
    if (data.number === "4" && override === undefined) { res.writeHead(503); res.end("fixture failure"); return; }
    const verdict = override ?? ({ 1: "没问题", 2: "缺条件、其他问题", 3: "没问题但不确定", 5: "没问题", 6: "没问题" })[data.number];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: verdict } }], usage: { prompt_tokens: 100, completion_tokens: 3 } }));
    return;
  }
  extractionCalls++;
  assert.ok(!request.messages[0].content.includes("confidence 必须"));
  const records = [{ event: "meta", questionCount: 6 }, ...Array.from({ length: 6 }, (_, i) => ({ event: "question",
    question: i === 5 ? { ...rawQuestion(6), answerPages: [] } : rawQuestion(i + 1) })), { event: "done" }];
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const record of records) {
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(record) + "\n" } }] })}\n\n`);
    if (checkConcurrentProgress && record.question?.number === "2") {
      // Keep the extraction stream open: review must finish before later questions arrive.
      const deadline = Date.now() + 5000;
      do {
        await new Promise(resolve => setTimeout(resolve, 10));
        concurrentProgress = (await getDocuments("local-demo")).find(doc => doc.id === "ai-review-fixture");
      } while ((concurrentProgress.recognizedQuestionCount !== 2 || concurrentProgress.aiReviewedQuestionCount < 1) && Date.now() < deadline);
      assert.equal(concurrentProgress.recognizedQuestionCount, 2);
      assert.ok(concurrentProgress.aiReviewedQuestionCount >= 1, "independent review completes while extraction is still streaming");
      assert.equal(concurrentProgress.recognitionQuestionTotal, 6);
    }
  }
  res.end("data: [DONE]\n\n");
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
try {
  await ensureDatabase();
  const db = getSqlite(), timestamp = new Date().toISOString();
  const secret = await encryptSecret("fixture");
  db.prepare(`INSERT INTO model_profiles (id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,created_at,updated_at)
    VALUES ('fixture','local-demo','fixture','openai-chat-completions',?,'fixture-recognition-model',?,?,?,?)`)
    .run(`http://127.0.0.1:${server.address().port}/v1`, secret.ciphertext, secret.iv, timestamp, timestamp);
  const id = "ai-review-fixture";
  db.prepare("INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,created_at,updated_at) VALUES (?,'local-demo','fixture','image/png','extracting',3,?,?)").run(id, timestamp, timestamp);
  db.prepare("INSERT INTO document_jobs (document_id,owner_id,status,queued_at,updated_at) VALUES (?,'local-demo','queued',?,?)").run(id, timestamp, timestamp);
  for (let page = 1; page <= 3; page++) {
    const key = `${id}/page-${page}.png`;
    await putFile(key, await sharp({ create: { width: 500, height: 500, channels: 3, background: "white" } }).png().toBuffer());
    db.prepare("INSERT INTO pages (id,document_id,page_number,storage_key,width,height,created_at) VALUES (?,?,?,?,500,500,?)").run(`p-${page}`, id, page, key, timestamp);
    db.prepare("INSERT INTO extraction_runs (id,document_id,page_id,page_number,provider,model,status,idempotency_key,created_at) VALUES (?,?,?,?,'pending','pending','queued',?,?)")
      .run(`run-${page}`, id, `p-${page}`, page, `${id}:page:${page}:extract-v4`, timestamp);
  }
  assert.equal(automaticAiReviewEnabled("local-demo"), false, "existing/new owners default to off");
  const withoutReview = await extractDocument("local-demo", { documentId: id, profileId: "fixture" });
  assert.equal(withoutReview.status, 200, JSON.stringify(withoutReview.body));
  assert.equal(reviewRequests.length, 0, "default-off makes no secondary model calls");
  assert.ok(withoutReview.body.questions.every(q => q.aiReview == null && !q.needsHumanReview));
  assert.equal((await getDocuments("local-demo")).find(doc => doc.id === id).aiReviewEnabled, false);
  db.prepare("DELETE FROM questions WHERE document_id=?").run(id);
  db.prepare("UPDATE extraction_runs SET status='queued' WHERE document_id=?").run(id);
  db.prepare("UPDATE document_jobs SET completed_question_numbers_json='[]',question_total=NULL WHERE document_id=?").run(id);
  extractionCalls = 0;
  await setAutomaticAiReviewEnabled("local-demo", true);
  assert.equal(automaticAiReviewEnabled("other-owner"), false, "settings are owner-scoped");
  checkConcurrentProgress = true;
  const result = await extractDocument("local-demo", { documentId: id, profileId: "fixture" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal((await finalizeDocument("local-demo", id)).status, 200);
  assert.equal(extractionCalls, 1); assert.equal(reviewRequests.length, 6); assert.equal(peak, 2);
  const progress = (await getDocuments("local-demo")).find(doc => doc.id === id);
  assert.equal(progress.recognizedQuestionCount, 6);
  assert.equal(progress.aiReviewEnabled, true);
  assert.equal(progress.aiReviewedQuestionCount, 4);
  assert.equal(progress.aiReviewFailedQuestionCount, 2, "failed reviews must not inflate the completed bar");
  for (const request of reviewRequests) {
    assert.equal(request.model, "fixture-recognition-model", "review uses the recognition model, including non-MiMo models");
    assert.equal(request.messages.length, 2); assert.equal(request.messages[0].content, QUESTION_REVIEW_PROMPT);
    const user = request.messages[1].content;
    assert.equal(user.filter(part => part.type === "image_url").length, 0, "no stored figures means text-only; never original pages");
    const text = user[0].text;
    assert.equal((text.match(/唯一题干_/g) ?? []).length, 1);
    assert.ok(!text.includes("confidence"));
  }
  const questions = result.body.questions;
  assert.deepEqual(questions.map(q => q.aiReview.status), ["passed", "issues", "failed", "failed", "passed", "passed"]);
  assert.deepEqual(questions.map(q => q.needsHumanReview), [false, true, true, true, false, false]);
  assert.ok(questions.every(q => q.confidence === 0));
  assert.deepEqual(questions[1].aiReview.categories, ["缺条件", "其他问题"]);
  assert.equal(questions[5].aiReview.mode, "saved_content_v1", "missing original answer pages do not block review");
  const beforeReplay = reviewRequests.length;
  assert.equal((await extractDocument("local-demo", { documentId: id, profileId: "fixture" })).body.idempotentReplay, true);
  assert.equal(reviewRequests.length, beforeReplay);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM model_usage_events WHERE purpose='question_review'").get().n, 5);

  // Tenant isolation, retry and preserving deterministic extraction warnings.
  const context = q => ({ params: Promise.resolve({ questionId: q.id }) });
  assert.equal((await retryReview(new Request("http://local", { method: "POST", headers: { "oai-authenticated-user-id": "someone-else" } }), context(questions[1]))).status, 404);
  override = "没问题";
  const retried = await retryReview(new Request("http://local", { method: "POST" }), context(questions[1]));
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).aiReview.status, "passed");
  // Only saved crops are transmitted. Missing files cannot silently receive a passed verdict.
  const cropKey = `${id}/crop.jpg`;
  await putFile(cropKey, await sharp({ create: { width: 80, height: 60, channels: 3, background: "red" } }).jpeg().toBuffer());
  const insertAsset = (question, key) => db.prepare(`INSERT INTO question_assets (id,question_id,page_id,kind,role,label,source_key,crop_key,bbox_json,position,created_at)
    VALUES (?,?,?,'figure','question','saved figure',?,?,?,0,?)`).run(crypto.randomUUID(), question.id, 'p-1', `${id}/page-1.png`, key, JSON.stringify({ x: 0, y: 0, width: 16, height: 12 }), timestamp);
  insertAsset(questions[4], cropKey);
  await retryReview(new Request("http://local", { method: "POST" }), context(questions[4]));
  const parts = reviewRequests.at(-1).messages[1].content;
  assert.ok(parts.some(part => part.text?.startsWith("已保存配图")));
  const crop = parts.find(part => part.type === "image_url").image_url.url;
  assert.equal((await sharp(Buffer.from(crop.split(',')[1], 'base64')).metadata()).width, 80);
  insertAsset(questions[5], `${id}/does-not-exist.jpg`);
  await retryReview(new Request("http://local", { method: "POST" }), context(questions[5]));
  assert.deepEqual(loadQuestionForAiReview("local-demo", questions[5].id).question.aiReview.categories, ["缺图"]);
  db.prepare("UPDATE documents SET source_removed_at=? WHERE id=?").run(timestamp, id);
  assert.equal((await retryReview(new Request("http://local", { method: "POST" }), context(questions[1]))).status, 200);
  db.prepare("UPDATE documents SET source_removed_at=NULL WHERE id=?").run(id);
  // Changing the selected default or an old review's profile must not redirect review.
  db.prepare(`INSERT INTO model_profiles (id,owner_id,display_name,provider,base_url,model,api_key_ciphertext,api_key_iv,created_at,updated_at)
    SELECT 'other','local-demo','other',provider,base_url,'xiaomi/mimo-v2.6-flash',api_key_ciphertext,api_key_iv,created_at,updated_at
    FROM model_profiles WHERE id='fixture'`).run();
  db.prepare("UPDATE app_settings SET selected_model_profile_id='other' WHERE owner_id='local-demo'").run();
  const legacy = loadQuestionForAiReview("local-demo", questions[1].id).question.aiReview;
  delete legacy.extractionProfileId; delete legacy.extractionModel;
  legacy.profileId = "other";
  db.prepare("UPDATE questions SET ai_review_json=? WHERE id=?").run(JSON.stringify(legacy), questions[1].id);
  await retryReview(new Request("http://local", { method: "POST" }), context(questions[1]));
  assert.equal(reviewRequests.at(-1).model, "fixture-recognition-model");
  assert.equal(loadQuestionForAiReview("local-demo", questions[1].id).question.aiReview.extractionProfileId, "fixture");
  db.prepare("UPDATE model_profiles SET model='changed-model' WHERE id='fixture'").run();
  const requestsBeforeChangedModel = reviewRequests.length;
  await retryReview(new Request("http://local", { method: "POST" }), context(questions[1]));
  assert.match(loadQuestionForAiReview("local-demo", questions[1].id).question.aiReview.error, /已更换模型/);
  assert.equal(reviewRequests.length, requestsBeforeChangedModel);
  db.prepare("UPDATE model_profiles SET model='fixture-recognition-model' WHERE id='fixture'").run();
  db.prepare("UPDATE model_profiles SET enabled=0 WHERE id='fixture'").run();
  const requestsBeforeDisabled = reviewRequests.length;
  await retryReview(new Request("http://local", { method: "POST" }), context(questions[1]));
  assert.match(loadQuestionForAiReview("local-demo", questions[1].id).question.aiReview.error, /识别模型配置不存在或已停用/);
  assert.equal(reviewRequests.length, requestsBeforeDisabled);
  db.prepare("UPDATE model_profiles SET enabled=1 WHERE id='fixture'").run();
  db.prepare("UPDATE questions SET extraction_issues_json=? WHERE id=?").run(JSON.stringify([{ code: "text_escape", message: "控制字符" }]), questions[2].id);
  await retryReview(new Request("http://local", { method: "POST" }), context(questions[2]));
  assert.equal(loadQuestionForAiReview("local-demo", questions[2].id).question.needsHumanReview, true);

  // Changed content is reviewed again; stale posted AI results are never trusted.
  let saveRelease, saveStarted;
  const saveSeen = new Promise(resolve => { saveStarted = resolve; });
  const saveGate = new Promise(resolve => { saveRelease = resolve; });
  pause = async () => { saveStarted(); await saveGate; };
  const saving = saveQuestion("local-demo", questions[0].id, { ...questions[0], stem: "修改后的题干", aiReview: { status: "issues" } });
  await saveSeen;
  const duringSave = loadQuestionForAiReview("local-demo", questions[0].id).question;
  assert.equal(duringSave.aiReview.status, "pending");
  assert.equal(duringSave.needsHumanReview, true, "pending re-review cannot enter bulk approval");
  saveRelease();
  const saved = await saving; pause = undefined;
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.question.aiReview.status, "passed");
  assert.equal(JSON.parse(reviewRequests.at(-1).messages[1].content[0].text).stem, "修改后的题干");

  // Hold an old session, edit the row, and prove its late result cannot overwrite the edit.
  const current = loadQuestionForAiReview("local-demo", questions[4].id).question;
  current.aiReview = { ...current.aiReview, status: "pending", token: crypto.randomUUID() };
  db.prepare("UPDATE questions SET ai_review_json=? WHERE id=?").run(JSON.stringify(current.aiReview), current.id);
  let release, started;
  const seen = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  pause = async () => { started(); await gate; };
  const running = reviewExtractedQuestion({ ownerId: "local-demo", documentId: id, question: current });
  await seen;
  db.prepare("UPDATE questions SET stem='教师新内容',updated_at='changed',ai_review_json=? WHERE id=?")
    .run(JSON.stringify({ ...current.aiReview, status: "stale", token: "newer" }), current.id);
  release(); await running; pause = undefined;
  const retained = loadQuestionForAiReview("local-demo", current.id).question;
  assert.equal(retained.stem, "教师新内容"); assert.equal(retained.aiReview.status, "stale");
  await setAutomaticAiReviewEnabled("local-demo", false);
  const beforeOffSave = reviewRequests.length;
  const offQuestion = loadQuestionForAiReview("local-demo", questions[0].id).question;
  const offSave = await saveQuestion("local-demo", offQuestion.id, { ...offQuestion, stem: "关闭复核后的编辑" });
  assert.equal(offSave.status, 200, JSON.stringify(offSave.body));
  assert.equal(reviewRequests.length, beforeOffSave, "editing with toggle off does not call a reviewer");
  assert.equal(offSave.body.question.aiReview.status, "stale", "disabled review never remains pending");
  const manualReview = await retryReview(new Request("http://local", { method: "POST" }), context(offQuestion));
  assert.equal(manualReview.status, 200);
  assert.equal(reviewRequests.length, beforeOffSave + 1, "explicit single-question review remains available");
  console.log("PASS: default-off extraction and edits, opt-in parallel reviews, owner isolation, explicit manual review, failure isolation, stale-result protection and usage accounting");
} finally {
  await new Promise(resolve => server.close(resolve));
  getSqlite().close();
}

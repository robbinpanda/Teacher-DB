import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3050";
const token = crypto.randomUUID();
const documentId = `runtime-smoke-${token}`;
const pageId = `runtime-smoke-page-${token}`;
const questionId = `runtime-smoke-question-${token}`;
const secondPageId = `runtime-smoke-page-2-${token}`;
const assetId = `runtime-smoke-asset-${token}`;
const paperId = `runtime-smoke-paper-${token}`;
const keepFixture = process.env.KEEP_RUNTIME_FIXTURE === "1";
const dataRoot = path.resolve("data");
const fixtureRoot = path.resolve(dataRoot, "files", "documents", documentId);
assert.ok(fixtureRoot.startsWith(path.resolve(dataRoot, "files") + path.sep));
const pageKey = `documents/${documentId}/pages/0001.png`;
const pagePath = path.resolve(dataRoot, "files", pageKey);
const secondPageKey = `documents/${documentId}/pages/0002.png`;
const databasePath = path.resolve(dataRoot, "teacher-question-bank.sqlite3");
const secondPagePath = path.resolve(dataRoot, "files", secondPageKey);
const db = new Database(databasePath);
const timestamp = new Date().toISOString();
const uploadOwnerId = `runtime-upload-${token}`;
const modelOwnerId = `runtime-model-${token}`;
let uploadedDocumentId;

async function jsonFetch(url, init) {
  const response = await fetch(baseUrl + url, init);
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${url}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

try {
  const managedModels = await jsonFetch("/api/model-profiles", {
    headers: { "oai-authenticated-user-id": modelOwnerId },
  });
  const managedMimo = managedModels.profiles.find((profile) => profile.model === "mimo-v2.5-free");
  assert.equal(managedMimo.isManaged, true);
  assert.equal(managedMimo.apiKeyMask, "public");
  assert.equal("apiKeyCiphertext" in managedMimo, false);
  assert.equal("apiKeyIv" in managedMimo, false);

  const rejectedUpload = new FormData();
  rejectedUpload.append("file", new File([Buffer.from("not-a-pdf")], `runtime-smoke-${token}.docx`, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  rejectedUpload.append("pageCount", "0");
  const rejectedUploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST", headers: { "oai-authenticated-user-id": uploadOwnerId }, body: rejectedUpload,
  });
  assert.equal(rejectedUploadResponse.status, 415);

  const firstUpload = new FormData();
  firstUpload.append("file", new File([Buffer.from("%PDF-1.4\n%%EOF")], `runtime-smoke-${token}.pdf`, { type: "application/pdf" }));
  firstUpload.append("pageCount", "0");
  const firstUploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST", headers: { "oai-authenticated-user-id": uploadOwnerId }, body: firstUpload,
  });
  const firstUploadResult = await firstUploadResponse.json();
  assert.equal(firstUploadResponse.status, 201);
  uploadedDocumentId = firstUploadResult.id;
  assert.deepEqual(
    db.prepare("SELECT page_count AS pageCount, status FROM documents WHERE id = ?").get(uploadedDocumentId),
    { pageCount: 0, status: "uploading" },
  );

  const resumedUpload = new FormData();
  resumedUpload.append("file", new File([Buffer.from("%PDF-1.4\n%%EOF")], `runtime-smoke-${token}.pdf`, { type: "application/pdf" }));
  resumedUpload.append("pageCount", "16");
  const resumedUploadResponse = await fetch(`${baseUrl}/api/documents`, {
    method: "POST", headers: { "oai-authenticated-user-id": uploadOwnerId }, body: resumedUpload,
  });
  const resumedUploadResult = await resumedUploadResponse.json();
  assert.equal(resumedUploadResponse.status, 200);
  assert.equal(resumedUploadResult.id, uploadedDocumentId);
  assert.equal(resumedUploadResult.resumed, true);
  assert.equal(db.prepare("SELECT page_count AS pageCount FROM documents WHERE id = ?").get(uploadedDocumentId).pageCount, 16);

  const failedUploadResponse = await fetch(`${baseUrl}/api/documents/${uploadedDocumentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "oai-authenticated-user-id": uploadOwnerId },
    body: JSON.stringify({ status: "failed", error: "runtime render failure" }),
  });
  assert.equal(failedUploadResponse.status, 200);
  assert.deepEqual(
    db.prepare("SELECT status, error FROM documents WHERE id = ?").get(uploadedDocumentId),
    { status: "failed", error: "runtime render failure" },
  );

  await mkdir(path.dirname(pagePath), { recursive: true });
  await writeFile(pagePath, await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#f5efe1" } }).png().toBuffer());
  await writeFile(secondPagePath, await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#e8f0f8" } }).png().toBuffer());
  db.prepare(`INSERT INTO documents
    (id, owner_id, name, mime_type, status, page_count, subject, grade, source_year, source_exam_type, created_at, updated_at)
    VALUES (?, 'local-demo', ?, 'image/png', 'reviewing', 1, '数学', '九年级', 2026, '运行时回归', ?, ?)`)
    .run(documentId, `运行时回归-${token}.png`, timestamp, timestamp);
  db.prepare("UPDATE documents SET page_count = 2 WHERE id = ?").run(documentId);
  db.prepare(`INSERT INTO pages (id, document_id, page_number, storage_key, width, height, status, created_at)
    VALUES (?, ?, 1, ?, 1200, 800, 'ready', ?)`)
    .run(pageId, documentId, pageKey, timestamp);
  db.prepare("INSERT INTO pages (id, document_id, page_number, storage_key, width, height, status, created_at) VALUES (?, ?, 2, ?, 1200, 800, 'ready', ?)")
    .run(secondPageId, documentId, secondPageKey, timestamp);

  db.prepare(`INSERT INTO extraction_runs
    (id, document_id, page_id, page_number, provider, model, status, attempt, idempotency_key, created_at, finished_at)
    VALUES (?, ?, ?, 1, 'runtime-test', 'runtime-test', 'complete', 1, ?, ?, ?)`)
    .run(`runtime-smoke-run-${token}`, documentId, pageId, `${documentId}:page:1:extract-v3`, timestamp, timestamp);
  db.prepare("INSERT INTO extraction_runs (id, document_id, page_id, page_number, provider, model, status, attempt, idempotency_key, created_at, finished_at) VALUES (?, ?, ?, 2, 'runtime-test', 'runtime-test', 'complete', 1, ?, ?, ?)")
    .run(`runtime-smoke-run-2-${token}`, documentId, secondPageId, `${documentId}:page:2:extract-v3`, timestamp, timestamp);

  db.prepare(`INSERT INTO questions
    (id, document_id, number, type, stem, options_json, answer, analysis, page_number, bbox_json, status, confidence, score, created_at, updated_at)
    VALUES (?, ?, '1', 'single', '若 $x^2=4$，则 $x$ 的值是？', '[{"key":"A","content":"$2$"}]', '$\\pm 2$', '平方根定义', 1, '{"x":5,"y":5,"width":80,"height":35}', 'pending', 0.98, 3, ?, ?)`)
    .run(questionId, documentId, timestamp, timestamp);
  db.prepare(`INSERT INTO question_assets (id, question_id, page_id, kind, label, source_key, bbox_json, created_at)
    VALUES (?, ?, ?, 'figure', '运行时题图', ?, '{"x":10,"y":10,"width":30,"height":25}', ?)`)
    .run(assetId, questionId, pageId, pageKey, timestamp);

  const saved = await jsonFetch(`/api/questions/${questionId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: questionId, number: "1", type: "single", stem: "若 $x^2=4$，则 $x$ 的值是？",
      options: [{ key: "A", content: "$2$" }], answer: "$\\pm 2$", analysis: "平方根定义",
      page: 1, bbox: { x: 5, y: 5, width: 80, height: 35 }, regions: [
        { page: 1, bbox: { x: 5, y: 5, width: 80, height: 35 } },
        { page: 2, bbox: { x: 5, y: 0, width: 80, height: 22 } },
      ],
      assets: [{ id: assetId, kind: "figure", page: 1, bbox: { x: 10, y: 10, width: 30, height: 25 }, label: "运行时题图" }],
      tags: ["运行时回归"], confidence: 0.98, status: "approved", score: 3,
    }),
  });
  assert.equal(saved.saved, true);
  assert.equal(saved.question.regions.length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM question_regions WHERE question_id = ?").get(questionId).count, 2);
  assert.match(saved.question.assets[0].url, /\/api\/files\//);
  const crop = await fetch(baseUrl + saved.question.assets[0].url);
  assert.equal(crop.status, 200);
  assert.equal(crop.headers.get("content-type"), "image/jpeg");
  assert.ok((await crop.arrayBuffer()).byteLength > 100);
  const resaved = await jsonFetch(`/api/questions/${questionId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(saved.question),
  });
  assert.notEqual(resaved.question.assets[0].url, saved.question.assets[0].url);
  assert.equal((await fetch(baseUrl + saved.question.assets[0].url)).status, 404);
  assert.equal((await fetch(baseUrl + resaved.question.assets[0].url)).status, 200);
  assert.equal((await fetch(baseUrl + resaved.question.assets[0].url, { headers: { "oai-authenticated-user-id": "another-owner" } })).status, 404);

  const manual = await jsonFetch(`/api/documents/${documentId}/questions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ page: 1 }),
  });
  assert.equal(manual.question.page, 1);
  await jsonFetch(`/api/questions/${manual.question.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...manual.question, stem: "人工补录题", status: "approved" }),
  });

  const exported = await jsonFetch(`/api/exports/questions?ids=${questionId}&format=json`);
  assert.equal(exported.count, 1);
  assert.equal(exported.questions[0].source.examType, "运行时回归");
  assert.match(exported.questions[0].assets[0].cropKey, new RegExp(`${assetId}-[0-9a-f-]+\\.jpg$`));
  const searched = await jsonFetch(`/api/questions?q=${encodeURIComponent("x^2")}&documentId=${documentId}&page=1&pageSize=10`);
  assert.equal(searched.pagination.total, 1);
  assert.equal(searched.questions[0].id, questionId);
  const noMatch = await jsonFetch(`/api/questions?q=${encodeURIComponent("不存在的学校")}&documentId=${documentId}`);
  assert.equal(noMatch.pagination.total, 0);
  const markdown = await fetch(`${baseUrl}/api/exports/questions?ids=${questionId}&format=markdown`);
  assert.equal(markdown.status, 200);
  assert.match(await markdown.text(), /x\^2=4/);

  await jsonFetch("/api/papers", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: paperId, title: "运行时回归试卷", subtitle: "自动测试", questionIds: [questionId] }),
  });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM paper_items WHERE paper_id = ?").get(paperId).count, 1);
  const pdfResponse = await fetch(`${baseUrl}/api/papers/${paperId}/pdf?answers=1`);
  const pdfBytes = Buffer.from(await pdfResponse.arrayBuffer());
  assert.equal(pdfResponse.status, 200, `PDF export failed: ${pdfBytes.toString("utf8").slice(0, 1000)}`);
  assert.equal(pdfResponse.headers.get("content-type"), "application/pdf");
  assert.equal(pdfBytes.subarray(0, 4).toString("ascii"), "%PDF");
  assert.ok(pdfBytes.byteLength > 5000);
  if (process.env.SAVE_RUNTIME_PDF) {
    const destination = path.resolve(process.env.SAVE_RUNTIME_PDF);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, pdfBytes);
  }
  const progress = await jsonFetch(`/api/documents/${documentId}/progress`);
  assert.equal(progress.counts.complete, 2);
  assert.equal(progress.pages.length, 2);
  assert.equal(progress.pages[0].attempt, 1);
  const health = await jsonFetch("/api/health");
  assert.equal(health.database.quickCheck, "ok");

  db.prepare("UPDATE extraction_runs SET status = 'queued' WHERE idempotency_key = ?").run(`${documentId}:page:1:extract-v3`);
  const blockedCompletion = await fetch(`${baseUrl}/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "complete" }),
  });
  assert.equal(blockedCompletion.status, 409);
  db.prepare("UPDATE extraction_runs SET status = 'complete' WHERE idempotency_key = ?").run(`${documentId}:page:1:extract-v3`);
  await jsonFetch(`/api/documents/${documentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "complete" }),
  });
  assert.equal(db.prepare("SELECT status FROM documents WHERE id = ?").get(documentId).status, "complete");
  console.log("runtime API smoke test passed");
  if (keepFixture) console.log(JSON.stringify({ documentId, paperId, fixtureRoot }));
} finally {
  if (!keepFixture) {
    db.prepare("DELETE FROM app_settings WHERE owner_id = ?").run(modelOwnerId);
    db.prepare("DELETE FROM model_profiles WHERE owner_id = ?").run(modelOwnerId);
    if (uploadedDocumentId) db.prepare("DELETE FROM documents WHERE id = ?").run(uploadedDocumentId);
    db.prepare("DELETE FROM papers WHERE id = ?").run(paperId);
    db.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
    db.prepare("DELETE FROM tags WHERE name = '运行时回归' AND NOT EXISTS (SELECT 1 FROM question_tags WHERE tag_id = tags.id)").run();
  }
  db.close();
  if (!keepFixture) await rm(fixtureRoot, { recursive: true, force: true });
  if (!keepFixture && uploadedDocumentId) await rm(path.resolve(dataRoot, "files", "documents", uploadedDocumentId), { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

// Uses real configured model calls, but all extraction and save mutations are isolated.
const directory = path.resolve("tmp", `asset-workflow-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const source = new Database("data/teacher-question-bank.sqlite3", { readonly: true });
await source.backup(path.join(directory, "teacher-question-bank.sqlite3"));
source.close();
fs.copyFileSync("data/.model-key-secret", path.join(directory, ".model-key-secret"));
const db = new Database(path.join(directory, "teacher-question-bank.sqlite3"));
db.pragma("foreign_keys=ON");
const papers = ["崇明", "黄浦"].map((region) => db.prepare("SELECT id,name,page_count FROM documents WHERE name=?")
  .get(`高考-数学二模-${region}区-答案.pdf`));
assert.ok(papers.every(Boolean), "Both local source papers are required");
const profile = db.prepare("SELECT id FROM model_profiles WHERE model LIKE 'deepseek%' AND enabled=1 LIMIT 1").get();
assert.ok(profile, "Enabled DeepSeek model required");
db.prepare("UPDATE app_settings SET extraction_paused=1,selected_model_profile_id=?").run(profile.id);
db.prepare("UPDATE document_jobs SET status='paused',lease_owner=NULL,lease_expires_at=NULL").run();
for (const paper of papers) {
  fs.cpSync(path.join("data/files/documents", paper.id), path.join(directory, "files/documents", paper.id), { recursive: true });
  db.prepare("DELETE FROM paper_items WHERE question_id IN (SELECT id FROM questions WHERE document_id=?)").run(paper.id);
  db.prepare("DELETE FROM submission_scores WHERE question_id IN (SELECT id FROM questions WHERE document_id=?)").run(paper.id);
  db.prepare("DELETE FROM assignment_items WHERE question_id IN (SELECT id FROM questions WHERE document_id=?)").run(paper.id);
  db.prepare("DELETE FROM questions WHERE document_id=?").run(paper.id);
  db.prepare("DELETE FROM extraction_runs WHERE document_id=?").run(paper.id);
  db.prepare("DELETE FROM document_jobs WHERE document_id=?").run(paper.id);
  db.prepare("UPDATE documents SET status='extracting',error=NULL WHERE id=?").run(paper.id);
}
const log = fs.openSync(path.join(directory, "server.log"), "w");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3186"], {
  env: { ...process.env, JIANTI_DATA_DIR: directory }, stdio: ["ignore", log, log], windowsHide: true,
});
const base = "http://127.0.0.1:3186";
const results = [];
// Manually checked against the source pages, including the unframed stem-and-leaf plot.
const expectedImagePages = {
  "高考-数学二模-崇明区-答案.pdf": { 7: [2], 11: [4], 17: [9], 19: [11, 12, 13], 20: [13] },
  "高考-数学二模-黄浦区-答案.pdf": { 9: [4, 5], 12: [6], 14: [7], 16: [10, 10, 10, 11], 18: [12, 13], 20: [15] },
};
async function request(url, method = "GET", body) {
  const response = await fetch(base + url, { method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(240000) });
  const value = await response.json();
  assert.ok(response.ok, `${url} HTTP ${response.status}: ${JSON.stringify(value)}`);
  return value;
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Isolated server exited; see server.log");
    try { if ((await fetch(base + "/api/health")).ok) { ready = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Isolated server ready");
  console.log("Isolated test directory:", directory);
  for (const paper of papers) {
    // The normal queue endpoint initializes one tracking row for every source page.
    await request(`/api/documents/${paper.id}/queue`, "POST", { profileId: profile.id });
    const extraction = await request("/api/extract", "POST", { documentId: paper.id, profileId: profile.id });
    assert.ok(!extraction.idempotentReplay, "Must perform a fresh extraction");
    const questions = db.prepare("SELECT * FROM questions WHERE document_id=? ORDER BY CAST(number AS INTEGER)").all(paper.id);
    assert.equal(questions.length, 21, "Expected 21 top-level questions");
    assert.equal(db.prepare("SELECT COUNT(DISTINCT page_number) AS n FROM extraction_runs WHERE document_id=? AND status='complete'").get(paper.id).n, paper.page_count);
    console.log(paper.name, "fresh extraction", questions.length, "questions");
    const pending = [...questions];
    await Promise.all(Array.from({ length: 2 }, async () => {
      while (pending.length) {
        const q = pending.shift();
        try {
          const review = await request(`/api/questions/${q.id}/review-assets`, "POST");
          assert.deepEqual(review.assets.map((a) => a.page).sort((a, b) => a - b),
            expectedImagePages[paper.name][q.number] || [], "Expected picture count and source-page ownership");
          const draft = { number: q.number, type: q.type, stem: q.stem, answer: q.answer, analysis: q.analysis,
            options: JSON.parse(q.options_json || "[]"), page: q.page_number, bbox: JSON.parse(q.bbox_json), regions: [],
            tags: db.prepare("SELECT t.name FROM tags t JOIN question_tags qt ON t.id=qt.tag_id WHERE qt.question_id=?").all(q.id).map((t) => t.name),
            assets: review.assets, confidence: q.confidence, status: "needs_attention", needsHumanReview: true };
          const saved = await request(`/api/questions/${q.id}`, "PUT", draft);
          assert.ok(saved.saved);
          assert.equal(db.prepare("SELECT COUNT(*) AS n FROM question_assets WHERE question_id=?").get(q.id).n, review.assets.length);
          for (const asset of saved.question.assets) {
            const image = await fetch(base + asset.url);
            assert.ok(image.ok, "Saved crop is served through the file API");
            const metadata = await sharp(Buffer.from(await image.arrayBuffer())).metadata();
            assert.ok(metadata.width > 0 && metadata.height > 0);
          }
          results.push({ paper: paper.name, number: q.number, success: true, needsHumanReview: review.needsHumanReview,
            notes: review.notes, assets: saved.question.assets });
          console.log(paper.name, q.number, "PASS", review.assets.length, "images", review.needsHumanReview ? "needs review" : "");
        } catch (error) {
          results.push({ paper: paper.name, number: q.number, success: false, error: error.message });
          console.log(paper.name, q.number, "FAIL", error.message);
        }
        fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
      }
    }));
  }
  assert.equal(results.filter((r) => !r.success).length, 0, "All questions complete review, save, crop and retrieval");
  assert.equal(results.length, 42);
  console.log("PASS: 2 fresh paper extractions; 42 reviews, saves and crop retrieval checks.");
} finally {
  child.kill();
  db.close();
  fs.closeSync(log);
}

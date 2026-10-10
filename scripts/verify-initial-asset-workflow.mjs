import { stopIsolatedProcess } from "./test-runtime.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import sharp from "sharp";

// Uses real configured model calls, but all extraction and save mutations are isolated.
const directory = path.resolve("tmp", `initial-asset-workflow-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const source = new Database("data/teacher-question-bank.sqlite3", { readonly: true });
await source.backup(path.join(directory, "teacher-question-bank.sqlite3"));
source.close();
fs.copyFileSync("data/.model-key-secret", path.join(directory, ".model-key-secret"));
const db = new Database(path.join(directory, "teacher-question-bank.sqlite3"));
db.pragma("foreign_keys=ON");
const papers = ["闵行"].map((region) => db.prepare("SELECT id,name,page_count FROM documents WHERE name=?")
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
const child = spawn(process.execPath, ["scripts/run-local.mjs", "--web-port=3188", "--api-port=3288"], {
  env: { ...process.env, JIANTI_DATA_DIR: directory }, stdio: ["ignore", log, log], windowsHide: true,
});
const base = "http://127.0.0.1:3188";
async function request(url, method = "GET", body) {
  const response = await fetch(base + url, { method, headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(240000) });
  const value = await response.json();
  assert.ok(response.ok, `${url}: ${JSON.stringify(value)}`);
  return value;
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready);
  const paper = papers[0];
  console.log('Testing initial extraction only:', paper.name, directory);
  const before = db.prepare('SELECT COUNT(*) AS n FROM model_usage_events WHERE document_id=?').get(paper.id).n;
  await request(`/api/documents/${paper.id}/queue`, 'POST', { profileId: profile.id });
  await request('/api/extract', 'POST', { documentId: paper.id, profileId: profile.id });
  const questions = db.prepare('SELECT number,status,analysis,needs_human_review,missing_images_json FROM questions WHERE document_id=? ORDER BY CAST(number AS INTEGER)').all(paper.id);
  assert.equal(questions.length, 21);
  const assets = db.prepare('SELECT q.number,a.role,a.bbox_json,a.crop_key,p.page_number FROM question_assets a JOIN questions q ON q.id=a.question_id JOIN pages p ON p.id=a.page_id WHERE q.document_id=? ORDER BY CAST(q.number AS INTEGER),a.position').all(paper.id);
  assert.ok(assets.length > 0);
  for (const q of questions) {
    const answers = assets.filter(a => a.number === q.number && a.role === 'answer');
    for (const [index] of answers.entries()) assert.ok(q.analysis.includes(`[[image:${index + 1}]]`), `Q${q.number} image ${index + 1} has a position`);
    assert.ok(!q.analysis.includes('[[image:p'), 'Candidate IDs must not persist as ordinals');
  }
  assert.ok(questions.some(q => /\[\[image:\d+\]\][\s\S]*\S/.test(q.analysis)), 'At least one image precedes subsequent analysis text');
  for (const asset of assets) {
    const metadata = await sharp(fs.readFileSync(path.join(directory, 'files', asset.crop_key))).metadata();
    assert.ok(metadata.width > 0 && metadata.height > 0);
  }
  for (const q of questions) {
    if (JSON.parse(q.missing_images_json).length) {
      assert.equal(q.status, 'needs_attention');
      assert.equal(q.needs_human_review, 1);
    }
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM model_usage_events WHERE document_id=?').get(paper.id).n - before, 1);
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({ questions, assets }, null, 2));
  console.log('PASS: 21 questions,', assets.length, 'crops,', questions.filter(q => JSON.parse(q.missing_images_json).length).length, 'questions with missing-image feedback; one model call, no review endpoint.');
} finally {
  await stopIsolatedProcess(child); db.close(); fs.closeSync(log);
}

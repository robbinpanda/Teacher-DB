import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// All mutations use a private database copy; no model calls are made.
const directory = path.resolve('tmp', `missing-image-feedback-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const source = new Database('data/teacher-question-bank.sqlite3', { readonly: true });
await source.backup(path.join(directory, 'teacher-question-bank.sqlite3'));
source.close();
const db = new Database(path.join(directory, 'teacher-question-bank.sqlite3'));
db.prepare('UPDATE app_settings SET extraction_paused=1').run();
db.prepare("UPDATE document_jobs SET status='paused',lease_owner=NULL,lease_expires_at=NULL").run();
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3187'], {
  env: { ...process.env, JIANTI_DATA_DIR: directory }, stdio: 'ignore', windowsHide: true,
});
const base = 'http://127.0.0.1:3187';
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready);
  const q = db.prepare("SELECT q.* FROM questions q JOIN documents d ON d.id=q.document_id WHERE d.name LIKE '%松江%' AND q.number='1'").get();
  assert.ok(q, 'Local Songjiang paper required');
  const missing = [{ page: 1, role: 'question', description: '测试待补图', reason: '候选框遗漏' }];
  db.prepare("UPDATE questions SET missing_images_json=?,status='needs_attention',needs_human_review=1 WHERE id=?").run(JSON.stringify(missing), q.id);
  const draft = { number: q.number, type: q.type, stem: q.stem, answer: q.answer, analysis: q.analysis,
    options: JSON.parse(q.options_json || '[]'), page: q.page_number, bbox: JSON.parse(q.bbox_json),
    regions: [], tags: [], assets: [], confidence: q.confidence, status: 'approved', needsHumanReview: false };
  const save = async body => {
    const response = await fetch(`${base}/api/questions/${q.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const blocked = await save(draft);
  assert.equal(blocked.status, 409, JSON.stringify(blocked));
  assert.match(blocked.body.error, /缺图/);
  const pending = await save({ ...draft, status: 'pending', missingImages: [] });
  assert.equal(pending.status, 200, JSON.stringify(pending));
  assert.deepEqual(pending.body.question.missingImages, missing);
  assert.equal(pending.body.question.status, 'needs_attention');
  assert.equal(pending.body.question.needsHumanReview, true);
  const resolved = await save({ ...draft, imageIssuesResolved: true });
  assert.equal(resolved.status, 200, JSON.stringify(resolved));
  assert.deepEqual(resolved.body.question.missingImages, []);
  assert.equal(resolved.body.question.imageIssuesResolved, false);
  assert.equal(db.prepare('SELECT missing_images_json AS issues FROM questions WHERE id=?').get(q.id).issues, '[]');
  console.log('PASS: unresolved approval blocked; ordinary save preserves warnings; explicit resolution clears warnings and approves.');
} finally {
  child.kill();
  db.close();
}

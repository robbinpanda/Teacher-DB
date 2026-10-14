import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getSqlite } from '../db/index.ts';
import { getDocumentIntegrity } from '../lib/document-integrity.ts';
const db = getSqlite();
const audit = JSON.parse(readFileSync('tmp/stuck-document-content-audit.json', 'utf8'));
const plan = JSON.parse(readFileSync('tmp/stuck-page-repair-plan.json', 'utf8'));
const restoredStatuses = ['10a750e5-c5c3-4e80-976d-f558ed7a7167', 'df4b23a9-5ddc-4b16-b45f-af8c5aba1c7e', 'fc5e9d6d-e682-4b2c-83a0-bb54669499f4', '22d811ed-0699-412e-a130-229fa85b00a9', '562b2038-02bb-4bd6-8998-59bba3c5b324'];
const results = [];
for (const id of [...Object.keys(audit), ...restoredStatuses]) {
  const document = db.prepare('SELECT id,name,status,error FROM documents WHERE id=?').get(id);
  const count = db.prepare('SELECT COUNT(*) n FROM questions WHERE document_id=?').get(id).n;
  const run = db.prepare('SELECT status,error_code FROM extraction_runs WHERE document_id=?').get(id);
  const answerOnly = audit[id]?.result.kind === 'answers_only';
  if (answerOnly) { assert.equal(document.status, 'failed'); assert.equal(run.error_code, 'source_only'); }
  else { assert.ok(['reviewing', 'complete'].includes(document.status), JSON.stringify(document)); assert.ok(getDocumentIntegrity(db, id)?.reviewReady, id); }
  results.push({ ...document, count, answerOnly });
}
assert.equal(results.filter(r => !r.answerOnly).length, 15);
assert.equal(results.filter(r => r.answerOnly).length, 3);
assert.equal(results.find(r => r.id === '8c0daac5-1f69-49b6-b2eb-ab7a8da2422d').count, 230);
for (const page of plan) assert.equal(db.prepare('SELECT storage_key FROM pages WHERE id=?').get(page.id).storage_key, page.newKey);
console.log(JSON.stringify({ ok: true, recovered: 15, answerOnly: 3, repairedPages: plan.length, results }, null, 2));
db.close();

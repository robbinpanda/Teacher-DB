// Read-only by default. --apply requires a paused, drained queue and creates a SQLite backup.
import Database from 'better-sqlite3';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractionResumeState } from '../lib/extraction-completeness.ts';
const apply = process.argv.includes('--apply');
const directory = path.resolve(process.env.JIANTI_DATA_DIR ?? 'data');
const db = new Database(path.join(directory, 'teacher-question-bank.sqlite3'), { readonly: !apply });
const timestamp = new Date().toISOString();
const docs = db.prepare(`SELECT d.id,d.name,d.owner_id AS ownerId,d.status,d.source_removed_at AS sourceRemovedAt,j.status AS jobStatus,j.question_total AS expected
  FROM documents d LEFT JOIN document_jobs j ON j.document_id=d.id`).all();
const suspects = [];
for (const doc of docs) {
  const questions = db.prepare('SELECT id,number,stem,status FROM questions WHERE document_id=?').all(doc.id);
  const empty = questions.filter(q => !q.stem.trim());
  const resume = extractionResumeState(questions);
  const numbers = new Set(questions.map(q => q.number));
  const missing = Array.from({length: doc.expected ?? 0}, (_,i) => String(i+1)).filter(n => !numbers.has(n));
  const terminal = ['complete','reviewing'].includes(doc.status) || doc.jobStatus === 'complete';
  if (empty.length || terminal && (!questions.length || missing.length)) suspects.push({ ...doc, total: questions.length,
    emptyNumbers: empty.map(q => q.number), emptyApprovedIds: empty.filter(q => q.status==='approved').map(q => q.id), missing,
    retainedNumbers: resume.completed.map(q => q.number), resumeFrom: resume.nextNumber });
}
const report = { timestamp, scannedDocuments: docs.length, completedDocuments: docs.filter(d=>d.status==='complete').length, suspects };
console.log(JSON.stringify(report,null,2));
if (apply) {
  const targetOwners = [...new Set(suspects.map(d=>d.ownerId))];
  for (const owner of targetOwners) {
    if (!db.prepare('SELECT extraction_paused FROM app_settings WHERE owner_id=?').get(owner)?.extraction_paused
      || db.prepare("SELECT 1 FROM document_jobs WHERE owner_id=? AND status='processing'").get(owner)) throw new Error('Pause and drain the affected queue before repair');
  }
  const backupDir = path.resolve('backups', `empty-extraction-repair-${timestamp.replace(/[:.]/g,'-')}`);
  mkdirSync(backupDir,{recursive:true});
  await db.backup(path.join(backupDir,'before.sqlite3'));
  writeFileSync(path.join(backupDir,'audit.json'),JSON.stringify(report,null,2));
  db.transaction(()=>{
    for (const doc of suspects) {
      // Keep every question and its ID/assets; only withdraw empty records from the bank.
      for (const id of doc.emptyApprovedIds) db.prepare("UPDATE questions SET status='needs_attention',needs_human_review=1,updated_at=? WHERE id=? AND trim(stem)=''").run(timestamp,id);
      if (doc.sourceRemovedAt || !doc.jobStatus) continue;
      db.prepare("UPDATE extraction_runs SET status='paused',attempt=0,error=NULL,error_code=NULL,next_attempt_at=NULL,lease_owner=NULL,lease_expires_at=NULL,finished_at=NULL WHERE document_id=?").run(doc.id);
      db.prepare(`UPDATE document_jobs SET status='paused',priority=10,attempt=0,next_attempt_at=NULL,lease_owner=NULL,lease_expires_at=NULL,
        last_error=NULL,stream_phase='paused',stream_message=?,completed_question_numbers_json=?,finished_at=NULL,updated_at=? WHERE document_id=?`)
        .run(`空题修复：将从第 ${doc.resumeFrom} 题续传`,JSON.stringify(doc.retainedNumbers),timestamp,doc.id);
      db.prepare("UPDATE documents SET status='extracting',error=?,updated_at=? WHERE id=?").run(`空题修复：从第 ${doc.resumeFrom} 题续传`,timestamp,doc.id);
    }
  }).immediate();
  console.log(JSON.stringify({ repairedDocuments:suspects.filter(d=>!d.sourceRemovedAt&&d.jobStatus).length,withdrawnEmptyQuestions:suspects.reduce((n,d)=>n+d.emptyApprovedIds.length,0),backupDir }));
}
db.close();

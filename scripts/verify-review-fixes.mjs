import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readQuestionPackage } from '../lib/question-package-format.ts';

const dataDir = path.resolve('tmp', `review-data-${crypto.randomUUID()}`);
mkdirSync(dataDir, { recursive: true });
// Simulate an existing database created before parent_external_id was added.
const oldDb = new Database(path.join(dataDir, 'teacher-question-bank.sqlite3'));
oldDb.exec(`CREATE TABLE questions (
  id TEXT PRIMARY KEY, document_id TEXT NOT NULL, number TEXT NOT NULL, type TEXT NOT NULL,
  stem TEXT NOT NULL, options_json TEXT, answer TEXT NOT NULL DEFAULT '', analysis TEXT NOT NULL DEFAULT '',
  page_number INTEGER NOT NULL, bbox_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  needs_human_review INTEGER, confidence REAL NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0,
  folder_id TEXT, parent_question_id TEXT, variation_kind TEXT, variation_review_status TEXT,
  variation_review_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO questions (id,document_id,number,type,stem,page_number,bbox_json,created_at,updated_at)
  VALUES ('migration-sentinel','migration-doc','1','fill','preserve me',1,'{}','t0','t0');`);
oldDb.close();
const base = 'http://127.0.0.1:3182';
const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3182'], {
  env: { ...process.env, JIANTI_DATA_DIR: dataDir }, stdio: 'ignore', windowsHide: true,
});
async function call(url, method = 'GET', body, headers = {}) {
  const response = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'isolated server ready');
  const db = new Database(path.join(dataDir, 'teacher-question-bank.sqlite3'));
  assert.ok(db.prepare('PRAGMA table_info(questions)').all().some(column => column.name === 'parent_external_id'));
  assert.equal(db.prepare("SELECT stem FROM questions WHERE id='migration-sentinel'").get().stem, 'preserve me');
  db.prepare("DELETE FROM questions WHERE id='migration-sentinel'").run();
  const timestamp = new Date().toISOString();
  db.prepare(`INSERT INTO documents (id,owner_id,name,mime_type,status,page_count,created_at,updated_at) VALUES ('review-doc','local-demo','Review fixture','application/pdf','complete',0,?,?)`).run(timestamp,timestamp);
  db.prepare(`INSERT INTO questions (id,document_id,number,type,stem,answer,analysis,page_number,bbox_json,status,needs_human_review,confidence,score,created_at,updated_at) VALUES ('review-q','review-doc','1','fill','1+1=?','2','1+1=2',1,'{}','approved',0,1,0,?,?)`).run(timestamp,timestamp);
  db.close();
  const teachingClass = await call('/api/classes', 'POST', { name: 'Review class', grade: '高一', subject: '数学', schoolYear: '2026' });
  assert.equal(teachingClass.status,201);
  const classId = teachingClass.body.teachingClass.id;
  const form = new FormData();
  form.set('file',new File(['学号,姓名\n001,测试学生\n'],'review.csv',{type:'text/csv'}));
  assert.equal((await fetch(`${base}/api/classes/${classId}/import`,{method:'POST',body:form})).status,200);
  const paper = await call('/api/papers','POST',{ title:'Review paper',questionIds:['review-q'],scores:{'review-q':10} });
  assert.equal(paper.status,201);
  const assignment = await call('/api/assignments','POST',{ paperId:paper.body.id,title:'Review assignment',classIds:[classId] });
  assert.equal(assignment.status,201);
  const assignmentId=assignment.body.assignment.id;
  const detail=await call(`/api/assignments/${assignmentId}`);
  const submissionId=detail.body.submissions[0].id;
  assert.equal((await call(`/api/assignments/${assignmentId}`,'PATCH',{status:'closed'})).status,200);
  const closed=await call(`/api/assignments/${assignmentId}/scores`,'PATCH',{submissionId,scores:{'review-q':7}});
  assert.equal(closed.status,409);
  assert.match(closed.body.error,/已结束/);
  const afterClosed=await call(`/api/assignments/${assignmentId}`);
  assert.equal(afterClosed.body.submissions[0].status,'assigned');
  assert.equal(afterClosed.body.submissions[0].totalScore,null);
  assert.deepEqual(afterClosed.body.submissions[0].scores,{});
  await call(`/api/assignments/${assignmentId}`,'PATCH',{status:'active'});
  const beforeInvalid=await call(`/api/assignments/${assignmentId}`);
  for (const invalid of [null,'',false,[],{},'2',undefined,-1,11]) {
    const result=await call(`/api/assignments/${assignmentId}/scores`,'PATCH',{submissionId,scores:{'review-q':invalid}});
    assert.equal(result.status,400,JSON.stringify({input:invalid,...result}));
    assert.deepEqual((await call(`/api/assignments/${assignmentId}`)).body,beforeInvalid.body,'invalid saves must not change scores, status, timestamps or analytics');
  }
  const zero=await call(`/api/assignments/${assignmentId}/scores`,'PATCH',{submissionId,scores:{'review-q':0}});
  assert.equal(zero.status,200);
  assert.equal(zero.body.totalScore,0);
  const afterZero=await call(`/api/assignments/${assignmentId}`);
  assert.equal(afterZero.body.submissions[0].status,'graded');
  assert.equal(afterZero.body.analytics.gradedCount,1);
  const unauthorized=await call(`/api/assignments/${assignmentId}/scores`,'PATCH',{submissionId,scores:{'review-q':10}},{'oai-authenticated-user-id':'other-teacher'});
  assert.equal(unauthorized.status,400);
  assert.deepEqual((await call(`/api/assignments/${assignmentId}`)).body,afterZero.body);
  await call(`/api/assignments/${assignmentId}`,'PATCH',{status:'closed'});
  assert.equal((await call(`/api/assignments/${assignmentId}/scores`,'PATCH',{submissionId,scores:{'review-q':10}})).status,409);
  assert.deepEqual((await call(`/api/assignments/${assignmentId}`)).body.submissions,afterZero.body.submissions);
  const packageValue={ format:'jianti-question-bank',schemaVersion:1,packageId:crypto.randomUUID(),title:'Review variation',exportedAt:timestamp,questionCount:1,questions:[{
    externalId:'variant',parentExternalId:'absent-parent',variationKind:null,variationReview:null,folderPath:[],number:'1',type:'fill',stem:'2+2=?',options:[],answer:'4',analysis:'2+2=4',tags:[],source:{documentKey:'shared-doc',documentName:'Review shared',subject:'数学',grade:'高一',year:null,examType:null,region:null,textbook:null,school:null},assets:[],
  }]};
  const {gzipSync}=await import('node:zlib');
  const sharedForm=new FormData();
  sharedForm.set('file',new File([gzipSync(Buffer.from(JSON.stringify(packageValue)))],'review.jianti'));
  const imported=await fetch(base+'/api/imports/questions',{method:'POST',body:sharedForm});
  assert.equal(imported.status,201,JSON.stringify(await imported.json()));
  const checkDb=new Database(path.join(dataDir,'teacher-question-bank.sqlite3'));
  const variant=checkDb.prepare("SELECT id,parent_question_id,parent_external_id FROM questions WHERE stem='2+2=?'").get();
  assert.equal(variant.parent_question_id,null);
  assert.equal(variant.parent_external_id,'absent-parent');
  const generate = id => call(`/api/questions/${id}/variations`,'POST',{count:1,idempotencyKey:crypto.randomUUID()});
  const blocked=await generate(variant.id);
  assert.equal(blocked.status,409);
  assert.match(blocked.body.error,/逐代漂移/);
  const exported=await fetch(`${base}/api/exports/questions?format=package&ids=${variant.id}`);
  assert.equal(exported.status,200);
  const exportedBytes=new Uint8Array(await exported.arrayBuffer());
  assert.equal(readQuestionPackage(exportedBytes).questions[0].parentExternalId,'absent-parent');
  const roundTrip=new FormData();
  roundTrip.set('file',new File([exportedBytes],'roundtrip.jianti'));
  const reimported=await fetch(base+'/api/imports/questions',{method:'POST',body:roundTrip});
  assert.equal(reimported.status,201);
  const variants=checkDb.prepare("SELECT id,parent_external_id FROM questions WHERE stem='2+2=?'").all();
  assert.equal(variants.length,2);
  for (const item of variants) {
    assert.equal(item.parent_external_id,'absent-parent');
    assert.equal((await generate(item.id)).status,409);
  }
  // Historical imports already lost the external parent but retain their kind.
  checkDb.prepare("UPDATE questions SET parent_external_id=NULL, variation_kind='similar:历史变式' WHERE id=?").run(variant.id);
  assert.equal((await generate(variant.id)).status,409);
  assert.equal(checkDb.prepare('SELECT COUNT(*) AS count FROM variation_runs').get().count,0,'rejections must happen before model work');
  checkDb.close();
  console.log('review fixes e2e: ok (schema upgrade, closed assignments, strict scores, provenance round trip, legacy variations)');
} finally {
  const exited=child.exitCode===null ? new Promise(resolve=>child.once('exit',resolve)) : Promise.resolve();
  child.kill();
  await exited;
  const temporaryRoot=path.resolve('tmp');
  assert.ok(dataDir.startsWith(temporaryRoot + path.sep), 'cleanup must stay inside tmp');
  rmSync(dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}

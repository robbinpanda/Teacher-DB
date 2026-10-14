import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { selectDocumentWindow } from '../lib/document-list.ts';

test('100,001 papers remain searchable and pageable; totals are global and hydration stays bounded', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE documents(id TEXT PRIMARY KEY,owner_id TEXT,name TEXT,status TEXT,page_count INTEGER,source_removed_at TEXT,created_at TEXT);
    CREATE TABLE extraction_runs(document_id TEXT,page_number INTEGER,status TEXT);
    CREATE TABLE document_jobs(document_id TEXT PRIMARY KEY,status TEXT);
    CREATE TABLE questions(document_id TEXT,status TEXT);
    CREATE INDEX documents_visible_created_idx ON documents(owner_id,created_at,id) WHERE source_removed_at IS NULL;
    CREATE INDEX runs_document_status_page_idx ON extraction_runs(document_id,status,page_number);
    CREATE INDEX questions_document_status_idx ON questions(document_id,status);`);
  const insert=db.prepare('INSERT INTO documents VALUES(?,?,?,?,1,NULL,?)');
  const question=db.prepare('INSERT INTO questions VALUES(?,?)');
  const run=db.prepare("INSERT INTO extraction_runs VALUES(?,1,'complete')");
  db.transaction(()=>{
    for(let i=0;i<100001;i++) {
      const id=String(i).padStart(6,'0'), status=['complete','reviewing','extracting'][i%3];
      insert.run(id,'teacher',i===0?'2023一模_100%原卷':`试卷${id}`,status,'2026-10-13T00:00:00Z');
      question.run(id,status==='complete'?'approved':'pending');
      if(status!=='extracting')run.run(id);
    }
    insert.run('foreign','other','2025一模','complete','2026-10-14T00:00:00Z');
    insert.run('removed','teacher','已删除来源','complete','2026-10-14T00:00:00Z');
    db.prepare("UPDATE documents SET source_removed_at='removed' WHERE id='removed'").run();
  })();
  const start=performance.now();
  const first=selectDocumentWindow(db,'teacher');
  const last=selectDocumentWindow(db,'teacher',{page:2001});
  const search=selectDocumentWindow(db,'teacher',{search:'100%'});
  const reviewed=selectDocumentWindow(db,'teacher',{group:'reviewed',pageSize:999999});
  assert.equal(first.counts.all,100001);assert.equal(first.ids.length,50);
  assert.equal(first.pagination.totalPages,2001);
  assert.deepEqual(last.ids,['000000']);assert.equal(search.pagination.total,1);assert.deepEqual(search.ids,['000000']);
  assert.equal(reviewed.ids.length,100);assert.equal(reviewed.counts.reviewed,33334);
  assert.equal(first.stats.approvedQuestions,33334);assert.equal(first.stats.pendingQuestions,33334);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM documents').get().n,100003,'reads never evict records');
  assert.ok(performance.now()-start<10000,'four 100k-scale indexed queries must stay responsive');
  console.log(JSON.stringify({documents:100001,queries:4,milliseconds:Math.round(performance.now()-start),lastPageAccessible:true}));
  db.close();
});

import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { documentStageSql, scopeFromCookieHeader, requestEducationScope } from '../lib/education-scope.ts';
import { stageFromGrade } from '../lib/education-taxonomy.ts';
import { migrateEducationScopes } from '../db/education-scope-migration.ts';
import { selectDocumentWindow } from '../lib/document-list.ts';

test('scope cookie and SQL use the same stage classification, including legacy grades', () => {
  const db = new Database(':memory:');
  for (const grade of [null, '', '未设置年级', '小学一年级', '六年级', '初一', '初三', '七年级', '初中', '高一', '高中']) {
    assert.equal(db.prepare(`SELECT ${documentStageSql()} AS stage FROM (SELECT ? AS grade) d`).get(grade).stage, stageFromGrade(grade));
  }
  assert.deepEqual(scopeFromCookieHeader('teacher-db-scope=%INVALID'), { subject: '数学', stage: 'middle' });
  const cookie = `teacher-db-scope=${encodeURIComponent(JSON.stringify({subject:'英语',stage:'primary'}))}`;
  assert.deepEqual(requestEducationScope(new Request('http://localhost/api/documents', {headers:{cookie}})), {subject:'英语',stage:'primary'});
  db.close();
});

test('workbench pages and aggregate counts are isolated before pagination', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE documents(id TEXT,owner_id TEXT,name TEXT,status TEXT,page_count INTEGER,source_removed_at TEXT,created_at TEXT,subject TEXT,grade TEXT);
    CREATE TABLE extraction_runs(document_id TEXT,page_number INTEGER,status TEXT);
    CREATE TABLE document_jobs(document_id TEXT,status TEXT);
    CREATE TABLE questions(document_id TEXT,status TEXT);`);
  for (const [id, subject, grade] of [['a','数学','九年级'],['b','英语','九年级'],['c','数学','高三']]) {
    db.prepare("INSERT INTO documents VALUES (?,'teacher',?,'complete',1,NULL,'2026-10-18',?,?)").run(id,id,subject,grade);
    db.prepare("INSERT INTO questions VALUES (?,'approved')").run(id);
    db.prepare("INSERT INTO extraction_runs VALUES (?,1,'complete')").run(id);
  }
  const result = selectDocumentWindow(db,'teacher',{scope:{subject:'数学',stage:'middle'},page:99,pageSize:1});
  assert.deepEqual(result.ids,['a']);
  assert.equal(result.counts.all,1);
  assert.equal(result.stats.approvedQuestions,1);
  assert.equal(result.pagination.total,1);
  db.close();
});

test('legacy mixed folders split without losing resources or directory paths', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE question_folders(id TEXT PRIMARY KEY, owner_id TEXT, parent_id TEXT REFERENCES question_folders(id), name TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE paper_folders(id TEXT PRIMARY KEY, owner_id TEXT, parent_id TEXT REFERENCES paper_folders(id), name TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE documents(id TEXT, owner_id TEXT, subject TEXT, grade TEXT, created_at TEXT, paper_folder_id TEXT REFERENCES paper_folders(id));
    CREATE TABLE questions(id TEXT, document_id TEXT, folder_id TEXT REFERENCES question_folders(id));
    CREATE TABLE papers(id TEXT, settings_json TEXT, folder_id TEXT REFERENCES paper_folders(id));
    CREATE TABLE paper_items(paper_id TEXT,question_id TEXT,position INTEGER);
    INSERT INTO question_folders VALUES ('root','teacher',NULL,'根目录','now','now'),('child','teacher','root','子目录','now','now');
    INSERT INTO paper_folders VALUES ('papers','teacher',NULL,'试卷','now','now');
    INSERT INTO documents VALUES ('a','teacher','数学','九年级','now','papers'),('b','teacher','英语','高三','now','papers');
    INSERT INTO questions VALUES ('qa','a','child'),('qb','b','child');
    INSERT INTO papers VALUES ('p','{}','papers');
    INSERT INTO paper_items VALUES ('p','qb',0);`);
  db.pragma('foreign_keys=ON');
  db.transaction(() => migrateEducationScopes(db))();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM questions').get().n,2);
  const folders = db.prepare(`SELECT q.id,f.name,f.subject,f.stage,p.name AS parent FROM questions q
    JOIN question_folders f ON f.id=q.folder_id JOIN question_folders p ON p.id=f.parent_id ORDER BY q.id`).all();
  assert.deepEqual(folders,[{id:'qa',name:'子目录',subject:'数学',stage:'middle',parent:'根目录'}, {id:'qb',name:'子目录',subject:'英语',stage:'high',parent:'根目录'}]);
  assert.deepEqual(JSON.parse(db.prepare("SELECT settings_json FROM papers WHERE id='p'").get().settings_json),{subject:'英语',stage:'high'});
  assert.deepEqual(db.pragma('foreign_key_check'),[]);
  db.close();
});

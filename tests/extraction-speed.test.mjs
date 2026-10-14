import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { getExtractionSpeed } from '../lib/extraction-speed.ts';

test('rolling speed counts only this teacher’s newly completed AI questions and ages out', () => {
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE documents(id TEXT PRIMARY KEY,owner_id TEXT,source_kind TEXT);
    CREATE TABLE questions(document_id TEXT,number TEXT,stem TEXT,created_at TEXT,updated_at TEXT);
    CREATE TABLE document_jobs(document_id TEXT,owner_id TEXT,completed_question_numbers_json TEXT,updated_at TEXT,started_at TEXT,status TEXT);`);
  const at=new Date('2026-10-14T02:00:00Z');
  const stamp=seconds=>new Date(at.getTime()+seconds*1000).toISOString();
  for(const [id,owner,kind] of [['paper','teacher','uploaded'],['foreign','other','uploaded'],['import','teacher','imported'],['variation','teacher','generated']]) {
    db.prepare('INSERT INTO documents VALUES(?,?,?)').run(id,owner,kind);
    db.prepare('INSERT INTO document_jobs VALUES(?,?,?,?,?,?)').run(id,owner,'["1","2","3","4","5","6"]',stamp(0),stamp(-120),'processing');
  }
  const insert=db.prepare('INSERT INTO questions VALUES(?,?,?,?,?)');
  insert.run('paper','1','new question',stamp(-1),stamp(-1));
  insert.run('paper','2','new question',stamp(0),stamp(0));
  insert.run('paper','3','edited old question',stamp(-120),stamp(-1));
  insert.run('paper','4','expired boundary',stamp(-10),stamp(-10));
  insert.run('paper','5','future',stamp(1),stamp(1));
  insert.run('paper','6',' ',stamp(-1),stamp(-1));
  insert.run('paper','7','unfinished checkpoint',stamp(-1),stamp(-1));
  for(const id of ['foreign','import','variation']) insert.run(id,'1','not counted',stamp(-1),stamp(-1));
  const result=getExtractionSpeed(db,'teacher',at);
  assert.equal(result.completedQuestions,2); assert.equal(result.questionsPerSecond,2/10);
  assert.equal(result.windowSeconds,10);
  db.prepare("UPDATE document_jobs SET started_at=? WHERE document_id='paper'").run(stamp(-2));
  const starting=getExtractionSpeed(db,'teacher',at);
  assert.equal(starting.windowSeconds,2); assert.equal(starting.questionsPerSecond,1,'first two seconds must not be divided by a full window');
  assert.equal(getExtractionSpeed(db,'other',at).completedQuestions,1);
  assert.equal(getExtractionSpeed(db,'teacher',new Date(stamp(90))).questionsPerSecond,0);
  db.close();
});

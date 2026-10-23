import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { assertPilotCopy, preparePilot, quarantineCopiedTasks } from '../scripts/prepare-pilot.mjs';

test('试用副本包含 WAL 最新数据和独立附件；旧任务暂停，原库不变', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'jianti-pilot-test-'));
  t.after(async () => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('jianti-pilot-test-')); await rm(root, { recursive: true, force: true }); });
  const source = path.join(root, 'source'), target = path.join(root, 'trial');
  await mkdir(path.join(source, 'files'), { recursive: true });
  await writeFile(path.join(source, 'files', 'a.jpg'), 'original image');
  await writeFile(path.join(source, '.model-key-secret'), 'test encryption secret');
  const db = new Database(path.join(source, 'teacher-question-bank.sqlite3'));
  try {
    db.pragma('journal_mode=WAL');
    db.exec(`CREATE TABLE documents(id TEXT, original_key TEXT); INSERT INTO documents VALUES('d','a.jpg');
      CREATE TABLE questions(id TEXT); INSERT INTO questions VALUES('q'); CREATE TABLE papers(id TEXT);
      CREATE TABLE question_assets(source_key TEXT,crop_key TEXT); INSERT INTO question_assets VALUES('old-source.jpg','a.jpg');
      CREATE TABLE document_jobs(status TEXT,lease_owner TEXT,lease_expires_at TEXT); INSERT INTO document_jobs VALUES('processing','old','future');
      CREATE TABLE runtime_processes(id TEXT); INSERT INTO runtime_processes VALUES('old');`);
    await assert.rejects(preparePilot(source, path.join(source, 'nested')), /原数据/);
    const report = await preparePilot(source, target);
    assert.equal(report.counts.questions, 1); assert.equal(report.tasks.document_jobs, 1);
    assert.equal(report.warnings.length, 1); assert.equal(report.warnings[0].kind, 'existing_missing_source_image');
    assert.equal((await assertPilotCopy(target)).files.length, 1);
    assert.equal(await readFile(path.join(target, '.model-key-secret'), 'utf8'), 'test encryption secret');
    const copy = new Database(path.join(target, 'teacher-question-bank.sqlite3'));
    try { assert.deepEqual(copy.prepare('SELECT * FROM document_jobs').get(), { status: 'paused', lease_owner: null, lease_expires_at: null }); assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM runtime_processes').get().n, 0); copy.exec("UPDATE questions SET id='edited'"); }
    finally { copy.close(); }
    await writeFile(path.join(target, 'files', 'a.jpg'), 'edited image');
    assert.equal(await readFile(path.join(source, 'files', 'a.jpg'), 'utf8'), 'original image');
    assert.equal(db.prepare('SELECT id FROM questions').get().id, 'q');
    assert.equal(db.prepare('SELECT status FROM document_jobs').get().status, 'processing');
    await assert.rejects(preparePilot(source, target), /EEXIST/);
    db.exec("UPDATE question_assets SET source_key='../missing.jpg'");
    await assert.rejects(preparePilot(source, path.join(root, 'invalid')), /路径越界/);
    db.exec("UPDATE question_assets SET source_key='old-source.jpg'");
    db.exec("UPDATE documents SET original_key='missing.jpg'");
    const broken = path.join(root, 'broken');
    await assert.rejects(preparePilot(source, broken), /缺少.*附件/);
    await assert.rejects(assertPilotCopy(broken), /ENOENT/);
  } finally { db.close(); }
});

test('副本隔离所有 worker 领取入口，包括暂停作品中的 accepting 变式', () => {
  const db = new Database(':memory:');
  try {
    const scenarios = { document_preparations: ['processing','failed'], authoring_projects: ['planning','paused'], authoring_chapters: ['running','failed'], authoring_variation_items: ['accepting','failed'], classification_batches: ['running','paused'], classification_batch_items: ['running','failed'], extraction_runs: ['running','paused'], variation_runs: ['reviewing','failed'] };
    for (const [table,[state]] of Object.entries(scenarios)) { db.exec(`CREATE TABLE ${table}(status TEXT,lease_owner TEXT,lease_expires_at TEXT,next_attempt_at TEXT)`); db.prepare(`INSERT INTO ${table} VALUES(?,'owner','future','future'),('complete',NULL,NULL,NULL)`).run(state); }
    quarantineCopiedTasks(db);
    for (const [table,[,expected]] of Object.entries(scenarios)) assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(), [{status:expected,lease_owner:null,lease_expires_at:null,next_attempt_at:null},{status:'complete',lease_owner:null,lease_expires_at:null,next_attempt_at:null}]);
  } finally { db.close(); }
});

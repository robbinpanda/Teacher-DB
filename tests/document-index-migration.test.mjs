import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

test('existing v9 databases receive document list indexes without changing saved settings', () => {
  mkdirSync('tmp', { recursive: true });
  const directory = mkdtempSync(path.resolve('tmp/document-index-migration-'));
  const migrate = () => execFileSync(process.execPath, [
    '--import', './server/register.mjs', '--import', 'tsx', '--input-type=module', '--eval',
    "const {ensureDatabase}=await import('./db/bootstrap.ts'); await ensureDatabase();",
  ], { env: { ...process.env, JIANTI_DATA_DIR: directory }, windowsHide: true, stdio: 'pipe' });
  migrate();
  const db = new Database(path.join(directory, 'teacher-question-bank.sqlite3'));
  try {
    const indexes = ['documents_visible_created_idx', 'documents_visible_name_idx',
      'runs_document_status_page_idx', 'questions_document_status_idx'];
    for (const name of indexes) db.exec(`DROP INDEX ${name}`);
    db.exec('DELETE FROM schema_migrations WHERE version = 10');
    db.prepare('INSERT INTO app_settings(owner_id,extraction_concurrency,updated_at) VALUES(?,?,?)')
      .run('saved-teacher', 10, '2026-10-14T00:00:00Z');
    const settings = db.prepare('SELECT * FROM app_settings').all();
    const ledger = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    migrate();
    migrate();
    assert.deepEqual(db.prepare('SELECT * FROM app_settings').all(), settings);
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version <> 10 ORDER BY version').all(), ledger);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations WHERE version=10').get().n, 1);
    for (const name of indexes) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name));
    const plan = db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(DISTINCT page_number) FROM extraction_runs WHERE document_id=? AND status='complete'").all('paper');
    assert.ok(plan.some(row => row.detail.includes('COVERING INDEX runs_document_status_page_idx')),
      'page counts must seek by document instead of scanning every completed run');
  } finally { db.close(); }
});

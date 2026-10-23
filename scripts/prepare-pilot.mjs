// Creates an independent local trial copy; never opens the source for writing.
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { listFiles, sha256File } from './backup-utils.mjs';
import { loadEnvironment } from './env.mjs';

export function quarantineCopiedTasks(db) {
  const changed = {};
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  return db.transaction(() => {
    const stop = (table, status, states) => {
      if (!tables.has(table)) return;
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
      const sets = ["status=?", ...['lease_owner','lease_expires_at','next_attempt_at'].filter(c => columns.has(c)).map(c => `${c}=NULL`)];
      changed[table] = db.prepare(`UPDATE ${table} SET ${sets.join(',')} WHERE status IN (${states.map(() => '?').join(',')})`).run(status, ...states).changes;
    };
    stop('document_jobs', 'paused', ['queued','processing','retry_wait']);
    stop('extraction_runs', 'paused', ['queued','running','retry_wait']);
    // PDF preparation has no paused state; failed jobs require explicit retry.
    stop('document_preparations', 'failed', ['queued','processing','retry_wait']);
    stop('authoring_projects', 'paused', ['queued','planning','generating']);
    stop('authoring_chapters', 'failed', ['running']);
    // Accepting variants can be claimed even when the project is paused.
    stop('authoring_variation_items', 'failed', ['running','accepting']);
    stop('classification_batches', 'paused', ['running']);
    stop('classification_batch_items', 'failed', ['running']);
    stop('variation_runs', 'failed', ['generating','reviewing']);
    if (tables.has('runtime_processes')) db.prepare('DELETE FROM runtime_processes').run();
    return changed;
  }).immediate();
}

export async function preparePilot(source, destination, progress = () => {}) {
  source = await realpath(path.resolve(source)); destination = path.resolve(destination);
  const relative = path.relative(source, destination);
  assert.ok(relative && relative !== '..' && (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)), '试用副本不能位于原数据目录内');
  await stat(path.join(source, 'teacher-question-bank.sqlite3'));
  await mkdir(path.dirname(destination), { recursive: true });
  destination = path.join(await realpath(path.dirname(destination)), path.basename(destination));
  const actualRelative = path.relative(source, destination);
  assert.ok(actualRelative && (actualRelative.startsWith('..' + path.sep) || path.isAbsolute(actualRelative)), '试用副本不能通过目录链接写入原数据目录');
  // An existing directory (including a symlink) is never reused or overwritten.
  await mkdir(destination);
  const sourceDb = new Database(path.join(source, 'teacher-question-bank.sqlite3'), { readonly: true, fileMustExist: true });
  try { await sourceDb.backup(path.join(destination, 'teacher-question-bank.sqlite3')); }
  finally { sourceDb.close(); }
  progress('SQLite snapshot copied');
  const files = await listFiles(path.join(source, 'files'));
  const manifest = [];
  let next = 0, completed = 0;
  const workers = await Promise.allSettled(Array.from({ length: 8 }, async () => {
    while (next < files.length) {
      const index = next++, file = files[index];
      const relativePath = path.relative(source, file), target = path.join(destination, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      const before = await sha256File(file);
      await copyFile(file, target);
      assert.equal(await sha256File(target), before, `附件复制期间变化，请重新创建副本：${relativePath}`);
      manifest[index] = { path: relativePath.split(path.sep).join('/'), sha256: before };
      completed++;
      if (completed % 2000 === 0) progress(`Verified ${completed}/${files.length} files`);
    }
  }));
  const failure = workers.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  try { await copyFile(path.join(source, '.model-key-secret'), path.join(destination, '.model-key-secret')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return finishPilotCopy(source, destination, manifest);
}

// Caller must have compared every listed file with its source before finalizing.
export async function finishPilotCopy(source, destination, manifest) {
  source = await realpath(source); destination = await realpath(destination);
  const relative = path.relative(source, destination);
  assert.ok(relative && (relative.startsWith('..' + path.sep) || path.isAbsolute(relative)), '不能将原库作为试用副本');
  const marker = path.join(destination, 'pilot-copy.json');
  assert.equal(await stat(marker).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; }), false, '已完成的副本不能重新初始化');
  const copy = new Database(path.join(destination, 'teacher-question-bank.sqlite3'), { fileMustExist: true });
  let tasks, counts;
  const warnings = [];
  try {
    assert.equal(copy.pragma('quick_check', { simple: true }), 'ok');
    assert.equal(copy.pragma('foreign_key_check').length, 0);
    const copied = new Set(manifest.map(entry => entry.path));
    for (const [table, column] of [['documents','original_key'],['pages','storage_key'],['question_assets','source_key'],['question_assets','crop_key']]) {
      if (!copy.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column)) continue;
      for (const { key } of copy.prepare(`SELECT DISTINCT ${column} AS key FROM ${table} WHERE ${column} IS NOT NULL`).all()) {
        const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
        const fileRoot = path.join(source, 'files');
        assert.ok(normalized && !normalized.split('/').some(part => part === '.' || part === '..') && path.resolve(fileRoot, normalized).startsWith(fileRoot + path.sep), '附件路径越界');
        if (table === 'question_assets' && column === 'source_key' && !copied.has('files/' + normalized)) {
          const assets = copy.prepare('SELECT crop_key FROM question_assets WHERE source_key=?').all(key);
          const sourceExists = await stat(path.join(source, 'files', normalized)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
          if (!sourceExists && assets.every(asset => asset.crop_key && copied.has('files/' + asset.crop_key.replace(/\\/g, '/').replace(/^\/+/, '')))) {
            warnings.push({ kind: 'existing_missing_source_image', key, message: '原库已有失效的来源图路径；对应题目裁剪图完整，保留原记录待核对。' });
            continue;
          }
        }
        assert.ok(copied.has('files/' + normalized), `副本缺少数据库引用的附件：${table}.${column} ${key}`);
      }
    }
    tasks = quarantineCopiedTasks(copy);
    counts = Object.fromEntries(['documents','questions','papers'].map(table => [table, copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  } finally { copy.close(); }
  const report = { format: 'teacher-pilot-copy', createdAt: new Date().toISOString(), source, destination, counts, tasks, warnings, files: manifest };
  // This marker is only written after verification; the launcher requires it.
  await writeFile(marker, JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}

export async function assertPilotCopy(directory) {
  const report = JSON.parse(await readFile(path.join(directory, 'pilot-copy.json'), 'utf8'));
  assert.equal(report.format, 'teacher-pilot-copy');
  const actual = await realpath(directory);
  assert.equal(await realpath(report.destination), actual);
  assert.notEqual(await realpath(report.source), actual);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  loadEnvironment(process.cwd(), 'production');
  assert.ok(process.argv[2], '请指定一个不存在的试用数据目录');
  const report = await preparePilot(process.env.JIANTI_DATA_DIR || path.join(process.cwd(), 'data'), process.argv[2], console.log);
  console.log(JSON.stringify({ directory: report.destination, counts: report.counts, pausedTasks: report.tasks, verifiedFiles: report.files.length, warnings: report.warnings }));
}

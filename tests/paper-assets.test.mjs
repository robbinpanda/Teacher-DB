import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('真实数据库：组卷恢复、更新和删除保持题目引用边界', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'jianti-paper-test-'));
  try {
    const result = spawnSync(process.execPath, ['--import', './server/register.mjs', '--import', 'tsx', 'tests/fixtures/paper-assets.mjs'], {
      env: { ...process.env, JIANTI_DATA_DIR: directory }, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

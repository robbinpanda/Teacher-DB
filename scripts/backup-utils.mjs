import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

export function appDataDirectory() {
  return path.resolve(process.env.SHITI_DATA_DIR || path.join(process.cwd(), "data"));
}

export async function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filename);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function listFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, target));
    else if (entry.isFile()) files.push(target);
  }
  return files.sort();
}

export async function buildFileManifest(root) {
  const files = await listFiles(root);
  return Promise.all(files.map(async (filename) => {
    const metadata = await stat(filename);
    return {
      path: path.relative(root, filename).split(path.sep).join("/"),
      size: metadata.size,
      sha256: await sha256File(filename),
    };
  }));
}

export async function verifyBackup(backupRoot) {
  const resolvedRoot = path.resolve(backupRoot);
  const manifestPath = path.join(resolvedRoot, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.format, "teacher-question-bank-backup");
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.files));
  for (const file of manifest.files) {
    const filename = path.resolve(resolvedRoot, "data", file.path);
    const dataRoot = path.resolve(resolvedRoot, "data");
    assert.ok(filename.startsWith(dataRoot + path.sep), `备份路径越界: ${file.path}`);
    const metadata = await stat(filename);
    assert.equal(metadata.size, file.size, `文件大小不匹配: ${file.path}`);
    assert.equal(await sha256File(filename), file.sha256, `SHA-256 不匹配: ${file.path}`);
  }
  const databasePath = path.join(resolvedRoot, "data", "teacher-question-bank.sqlite3");
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const quickCheck = database.pragma("quick_check", { simple: true });
    assert.equal(quickCheck, "ok", `SQLite quick_check 失败: ${quickCheck}`);
    const foreignKeyErrors = database.pragma("foreign_key_check");
    assert.equal(foreignKeyErrors.length, 0, `SQLite 外键错误: ${JSON.stringify(foreignKeyErrors.slice(0, 10))}`);
  } finally {
    database.close();
  }
  return manifest;
}

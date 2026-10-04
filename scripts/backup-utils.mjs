import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

export function appDataDirectory() {
  return path.resolve(process.env.JIANTI_DATA_DIR || path.join(process.cwd(), "data"));
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
  const directory = await lstat(current);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink(), `备份目录不能是链接: ${current}`);
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, target));
    else if (entry.isFile()) files.push(target);
    else throw new Error(`备份包含链接或不支持的文件类型: ${target}`);
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
  const dataRoot = path.resolve(resolvedRoot, "data");
  const actualPaths = (await listFiles(dataRoot)).map((filename) => path.relative(dataRoot, filename).split(path.sep).join("/"));
  const declaredPaths = new Set();
  for (const file of manifest.files) {
    assert.ok(file && typeof file.path === "string" && file.path.length > 0, "备份文件路径无效");
    assert.ok(!/[\\:\u0000]/.test(file.path) && file.path.split("/").every((part) => part && part !== "." && part !== ".."), `备份路径不规范: ${file.path}`);
    assert.ok(!declaredPaths.has(file.path), `备份清单包含重复文件: ${file.path}`);
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0, `备份文件大小无效: ${file.path}`);
    assert.ok(typeof file.sha256 === "string" && /^[a-f0-9]{64}$/.test(file.sha256), `备份文件 SHA-256 无效: ${file.path}`);
    declaredPaths.add(file.path);
  }
  assert.ok(declaredPaths.has("teacher-question-bank.sqlite3"), "备份清单缺少数据库");
  assert.deepEqual([...declaredPaths].sort(), actualPaths.sort(), "备份清单与实际文件不一致");
  for (const file of manifest.files) {
    const filename = path.resolve(dataRoot, file.path);
    assert.ok(filename.startsWith(dataRoot + path.sep), `备份路径越界: ${file.path}`);
    const metadata = await stat(filename);
    assert.equal(metadata.size, file.size, `文件大小不匹配: ${file.path}`);
    assert.equal(await sha256File(filename), file.sha256, `SHA-256 不匹配: ${file.path}`);
  }
  // Even readonly SQLite connections can create WAL/SHM files. Validate a copy
  // so repeated verification never changes the backup being verified.
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "jianti-backup-check-"));
  try {
    const databaseName = "teacher-question-bank.sqlite3";
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      const name = databaseName + suffix;
      if (declaredPaths.has(name)) await copyFile(path.join(dataRoot, name), path.join(temporaryRoot, name));
    }
    const database = new Database(path.join(temporaryRoot, databaseName), { readonly: true, fileMustExist: true });
    try {
      const quickCheck = database.pragma("quick_check", { simple: true });
      assert.equal(quickCheck, "ok", `SQLite quick_check 失败: ${quickCheck}`);
      const foreignKeyErrors = database.pragma("foreign_key_check");
      assert.equal(foreignKeyErrors.length, 0, `SQLite 外键错误: ${JSON.stringify(foreignKeyErrors.slice(0, 10))}`);
    } finally {
      database.close();
    }
  } finally {
    assert.equal(path.dirname(temporaryRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporaryRoot).startsWith("jianti-backup-check-"));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return manifest;
}

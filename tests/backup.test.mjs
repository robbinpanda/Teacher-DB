import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { buildFileManifest, verifyBackup } from "../scripts/backup-utils.mjs";

const run = promisify(execFile);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "jianti-backup-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("jianti-backup-test-"));
    await rm(root, { recursive: true, force: true });
  });
  const data = path.join(root, "data");
  await mkdir(path.join(data, "files"), { recursive: true });
  const db = new Database(path.join(data, "teacher-question-bank.sqlite3"));
  db.exec("CREATE TABLE example (id INTEGER PRIMARY KEY); INSERT INTO example VALUES (1)");
  db.close();
  await writeFile(path.join(data, "files", "sample.jpg"), "fixture image");
  const manifest = { format: "teacher-question-bank-backup", version: 1, files: await buildFileManifest(data) };
  const save = () => writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
  await save();
  return { root, data, manifest, save };
}

test("备份完整清单可以重复校验，内容损坏必须拒绝", async (t) => {
  const backup = await fixture(t);
  await verifyBackup(backup.root);
  await verifyBackup(backup.root);
  const image = path.join(backup.data, "files", "sample.jpg");
  const original = await readFile(image);
  await writeFile(image, Buffer.alloc(original.length));
  await assert.rejects(verifyBackup(backup.root), /SHA-256/);
});

test("备份清单不能为空、漏掉数据库、漏掉附件或包含重复项", async (t) => {
  const backup = await fixture(t);
  const entries = backup.manifest.files;
  for (const files of [[], entries.filter((f) => f.path !== "teacher-question-bank.sqlite3"), entries.filter((f) => !f.path.startsWith("files/")), [...entries, entries[0]]]) {
    backup.manifest.files = files;
    await backup.save();
    await assert.rejects(verifyBackup(backup.root));
  }
});

test("备份拒绝未列入清单的文件和不规范的清单路径", async (t) => {
  const backup = await fixture(t);
  const original = backup.manifest.files[0].path;
  for (const invalid of ["../outside", "/absolute", "files/../teacher-question-bank.sqlite3", "files\\sample.jpg"]) {
    backup.manifest.files[0].path = invalid;
    await backup.save();
    await assert.rejects(verifyBackup(backup.root));
  }
  backup.manifest.files[0].path = original;
  await backup.save();
  await writeFile(path.join(backup.data, "unexpected.sqlite3-wal"), "unverified data");
  await assert.rejects(verifyBackup(backup.root));
});

test("备份不能通过目录链接夹带清单之外的数据", async (t) => {
  const backup = await fixture(t);
  const outside = path.join(backup.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "unverified.txt"), "external data");
  await symlink(outside, path.join(backup.data, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(verifyBackup(backup.root), /链接|文件类型/);
});

test("备份与恢复命令支持 WAL 快照，失败校验不触碰目标，成功恢复保留旧数据", async (t) => {
  const source = await fixture(t);
  const archive = path.join(source.root, "archive");
  const restored = path.join(source.root, "restored");
  const sourceDb = new Database(path.join(source.data, "teacher-question-bank.sqlite3"));
  try {
    sourceDb.pragma("journal_mode = WAL");
    sourceDb.exec("INSERT INTO example VALUES (2)");
    await run(process.execPath, ["scripts/backup.mjs", archive], {
      cwd: projectRoot, env: { ...process.env, JIANTI_DATA_DIR: source.data }, windowsHide: true,
    });
  } finally {
    sourceDb.close();
  }
  await verifyBackup(archive);
  await verifyBackup(archive);
  await mkdir(restored);
  await writeFile(path.join(restored, "sentinel.txt"), "keep old data");
  const manifestFile = path.join(archive, "manifest.json");
  const manifest = await readFile(manifestFile, "utf8");
  await writeFile(manifestFile, JSON.stringify({ ...JSON.parse(manifest), files: [] }));
  const restore = () => run(process.execPath, ["scripts/restore.mjs", archive, "--confirm"], {
    cwd: projectRoot, env: { ...process.env, JIANTI_DATA_DIR: restored }, windowsHide: true,
  });
  await assert.rejects(restore());
  assert.equal(await readFile(path.join(restored, "sentinel.txt"), "utf8"), "keep old data");
  await writeFile(manifestFile, manifest);
  await restore();
  const db = new Database(path.join(restored, "teacher-question-bank.sqlite3"), { readonly: true });
  try { assert.deepEqual(db.prepare("SELECT id FROM example ORDER BY id").pluck().all(), [1, 2]); }
  finally { db.close(); }
  assert.equal(await readFile(path.join(restored, "files", "sample.jpg"), "utf8"), "fixture image");
  const safetyCopy = (await readdir(source.root)).find((name) => name.startsWith("restored.pre-restore-"));
  assert.ok(safetyCopy);
  assert.equal(await readFile(path.join(source.root, safetyCopy, "sentinel.txt"), "utf8"), "keep old data");
});

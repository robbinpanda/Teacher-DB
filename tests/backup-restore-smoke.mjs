import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

const tempParent = path.resolve("tmp");
await mkdir(tempParent, { recursive: true });
const root = await mkdtemp(path.join(tempParent, "backup-restore-smoke-"));
assert.ok(root.startsWith(tempParent + path.sep));
const dataRoot = path.join(root, "data");
const backupRoot = path.join(root, "backup");
const filePath = path.join(dataRoot, "files", "documents", "fixture", "original.txt");
const databasePath = path.join(dataRoot, "teacher-question-bank.sqlite3");

function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, SHITI_DATA_DIR: dataRoot },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${script} failed:\n${result.stdout}\n${result.stderr}`);
}

try {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "original", "utf8");
  await writeFile(path.join(dataRoot, ".model-key-secret"), "test-secret-value\n", "utf8");
  let database = new Database(databasePath);
  database.exec("CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records VALUES ('one', 'original')");
  database.close();

  run("scripts/backup.mjs", [backupRoot]);
  run("scripts/verify-backup.mjs", [backupRoot]);

  database = new Database(databasePath);
  database.prepare("UPDATE records SET value = 'changed' WHERE id = 'one'").run();
  database.close();
  await writeFile(filePath, "changed", "utf8");

  run("scripts/restore.mjs", [backupRoot, "--confirm"]);
  database = new Database(databasePath, { readonly: true });
  assert.equal(database.prepare("SELECT value FROM records WHERE id = 'one'").get().value, "original");
  database.close();
  assert.equal(await readFile(filePath, "utf8"), "original");
  console.log("backup and restore smoke test passed");
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

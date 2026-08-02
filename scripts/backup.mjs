import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { appDataDirectory, buildFileManifest, verifyBackup } from "./backup-utils.mjs";

const dataRoot = appDataDirectory();
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = path.resolve(process.argv[2] || path.join(process.cwd(), "backups", `backup-${timestamp}`));
if (destination === dataRoot || destination.startsWith(dataRoot + path.sep)) throw new Error("备份目录不能位于数据目录内部");
try {
  await stat(destination);
  throw new Error(`备份目录已存在: ${destination}`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const sourceDatabase = path.join(dataRoot, "teacher-question-bank.sqlite3");
await stat(sourceDatabase);
const backupDataRoot = path.join(destination, "data");
await mkdir(backupDataRoot, { recursive: true });
const database = new Database(sourceDatabase, { readonly: true, fileMustExist: true });
try {
  await database.backup(path.join(backupDataRoot, "teacher-question-bank.sqlite3"));
} finally {
  database.close();
}
for (const relative of ["files", ".model-key-secret"]) {
  const source = path.join(dataRoot, relative);
  try { await cp(source, path.join(backupDataRoot, relative), { recursive: true, errorOnExist: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
const files = await buildFileManifest(backupDataRoot);
const manifest = {
  format: "teacher-question-bank-backup",
  version: 1,
  createdAt: new Date().toISOString(),
  sourceDataRoot: dataRoot,
  files,
};
await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
await verifyBackup(destination);
console.log(`backup created and verified: ${destination}`);

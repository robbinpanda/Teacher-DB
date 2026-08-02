import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { appDataDirectory, listFiles } from "./backup-utils.mjs";

const dataRoot = appDataDirectory();
const databasePath = path.join(dataRoot, "teacher-question-bank.sqlite3");
const filesRoot = path.join(dataRoot, "files");
const report = { ok: true, checks: {}, warnings: [] };
const database = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  const quickCheck = database.pragma("quick_check", { simple: true });
  report.checks.sqlite = quickCheck;
  if (quickCheck !== "ok") report.ok = false;
  const foreignKeyErrors = database.pragma("foreign_key_check");
  report.checks.foreignKeyErrors = foreignKeyErrors.length;
  if (foreignKeyErrors.length) report.ok = false;
  const requiredTables = ["documents", "pages", "extraction_runs", "questions", "question_assets", "tags", "papers", "model_profiles"];
  const existingTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));
  report.checks.missingTables = missingTables;
  if (missingTables.length) report.ok = false;

  const referencedKeys = new Set();
  for (const query of [
    "SELECT original_key AS storageKey FROM documents WHERE original_key IS NOT NULL",
    "SELECT storage_key AS storageKey FROM pages",
    "SELECT source_key AS storageKey FROM question_assets WHERE source_key IS NOT NULL",
    "SELECT crop_key AS storageKey FROM question_assets WHERE crop_key IS NOT NULL",
  ]) {
    for (const row of database.prepare(query).all()) referencedKeys.add(row.storageKey.replace(/\\/g, "/"));
  }
  const missingFiles = [];
  for (const key of referencedKeys) {
    try { await access(path.resolve(filesRoot, key)); } catch { missingFiles.push(key); }
  }
  report.checks.missingReferencedFiles = missingFiles;
  if (missingFiles.length) report.ok = false;
  let storedFiles = [];
  try { storedFiles = await listFiles(filesRoot); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const orphanFiles = storedFiles
    .map((filename) => path.relative(filesRoot, filename).split(path.sep).join("/"))
    .filter((key) => !referencedKeys.has(key));
  report.checks.orphanFileCount = orphanFiles.length;
  report.checks.orphanFiles = orphanFiles.slice(0, 50);
  if (orphanFiles.length) report.warnings.push(`发现 ${orphanFiles.length} 个未被数据库引用的文件，可人工确认后清理`);
  const staleRuns = database.prepare(
    `SELECT COUNT(*) AS count FROM extraction_runs WHERE status = 'running' AND created_at < ?`,
  ).get(new Date(Date.now() - 15 * 60 * 1000).toISOString()).count;
  report.checks.staleExtractionRuns = staleRuns;
  if (staleRuns) report.warnings.push(`发现 ${staleRuns} 个超过 15 分钟的运行中识别任务，可从审核页继续识别`);
  const profiles = database.prepare("SELECT COUNT(*) AS count FROM model_profiles WHERE enabled = 1").get().count;
  report.checks.enabledModelProfiles = profiles;
  if (!profiles) report.warnings.push("没有启用的模型配置");
} finally {
  database.close();
}

const writeProbe = path.join(dataRoot, "tmp", `doctor-${crypto.randomUUID()}.tmp`);
try {
  await mkdir(path.dirname(writeProbe), { recursive: true });
  await writeFile(writeProbe, "ok", "utf8");
  report.checks.storageWritable = true;
} catch {
  report.checks.storageWritable = false;
  report.ok = false;
} finally {
  await rm(writeProbe, { force: true });
}
report.checks.dataRoot = dataRoot;
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

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
  const requiredTables = ["documents", "pages", "extraction_runs", "questions", "question_regions", "question_assets", "tags", "papers", "model_profiles"];
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
  const staleAnswerImports = database.prepare(
    `SELECT COUNT(*) AS count FROM answer_imports WHERE status = 'processing' AND updated_at < ?`,
  ).get(new Date(Date.now() - 15 * 60 * 1000).toISOString()).count;
  report.checks.staleAnswerImports = staleAnswerImports;
  if (staleAnswerImports) report.ok = false;
  const runPageLinkErrors = database.prepare(
    `SELECT COUNT(*) AS count FROM extraction_runs r LEFT JOIN pages p ON p.id = r.page_id
      WHERE r.page_id IS NULL OR p.id IS NULL OR p.document_id <> r.document_id OR p.page_number <> r.page_number`,
  ).get().count;
  report.checks.runPageLinkErrors = runPageLinkErrors;
  if (runPageLinkErrors) report.ok = false;
  const duplicateRunPages = database.prepare(
    `SELECT COUNT(*) AS count FROM (
       SELECT document_id, page_number FROM extraction_runs
        GROUP BY document_id, page_number HAVING COUNT(*) <> 1
     )`,
  ).get().count;
  report.checks.duplicateRunPages = duplicateRunPages;
  if (duplicateRunPages) report.ok = false;
  const pageRunCardinalityErrors = database.prepare(
    `SELECT COUNT(*) AS count FROM (
       SELECT p.id FROM pages p LEFT JOIN extraction_runs r
         ON r.document_id = p.document_id AND r.page_number = p.page_number
        GROUP BY p.id HAVING COUNT(r.id) <> 1
     )`,
  ).get().count;
  report.checks.pageRunCardinalityErrors = pageRunCardinalityErrors;
  if (pageRunCardinalityErrors) report.ok = false;
  const regionPageLinkErrors = database.prepare(
    `SELECT COUNT(*) AS count FROM question_regions qr
       JOIN questions q ON q.id = qr.question_id LEFT JOIN pages p ON p.id = qr.page_id
      WHERE p.id IS NULL OR qr.page_number <> p.page_number OR q.document_id <> p.document_id`,
  ).get().count;
  report.checks.regionPageLinkErrors = regionPageLinkErrors;
  if (regionPageLinkErrors) report.ok = false;
  const jobStateErrors = database.prepare(
    `SELECT COUNT(*) AS count FROM documents d JOIN document_jobs j ON j.document_id = d.id
      WHERE (j.status = 'complete' AND d.status NOT IN ('reviewing', 'complete'))
         OR (j.status = 'failed' AND d.status <> 'failed')
         OR (j.status = 'processing' AND (j.lease_owner IS NULL OR j.lease_expires_at IS NULL))
         OR (j.status <> 'processing' AND (j.lease_owner IS NOT NULL OR j.lease_expires_at IS NOT NULL))`,
  ).get().count;
  report.checks.jobStateErrors = jobStateErrors;
  if (jobStateErrors) report.ok = false;
  const completedJobRunErrors = database.prepare(
    `SELECT COUNT(*) AS count FROM (
       SELECT j.document_id FROM document_jobs j JOIN documents d ON d.id = j.document_id
       LEFT JOIN extraction_runs r ON r.document_id = j.document_id AND r.status = 'complete'
       WHERE j.status = 'complete' GROUP BY j.document_id HAVING COUNT(DISTINCT r.page_number) <> d.page_count
     )`,
  ).get().count;
  report.checks.completedJobRunErrors = completedJobRunErrors;
  if (completedJobRunErrors) report.ok = false;
  const activePageIntegrityErrors = database.prepare(
    `SELECT COUNT(*) AS count FROM (
       SELECT d.id FROM documents d LEFT JOIN pages p ON p.document_id = d.id
        WHERE d.status <> 'failed' GROUP BY d.id
       HAVING COUNT(p.id) <> d.page_count OR (d.page_count > 0 AND (MIN(p.page_number) <> 1 OR MAX(p.page_number) <> d.page_count))
     )`,
  ).get().count;
  report.checks.activePageIntegrityErrors = activePageIntegrityErrors;
  if (activePageIntegrityErrors) report.ok = false;
  const failedApprovedQuestions = database.prepare(
    `SELECT COUNT(*) AS count FROM questions q JOIN documents d ON d.id = q.document_id
      WHERE d.status = 'failed' AND q.status = 'approved'`,
  ).get().count;
  report.checks.failedApprovedQuestions = failedApprovedQuestions;
  if (failedApprovedQuestions) report.ok = false;
  const incompleteFailedDocuments = database.prepare(
    `SELECT d.name, d.page_count AS declaredPages, COUNT(p.id) AS storedPages
       FROM documents d LEFT JOIN pages p ON p.document_id = d.id
      WHERE d.status = 'failed' GROUP BY d.id HAVING COUNT(p.id) <> d.page_count`,
  ).all();
  report.checks.incompleteFailedDocuments = incompleteFailedDocuments;
  if (incompleteFailedDocuments.length) {
    report.warnings.push(`有 ${incompleteFailedDocuments.length} 份失败试卷缺页，已隔离且不会进入题库`);
  }
  const numberedDocuments = database.prepare(
    `SELECT d.id, d.name, d.status, q.number FROM documents d
       LEFT JOIN questions q ON q.document_id = d.id
      WHERE d.status IN ('reviewing', 'complete') ORDER BY d.id, CAST(q.number AS INTEGER)`,
  ).all();
  const numbersByDocument = new Map();
  for (const row of numberedDocuments) {
    if (!numbersByDocument.has(row.id)) numbersByDocument.set(row.id, { name: row.name, numbers: [], invalid: [] });
    if (row.number !== null && !/^[1-9]\d*$/.test(String(row.number))) {
      numbersByDocument.get(row.id).invalid.push(String(row.number));
      continue;
    }
    const number = Number(row.number);
    if (Number.isInteger(number) && number > 0) numbersByDocument.get(row.id).numbers.push(number);
  }
  const questionNumberGaps = [];
  for (const [documentId, entry] of numbersByDocument) {
    const maximum = Math.max(0, ...entry.numbers);
    const present = new Set(entry.numbers);
    const missing = Array.from({ length: maximum }, (_, index) => index + 1).filter((number) => !present.has(number));
    if (!entry.numbers.length || missing.length || entry.invalid.length) {
      questionNumberGaps.push({ documentId, name: entry.name, missing, invalid: entry.invalid });
    }
  }
  report.checks.questionNumberGaps = questionNumberGaps;
  if (questionNumberGaps.length) report.ok = false;
  const documentQuestionState = new Map();
  for (const row of database.prepare(
    `SELECT d.id, d.name, d.status, q.number FROM documents d LEFT JOIN questions q ON q.document_id = d.id`,
  ).all()) {
    if (!documentQuestionState.has(row.id)) {
      documentQuestionState.set(row.id, { name: row.name, status: row.status, numbers: new Set(), rawMissing: new Set() });
    }
    if (row.number !== null) documentQuestionState.get(row.id).numbers.add(String(row.number));
  }
  for (const run of database.prepare(
    `SELECT document_id AS documentId, raw_json AS rawJson FROM extraction_runs
      WHERE status = 'complete' AND raw_json IS NOT NULL`,
  ).all()) {
    const state = documentQuestionState.get(run.documentId);
    if (!state) continue;
    let raw;
    try { raw = JSON.parse(run.rawJson); } catch { continue; }
    const rawNumbers = [
      ...(Array.isArray(raw.questions) ? raw.questions : []),
      ...(Array.isArray(raw.answerUpdates) ? raw.answerUpdates : []),
    ].map((item) => String(item?.number ?? "").trim()).filter((number) => /^[1-9]\d*$/.test(number));
    for (const number of rawNumbers) if (!state.numbers.has(number)) state.rawMissing.add(number);
  }
  const rawQuestionStorageMismatches = [...documentQuestionState.entries()]
    .filter(([, state]) => state.status !== "failed" && state.rawMissing.size)
    .map(([documentId, state]) => ({ documentId, name: state.name, missing: [...state.rawMissing] }));
  report.checks.rawQuestionStorageMismatches = rawQuestionStorageMismatches;
  if (rawQuestionStorageMismatches.length) report.ok = false;
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

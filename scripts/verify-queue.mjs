import Database from "better-sqlite3";
import path from "node:path";

const dataDirectory = process.env.JIANTI_DATA_DIR
  ? path.resolve(process.env.JIANTI_DATA_DIR)
  : path.resolve("data");
const sqlite = new Database(path.join(dataDirectory, "teacher-question-bank.sqlite3"), { readonly: true });

const requiredJobColumns = ["document_id", "status", "next_attempt_at", "lease_owner", "lease_expires_at"];
const jobColumns = new Set(sqlite.prepare("PRAGMA table_info(document_jobs)").all().map((column) => column.name));
for (const column of requiredJobColumns) {
  if (!jobColumns.has(column)) throw new Error(`document_jobs 缺少列：${column}`);
}

const processing = sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE status = 'processing'").get().count;
const overCapacity = sqlite.prepare(`SELECT j.owner_id, COUNT(*) AS active, COALESCE(s.extraction_concurrency, 2) AS capacity
  FROM document_jobs j LEFT JOIN app_settings s ON s.owner_id=j.owner_id
  WHERE j.status='processing' AND j.lease_expires_at>=? GROUP BY j.owner_id
  HAVING COUNT(*) > COALESCE(s.extraction_concurrency, 2)`).all(new Date().toISOString());
// Lowering concurrency does not cancel existing work. Report draining jobs
// rather than treating that legitimate transition as corrupt queue state.

const duplicates = sqlite.prepare(
  `SELECT idempotency_key, COUNT(*) AS count FROM extraction_runs
   WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*) > 1`,
).all();
if (duplicates.length) throw new Error(`发现 ${duplicates.length} 个重复页面幂等键`);

const incompleteCheckpoints = sqlite.prepare(
  "SELECT COUNT(*) AS count FROM extraction_runs WHERE status = 'complete' AND (raw_json IS NULL OR finished_at IS NULL)",
).get().count;
if (incompleteCheckpoints) throw new Error(`发现 ${incompleteCheckpoints} 个不完整的成功检查点`);

const duplicateQuestionNumbers = sqlite.prepare(
  `SELECT COUNT(*) AS count FROM (
     SELECT document_id, number FROM questions GROUP BY document_id, number HAVING COUNT(*) > 1
   )`,
).get().count;
if (duplicateQuestionNumbers) throw new Error(`发现 ${duplicateQuestionNumbers} 组重复题号`);

const foreignKeyErrors = sqlite.prepare("PRAGMA foreign_key_check").all();
if (foreignKeyErrors.length) throw new Error(`发现 ${foreignKeyErrors.length} 个外键错误`);

const summary = sqlite.prepare(
  `SELECT status, COUNT(*) AS count FROM document_jobs GROUP BY status ORDER BY status`,
).all();
console.log(JSON.stringify({ ok: true, processing, drainingOwners: overCapacity, duplicateQuestionNumbers, jobs: summary }, null, 2));
sqlite.close();

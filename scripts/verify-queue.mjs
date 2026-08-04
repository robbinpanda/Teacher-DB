import Database from "better-sqlite3";
import path from "node:path";

const dataDirectory = process.env.SHITI_DATA_DIR
  ? path.resolve(process.env.SHITI_DATA_DIR)
  : path.resolve("data");
const sqlite = new Database(path.join(dataDirectory, "teacher-question-bank.sqlite3"), { readonly: true });

const requiredJobColumns = ["document_id", "status", "next_attempt_at", "lease_owner", "lease_expires_at"];
const jobColumns = new Set(sqlite.prepare("PRAGMA table_info(document_jobs)").all().map((column) => column.name));
for (const column of requiredJobColumns) {
  if (!jobColumns.has(column)) throw new Error(`document_jobs 缺少列：${column}`);
}

const processing = sqlite.prepare("SELECT COUNT(*) AS count FROM document_jobs WHERE status = 'processing'").get().count;
if (processing > 2) throw new Error(`文档并发越界：当前 ${processing}，上限 2`);

const duplicates = sqlite.prepare(
  `SELECT idempotency_key, COUNT(*) AS count FROM extraction_runs
   WHERE idempotency_key IS NOT NULL GROUP BY idempotency_key HAVING COUNT(*) > 1`,
).all();
if (duplicates.length) throw new Error(`发现 ${duplicates.length} 个重复页面幂等键`);

const incompleteCheckpoints = sqlite.prepare(
  "SELECT COUNT(*) AS count FROM extraction_runs WHERE status = 'complete' AND (raw_json IS NULL OR finished_at IS NULL)",
).get().count;
if (incompleteCheckpoints) throw new Error(`发现 ${incompleteCheckpoints} 个不完整的成功检查点`);

const foreignKeyErrors = sqlite.prepare("PRAGMA foreign_key_check").all();
if (foreignKeyErrors.length) throw new Error(`发现 ${foreignKeyErrors.length} 个外键错误`);

const summary = sqlite.prepare(
  `SELECT status, COUNT(*) AS count FROM document_jobs GROUP BY status ORDER BY status`,
).all();
console.log(JSON.stringify({ ok: true, processing, jobs: summary }, null, 2));
sqlite.close();

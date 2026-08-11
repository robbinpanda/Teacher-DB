import { getSqlite } from ".";
import { installDatabaseInvariants, repairFailedDocumentApprovals } from "../lib/database-invariants";

const schemaSql = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', name TEXT NOT NULL,
  mime_type TEXT NOT NULL, original_key TEXT, status TEXT NOT NULL DEFAULT 'uploading', page_count INTEGER NOT NULL DEFAULT 0,
  subject TEXT, grade TEXT, source_year INTEGER, source_exam_type TEXT, source_region TEXT, source_school TEXT,
  checksum TEXT, error TEXT, source_removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS documents_owner_created_idx ON documents(owner_id, created_at);
CREATE INDEX IF NOT EXISTS documents_status_idx ON documents(status);
CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL, storage_key TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready', checksum TEXT, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS pages_document_number_idx ON pages(document_id, page_number);
CREATE TABLE IF NOT EXISTS extraction_runs (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL, page_number INTEGER, model_profile_id TEXT,
  provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT, raw_json TEXT, error TEXT, error_code TEXT, next_attempt_at TEXT,
  lease_owner TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_document_idx ON extraction_runs(document_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS runs_idempotency_idx ON extraction_runs(idempotency_key);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  number TEXT NOT NULL, type TEXT NOT NULL, stem TEXT NOT NULL, options_json TEXT, answer TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '', page_number INTEGER NOT NULL, bbox_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', needs_human_review INTEGER, confidence REAL NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_document_page_idx ON questions(document_id, page_number);
CREATE INDEX IF NOT EXISTS questions_type_status_idx ON questions(type, status);
CREATE TABLE IF NOT EXISTS question_regions (
  id TEXT PRIMARY KEY NOT NULL, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL, page_number INTEGER NOT NULL,
  bbox_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS question_regions_question_page_idx ON question_regions(question_id, page_number);
CREATE INDEX IF NOT EXISTS question_regions_page_idx ON question_regions(page_id);
CREATE TABLE IF NOT EXISTS question_assets (
  id TEXT PRIMARY KEY NOT NULL, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '题图',
  source_key TEXT, crop_key TEXT, bbox_json TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_question_idx ON question_assets(question_id);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_idx ON tags(name);
CREATE TABLE IF NOT EXISTS tag_catalog (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', subject TEXT NOT NULL,
  stage TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tag_catalog_scope_name_idx ON tag_catalog(owner_id, subject, stage, name);
CREATE INDEX IF NOT EXISTS tag_catalog_scope_idx ON tag_catalog(owner_id, subject, stage);
CREATE TABLE IF NOT EXISTS question_tags (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(question_id, tag_id)
);
CREATE INDEX IF NOT EXISTS question_tags_tag_idx ON question_tags(tag_id);
CREATE TABLE IF NOT EXISTS paper_folders (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', parent_id TEXT REFERENCES paper_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_folders_owner_parent_idx ON paper_folders(owner_id, parent_id);
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', title TEXT NOT NULL, subtitle TEXT,
  folder_id TEXT REFERENCES paper_folders(id) ON DELETE SET NULL,
  settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS papers_owner_created_idx ON papers(owner_id, created_at);
CREATE TABLE IF NOT EXISTS paper_templates (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', name TEXT NOT NULL,
  subject TEXT NOT NULL, stage TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom', description TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS paper_templates_owner_scope_idx ON paper_templates(owner_id, subject, stage);
CREATE UNIQUE INDEX IF NOT EXISTS paper_templates_owner_name_idx ON paper_templates(owner_id, name);
CREATE TABLE IF NOT EXISTS answer_imports (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo',
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, source_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing', result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS answer_imports_document_idx ON answer_imports(document_id, created_at);
CREATE TABLE IF NOT EXISTS paper_items (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL, score INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(paper_id, question_id)
);
CREATE INDEX IF NOT EXISTS paper_items_position_idx ON paper_items(paper_id, position);
CREATE TABLE IF NOT EXISTS model_profiles (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', display_name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'openai-compatible', base_url TEXT NOT NULL, model TEXT NOT NULL,
  api_key_ciphertext TEXT, api_key_iv TEXT, api_key_mask TEXT, is_managed INTEGER NOT NULL DEFAULT 0,
  is_multimodal INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, timeout_ms INTEGER NOT NULL DEFAULT 90000,
  last_test_status TEXT, last_test_message TEXT, last_tested_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS model_profiles_owner_idx ON model_profiles(owner_id, enabled);
CREATE UNIQUE INDEX IF NOT EXISTS model_profiles_owner_name_idx ON model_profiles(owner_id, display_name);
CREATE TABLE IF NOT EXISTS app_settings (
  owner_id TEXT PRIMARY KEY NOT NULL, selected_model_profile_id TEXT,
  extraction_concurrency INTEGER NOT NULL DEFAULT 2, extraction_paused INTEGER NOT NULL DEFAULT 0,
  extraction_pause_reason TEXT, extraction_paused_at TEXT,
  extraction_failure_streak INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS document_jobs (
  document_id TEXT PRIMARY KEY NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL DEFAULT 'local-demo', profile_id TEXT, status TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
  lease_owner TEXT, lease_expires_at TEXT, last_error TEXT, queued_at TEXT NOT NULL,
  started_at TEXT, finished_at TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS document_jobs_queue_idx ON document_jobs(status, next_attempt_at, queued_at);
CREATE INDEX IF NOT EXISTS document_jobs_owner_idx ON document_jobs(owner_id, status);
`;

const upgrades: Record<string, Record<string, string>> = {
  documents: {
    owner_id: "TEXT NOT NULL DEFAULT 'local-demo'",
    original_key: "TEXT",
    page_count: "INTEGER NOT NULL DEFAULT 0",
    subject: "TEXT",
    grade: "TEXT",
    source_year: "INTEGER",
    source_exam_type: "TEXT",
    source_region: "TEXT",
    source_school: "TEXT",
    checksum: "TEXT",
    error: "TEXT",
    source_removed_at: "TEXT",
  },
  pages: { status: "TEXT NOT NULL DEFAULT 'ready'", checksum: "TEXT" },
  extraction_runs: {
    page_id: "TEXT",
    page_number: "INTEGER",
    model_profile_id: "TEXT",
    attempt: "INTEGER NOT NULL DEFAULT 1",
    idempotency_key: "TEXT",
    error_code: "TEXT",
    next_attempt_at: "TEXT",
    lease_owner: "TEXT",
    lease_expires_at: "TEXT",
    finished_at: "TEXT",
  },
  questions: {
    confidence: "REAL NOT NULL DEFAULT 0",
    needs_human_review: "INTEGER",
    score: "INTEGER NOT NULL DEFAULT 0",
  },
  question_assets: {
    page_id: "TEXT",
    source_key: "TEXT",
    crop_key: "TEXT",
    position: "INTEGER NOT NULL DEFAULT 0",
  },
  papers: {
    owner_id: "TEXT NOT NULL DEFAULT 'local-demo'",
    folder_id: "TEXT REFERENCES paper_folders(id) ON DELETE SET NULL",
    subtitle: "TEXT",
    settings_json: "TEXT NOT NULL DEFAULT '{}'",
  },
  app_settings: {
    extraction_concurrency: "INTEGER NOT NULL DEFAULT 2",
    extraction_paused: "INTEGER NOT NULL DEFAULT 0",
    extraction_pause_reason: "TEXT",
    extraction_paused_at: "TEXT",
    extraction_failure_streak: "INTEGER NOT NULL DEFAULT 0",
  },
};

let initialized = false;

function initialize() {
  const sqlite = getSqlite();
  sqlite.exec(schemaSql);
  for (const [table, columns] of Object.entries(upgrades)) {
    const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const existing = new Set(info.map((column) => column.name));
    for (const [name, definition] of Object.entries(columns)) {
      if (!existing.has(name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS runs_idempotency_idx ON extraction_runs(idempotency_key)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS runs_queue_idx ON extraction_runs(status, next_attempt_at)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS document_jobs_queue_idx ON document_jobs(status, next_attempt_at, queued_at)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS document_jobs_owner_idx ON document_jobs(owner_id, status)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS paper_folders_owner_parent_idx ON paper_folders(owner_id, parent_id)");
  sqlite.exec("CREATE INDEX IF NOT EXISTS papers_owner_folder_idx ON papers(owner_id, folder_id, updated_at)");
  installDatabaseInvariants(sqlite);
  const migrationTime = new Date().toISOString();
  sqlite.prepare(
    `INSERT INTO app_settings
       (owner_id, extraction_paused, extraction_pause_reason, extraction_paused_at, extraction_failure_streak, updated_at)
     SELECT owner_id, 1,
       '检测到多份试卷同时处于退避状态，已暂停全部识别。请检查网络或模型 API 后点击“全部开始”。',
       ?, 3, ?
     FROM document_jobs WHERE status = 'retry_wait'
     GROUP BY owner_id HAVING COUNT(*) >= 3
     ON CONFLICT(owner_id) DO UPDATE SET
       extraction_paused = 1,
       extraction_pause_reason = excluded.extraction_pause_reason,
       extraction_paused_at = excluded.extraction_paused_at,
       extraction_failure_streak = MAX(app_settings.extraction_failure_streak, 3),
       updated_at = excluded.updated_at`,
  ).run(migrationTime, migrationTime);
  sqlite.prepare(
    `UPDATE document_jobs SET status = 'paused', next_attempt_at = NULL, lease_owner = NULL,
       lease_expires_at = NULL, finished_at = NULL, updated_at = ?
     WHERE status IN ('queued', 'retry_wait', 'failed') AND owner_id IN (
       SELECT owner_id FROM app_settings WHERE extraction_paused = 1
     )`,
  ).run(migrationTime);
  sqlite.prepare(
    `UPDATE extraction_runs SET status = 'paused', next_attempt_at = NULL,
       lease_owner = NULL, lease_expires_at = NULL, finished_at = NULL
     WHERE status <> 'complete' AND status <> 'running' AND document_id IN (
       SELECT document_id FROM document_jobs WHERE status = 'paused'
     )`,
  ).run();
  sqlite.prepare(
    `UPDATE answer_imports SET status = 'failed', error = '服务重启中断了答案识别，请重新导入未完成页面', updated_at = ?
      WHERE status = 'processing'`,
  ).run(migrationTime);
  sqlite.prepare(
    `UPDATE document_jobs SET status = 'failed', next_attempt_at = NULL, lease_owner = NULL,
       lease_expires_at = NULL, finished_at = COALESCE(finished_at, ?), updated_at = ?,
       last_error = (SELECT '原卷页面不完整：已保存 ' || COUNT(p.id) || '/' || d.page_count || ' 页，请重新上传同一 PDF 补齐'
                       FROM documents d LEFT JOIN pages p ON p.document_id = d.id
                      WHERE d.id = document_jobs.document_id GROUP BY d.id)
     WHERE status = 'complete' AND EXISTS (
       SELECT 1 FROM documents d WHERE d.id = document_jobs.document_id
         AND d.page_count <> (SELECT COUNT(*) FROM pages p WHERE p.document_id = d.id)
     )`,
  ).run(migrationTime, migrationTime);
  sqlite.prepare(
    `UPDATE documents SET status = 'failed',
       error = '原卷页面不完整：已保存 ' || (SELECT COUNT(*) FROM pages p WHERE p.document_id = documents.id)
         || '/' || page_count || ' 页，请重新上传同一 PDF 补齐', updated_at = ?
     WHERE status IN ('reviewing', 'complete')
       AND page_count <> (SELECT COUNT(*) FROM pages p WHERE p.document_id = documents.id)`,
  ).run(migrationTime);
  repairFailedDocumentApprovals(sqlite, migrationTime);
  sqlite.prepare(
    `UPDATE extraction_runs SET status = 'queued', attempt = 0, error = NULL, error_code = NULL,
       next_attempt_at = NULL, lease_owner = NULL, lease_expires_at = NULL, finished_at = NULL
     WHERE status = 'failed' AND document_id IN (
       SELECT d.id FROM documents d LEFT JOIN document_jobs j ON j.document_id = d.id
       WHERE j.document_id IS NULL AND d.status IN ('extracting', 'failed')
     )`,
  ).run();
  sqlite.prepare(
    `INSERT OR IGNORE INTO document_jobs
      (document_id, owner_id, profile_id, status, priority, attempt, queued_at, updated_at)
     SELECT d.id, d.owner_id, NULL, 'queued', 0, 0, ?, ? FROM documents d
     WHERE d.status IN ('extracting', 'failed')
       AND d.page_count > 0
       AND (SELECT COUNT(*) FROM pages p WHERE p.document_id = d.id) = d.page_count
       AND (SELECT MIN(p.page_number) FROM pages p WHERE p.document_id = d.id) = 1
       AND (SELECT MAX(p.page_number) FROM pages p WHERE p.document_id = d.id) = d.page_count
       AND EXISTS (SELECT 1 FROM pages p WHERE p.document_id = d.id)
       AND EXISTS (SELECT 1 FROM extraction_runs r WHERE r.document_id = d.id AND r.status <> 'complete')`,
  ).run(migrationTime, migrationTime);
  sqlite.prepare(
    `UPDATE documents SET status = 'extracting', error = '历史任务已迁移到可靠队列，将从未完成页面继续', updated_at = ?
     WHERE id IN (SELECT document_id FROM document_jobs WHERE status = 'queued' AND queued_at = ?)`,
  ).run(migrationTime, migrationTime);
  sqlite.prepare(
    `UPDATE extraction_runs SET error = NULL, error_code = NULL, next_attempt_at = NULL,
       lease_owner = NULL, lease_expires_at = NULL
     WHERE status = 'complete' AND (error IS NOT NULL OR error_code IS NOT NULL OR next_attempt_at IS NOT NULL
       OR lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL)`,
  ).run();
  const hasDuplicateQuestions = sqlite.prepare(
    "SELECT 1 FROM questions GROUP BY document_id, number HAVING COUNT(*) > 1 LIMIT 1",
  ).get();
  if (hasDuplicateQuestions) {
    sqlite.exec("DROP TABLE IF EXISTS temp._question_dedup");
    sqlite.exec(
    `CREATE TEMP TABLE _question_dedup AS
     SELECT id,
       FIRST_VALUE(id) OVER (
         PARTITION BY document_id, number
         ORDER BY
           CASE WHEN bbox_json <> '{"x":0,"y":0,"width":10,"height":10}' THEN 0 ELSE 1 END,
           CASE status WHEN 'approved' THEN 0 WHEN 'needs_attention' THEN 1 ELSE 2 END,
           CASE WHEN bbox_json <> '{"x":0,"y":0,"width":10,"height":10}' THEN page_number ELSE -page_number END,
           confidence DESC, created_at
       ) AS keep_id
     FROM questions`,
  );
    sqlite.exec(
    `UPDATE questions AS keep SET
       answer = CASE WHEN keep.answer = '' THEN COALESCE((
         SELECT duplicate.answer FROM _question_dedup map
         JOIN questions duplicate ON duplicate.id = map.id
         WHERE map.keep_id = keep.id AND map.id <> map.keep_id AND duplicate.answer <> ''
         ORDER BY LENGTH(duplicate.answer) DESC LIMIT 1
       ), keep.answer) ELSE keep.answer END,
       analysis = CASE WHEN keep.analysis = '' THEN COALESCE((
         SELECT duplicate.analysis FROM _question_dedup map
         JOIN questions duplicate ON duplicate.id = map.id
         WHERE map.keep_id = keep.id AND map.id <> map.keep_id AND duplicate.analysis <> ''
         ORDER BY LENGTH(duplicate.analysis) DESC LIMIT 1
       ), keep.analysis) ELSE keep.analysis END,
       score = MAX(keep.score, COALESCE((
         SELECT MAX(duplicate.score) FROM _question_dedup map
         JOIN questions duplicate ON duplicate.id = map.id
         WHERE map.keep_id = keep.id
       ), keep.score))
     WHERE keep.id IN (SELECT keep_id FROM _question_dedup WHERE id <> keep_id)`,
  );
    sqlite.exec(
    `INSERT OR IGNORE INTO question_tags(question_id, tag_id)
     SELECT map.keep_id, qt.tag_id FROM _question_dedup map
     JOIN question_tags qt ON qt.question_id = map.id
     WHERE map.id <> map.keep_id`,
  );
    sqlite.exec("DELETE FROM questions WHERE id IN (SELECT id FROM _question_dedup WHERE id <> keep_id)");
    sqlite.exec("DROP TABLE temp._question_dedup");
  }
  sqlite.prepare(
    `UPDATE questions SET status = 'needs_attention', needs_human_review = 1, updated_at = ?
      WHERE number = '' OR number GLOB '*[^0-9]*' OR CAST(number AS INTEGER) < 1
         OR CAST(CAST(number AS INTEGER) AS TEXT) <> number`,
  ).run(migrationTime);
  sqlite.prepare(
    `UPDATE documents SET status = 'reviewing', updated_at = ?
      WHERE status = 'complete' AND EXISTS (
        SELECT 1 FROM questions q WHERE q.document_id = documents.id
          AND (q.number = '' OR q.number GLOB '*[^0-9]*' OR CAST(q.number AS INTEGER) < 1
               OR CAST(CAST(q.number AS INTEGER) AS TEXT) <> q.number)
      )`,
  ).run(migrationTime);
  sqlite.exec("CREATE UNIQUE INDEX IF NOT EXISTS questions_document_number_idx ON questions(document_id, number)");
  sqlite.exec(
    `DELETE FROM question_assets WHERE id IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY question_id, page_id, kind, label, bbox_json ORDER BY created_at, id
         ) AS duplicate_position
         FROM question_assets WHERE crop_key IS NULL
       ) WHERE duplicate_position > 1
     )`,
  );
  initialized = true;
}

export async function ensureDatabase() {
  if (!initialized) initialize();
}

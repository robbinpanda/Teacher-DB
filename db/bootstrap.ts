import { getSqlite } from ".";

const schemaSql = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', name TEXT NOT NULL,
  mime_type TEXT NOT NULL, original_key TEXT, status TEXT NOT NULL DEFAULT 'uploading', page_count INTEGER NOT NULL DEFAULT 0,
  subject TEXT, grade TEXT, source_year INTEGER, source_exam_type TEXT, source_region TEXT, source_school TEXT,
  checksum TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
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
  idempotency_key TEXT, raw_json TEXT, error TEXT, created_at TEXT NOT NULL, finished_at TEXT
);
CREATE INDEX IF NOT EXISTS runs_document_idx ON extraction_runs(document_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS runs_idempotency_idx ON extraction_runs(idempotency_key);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  number TEXT NOT NULL, type TEXT NOT NULL, stem TEXT NOT NULL, options_json TEXT, answer TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '', page_number INTEGER NOT NULL, bbox_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', confidence REAL NOT NULL DEFAULT 0, score INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_document_page_idx ON questions(document_id, page_number);
CREATE INDEX IF NOT EXISTS questions_type_status_idx ON questions(type, status);
CREATE TABLE IF NOT EXISTS question_assets (
  id TEXT PRIMARY KEY NOT NULL, question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  page_id TEXT REFERENCES pages(id) ON DELETE SET NULL, kind TEXT NOT NULL, label TEXT NOT NULL DEFAULT '题图',
  source_key TEXT, crop_key TEXT, bbox_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_question_idx ON question_assets(question_id);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_idx ON tags(name);
CREATE TABLE IF NOT EXISTS question_tags (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(question_id, tag_id)
);
CREATE INDEX IF NOT EXISTS question_tags_tag_idx ON question_tags(tag_id);
CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL DEFAULT 'local-demo', title TEXT NOT NULL, subtitle TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS papers_owner_created_idx ON papers(owner_id, created_at);
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
  owner_id TEXT PRIMARY KEY NOT NULL, selected_model_profile_id TEXT, updated_at TEXT NOT NULL
);
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
  },
  pages: { status: "TEXT NOT NULL DEFAULT 'ready'", checksum: "TEXT" },
  extraction_runs: {
    page_id: "TEXT",
    page_number: "INTEGER",
    model_profile_id: "TEXT",
    attempt: "INTEGER NOT NULL DEFAULT 1",
    idempotency_key: "TEXT",
    finished_at: "TEXT",
  },
  questions: {
    confidence: "REAL NOT NULL DEFAULT 0",
    score: "INTEGER NOT NULL DEFAULT 0",
  },
  question_assets: {
    page_id: "TEXT",
    source_key: "TEXT",
    crop_key: "TEXT",
  },
  papers: {
    owner_id: "TEXT NOT NULL DEFAULT 'local-demo'",
    subtitle: "TEXT",
    settings_json: "TEXT NOT NULL DEFAULT '{}'",
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
  initialized = true;
}

export async function ensureDatabase() {
  if (!initialized) initialize();
}

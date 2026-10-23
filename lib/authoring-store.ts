import type Database from "better-sqlite3";

export const authoringSchemaSql = `
CREATE TABLE IF NOT EXISTS question_classifications (
 question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
 owner_id TEXT NOT NULL, fingerprint TEXT NOT NULL, catalog_version TEXT NOT NULL,
 content_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('suggested','confirmed')),
 model_profile_id TEXT, trace_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS classifications_owner_idx ON question_classifications(owner_id, status);
CREATE TABLE IF NOT EXISTS question_knowledge (
 question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
 knowledge_id TEXT NOT NULL, PRIMARY KEY(question_id, knowledge_id)
);
CREATE INDEX IF NOT EXISTS question_knowledge_lookup_idx ON question_knowledge(knowledge_id, question_id);
CREATE TABLE IF NOT EXISTS authoring_projects (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, subject TEXT NOT NULL, stage TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('paper','variation','handout','book')),
 title TEXT NOT NULL, request_json TEXT NOT NULL, plan_json TEXT,
 status TEXT NOT NULL DEFAULT 'draft', revision INTEGER NOT NULL DEFAULT 1,
 error TEXT, lease_owner TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS authoring_projects_owner_idx ON authoring_projects(owner_id, subject, stage, updated_at);
CREATE TABLE IF NOT EXISTS authoring_chapters (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES authoring_projects(id) ON DELETE CASCADE,
 position INTEGER NOT NULL, plan_json TEXT NOT NULL, content_json TEXT,
 status TEXT NOT NULL DEFAULT 'pending', error TEXT, attempt INTEGER NOT NULL DEFAULT 0,
 lease_owner TEXT, lease_expires_at TEXT, updated_at TEXT NOT NULL,
 UNIQUE(project_id, position)
);`;

export function installAuthoringSchema(sqlite: Database.Database) { sqlite.exec(authoringSchemaSql); }

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  approveDocumentsWithoutReview,
  deleteDocuments,
  DocumentBulkActionError,
  normalizeDocumentIds,
} from "../lib/document-bulk-actions.ts";

function database() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, status TEXT, source_removed_at TEXT, page_count INTEGER, updated_at TEXT);
    CREATE TABLE pages (id TEXT PRIMARY KEY, document_id TEXT, page_number INTEGER);
    CREATE TABLE extraction_runs (id TEXT PRIMARY KEY, document_id TEXT, page_number INTEGER, status TEXT);
    CREATE TABLE questions (id TEXT PRIMARY KEY, document_id TEXT, number TEXT, status TEXT, needs_human_review INTEGER, updated_at TEXT);
  `);
  return sqlite;
}

function addDocument(sqlite, id, complete = true) {
  sqlite.prepare("INSERT INTO documents VALUES (?, 'teacher', ?, 'reviewing', NULL, 1, 'before')").run(id, id);
  sqlite.prepare("INSERT INTO pages VALUES (?, ?, 1)").run(`${id}-page`, id);
  sqlite.prepare("INSERT INTO extraction_runs VALUES (?, ?, 1, ?)").run(`${id}-run`, id, complete ? "complete" : "queued");
}

test("批量试卷 id 去重且限制为 1 到 100 份", () => {
  assert.deepEqual(normalizeDocumentIds(["a", " a ", "b"]), ["a", "b"]);
  assert.throws(() => normalizeDocumentIds([]), DocumentBulkActionError);
  assert.throws(() => normalizeDocumentIds(Array.from({ length: 101 }, (_, index) => String(index))), DocumentBulkActionError);
});

test("批量完成只入库模型明确无需人工核查的题目", () => {
  const sqlite = database();
  addDocument(sqlite, "a");
  addDocument(sqlite, "b");
  sqlite.exec(`
    INSERT INTO questions VALUES ('a1', 'a', '1', 'pending', 0, 'before');
    INSERT INTO questions VALUES ('a2', 'a', '2', 'needs_attention', 1, 'before');
    INSERT INTO questions VALUES ('b1', 'b', '1', 'pending', 0, 'before');
  `);
  const outcome = sqlite.transaction(() => approveDocumentsWithoutReview(sqlite, {
    ownerId: "teacher",
    documentIds: ["a", "b"],
    timestamp: "after",
    reviewReadinessError: () => null,
  }))();
  assert.equal(outcome.changed, 2);
  assert.deepEqual(sqlite.prepare("SELECT id, status FROM documents ORDER BY id").all(), [
    { id: "a", status: "reviewing" },
    { id: "b", status: "complete" },
  ]);
  assert.deepEqual(sqlite.prepare("SELECT id, status FROM questions ORDER BY id").all(), [
    { id: "a1", status: "approved" },
    { id: "a2", status: "needs_attention" },
    { id: "b1", status: "approved" },
  ]);
  sqlite.close();
});

test("任意选中试卷不完整时整批回滚", () => {
  const sqlite = database();
  addDocument(sqlite, "a");
  addDocument(sqlite, "b", false);
  sqlite.exec(`
    INSERT INTO questions VALUES ('a1', 'a', '1', 'pending', 0, 'before');
    INSERT INTO questions VALUES ('b1', 'b', '1', 'pending', 0, 'before');
  `);
  assert.throws(() => sqlite.transaction(() => approveDocumentsWithoutReview(sqlite, {
    ownerId: "teacher",
    documentIds: ["a", "b"],
    timestamp: "after",
    reviewReadinessError: (documentId) => documentId === "b" ? "识别尚未完成" : null,
  }))(), DocumentBulkActionError);
  assert.deepEqual(sqlite.prepare("SELECT status FROM questions ORDER BY id").pluck().all(), ["pending", "pending"]);
  sqlite.close();
});

test("批量删除在同一事务中移除试卷、题目和组卷引用", () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, owner_id TEXT, name TEXT, status TEXT, source_removed_at TEXT, original_key TEXT);
    CREATE TABLE pages (id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE, storage_key TEXT);
    CREATE TABLE questions (id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE);
    CREATE TABLE question_assets (id TEXT PRIMARY KEY, question_id TEXT REFERENCES questions(id) ON DELETE CASCADE, crop_key TEXT);
    CREATE TABLE paper_items (id TEXT PRIMARY KEY, question_id TEXT);
    CREATE TABLE tags (id TEXT PRIMARY KEY);
    CREATE TABLE question_tags (question_id TEXT, tag_id TEXT);
    CREATE TABLE document_jobs (document_id TEXT);
    CREATE TABLE extraction_runs (document_id TEXT);
    INSERT INTO documents VALUES ('a', 'teacher', 'A', 'reviewing', NULL, 'a.pdf'), ('b', 'teacher', 'B', 'reviewing', NULL, 'b.pdf');
    INSERT INTO pages VALUES ('pa', 'a', 'a.jpg'), ('pb', 'b', 'b.jpg');
    INSERT INTO questions VALUES ('qa', 'a'), ('qb', 'b');
    INSERT INTO question_assets VALUES ('asset-a', 'qa', 'a-crop.jpg');
    INSERT INTO paper_items VALUES ('item-a', 'qa'), ('item-b', 'qb');
  `);
  const outcome = sqlite.transaction(() => deleteDocuments(sqlite, {
    ownerId: "teacher",
    documentIds: ["a", "b"],
    mode: "with_questions",
    timestamp: "after",
  }))();
  assert.equal(outcome.deleted, 2);
  assert.deepEqual(new Set(outcome.fileKeys), new Set(["a.pdf", "b.pdf", "a.jpg", "b.jpg", "a-crop.jpg"]));
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM documents").pluck().get(), 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM questions").pluck().get(), 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) FROM paper_items").pluck().get(), 0);
  sqlite.close();
});

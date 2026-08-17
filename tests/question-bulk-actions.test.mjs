import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  deleteQuestions,
  normalizeQuestionIds,
  QuestionBulkActionError,
} from "../lib/question-bulk-actions.ts";

test("批量题目 id 会去重并限制数量", () => {
  assert.deepEqual(normalizeQuestionIds(["q1", " q1 ", "q2"]), ["q1", "q2"]);
  assert.throws(() => normalizeQuestionIds([]), QuestionBulkActionError);
  assert.throws(() => normalizeQuestionIds(Array.from({ length: 501 }, (_, index) => `q${index}`)), QuestionBulkActionError);
});

test("批量删除题目同时清理组卷引用并保留原试卷", () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, owner_id TEXT, status TEXT, source_removed_at TEXT, updated_at TEXT);
    CREATE TABLE questions (id TEXT PRIMARY KEY, document_id TEXT REFERENCES documents(id) ON DELETE CASCADE);
    CREATE TABLE question_assets (id TEXT PRIMARY KEY, question_id TEXT REFERENCES questions(id) ON DELETE CASCADE, crop_key TEXT);
    CREATE TABLE paper_items (question_id TEXT);
    CREATE TABLE tags (id TEXT PRIMARY KEY);
    CREATE TABLE question_tags (question_id TEXT, tag_id TEXT);
    INSERT INTO documents VALUES ('d1', 'teacher', 'complete', NULL, 'before');
    INSERT INTO questions VALUES ('q1', 'd1'), ('q2', 'd1');
    INSERT INTO question_assets VALUES ('a1', 'q1', 'crop-1.jpg');
    INSERT INTO paper_items VALUES ('q1'), ('q2');
  `);
  const outcome = sqlite.transaction(() => deleteQuestions(sqlite, {
    ownerId: "teacher",
    questionIds: ["q1"],
    timestamp: "after",
  }))();
  assert.equal(outcome.deleted, 1);
  assert.deepEqual(outcome.fileKeys, ["crop-1.jpg"]);
  assert.deepEqual(sqlite.prepare("SELECT id FROM questions").pluck().all(), ["q2"]);
  assert.deepEqual(sqlite.prepare("SELECT question_id FROM paper_items").pluck().all(), ["q2"]);
  assert.deepEqual(sqlite.prepare("SELECT status, updated_at AS updatedAt FROM documents").get(), { status: "reviewing", updatedAt: "after" });
  sqlite.close();
});

import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { finalizeDocumentState, unresolvedAnswerUpdateNumbers } from "../lib/document-finalization.ts";

test("收尾时忽略后来已经落库的暂时未匹配答案", () => {
  assert.deepEqual(
    unresolvedAnswerUpdateNumbers(["12", "21"], ["21", "22", "0", "bad"], ["1", "12", "21"]),
    ["22"],
  );
});

test("收尾事务只更新文档与任务状态，不重放原始模型内容", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, status TEXT, error TEXT, updated_at TEXT);
    CREATE TABLE document_jobs (
      document_id TEXT PRIMARY KEY, status TEXT, next_attempt_at TEXT, lease_owner TEXT,
      lease_expires_at TEXT, last_error TEXT, stream_phase TEXT, stream_message TEXT,
      finished_at TEXT, updated_at TEXT
    );
    CREATE TABLE questions (id TEXT PRIMARY KEY, document_id TEXT, number TEXT, analysis TEXT);
    INSERT INTO documents VALUES ('document-1', 'extracting', NULL, 'before');
    INSERT INTO document_jobs VALUES ('document-1', 'processing', NULL, 'worker-1', 'future', NULL, 'receiving', NULL, NULL, 'before');
    INSERT INTO questions VALUES ('question-18', 'document-1', '18', '已人工修复的第18题解析');
  `);

  sqlite.transaction(() => finalizeDocumentState(sqlite, {
    documentId: "document-1",
    terminalError: null,
    timestamp: "after",
  }))();

  assert.deepEqual(sqlite.prepare("SELECT status, error, updated_at AS updatedAt FROM documents").get(), {
    status: "reviewing",
    error: null,
    updatedAt: "after",
  });
  assert.equal(sqlite.prepare("SELECT status FROM document_jobs").pluck().get(), "complete");
  assert.equal(sqlite.prepare("SELECT analysis FROM questions WHERE id = 'question-18'").pluck().get(), "已人工修复的第18题解析");
  sqlite.close();
});

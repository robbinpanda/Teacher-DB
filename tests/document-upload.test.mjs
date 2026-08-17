import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { findReusableDocument } from "../lib/document-upload.ts";

function database() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, original_key TEXT,
      page_count INTEGER NOT NULL, status TEXT NOT NULL, checksum TEXT,
      source_removed_at TEXT, created_at TEXT NOT NULL
    );
  `);
  return sqlite;
}

test("删除过来源的试卷不会阻止相同 PDF 重新上传", () => {
  const sqlite = database();
  sqlite.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("deleted", "teacher", null, 21, "reviewing", "same-pdf", "2026-08-17", "before");

  assert.equal(findReusableDocument(sqlite, "teacher", "same-pdf"), undefined);
  sqlite.close();
});

test("来源仍存在的相同 PDF 继续复用现有试卷", () => {
  const sqlite = database();
  sqlite.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("active", "teacher", "active.pdf", 21, "extracting", "same-pdf", null, "after");

  assert.deepEqual(findReusableDocument(sqlite, "teacher", "same-pdf"), {
    id: "active",
    originalKey: "active.pdf",
    pageCount: 21,
    status: "extracting",
  });
  sqlite.close();
});

test("存在历史软删除记录时优先复用当前有效记录", () => {
  const sqlite = database();
  const insert = sqlite.prepare("INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  insert.run("deleted", "teacher", null, 21, "reviewing", "same-pdf", "2026-08-17", "before");
  insert.run("active", "teacher", "active.pdf", 21, "complete", "same-pdf", null, "after");

  assert.equal(findReusableDocument(sqlite, "teacher", "same-pdf")?.id, "active");
  sqlite.close();
});

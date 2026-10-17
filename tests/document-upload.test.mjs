import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { findReusableDocument, resolveUploadDestination } from "../lib/document-upload.ts";

test("导入自动使用目标题库，缺省年级随学段选择，拒绝不匹配的元数据", () => {
  for (const [stage, grade] of [['primary','六年级'],['middle','九年级'],['high','高三']]) {
    assert.deepEqual(resolveUploadDestination({subject:'英语',stage},{}),{subject:'英语',grade});
  }
  assert.deepEqual(resolveUploadDestination({subject:'英语',stage:'primary'},{subject:'英语',grade:'三年级'}),{subject:'英语',grade:'三年级'});
  assert.throws(() => resolveUploadDestination({subject:'英语',stage:'primary'},{subject:'数学',grade:'三年级'}), /学科与目标题库不一致/);
  assert.throws(() => resolveUploadDestination({subject:'英语',stage:'primary'},{grade:'高三'}), /年级不属于/);
});

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

test("同一 PDF 仅在相同学科和学段中去重", () => {
  const sqlite = database();
  sqlite.exec("ALTER TABLE documents ADD COLUMN subject TEXT; ALTER TABLE documents ADD COLUMN grade TEXT");
  const insert = sqlite.prepare("INSERT INTO documents VALUES (?, 'teacher', 'paper.pdf', 1, 'complete', 'same-pdf', NULL, 'now', ?, ?)");
  insert.run("middle-math", "数学", "九年级");
  insert.run("high-math", "数学", "高三");
  assert.equal(findReusableDocument(sqlite, "teacher", "same-pdf", {subject:"数学",stage:"middle"})?.id, "middle-math");
  assert.equal(findReusableDocument(sqlite, "teacher", "same-pdf", {subject:"数学",stage:"high"})?.id, "high-math");
  assert.equal(findReusableDocument(sqlite, "teacher", "same-pdf", {subject:"英语",stage:"middle"}), undefined);
  sqlite.close();
});

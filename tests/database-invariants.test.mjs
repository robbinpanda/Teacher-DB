import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { installDatabaseInvariants, repairFailedDocumentApprovals } from "../lib/database-invariants.ts";

function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE questions (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL, status TEXT NOT NULL,
      needs_human_review INTEGER, updated_at TEXT NOT NULL
    );
    INSERT INTO documents VALUES ('failed-old', 'failed', 't0'), ('active', 'reviewing', 't0');
    INSERT INTO questions VALUES
      ('q-old', 'failed-old', 'approved', 0, 't0'),
      ('q-active', 'active', 'approved', 0, 't0');
  `);
  return sqlite;
}

test("migration removes historical approvals from failed documents", () => {
  const sqlite = fixture();
  assert.equal(repairFailedDocumentApprovals(sqlite, "t1"), 1);
  assert.deepEqual(sqlite.prepare("SELECT status, needs_human_review AS review FROM questions WHERE id = 'q-old'").get(), {
    status: "needs_attention",
    review: 1,
  });
  assert.equal(sqlite.prepare("SELECT status FROM questions WHERE id = 'q-active'").get().status, "approved");
  sqlite.close();
});

test("failing a document atomically revokes its approved questions", () => {
  const sqlite = fixture();
  installDatabaseInvariants(sqlite);
  sqlite.transaction(() => {
    sqlite.prepare("UPDATE documents SET status = 'failed', updated_at = 't2' WHERE id = 'active'").run();
    const question = sqlite.prepare("SELECT status, needs_human_review AS review, updated_at AS updatedAt FROM questions WHERE id = 'q-active'").get();
    assert.deepEqual(question, { status: "needs_attention", review: 1, updatedAt: "t2" });
  })();
  sqlite.close();
});

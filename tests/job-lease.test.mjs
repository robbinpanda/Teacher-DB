import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import {
  assertDocumentLease,
  documentLeaseIsCurrent,
  LostDocumentLeaseError,
  renewDocumentLease,
} from "../lib/job-lease.ts";

function databaseWithLease() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE document_jobs (
    document_id TEXT PRIMARY KEY, status TEXT NOT NULL, lease_owner TEXT,
    lease_expires_at TEXT, updated_at TEXT NOT NULL
  )`);
  sqlite.prepare(
    "INSERT INTO document_jobs VALUES ('doc-1', 'processing', 'worker-new', '2026-08-07T12:10:00.000Z', '2026-08-07T12:00:00.000Z')",
  ).run();
  return sqlite;
}

test("only the current unexpired worker can renew or commit", () => {
  const sqlite = databaseWithLease();
  const now = "2026-08-07T12:05:00.000Z";
  assert.equal(documentLeaseIsCurrent(sqlite, "doc-1", "worker-new", now), true);
  assert.equal(documentLeaseIsCurrent(sqlite, "doc-1", "worker-old", now), false);
  assert.throws(
    () => assertDocumentLease(sqlite, "doc-1", "worker-old", now),
    LostDocumentLeaseError,
  );
  assert.equal(renewDocumentLease(sqlite, "doc-1", "worker-old", now, "2026-08-07T12:20:00.000Z"), false);
  assert.equal(renewDocumentLease(sqlite, "doc-1", "worker-new", now, "2026-08-07T12:20:00.000Z"), true);
  sqlite.close();
});

test("an expired lease cannot be resurrected by its old worker", () => {
  const sqlite = databaseWithLease();
  const afterExpiry = "2026-08-07T12:11:00.000Z";
  assert.equal(renewDocumentLease(sqlite, "doc-1", "worker-new", afterExpiry, "2026-08-07T12:30:00.000Z"), false);
  assert.throws(() => assertDocumentLease(sqlite, "doc-1", "worker-new", afterExpiry), LostDocumentLeaseError);
  sqlite.close();
});

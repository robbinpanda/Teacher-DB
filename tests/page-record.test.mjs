import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { PageContentLockedError, savePageRecord } from "../lib/page-record.ts";

function databaseForPages() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE documents (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, page_count INTEGER NOT NULL, source_removed_at TEXT
    );
    CREATE TABLE pages (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), page_number INTEGER NOT NULL,
      storage_key TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, status TEXT NOT NULL,
      checksum TEXT, created_at TEXT NOT NULL, UNIQUE(document_id, page_number)
    );
    CREATE TABLE extraction_runs (
      id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(id), page_id TEXT REFERENCES pages(id),
      page_number INTEGER, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL,
      idempotency_key TEXT UNIQUE, raw_json TEXT, error TEXT, error_code TEXT, next_attempt_at TEXT,
      lease_owner TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE TABLE question_regions (page_id TEXT);
    CREATE TABLE question_assets (page_id TEXT);
    INSERT INTO documents VALUES ('doc-1', 'owner-1', 2, NULL);
  `);
  return sqlite;
}

const firstPage = {
  documentId: "doc-1",
  ownerId: "owner-1",
  pageNumber: 1,
  storageKey: "documents/doc-1/pages/0001-aaa.jpg",
  width: 1200,
  height: 1800,
  checksum: "aaa",
  timestamp: "2026-08-07T12:00:00.000Z",
};

test("page and extraction run roll back together", () => {
  const sqlite = databaseForPages();
  const action = sqlite.transaction(() => {
    savePageRecord(sqlite, firstPage);
    throw new Error("forced rollback");
  });
  assert.throws(action, /forced rollback/);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pages").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM extraction_runs").get().count, 0);
  sqlite.close();
});

test("a page and its queued extraction run commit atomically", () => {
  const sqlite = databaseForPages();
  const result = sqlite.transaction(() => savePageRecord(sqlite, firstPage))();
  const page = sqlite.prepare("SELECT id, checksum FROM pages").get();
  const run = sqlite.prepare("SELECT page_id AS pageId, status FROM extraction_runs").get();
  assert.equal(result.created, true);
  assert.equal(page.checksum, "aaa");
  assert.equal(run.pageId, page.id);
  assert.equal(run.status, "queued");
  sqlite.close();
});

test("a different image cannot overwrite a page that already produced results", () => {
  const sqlite = databaseForPages();
  sqlite.transaction(() => savePageRecord(sqlite, firstPage))();
  sqlite.prepare("UPDATE extraction_runs SET status = 'complete'").run();
  const replacement = { ...firstPage, storageKey: "documents/doc-1/pages/0001-bbb.jpg", checksum: "bbb" };
  assert.throws(
    () => sqlite.transaction(() => savePageRecord(sqlite, replacement))(),
    PageContentLockedError,
  );
  const page = sqlite.prepare("SELECT storage_key AS storageKey, checksum FROM pages").get();
  assert.deepEqual(page, { storageKey: firstPage.storageKey, checksum: "aaa" });
  assert.equal(sqlite.prepare("SELECT status FROM extraction_runs").get().status, "complete");
  sqlite.close();
});

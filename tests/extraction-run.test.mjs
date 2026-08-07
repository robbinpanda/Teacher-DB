import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { activateExtractionRun } from "../lib/extraction-run.ts";

function fixture() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`CREATE TABLE extraction_runs (
    id TEXT PRIMARY KEY, document_id TEXT NOT NULL, page_id TEXT, page_number INTEGER,
    model_profile_id TEXT, provider TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL,
    attempt INTEGER NOT NULL, idempotency_key TEXT UNIQUE, raw_json TEXT, error TEXT,
    error_code TEXT, next_attempt_at TEXT, lease_owner TEXT, lease_expires_at TEXT,
    created_at TEXT NOT NULL, finished_at TEXT
  )`);
  return sqlite;
}

function input(proposedRunId) {
  return {
    proposedRunId,
    documentId: "doc-1",
    pageId: "page-1",
    pageNumber: 1,
    profileId: "profile-1",
    provider: "provider",
    model: "model",
    idempotencyKey: "doc-1:page:1:extract-v3",
    timestamp: "2026-08-07T12:00:00.000Z",
  };
}

test("retry preserves extraction run identity and increments attempt", () => {
  const sqlite = fixture();
  const first = activateExtractionRun(sqlite, input("run-original"));
  sqlite.prepare("UPDATE extraction_runs SET status = 'retry_wait', raw_json = '{}', error = 'retry'").run();
  const retry = activateExtractionRun(sqlite, input("run-must-not-replace-original"));
  assert.deepEqual(first, { id: "run-original", attempt: 1 });
  assert.deepEqual(retry, { id: "run-original", attempt: 2 });
  assert.deepEqual(sqlite.prepare("SELECT id, status, attempt, raw_json AS rawJson, error FROM extraction_runs").get(), {
    id: "run-original",
    status: "running",
    attempt: 2,
    rawJson: null,
    error: null,
  });
  sqlite.close();
});

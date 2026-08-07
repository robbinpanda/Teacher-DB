import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { getDocumentIntegrity, missingPositiveNumbers } from "../lib/document-integrity.ts";

test("finds missing numbers inside a recognized question sequence", () => {
  assert.deepEqual(missingPositiveNumbers([1, 2, 3, 6, 7]), [4, 5]);
});

test("finds missing source pages up to the declared PDF page count", () => {
  assert.deepEqual(missingPositiveNumbers([1, 2, 4], 4), [3]);
});

test("review remains blocked until every page completed and question numbering is contiguous", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE documents (id TEXT PRIMARY KEY, page_count INTEGER NOT NULL);
    CREATE TABLE pages (document_id TEXT NOT NULL, page_number INTEGER NOT NULL);
    CREATE TABLE extraction_runs (document_id TEXT NOT NULL, page_number INTEGER, status TEXT NOT NULL);
    CREATE TABLE questions (document_id TEXT NOT NULL, number TEXT NOT NULL);
    INSERT INTO documents VALUES ('paper', 3);
    INSERT INTO pages VALUES ('paper', 1), ('paper', 2);
    INSERT INTO extraction_runs VALUES ('paper', 1, 'complete'), ('paper', 2, 'complete');
    INSERT INTO questions VALUES ('paper', '1'), ('paper', '3');
  `);

  assert.deepEqual(getDocumentIntegrity(sqlite, "paper"), {
    pageCount: 3,
    storedPageNumbers: [1, 2],
    completedPageNumbers: [1, 2],
    missingPageNumbers: [3],
    unexpectedPageNumbers: [],
    incompletePageNumbers: [],
    questionNumbers: [1, 3],
    missingQuestionNumbers: [2],
    pagesComplete: false,
    questionsComplete: false,
    reviewReady: false,
  });
  sqlite.close();
});

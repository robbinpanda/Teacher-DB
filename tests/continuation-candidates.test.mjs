import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { loadContinuationCandidates } from "../lib/continuation-candidates.ts";

test("a question discovered by lookahead remains the continuation candidate on its own page", () => {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE questions (id TEXT PRIMARY KEY, document_id TEXT, number TEXT, page_number INTEGER, stem TEXT, analysis TEXT);
    CREATE TABLE question_regions (question_id TEXT, page_number INTEGER, bbox_json TEXT);
    INSERT INTO questions VALUES ('q20', 'paper', '20', 16, 'question 20', '');
    INSERT INTO question_regions VALUES ('q20', 16, '{"x":8,"y":44,"width":84,"height":48}');
  `);
  assert.equal(loadContinuationCandidates(sqlite, "paper", 16)[0]?.number, "20");
  assert.equal(loadContinuationCandidates(sqlite, "paper", 17)[0]?.number, "20");
  sqlite.close();
});

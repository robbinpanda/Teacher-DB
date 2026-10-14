import assert from "node:assert/strict";
import test from "node:test";
import { extractionCompletenessError, extractionResumeState } from "../lib/extraction-completeness.ts";
import { getDocumentIntegrity, integrityError } from "../lib/document-integrity.ts";
import Database from "better-sqlite3";
import { countsTowardExtractionCircuit } from "../lib/extraction-circuit.ts";

test("paper-local missing content retries without pausing every other paper", () => {
  assert.equal(countsTowardExtractionCircuit("incomplete_extraction"), false);
  assert.equal(countsTowardExtractionCircuit("provider_http_503"), true);
  assert.equal(countsTowardExtractionCircuit("network_error"), true);
});

test("resume skips durable questions and starts at the first blank or missing question", () => {
  const rows = [{ number: "1", stem: "保留第一题" }, { number: "2", stem: "" }, { number: "3", stem: "保留第三题" }];
  const resume = extractionResumeState(rows);
  assert.equal(resume.nextNumber, 2);
  assert.deepEqual(resume.completed.map(q => q.number), ["1", "3"]);
  assert.equal(extractionResumeState(resume.completed.concat({ number: "2", stem: "补齐第二题" })).nextNumber, 4);
});

test("meta-only, placeholders, missing tail and interrupted streams must retry", () => {
  const q = { number: "1", stem: "题干" };
  assert.match(extractionCompletenessError([], 21, true), /未返回/);
  assert.match(extractionCompletenessError([{ ...q, stem: " \n" }], 1, true), /题干为空/);
  assert.match(extractionCompletenessError([q], 2, true), /漏识别第 2/);
  assert.match(extractionCompletenessError([q], 1, false), /输出中断/);
  assert.equal(extractionCompletenessError([q], 1, true), null);
  assert.match(extractionCompletenessError([q,{number:'2',stem:'重试虚构尾题'}],1,true), /超过原卷总题数/);
  // No printed answer is valid; an empty stem is not.
  assert.equal(extractionCompletenessError([{ ...q, answer: "", analysis: "" }], null, true), null);
});

test("completed page runs cannot make blank persisted questions eligible for admission", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE documents(id TEXT, page_count INTEGER);
    CREATE TABLE pages(document_id TEXT, page_number INTEGER);
    CREATE TABLE extraction_runs(document_id TEXT,page_number INTEGER,status TEXT);
    CREATE TABLE questions(document_id TEXT,number TEXT,stem TEXT);
    INSERT INTO documents VALUES('d',1);
    INSERT INTO pages VALUES('d',1);
    INSERT INTO extraction_runs VALUES('d',1,'complete');
    INSERT INTO questions VALUES('d','1','   ');`);
  const integrity = getDocumentIntegrity(db, "d");
  assert.equal(integrity.reviewReady, false);
  assert.match(integrityError(integrity), /题干为空/);
  db.prepare("UPDATE questions SET stem='实际题干'").run();
  assert.equal(getDocumentIntegrity(db, "d").reviewReady, true);
  db.close();
});

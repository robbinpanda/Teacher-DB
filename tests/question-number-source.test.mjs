import assert from "node:assert/strict";
import test from "node:test";
import { acceptsQuestionNumberSource } from "../lib/question-number-source.ts";

test("printed question numbers are accepted without a continuation candidate", () => {
  assert.equal(acceptsQuestionNumberSource("20", "printed", new Set()), true);
});

test("continuations must use the exact current candidate number", () => {
  const candidates = new Set(["20"]);
  assert.equal(acceptsQuestionNumberSource("20", "continuation", candidates), true);
  assert.equal(acceptsQuestionNumberSource("18", "continuation", candidates), false);
});

test("missing or invented number-source values fail closed", () => {
  const candidates = new Set(["20"]);
  assert.equal(acceptsQuestionNumberSource("20", undefined, candidates), false);
  assert.equal(acceptsQuestionNumberSource("20", "guessed", candidates), false);
  assert.equal(acceptsQuestionNumberSource("0", "printed", candidates), false);
  assert.equal(acceptsQuestionNumberSource("01", "printed", candidates), false);
});

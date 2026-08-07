import assert from "node:assert/strict";
import test from "node:test";
import { extractionCoverageFailures } from "../lib/extraction-coverage.ts";

test("complete independent page audit passes", () => {
  assert.deepEqual(extractionCoverageFailures({
    rejectedNumberAssociations: [],
    discardedQuestionNumbers: [],
    uncoveredVisibleNumbers: [],
    missingPageAuditPages: [],
  }), []);
});

test("missing, discarded, or mis-associated questions force a retry", () => {
  assert.deepEqual(extractionCoverageFailures({
    rejectedNumberAssociations: ["answerUpdate:18:continuation"],
    discardedQuestionNumbers: ["20"],
    uncoveredVisibleNumbers: ["21"],
    missingPageAuditPages: [16],
  }), [
    "answerUpdate:18:continuation",
    "discarded-question:20",
    "uncovered-visible:21",
    "missing-page-audit:16",
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import { EXTRACTION_CIRCUIT_FAILURE_THRESHOLD, recordExtractionFailure, resetExtractionFailureStreak } from "../lib/extraction-circuit.ts";

test("连续三次识别失败后打开全局暂停熔断", () => {
  let streak = 0;
  for (let attempt = 1; attempt <= EXTRACTION_CIRCUIT_FAILURE_THRESHOLD; attempt += 1) {
    const state = recordExtractionFailure(streak);
    streak = state.failureStreak;
    assert.equal(state.shouldPause, attempt === EXTRACTION_CIRCUIT_FAILURE_THRESHOLD);
  }
});

test("成功识别后连续失败计数归零", () => {
  assert.equal(resetExtractionFailureStreak(), 0);
  assert.deepEqual(recordExtractionFailure(resetExtractionFailureStreak()), { failureStreak: 1, shouldPause: false });
});

test("异常的历史计数按零处理", () => {
  assert.deepEqual(recordExtractionFailure("invalid"), { failureStreak: 1, shouldPause: false });
});
